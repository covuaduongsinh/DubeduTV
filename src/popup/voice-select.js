// Mục "Giọng" của popup: giọng Google, giọng AI đám mây (khi đã nhập API key
// trong Tuỳ chọn) và giọng cài trên máy. Giá trị của mỗi lựa chọn: "google",
// "system::<tên>", "azure::<tên>" hoặc "gcloud::<tên>" (tên trống = giọng
// mặc định theo ngôn ngữ đích).
import "../shared/defaults.js";
import "../shared/cloud-voices.js";

const LTV = globalThis.LTV;
const $ = (id) => document.getElementById(id);
const PREVIEW_TEXT = {
  vi: "Xin chào! Đây là giọng đọc lồng tiếng cho video của bạn.",
  en: "Hello! This is the dubbing voice for your video.",
};
const CLOUD_GROUPS = [
  ["azure", "Giọng AI Azure", "azureTtsKey"],
  ["gcloud", "Giọng AI Google Cloud", "gcloudTtsKey"],
];
// Cài đặt giữ tên giọng của từng bộ giọng.
const VOICE_SETTING = {
  system: "systemVoice",
  azure: "azureVoice",
  gcloud: "gcloudVoice",
};

function group(label, options) {
  const element = document.createElement("optgroup");
  element.label = label;
  element.append(...options);
  return element;
}

// Chỉ hiện giọng AI của dịch vụ đã có API key.
async function cloudGroups(lang) {
  const stored = await chrome.storage.local.get([
    "azureTtsKey",
    "gcloudTtsKey",
    "cloudVoices",
  ]);
  return CLOUD_GROUPS.filter(([, , keyName]) => stored[keyName]).map(
    ([engine, label]) =>
      group(label, [
        new Option(LTV.cloudVoices.defaultLabel(engine, lang), `${engine}::`),
        ...LTV.cloudVoices
          .forLang(engine, stored.cloudVoices?.[engine], lang)
          .map((voice) => new Option(voice.label, `${engine}::${voice.name}`)),
      ]),
  );
}

async function systemGroup(lang) {
  const base = LTV.baseLang(lang);
  const voices = (await chrome.tts.getVoices()).filter(
    (voice) =>
      voice.voiceName && voice.lang && LTV.baseLang(voice.lang) === base,
  );
  const label =
    voices.length > 0
      ? "Giọng cài trên máy"
      : "Máy chưa có giọng cho ngôn ngữ này";
  return {
    count: voices.length,
    element: group(
      label,
      voices.map(
        (voice) =>
          new Option(
            `${voice.voiceName}${voice.remote ? " (trực tuyến)" : ""}`,
            `system::${voice.voiceName}`,
          ),
      ),
    ),
  };
}

function hintFor(cloudCount, systemCount) {
  if (cloudCount === 0)
    return "Giọng AI tự nhiên (HoaiMy, NamMinh…): nhập API key Azure hoặc Google Cloud trong Tuỳ chọn.";
  if (systemCount === 0)
    return "Mẹo: cài giọng tiếng Việt cho Windows/macOS, hoặc dùng Microsoft Edge để có giọng HoaiMy/NamMinh miễn phí.";
  return "";
}

export function initVoiceSelect({ getSettings, saveSetting }) {
  async function load() {
    const settings = getSettings();
    const lang = settings.targetLang;
    const [cloud, system] = await Promise.all([
      cloudGroups(lang),
      systemGroup(lang),
    ]);
    const select = $("voice");
    select.replaceChildren(
      new Option("Google (trực tuyến)", "google"),
      ...cloud,
      system.element,
    );
    const engine = settings.voiceEngine;
    const values = Array.from(select.options, (option) => option.value);
    const chosen = VOICE_SETTING[engine]
      ? `${engine}::${settings[VOICE_SETTING[engine]]}`
      : "google";
    // Giọng đã chọn không nói ngôn ngữ đích: hiện giọng mặc định của bộ đó.
    const fallback = values.includes(`${engine}::`) ? `${engine}::` : "google";
    select.value = values.includes(chosen) ? chosen : fallback;
    const hint = hintFor(cloud.length, system.count);
    $("voice-hint").hidden = !hint;
    $("voice-hint").textContent = hint;
  }

  function bind() {
    $("voice").addEventListener("change", () => {
      const value = $("voice").value;
      const split = value.indexOf("::");
      const engine = split < 0 ? value : value.slice(0, split);
      saveSetting("voiceEngine", engine);
      if (VOICE_SETTING[engine])
        saveSetting(VOICE_SETTING[engine], value.slice(split + 2));
    });
    $("preview").addEventListener("click", () => {
      const settings = getSettings();
      chrome.runtime.sendMessage({
        type: "ltv:preview",
        utterance: {
          text:
            PREVIEW_TEXT[LTV.baseLang(settings.targetLang)] || PREVIEW_TEXT.en,
          lang: settings.targetLang,
          rate: settings.rate,
          volume: settings.voiceVolume,
          engine: settings.voiceEngine,
          voiceName: LTV.voiceNameFor(settings),
        },
      });
    });
  }

  return { load, bind };
}
