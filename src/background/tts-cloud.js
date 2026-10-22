// Giọng AI đám mây: Azure AI Speech và Google Cloud Text-to-Speech, gọi bằng
// API key của người dùng (lưu ở storage.local, chỉ service worker đọc). Đọc ở
// tốc độ gốc để cache theo câu; offscreen chỉnh tốc độ bằng playbackRate.
// Âm thanh trả về dạng base64 vì tin nhắn giữa các ngữ cảnh chỉ mang JSON.
import "../shared/defaults.js";
import "../shared/cloud-voices.js";
import { SpeechError } from "./errors.js";

const LTV = globalThis.LTV;

// Gốc URL của từng dịch vụ (bản kiểm thử trỏ sang máy chủ giả lập).
export const ENDPOINTS = {
  azure: async (region) => `https://${region}.tts.speech.microsoft.com`,
  gcloud: async () => "https://texttospeech.googleapis.com",
};

export const KEY_NAMES = { azure: "azureTtsKey", gcloud: "gcloudTtsKey" };
const NAMES = { azure: "Azure", gcloud: "Google Cloud" };
const AZURE_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const RETRY_DELAYS_MS = [800, 2000];
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_DETAIL = 200;
const MAX_VOICES = 800;
const BYTES_PER_CHUNK = 0x8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeXml(text) {
  return String(text).replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
}

export function buildAzureRequest({ key, name, locale, text }) {
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${escapeXml(name)}">${escapeXml(text)}</voice></speak>`;
  return {
    path: "/cognitiveservices/v1",
    init: {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": AZURE_FORMAT,
      },
      body: ssml,
    },
  };
}

export function buildGoogleRequest({ key, name, locale, text }) {
  const voice = name
    ? { languageCode: locale, name }
    : { languageCode: locale };
  return {
    path: "/v1/text:synthesize",
    init: {
      method: "POST",
      // Key trong header để không nằm trong URL.
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: String(text) },
        voice,
        audioConfig: { audioEncoding: "MP3" },
      }),
    },
  };
}

// Lời giải thích trong phản hồi lỗi: Google trả JSON, Azure thường để trống.
async function errorDetail(response) {
  const body = await response.text().catch(() => "");
  try {
    const error = JSON.parse(body).error || {};
    const reasons = (error.details || []).map((item) => item.reason);
    return { message: String(error.message || ""), reasons };
  } catch {
    return { message: body.trim(), reasons: [] };
  }
}

async function failure(engine, response) {
  const { status } = response;
  const detail = await errorDetail(response);
  const suffix = detail.message
    ? `: ${detail.message.slice(0, MAX_DETAIL)}`
    : "";
  const auth =
    status === 401 ||
    status === 403 ||
    detail.reasons.includes("API_KEY_INVALID");
  if (auth) {
    const region = engine === "azure" ? " hoặc sai vùng" : "";
    return new SpeechError(
      `API key ${NAMES[engine]} không hợp lệ${region}${suffix}`,
      { status, code: "auth" },
    );
  }
  return new SpeechError(`${NAMES[engine]} lỗi HTTP ${status}${suffix}`, {
    status,
    retryable: status === 429 || status >= 500,
    code: "request",
  });
}

async function withRetry(run, retryDelay) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const retryable = error.retryable || error.name === "TypeError";
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(retryDelay ?? RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Định dạng âm thanh theo vài byte đầu (bản kiểm thử trả WAV thay cho MP3).
function audioMime(head) {
  if (head.startsWith("RIFF")) return "audio/wav";
  if (head.startsWith("OggS")) return "audio/ogg";
  return "audio/mpeg";
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += BYTES_PER_CHUNK)
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + BYTES_PER_CHUNK),
    );
  return btoa(binary);
}

function checkSize(engine, size) {
  if (size === 0)
    throw new SpeechError(`${NAMES[engine]} trả về âm thanh rỗng`, {
      code: "request",
    });
  if (size > MAX_AUDIO_BYTES)
    throw new SpeechError("Âm thanh giọng AI quá lớn", { code: "request" });
}

async function readAzureAudio(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  checkSize("azure", bytes.length);
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  return { audio: bytesToBase64(bytes), mime: audioMime(head) };
}

async function readGoogleAudio(response) {
  const data = await response.json().catch(() => null);
  const audio = typeof data?.audioContent === "string" ? data.audioContent : "";
  // base64: 4 ký tự mang 3 byte.
  checkSize("gcloud", Math.floor((audio.length * 3) / 4));
  let head = "";
  try {
    head = atob(audio.slice(0, 8));
  } catch {
    throw new SpeechError("Google Cloud trả về âm thanh hỏng", {
      code: "request",
    });
  }
  return { audio, mime: audioMime(head) };
}

// Đọc một đoạn văn bản → { audio: base64, mime }.
export async function synthesizeCloud({
  engine,
  key,
  region,
  voice,
  lang,
  text,
  voices,
  fetchImpl = fetch,
  retryDelay,
}) {
  if (!KEY_NAMES[engine])
    throw new SpeechError("Giọng AI không hợp lệ", { code: "request" });
  if (!key)
    throw new SpeechError(`Chưa nhập API key ${NAMES[engine]}`, {
      code: "auth",
    });
  const target = LTV.cloudVoices.resolve({ engine, voice, lang, voices });
  if (!target.locale)
    throw new SpeechError(`Giọng ${NAMES[engine]} chưa hỗ trợ ngôn ngữ này`, {
      code: "lang",
    });
  const base = await ENDPOINTS[engine](region);
  const build = engine === "azure" ? buildAzureRequest : buildGoogleRequest;
  const request = build({ key, ...target, text });
  return withRetry(async () => {
    const response = await fetchImpl(base + request.path, request.init);
    if (!response.ok) throw await failure(engine, response);
    return engine === "azure"
      ? readAzureAudio(response)
      : readGoogleAudio(response);
  }, retryDelay);
}

const GENDERS = { female: "nữ", male: "nam" };

function voiceLabel(name, gender) {
  const word = GENDERS[String(gender || "").toLowerCase()];
  return word ? `${name} (${word})` : name;
}

// Danh sách giọng của API → { name, label, locale }, chỉ các ngôn ngữ đích
// tiện ích hỗ trợ.
export function normalizeVoices(engine, data) {
  const raw = engine === "azure" ? data : data?.voices;
  if (!Array.isArray(raw)) return [];
  const voices = raw.map((voice) => {
    if (engine === "azure")
      return {
        name: String(voice?.ShortName || ""),
        label: voiceLabel(
          voice?.LocalName || voice?.DisplayName || voice?.ShortName,
          voice?.Gender,
        ),
        locale: String(voice?.Locale || ""),
      };
    const name = String(voice?.name || "");
    const locale = String(voice?.languageCodes?.[0] || "");
    return {
      name,
      label: voiceLabel(
        name.slice(locale.length + 1) || name,
        voice?.ssmlGender,
      ),
      locale,
    };
  });
  return voices
    .filter(
      (voice) =>
        voice.name && LTV.cloudVoices.supportedLocale(engine, voice.locale),
    )
    .slice(0, MAX_VOICES);
}

// Tải danh sách giọng – cũng là cách kiểm tra key.
export async function listCloudVoices({
  engine,
  key,
  region,
  fetchImpl = fetch,
}) {
  if (!key)
    throw new SpeechError(`Chưa nhập API key ${NAMES[engine]}`, {
      code: "auth",
    });
  const base = await ENDPOINTS[engine](region);
  const request =
    engine === "azure"
      ? {
          url: `${base}/cognitiveservices/voices/list`,
          headers: { "Ocp-Apim-Subscription-Key": key },
        }
      : { url: `${base}/v1/voices`, headers: { "x-goog-api-key": key } };
  const response = await fetchImpl(request.url, { headers: request.headers });
  if (!response.ok) throw await failure(engine, response);
  return normalizeVoices(engine, await response.json());
}

// Phần service worker: đọc key/vùng/danh sách giọng đã lưu rồi gọi dịch vụ.
export function createCloudSpeech({ storage, readSettings, fetchImpl }) {
  async function synthesize({ engine, voice, lang, text }) {
    try {
      const keyName = KEY_NAMES[engine];
      const stored = keyName ? await storage.get([keyName, "cloudVoices"]) : {};
      const { azureRegion } = await readSettings();
      const result = await synthesizeCloud({
        engine,
        key: stored[keyName],
        region: azureRegion,
        voice: String(voice || ""),
        lang,
        text: String(text || ""),
        voices: stored.cloudVoices?.[engine],
        fetchImpl,
      });
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        code: error.code || "",
        error: error.message || "Lỗi giọng AI",
      };
    }
  }

  // "Kiểm tra key" ở trang tuỳ chọn: tải và lưu danh sách giọng.
  async function test({ engine, apiKey, region }) {
    if (!KEY_NAMES[engine]) throw new SpeechError("Giọng AI không hợp lệ");
    const { azureRegion } = LTV.mergeSettings({ azureRegion: region });
    const voices = await listCloudVoices({
      engine,
      key: String(apiKey || "").trim(),
      region: azureRegion,
      fetchImpl,
    });
    const { cloudVoices = {} } = await storage.get("cloudVoices");
    await storage.set({ cloudVoices: { ...cloudVoices, [engine]: voices } });
    return {
      count: voices.length,
      vietnamese: LTV.cloudVoices.forLang(engine, voices, "vi").length,
    };
  }

  return { synthesize, test };
}
