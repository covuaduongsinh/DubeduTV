import "../shared/defaults.js";
import "../shared/frame-probe.js";
import { initChromePack } from "./chrome-pack.js";
import { initTabLive } from "./tab-live.js";
import { initVoiceSelect } from "./voice-select.js";

const LTV = globalThis.LTV;
const $ = (id) => document.getElementById(id);
const SAVE_DELAY_MS = 300;

const PROBE_EVERY_MS = 3000;

let settings = LTV.mergeSettings({});
let tab = null;
let lastStatus = null;
// Khung đang điều khiển (trang chính hoặc video nhúng), chọn lại định kỳ.
const frameProbe = LTV.createFrameProbe();
let frameId = null;
let probedAt = 0;
const chromePack = initChromePack({
  getSettings: () => settings,
  // Ngôn ngữ gốc: cài đặt, hoặc ngôn ngữ phụ đề của video đang mở.
  getSourceLang: () =>
    settings.sourceLang !== "auto"
      ? settings.sourceLang
      : lastStatus?.lang || "en",
  isVisible: () => settings.translator === "chrome",
});
const pendingSave = {};
let saveTimer = null;
const voiceSelect = initVoiceSelect({
  getSettings: () => settings,
  saveSetting,
});

function saveSetting(key, value) {
  settings = { ...settings, [key]: value };
  pendingSave[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const changes = { ...pendingSave };
    for (const name of Object.keys(pendingSave)) delete pendingSave[name];
    chrome.storage.sync.set(changes);
  }, SAVE_DELAY_MS);
}

function formatValue(input) {
  const value = Number(input.value);
  if (input.dataset.format === "%") return `${Math.round(value * 100)}%`;
  if (input.dataset.format === "px") return `${value}px`;
  return `${value.toFixed(2).replace(/0$/, "")}×`;
}

function fillLanguageSelects() {
  for (const [id, list] of [
    ["sourceLang", LTV.SOURCE_LANGUAGES],
    ["targetLang", LTV.TARGET_LANGUAGES],
    ["asrLang", LTV.SPEECH_LANGUAGES],
  ]) {
    $(id).replaceChildren(
      ...list.map(([code, name]) => new Option(name, code)),
    );
  }
}

function renderSettings() {
  for (const element of document.querySelectorAll("[data-setting]")) {
    const key = element.dataset.setting;
    if (element.type === "checkbox") element.checked = Boolean(settings[key]);
    else element.value = String(settings[key]);
    const label = document.querySelector(`[data-for="${element.id}"]`);
    if (label) label.textContent = formatValue(element);
  }
  $("maxRate").disabled = !settings.autoRate;
}

function bindSettings() {
  for (const element of document.querySelectorAll("[data-setting]")) {
    const key = element.dataset.setting;
    const handler = () => {
      let value = element.value;
      if (element.type === "checkbox") value = element.checked;
      else if (typeof LTV.DEFAULTS[key] === "number") value = Number(value);
      saveSetting(key, value);
      renderSettings();
      if (key === "targetLang") voiceSelect.load();
      if (key === "translator" || key === "asrEngine") checkKeys();
      if (["translator", "sourceLang", "targetLang"].includes(key))
        chromePack.refresh();
    };
    element.addEventListener(
      element.type === "range" ? "input" : "change",
      handler,
    );
  }
}

// Nhắc nhập key khi đã chọn Claude/Whisper mà chưa có key.
async function checkKeys() {
  const { claudeApiKey, whisperApiKey } = await chrome.storage.local.get([
    "claudeApiKey",
    "whisperApiKey",
  ]);
  $("claude-hint").hidden =
    settings.translator !== "claude" || Boolean(claudeApiKey);
  $("whisper-hint").hidden =
    settings.asrEngine !== "whisper" || Boolean(whisperApiKey);
}

function describeStatus(status) {
  if (!status.onVideo) {
    return {
      text: `Mở một video ${status.provider ? `trên ${status.provider} ` : ""}để lồng tiếng.`,
      tone: "muted",
    };
  }
  if (!status.active)
    return { text: "Lồng tiếng đang tắt cho tab này.", tone: "muted" };
  const tone =
    status.status.state === "error"
      ? "error"
      : status.status.state === "warn"
        ? "warn"
        : "";
  return { text: status.status.message || "Đang chuẩn bị…", tone };
}

const tabLive = initTabLive({
  getTab: () => tab,
  onChange: () => refreshStatus(),
});

function renderStatus(status) {
  // Đang nghe cả thẻ: không bật lồng tiếng riêng trong trang (tránh đọc trùng).
  tabLive.refresh(status).then((listening) => {
    if (listening) $("toggle").hidden = true;
  });
  if (status?.lang && status.lang !== lastStatus?.lang) {
    lastStatus = status;
    chromePack.refresh();
  }
  lastStatus = status;
  const text = $("status-text");
  const toggle = $("toggle");
  const inject = $("inject");
  if (!status) {
    const injectable = /^https?:/.test(tab?.url || "");
    text.textContent = injectable
      ? "Trang này chưa được hỗ trợ sẵn (hỗ trợ: YouTube, Udemy, Coursera, Google Drive, X và video YouTube nhúng)."
      : "Không lồng tiếng được trên trang này.";
    text.className = "status-text muted";
    toggle.hidden = true;
    inject.hidden = !injectable;
    $("progress").hidden = true;
    return;
  }
  $("site").hidden = !status.provider;
  $("site").textContent = status.provider || "";
  const { text: message, tone } = describeStatus(status);
  text.textContent = message;
  text.className = `status-text ${tone}`;
  toggle.hidden = !status.onVideo;
  toggle.textContent = status.active ? "Tắt lồng tiếng" : "Bật lồng tiếng";
  toggle.classList.toggle("off", status.active);
  inject.hidden = true;
  const progress = status.progress;
  const showProgress =
    status.active &&
    progress &&
    progress.total > 0 &&
    progress.done < progress.total;
  $("progress").hidden = !showProgress;
  if (showProgress)
    $("progress-bar").style.width =
      `${Math.round((100 * progress.done) / progress.total)}%`;
}

async function sendToFrame(message) {
  if (frameId === null || Date.now() - probedAt > PROBE_EVERY_MS) {
    frameId = LTV.chooseFrame(await frameProbe.probe(tab.id));
    probedAt = Date.now();
  }
  if (frameId === null) throw new Error("no-frame");
  try {
    return await chrome.tabs.sendMessage(tab.id, message, { frameId });
  } catch (error) {
    frameId = null;
    throw error;
  }
}

async function refreshStatus() {
  if (tab?.id === undefined) return renderStatus(null);
  try {
    renderStatus(await sendToFrame({ type: "ltv:getStatus" }));
  } catch {
    renderStatus(null);
  }
}

function bindActions() {
  $("toggle").addEventListener("click", async () => {
    try {
      renderStatus(await sendToFrame({ type: "ltv:toggle" }));
    } catch {
      renderStatus(null);
    }
  });
  $("inject").addEventListener("click", async () => {
    $("inject").disabled = true;
    const response = await chrome.runtime.sendMessage({
      type: "ltv:inject",
      tabId: tab.id,
    });
    $("inject").disabled = false;
    if (!response?.ok) {
      $("status-text").textContent =
        `Không nạp được vào trang: ${response?.error || "lỗi không rõ"}`;
      $("status-text").className = "status-text error";
    }
    refreshStatus();
  });
  for (const id of [
    "open-options",
    "open-options-key",
    "open-options-whisper",
  ]) {
    $(id).addEventListener("click", (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

async function init() {
  settings = LTV.mergeSettings(await chrome.storage.sync.get(null));
  // ?tabId=: mở popup như một trang để kiểm thử với thẻ chỉ định.
  const tabId = Number(new URL(location.href).searchParams.get("tabId"));
  [tab] = tabId
    ? [await chrome.tabs.get(tabId)]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  fillLanguageSelects();
  renderSettings();
  bindSettings();
  voiceSelect.bind();
  bindActions();
  await Promise.all([
    voiceSelect.load(),
    checkKeys(),
    refreshStatus(),
    chromePack.refresh(),
  ]);
  setInterval(refreshStatus, 1000);
}

init();
