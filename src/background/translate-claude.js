// Dịch bằng Claude (Messages API, gọi trực tiếp bằng fetch vì tiện ích chạy
// không qua bundler). Kết quả trả về theo JSON Schema nên luôn khớp id dòng;
// dòng thiếu để null cho service worker bù bằng Google Dịch.

import { TranslateError } from "./errors.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2026-10-21";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// Server-side fallback "default" có trên Opus 5.5 và Sonnet 5.5; Haiku 5.5 không có.
const MODELS_WITH_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
const BATCH_SIZE = 60;
const CONTEXT_LINES = 3;
const MAX_SPLIT_DEPTH = 3;
const RETRY_DELAYS_MS = [2000, 5000];

const LANGUAGE_NAMES = {
  auto: "the original language",
  vi: "Vietnamese",
  en: "English",
  "zh-CN": "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
  th: "Thai",
  id: "Indonesian",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          text: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

export function languageName(code) {
  return LANGUAGE_NAMES[code] || code;
}

export function buildSystemPrompt(sl, tl) {
  const target = languageName(tl);
  const vietnameseHint =
    tl === "vi"
      ? " For chess videos, for example, use Mã for knight, Tượng for bishop, Xe for rook, Hậu for queen, Vua for king, Tốt for pawn and nhập thành for castling."
      : "";
  return [
    `You translate video subtitles from ${languageName(sl)} into ${target} for a voice-over that is read aloud in sync with the video.`,
    "The user message is JSON: `lines` holds the subtitle lines to translate, in playback order, each with an `id`; `video_title` and `context_before` (earlier lines) are context only and must not be translated.",
    "Return exactly one translation for every id. Never merge, split, drop, reorder or add lines, even when a line is only a fragment of a longer sentence: translate the fragment so the sequence still reads naturally when spoken line by line.",
    `Write natural spoken ${target}, the way a professional dubbing artist would say it, rather than a word-for-word rendering. Keep each line about as long as the original so it fits the same time slot.`,
    `Keep personal names, code, numbers and units as they are. Use the established ${target} terms of the video's field.${vietnameseHint}`,
    `If a line is already in ${target}, or is only a name or a sound, return it unchanged.`,
  ].join("\n\n");
}

export function buildClaudeRequest({ texts, sl, tl, title, model, context }) {
  const body = {
    model,
    max_tokens: 16000,
    system: buildSystemPrompt(sl || "auto", tl),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          video_title: title || "",
          context_before: context || [],
          lines: texts.map((text, id) => ({ id, text })),
        }),
      },
    ],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  };
  if (MODELS_WITH_FALLBACK.has(model)) body.fallbacks = "default";
  return body;
}

export function buildHeaders(apiKey, model) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    // Bắt buộc khi gọi API từ môi trường trình duyệt (có header Origin).
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (MODELS_WITH_FALLBACK.has(model))
    headers["anthropic-beta"] = FALLBACK_BETA;
  return headers;
}

export function parseClaudeResponse(data, count) {
  if (data?.stop_reason === "refusal") {
    throw new TranslateError("Claude từ chối dịch đoạn này", {
      code: "refusal",
    });
  }
  if (data?.stop_reason === "max_tokens") {
    throw new TranslateError("Câu trả lời của Claude bị cắt", {
      code: "max_tokens",
    });
  }
  const text = (data?.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TranslateError("Claude trả về JSON không hợp lệ", {
      code: "invalid_json",
    });
  }
  const out = Array.from({ length: count }, () => null);
  for (const item of parsed?.translations || []) {
    const valid = Number.isInteger(item?.id) && item.id >= 0 && item.id < count;
    if (valid && typeof item.text === "string" && item.text.trim()) {
      out[item.id] = item.text.trim();
    }
  }
  return out;
}

function describeHttpError(status, payload) {
  const detail = payload?.error?.message ? `: ${payload.error.message}` : "";
  if (status === 401) return "API key Claude không hợp lệ";
  if (status === 403) return `API key Claude không có quyền${detail}`;
  if (status === 429) return "Claude đang giới hạn tốc độ, thử lại sau";
  if (status === 529) return "Claude đang quá tải, thử lại sau";
  return `Claude lỗi HTTP ${status}${detail}`;
}

function retryAfterMs(response, attempt) {
  const header = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(30, header) * 1000;
  return RETRY_DELAYS_MS[attempt];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postMessages(body, { apiKey, fetchImpl, retryDelay }) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(apiKey, body.model),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) return payload;
    const status = response.status;
    const retryable = status === 429 || status === 529 || status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
      throw new TranslateError(describeHttpError(status, payload), {
        status,
        code: status === 401 || status === 403 ? "auth" : "http",
      });
    }
    await sleep(retryDelay ?? retryAfterMs(response, attempt));
  }
}

async function translateBatch(texts, request, depth) {
  const body = buildClaudeRequest({ ...request, texts });
  try {
    return parseClaudeResponse(await postMessages(body, request), texts.length);
  } catch (error) {
    if (
      error.code !== "max_tokens" ||
      depth >= MAX_SPLIT_DEPTH ||
      texts.length < 2
    ) {
      throw error;
    }
    const middle = Math.ceil(texts.length / 2);
    const first = await translateBatch(
      texts.slice(0, middle),
      request,
      depth + 1,
    );
    const second = await translateBatch(
      texts.slice(middle),
      request,
      depth + 1,
    );
    return first.concat(second);
  }
}

export async function translateClaude({
  texts,
  sl,
  tl,
  title,
  apiKey,
  model,
  context = [],
  fetchImpl = fetch,
  retryDelay,
}) {
  if (!apiKey)
    throw new TranslateError("Chưa nhập API key Claude", { code: "auth" });
  const out = [];
  let before = context.slice(-CONTEXT_LINES);
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const request = {
      sl,
      tl,
      title,
      model,
      context: before,
      apiKey,
      fetchImpl,
      retryDelay,
    };
    out.push(...(await translateBatch(batch, request, 0)));
    before = batch.slice(-CONTEXT_LINES);
  }
  return out;
}
