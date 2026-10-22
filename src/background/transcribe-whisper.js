// Chép lời một đoạn âm thanh bằng Whisper qua API tương thích OpenAI
// (Groq whisper-large-v3-turbo hoặc OpenAI whisper-1). Trả các đoạn có mốc
// thời gian tính từ đầu đoạn âm thanh; lọc đoạn im lặng và câu "ảo giác".

import { TranscribeError } from "./errors.js";

export const WHISPER_PROVIDERS = {
  groq: {
    base: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
  },
  openai: { base: "https://api.openai.com/v1", model: "whisper-1" },
};

const RETRY_DELAYS_MS = [1500, 4000];
const MAX_NO_SPEECH_PROB = 0.6;
const MAX_PROMPT_CHARS = 200;

// Câu Whisper hay tự bịa ra khi gặp im lặng hoặc nhạc nền.
const HALLUCINATIONS = [
  /^(thank you|thanks)( so much| very much)?( for watching)?[.!]*$/i,
  /\b(please )?(like and )?subscribe\b/i,
  /subtitles? (by|created by|provided by)/i,
  /amara\.org/i,
  /^[[(]?(music|applause|silence|laughter)[\])]?\.?$/i,
  /^[.…\s]*$/,
];

function providerConfig(provider) {
  return WHISPER_PROVIDERS[provider] || WHISPER_PROVIDERS.groq;
}

export function buildWhisperForm({ audio, mime, lang, prompt, model }) {
  const form = new FormData();
  const extension = /ogg/.test(mime || "") ? "ogg" : "webm";
  form.append("file", audio, `chunk.${extension}`);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  if (lang && lang !== "auto") form.append("language", lang.split("-")[0]);
  if (prompt) form.append("prompt", String(prompt).slice(-MAX_PROMPT_CHARS));
  return form;
}

function isHallucination(text) {
  return HALLUCINATIONS.some((pattern) => pattern.test(text));
}

export function parseWhisperResponse(data) {
  const raw = Array.isArray(data?.segments)
    ? data.segments
    : [{ start: 0, end: Number(data?.duration) || 0, text: data?.text || "" }];
  const segments = raw
    .filter((segment) => !(segment.no_speech_prob > MAX_NO_SPEECH_PROB))
    .map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || Number(segment.start) || 0,
      text: String(segment.text || "").trim(),
    }))
    .filter((segment) => segment.text && !isHallucination(segment.text));
  return { language: data?.language || "", segments };
}

function describeHttpError(status, payload) {
  const detail = payload?.error?.message ? `: ${payload.error.message}` : "";
  if (status === 401) return "API key Whisper không hợp lệ";
  if (status === 403) return `API key Whisper không có quyền${detail}`;
  if (status === 413) return "Đoạn âm thanh quá lớn";
  if (status === 429) return "Whisper đang giới hạn tốc độ, thử lại sau";
  return `Whisper lỗi HTTP ${status}${detail}`;
}

function retryDelayFor(response, attempt, override) {
  if (override !== undefined) return override;
  const header = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(20, header) * 1000;
  return RETRY_DELAYS_MS[attempt];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transcribeWhisper({
  audio,
  mime,
  lang,
  prompt,
  provider,
  apiKey,
  fetchImpl = fetch,
  retryDelay,
}) {
  if (!apiKey) {
    throw new TranscribeError("Chưa nhập API key Whisper", { code: "auth" });
  }
  const config = providerConfig(provider);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(`${config.base}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: buildWhisperForm({
        audio,
        mime,
        lang,
        prompt,
        model: config.model,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) return parseWhisperResponse(payload);
    const status = response.status;
    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      throw new TranscribeError(describeHttpError(status, payload), {
        status,
        code: status === 401 || status === 403 ? "auth" : "http",
      });
    }
    await sleep(retryDelayFor(response, attempt, retryDelay));
  }
}

// Kiểm tra key bằng một yêu cầu đọc danh sách model (không tốn phí).
export async function testWhisperKey({ apiKey, provider, fetchImpl = fetch }) {
  if (!apiKey) {
    throw new TranscribeError("Chưa nhập API key Whisper", { code: "auth" });
  }
  const response = await fetchImpl(`${providerConfig(provider).base}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new TranscribeError(describeHttpError(response.status, payload), {
      status: response.status,
    });
  }
  return true;
}
