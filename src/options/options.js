import "../shared/defaults.js";

const LTV = globalThis.LTV;
const $ = (id) => document.getElementById(id);

function showResult(text, tone = "") {
  $("test-result").textContent = text;
  $("test-result").className = `hint ${tone}`;
}

async function refreshCacheStats() {
  const stats = await chrome.runtime.sendMessage({ type: "ltv:cacheStats" });
  if (!stats?.ok) {
    $("cache-stats").textContent = "Không đọc được bộ nhớ đệm.";
    return;
  }
  const megabytes = (stats.bytes / (1024 * 1024)).toFixed(2);
  $("cache-stats").textContent =
    `Đang lưu bản dịch của ${stats.videos} video (${megabytes} MB).`;
}

async function init() {
  const settings = LTV.mergeSettings(await chrome.storage.sync.get(null));
  const { claudeApiKey } = await chrome.storage.local.get("claudeApiKey");
  $("api-key").value = claudeApiKey || "";
  $("model").replaceChildren(
    ...LTV.CLAUDE_MODELS.map(([id, label]) => new Option(label, id)),
  );
  $("model").value = settings.claudeModel;

  $("model").addEventListener("change", () =>
    chrome.storage.sync.set({ claudeModel: $("model").value }),
  );
  $("toggle-key").addEventListener("click", () => {
    const hidden = $("api-key").type === "password";
    $("api-key").type = hidden ? "text" : "password";
    $("toggle-key").textContent = hidden ? "Ẩn" : "Hiện";
  });
  $("save-key").addEventListener("click", async () => {
    const key = $("api-key").value.trim();
    await chrome.storage.local.set({ claudeApiKey: key });
    if (key) await chrome.storage.sync.set({ translator: "claude" });
    showResult(
      key ? "Đã lưu. Bộ dịch đã chuyển sang Claude." : "Đã lưu (key trống).",
      "muted",
    );
  });
  $("remove-key").addEventListener("click", async () => {
    $("api-key").value = "";
    await chrome.storage.local.remove("claudeApiKey");
    await chrome.storage.sync.set({ translator: "google" });
    showResult("Đã xoá key. Bộ dịch quay về Google Dịch.", "muted");
  });
  $("test-key").addEventListener("click", async () => {
    showResult("Đang gửi một câu thử…", "muted");
    const response = await chrome.runtime.sendMessage({
      type: "ltv:testClaude",
      apiKey: $("api-key").value.trim(),
      model: $("model").value,
    });
    if (response?.ok)
      showResult(`Key hoạt động. Bản dịch thử:\n“${response.text}”`, "");
    else showResult(`Lỗi: ${response?.error || "không rõ"}`, "error");
  });
  $("clear-cache").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "ltv:cacheClear" });
    refreshCacheStats();
  });
  refreshCacheStats();
}

init();
