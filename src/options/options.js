import "../shared/defaults.js";
import "../shared/glossary.js";
import { initChromePack } from "../popup/chrome-pack.js";

const LTV = globalThis.LTV;
const $ = (id) => document.getElementById(id);

const WHISPER_PROVIDERS = [
  ["groq", "Groq – whisper-large-v3-turbo (rẻ, nhanh)"],
  ["openai", "OpenAI – whisper-1"],
];

// Một mục nhập API key (Claude, Whisper, giọng AI): key lưu ở storage.local,
// lựa chọn đi kèm (model / nhà cung cấp / vùng) lưu ở storage.sync.
function bindKeySection(config, settings) {
  const id = (name) => $(`${config.prefix}-${name}`);
  const showResult = (text, tone = "") => {
    id("result").textContent = text;
    id("result").className = `hint ${tone}`;
  };
  // Lựa chọn đi kèm là tuỳ chọn (Google Cloud không có).
  const select = config.options ? id("select") : null;
  if (select) {
    select.replaceChildren(
      ...config.options.map(([value, label]) => new Option(label, value)),
    );
    select.value = settings[config.selectSetting];
    select.addEventListener("change", () =>
      chrome.storage.sync.set({ [config.selectSetting]: select.value }),
    );
  }
  id("toggle").addEventListener("click", () => {
    const hidden = id("key").type === "password";
    id("key").type = hidden ? "text" : "password";
    id("toggle").textContent = hidden ? "Ẩn" : "Hiện";
  });
  async function runTest(prefix = "") {
    showResult(`${prefix}Đang kiểm tra…`, "muted");
    const response = await chrome.runtime.sendMessage({
      ...config.testExtra,
      type: config.testType,
      apiKey: id("key").value.trim(),
      ...(select ? { [config.testField]: select.value } : {}),
    });
    if (response?.ok) showResult(prefix + config.okText(response), "");
    else showResult(`${prefix}Lỗi: ${response?.error || "không rõ"}`, "error");
  }
  id("save").addEventListener("click", async () => {
    const key = id("key").value.trim();
    await chrome.storage.local.set({ [config.storageKey]: key });
    if (key) await chrome.storage.sync.set(config.enable);
    showResult(key ? config.savedText : "Đã lưu (key trống).", "muted");
    // Giọng AI: tải luôn danh sách giọng để chọn trong popup.
    if (key && config.testOnSave) await runTest(`${config.savedText} `);
  });
  id("remove").addEventListener("click", async () => {
    id("key").value = "";
    await chrome.storage.local.remove(config.storageKey);
    // Chỉ trả về mặc định khi tiện ích còn đang dùng dịch vụ này.
    const current = await chrome.storage.sync.get(Object.keys(config.enable));
    const revert = Object.fromEntries(
      Object.entries(config.disable).filter(
        ([key]) => current[key] === config.enable[key],
      ),
    );
    if (Object.keys(revert).length > 0) await chrome.storage.sync.set(revert);
    showResult(config.removedText, "muted");
  });
  id("test").addEventListener("click", () => runTest());
}

const cloudOkText = (response) =>
  `Key hoạt động: ${response.count} giọng, trong đó ${response.vietnamese} giọng tiếng Việt. Chọn giọng trong popup → Giọng.`;

// Giọng AI đám mây: Azure (có chọn vùng) và Google Cloud.
function bindCloudVoices(settings) {
  bindKeySection(
    {
      prefix: "azure",
      storageKey: "azureTtsKey",
      options: LTV.AZURE_REGIONS,
      selectSetting: "azureRegion",
      enable: { voiceEngine: "azure" },
      disable: { voiceEngine: "google" },
      savedText: "Đã lưu. Giọng đọc đã chuyển sang Azure.",
      removedText: "Đã xoá key Azure.",
      testType: "ltv:testCloudTts",
      testExtra: { engine: "azure" },
      testField: "region",
      testOnSave: true,
      okText: cloudOkText,
    },
    settings,
  );
  bindKeySection(
    {
      prefix: "gcloud",
      storageKey: "gcloudTtsKey",
      enable: { voiceEngine: "gcloud" },
      disable: { voiceEngine: "google" },
      savedText: "Đã lưu. Giọng đọc đã chuyển sang Google Cloud.",
      removedText: "Đã xoá key Google Cloud.",
      testType: "ltv:testCloudTts",
      testExtra: { engine: "gcloud" },
      testOnSave: true,
      okText: cloudOkText,
    },
    settings,
  );
}

// Từ điển thuật ngữ riêng (storage.sync, tối đa 2000 ký tự).
function bindCustomTerms(settings) {
  $("custom-terms").value = settings.customTerms;
  $("custom-terms-save").addEventListener("click", async () => {
    const text = $("custom-terms").value.slice(0, 2000);
    await chrome.storage.sync.set({ customTerms: text });
    const count = LTV.glossary.parseCustom(text).length;
    $("custom-terms-result").textContent = `Đã lưu ${count} thuật ngữ.`;
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
    "azureTtsKey",
    "gcloudTtsKey",
  ]);
  $("claude-key").value = keys.claudeApiKey || "";
  $("whisper-key").value = keys.whisperApiKey || "";
  $("azure-key").value = keys.azureTtsKey || "";
  $("gcloud-key").value = keys.gcloudTtsKey || "";
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
  bindCustomTerms(settings);
  bindCloudVoices(settings);
  $("clear-cache").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "ltv:cacheClear" });
    refreshStats();
  });
  $("clear-transcripts").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "ltv:transcriptClear" });
    refreshStats();
  });
  refreshStats();
  initChromePack({
    getSettings: () => settings,
    getSourceLang: () =>
      settings.sourceLang !== "auto" ? settings.sourceLang : "en",
    isVisible: () => true,
  }).refresh();
}

init();
