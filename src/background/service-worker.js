// Service worker: nhận yêu cầu từ content script qua port "ltv" (dịch, đọc,
// cache, tải phụ đề chéo nguồn) và từ popup/options/offscreen qua message.
import "../shared/defaults.js";
import { translateGoogle } from "./translate-google.js";
import { translateClaude } from "./translate-claude.js";
import { createSpeech } from "./tts.js";
import { createOffscreenDoc } from "./offscreen-doc.js";
import { createTranslateRouter } from "./translate-router.js";
import { createChromeTranslate } from "./translate-chrome.js";
import { createCache } from "./cache.js";
import { createFetchGuard } from "./fetch-guard.js";
import { testWhisperKey, transcribeWhisper } from "./transcribe-whisper.js";
import { createTranscriptStore } from "./transcripts.js";
import { createLibrary } from "./library.js";

const LTV = globalThis.LTV;
const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

const ports = new Map();
const cache = createCache({ storage: chrome.storage.local });
const transcripts = createTranscriptStore({ storage: chrome.storage.local });
const library = createLibrary({ cache, transcripts });
const isFetchAllowed = createFetchGuard(chrome.runtime.getManifest());

function safePost(port, message) {
  try {
    port?.postMessage(message);
  } catch {
    // Port đã đóng (tab đóng hoặc điều hướng) – bỏ qua.
  }
}

const offscreenDoc = createOffscreenDoc();
const speech = createSpeech({
  emit: (owner, message) => safePost(ports.get(owner), message),
  ensureOffscreen: () => offscreenDoc.ensure(),
});

async function readSettings() {
  return LTV.mergeSettings(await chrome.storage.sync.get(null));
}

const translate = createTranslateRouter({
  google: translateGoogle,
  engines: {
    claude: async (request) => {
      const { claudeApiKey } = await chrome.storage.local.get("claudeApiKey");
      const { claudeModel } = await readSettings();
      return translateClaude({
        ...request,
        apiKey: claudeApiKey,
        model: claudeModel,
      });
    },
    chrome: createChromeTranslate({
      ensureOffscreen: () => offscreenDoc.ensure(),
    }),
  },
});

async function fetchText(url) {
  if (!isFetchAllowed(url))
    return { ok: false, status: 0, error: "URL không được phép" };
  try {
    const response = await fetch(url, { credentials: "include" });
    const text = await response.text();
    if (text.length > MAX_FETCH_BYTES)
      return { ok: false, status: 413, error: "Phụ đề quá lớn" };
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, error: error.message || "Lỗi mạng" };
  }
}

// Giọng máy phù hợp ngôn ngữ đích (ưu tiên giọng cài cục bộ), hoặc null.
async function systemVoiceFor(lang) {
  const voices = await chrome.tts.getVoices();
  const base = LTV.baseLang(lang);
  const matching = voices.filter(
    (voice) => voice.lang && LTV.baseLang(voice.lang) === base,
  );
  const local = matching.find((voice) => !voice.remote);
  return (local || matching[0])?.voiceName || null;
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(String(value || "")), (char) =>
    char.charCodeAt(0),
  );
}

// Chép lời một đoạn âm thanh (base64) bằng Whisper với key đã lưu.
async function transcribeChunk({ audio, mime, lang, prompt }) {
  try {
    const bytes = base64ToBytes(audio);
    if (bytes.length > MAX_AUDIO_BYTES) {
      return { ok: false, error: "Đoạn âm thanh quá lớn" };
    }
    const { whisperApiKey } = await chrome.storage.local.get("whisperApiKey");
    const { whisperProvider } = await readSettings();
    const result = await transcribeWhisper({
      audio: new Blob([bytes], { type: mime || "audio/webm" }),
      mime,
      lang,
      prompt,
      provider: whisperProvider,
      apiKey: whisperApiKey,
    });
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      code: error.code || "",
      error: error.message || "Lỗi chép lời",
    };
  }
}

// Lệnh từ content script. Handler trả về phản hồi (gửi lại kèm reqId) hoặc
// undefined khi không cần trả lời.
const portHandlers = {
  translate: async (message) => ({
    type: "translated",
    ...(await translate(message)),
  }),
  speak: async (message, ctx) => {
    await speech.speak({
      owner: ctx.owner,
      uttId: String(message.uttId),
      text: String(message.text || ""),
      lang: message.lang,
      rate: message.rate,
      volume: message.volume,
      engine: message.engine,
      voiceName: message.voiceName,
    });
  },
  stop: (message, ctx) => {
    speech.stop(ctx.owner);
  },
  prefetch: async (message) => {
    if (message.engine === "google") {
      await speech.prefetch(message.texts, message.lang);
    }
  },
  "cache:get": async (message) => ({
    type: "cache",
    items: await cache.get(message.key),
  }),
  "cache:put": (message) => {
    cache.merge(message.key, message.items);
  },
  fetchText: async (message) => ({
    type: "fetched",
    ...(await fetchText(message.url)),
  }),
  voices: async (message) => ({
    type: "voices",
    voice: await systemVoiceFor(message.lang),
  }),
  "asr:whisper": async (message) => ({
    type: "asr",
    ...(await transcribeChunk(message)),
  }),
  "transcript:get": async (message) => ({
    type: "transcript",
    entry: await transcripts.get(message.key),
  }),
  "transcript:put": async (message) => {
    await transcripts.put(message.key, message);
  },
  "library:lookup": async (message) => ({
    type: "library",
    ...(await library.lookup(message)),
  }),
};

async function handlePortMessage(port, ctx, message) {
  const handler = portHandlers[message?.type];
  if (!handler) return;
  const reply = await handler(message, ctx);
  if (reply && message.reqId)
    safePost(port, { ...reply, reqId: message.reqId });
}

// Mỗi frame (trang chính hoặc video nhúng) có port riêng; owner = tab:frame.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ltv" || !port.sender?.tab) return;
  const tabId = port.sender.tab.id;
  const frameId = port.sender.frameId ?? 0;
  const ctx = { owner: `${tabId}:${frameId}`, tabId, frameId };
  ports.set(ctx.owner, port);
  port.onMessage.addListener((message) => {
    handlePortMessage(port, ctx, message).catch((error) => {
      console.warn("[Lồng Tiếng Việt]", error);
    });
  });
  port.onDisconnect.addListener(() => {
    if (ports.get(ctx.owner) !== port) return;
    ports.delete(ctx.owner);
    speech.stop(ctx.owner);
  });
});

// Bộ script của trang chính (không phải bộ chạy trong khung video nhúng).
function isolatedContentFiles() {
  const scripts = chrome.runtime.getManifest().content_scripts || [];
  const main = scripts.find(
    (entry) => entry.js.includes("content/main.js") && !entry.all_frames,
  );
  return main ? main.js : [];
}

// "Thử lồng tiếng trang này": nạp script vào trang chưa hỗ trợ sẵn (activeTab).
async function injectIntoTab(tabId) {
  const target = { tabId, frameIds: [0] };
  await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    files: ["content/page-hook.js"],
  });
  await chrome.scripting.executeScript({
    target,
    files: isolatedContentFiles(),
  });
  await chrome.tabs.sendMessage(
    tabId,
    { type: "ltv:toggle", force: true },
    { frameId: 0 },
  );
}

async function testClaude({ apiKey, model }) {
  const [text] = await translateClaude({
    texts: ["Welcome back! In this lesson we will see how the knight moves."],
    sl: "en",
    tl: "vi",
    apiKey,
    model,
  });
  return text;
}

const messageHandlers = {
  "ltv:preview": async (message) => {
    await speech.speak({
      ...message.utterance,
      owner: "preview",
      uttId: `preview-${Date.now()}`,
    });
    return { ok: true };
  },
  "ltv:testClaude": async (message) => ({
    ok: true,
    text: await testClaude(message),
  }),
  "ltv:cacheStats": async () => ({ ok: true, ...(await cache.stats()) }),
  "ltv:cacheClear": async () => {
    await cache.clear();
    return { ok: true };
  },
  "ltv:testWhisper": async (message) => {
    await testWhisperKey(message);
    return { ok: true };
  },
  "ltv:transcriptStats": async () => ({
    ok: true,
    videos: await transcripts.count(),
  }),
  "ltv:transcriptClear": async () => {
    await transcripts.clear();
    return { ok: true };
  },
  "ltv:inject": async (message) => {
    await injectIntoTab(message.tabId);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "background") {
    // Chỉ offscreen document của tiện ích gửi sự kiện giọng đọc.
    if (sender.url === offscreenDoc.url() && message.type === "speech")
      speech.handleOffscreenEvent(message);
    return false;
  }
  // Chỉ trang của chính tiện ích (popup, options) được gọi các lệnh này,
  // không phải content script chạy trong trang web.
  const handler = messageHandlers[message?.type];
  const fromExtensionPage =
    sender.id === chrome.runtime.id &&
    sender.url?.startsWith(chrome.runtime.getURL(""));
  if (!handler || !fromExtensionPage) return false;
  handler(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: error?.message || String(error) }),
    );
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-dubbing") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined)
    chrome.tabs.sendMessage(tab.id, { type: "ltv:toggle" }).catch(() => {});
});
