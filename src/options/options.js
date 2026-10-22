import "../shared/defaults.js";

const LTV = globalThis.LTV;
const $ = (id) => document.getElementById(id);

const WHISPER_PROVIDERS = [
  ["groq", "Groq – whisper-large-v3-turbo (rẻ, nhanh)"],
  ["openai", "OpenAI – whisper-1"],
];

// Một mục nhập API key (Claude hoặc Whisper): lưu ở storage.local, lựa chọn
// đi kèm (model / nhà cung cấp) lưu ở storage.sync.
function bindKeySection(config, settings) {
  const id = (name) => $(`${config.prefix}-${name}`);
  const showResult = (text, tone = "") => {
    id("result").textContent = text;
    id("result").className = `hint ${tone}`;
  };
  const select = id("select");
  select.replaceChildren(
    ...config.options.map(([value, label]) => new Option(label, value)),
  );
  select.value = settings[config.selectSetting];
  select.addEventListener("change", () =>
    chrome.storage.sync.set({ [config.selectSetting]: select.value }),
  );
  id("toggle").addEventListener("click", () => {
    const hidden = id("key").type === "password";
    id("key").type = hidden ? "text" : "password";
    id("toggle").textContent = hidden ? "Ẩn" : "Hiện";
  });
  id("save").addEventListener("click", async () => {
    const key = id("key").value.trim();
    await chrome.storage.local.set({ [config.storageKey]: key });
    if (key) await chrome.storage.sync.set(config.enable);
    showResult(key ? config.savedText : "Đã lưu (key trống).", "muted");
  });
  id("remove").addEventListener("click", async () => {
    id("key").value = "";
    await chrome.storage.local.remove(config.storageKey);
    await chrome.storage.sync.set(config.disable);
    showResult(config.removedText, "muted");
  });
  id("test").addEventListener("click", async () => {
    showResult("Đang kiểm tra…", "muted");
    const response = await chrome.runtime.sendMessage({
      type: config.testType,
      apiKey: id("key").value.trim(),
      [config.testField]: select.value,
    });
    if (response?.ok) showResult(config.okText(response), "");
    else showResult(`Lỗi: ${response?.error || "không rõ"}`, "error");
  });
}

async function refreshStats() {
  const [cache, transcripts] = await Promise.all([
    chrome.runtime.sendMessage({ type: "ltv:cacheStats" }),
    chrome.runtime.sendMessage({ type: "ltv:transcriptStats" }),
  ]);
  $("cache-stats").textContent = cache?.ok
    ? `Đang lưu bản dịch của ${cache.videos} video (${(cache.bytes / (1024 * 1024)).toFixed(2)} MB).`
    : "Không đọc được bộ nhớ đệm.";
  $("transcript-stats").textContent = transcripts?.ok
    ? `Đang lưu lời chép của ${transcripts.videos} video.`
    : "Không đọc được lời chép đã lưu.";
}

async function init() {
  const settings = LTV.mergeSettings(await chrome.storage.sync.get(null));
  const keys = await chrome.storage.local.get([
    "claudeApiKey",
    "whisperApiKey",
  ]);
  $("claude-key").value = keys.claudeApiKey || "";
  $("whisper-key").value = keys.whisperApiKey || "";
  bindKeySection(
    {
      prefix: "claude",
      storageKey: "claudeApiKey",
      options: LTV.CLAUDE_MODELS,
      selectSetting: "claudeModel",
      enable: { translator: "claude" },
      disable: { translator: "google" },
      savedText: "Đã lưu. Bộ dịch đã chuyển sang Claude.",
      removedText: "Đã xoá key. Bộ dịch quay về Google Dịch.",
      testType: "ltv:testClaude",
      testField: "model",
      okText: (response) => `Key hoạt động. Bản dịch thử:\n“${response.text}”`,
    },
    settings,
  );
  bindKeySection(
    {
      prefix: "whisper",
      storageKey: "whisperApiKey",
      options: WHISPER_PROVIDERS,
      selectSetting: "whisperProvider",
      enable: { asrEngine: "whisper" },
      disable: { asrEngine: "chrome" },
      savedText: "Đã lưu. Video không có phụ đề sẽ được chép lời bằng Whisper.",
      removedText: "Đã xoá key. Quay về chép lời bằng Chrome (miễn phí).",
      testType: "ltv:testWhisper",
      testField: "provider",
      okText: () => "Key hoạt động.",
    },
    settings,
  );
  $("clear-cache").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "ltv:cacheClear" });
    refreshStats();
  });
  $("clear-transcripts").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "ltv:transcriptClear" });
    refreshStats();
  });
  refreshStats();
}

init();
