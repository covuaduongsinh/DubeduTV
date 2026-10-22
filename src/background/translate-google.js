// Dịch bằng endpoint miễn phí của Google Dịch (client=gtx, không cần key).
// Gộp nhiều câu thành một yêu cầu, ngăn bằng "\n"; nếu số dòng trả về lệch
// thì dịch lại từng câu để không bao giờ gán nhầm bản dịch.

import { TranslateError } from "./errors.js";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_CHARS_PER_REQUEST = 4500;
const SINGLE_CONCURRENCY = 4;
const RETRY_DELAYS_MS = [1000, 2500];

function sanitize(text) {
  return String(text)
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

// Nhóm chỉ số câu sao cho mỗi nhóm không vượt quá maxChars ký tự.
export function buildChunks(texts, maxChars = MAX_CHARS_PER_REQUEST) {
  const chunks = [];
  let current = [];
  let size = 0;
  texts.forEach((text, index) => {
    const length = sanitize(text).length + 1;
    if (current.length > 0 && size + length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(index);
    size += length;
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function parseGoogleResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new TranslateError("Phản hồi Google Dịch không hợp lệ");
  }
  return data[0]
    .map((segment) => (Array.isArray(segment) ? segment[0] || "" : ""))
    .join("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(text, { sl, tl, fetchImpl }) {
  const url = `${ENDPOINT}?client=gtx&dt=t&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: `q=${encodeURIComponent(text)}`,
  });
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new TranslateError(`Google Dịch lỗi HTTP ${response.status}`, {
      status: response.status,
      retryable,
    });
  }
  return parseGoogleResponse(await response.json());
}

async function requestWithRetry(text, options) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(text, options);
    } catch (error) {
      const retryable = error.retryable || error.name === "TypeError";
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(options.retryDelay ?? RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function translateIndividually(indexes, texts, out, options) {
  const queue = indexes.slice();
  const worker = async () => {
    while (queue.length > 0) {
      const index = queue.shift();
      const result = await requestWithRetry(sanitize(texts[index]), options);
      out[index] = result.trim();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SINGLE_CONCURRENCY, queue.length) }, worker),
  );
}

export async function translateGoogle({
  texts,
  sl = "auto",
  tl,
  fetchImpl = fetch,
  retryDelay,
}) {
  const out = Array.from({ length: texts.length }, () => null);
  const options = { sl: sl || "auto", tl, fetchImpl, retryDelay };
  for (const chunk of buildChunks(texts)) {
    const joined = chunk.map((index) => sanitize(texts[index])).join("\n");
    const lines = (await requestWithRetry(joined, options)).split("\n");
    if (lines.length === chunk.length) {
      chunk.forEach((index, k) => {
        out[index] = lines[k].trim();
      });
    } else {
      await translateIndividually(chunk, texts, out, options);
    }
  }
  return out;
}
