// Dịch bằng endpoint miễn phí của Google Dịch (client=gtx, không cần key).
// Gộp nhiều câu thành một yêu cầu, ngăn bằng "\n"; nếu số dòng trả về lệch
// thì dịch lại từng câu để không bao giờ gán nhầm bản dịch.

import { TranslateError } from "./errors.js";

// Các "cửa" Google Dịch, thử lần lượt. Google có thể tạm chặn yêu cầu không
// kèm cookie từ IP dùng chung (mạng nhà/4G thường nhiều người chung một IP)
// bằng cách chuyển sang trang xác minh "Sorry": khi đó gọi qua
// translate.google.com kèm cookie Google của trình duyệt, như khi người dùng
// tự mở Google Dịch. Cửa dùng được được nhớ cho các lần dịch sau.
export const GOOGLE_ENDPOINTS = [
  {
    url: "https://translate.googleapis.com/translate_a/single",
    credentials: "omit",
  },
  {
    url: "https://translate.google.com/translate_a/single",
    credentials: "include",
  },
];

const MESSAGES = {
  blocked:
    "Google Dịch đang tạm chặn yêu cầu từ mạng của bạn (trang xác minh “Sorry”). Thử lại sau vài phút hoặc chọn bộ dịch “Chrome trên máy”.",
  network:
    "Không kết nối được Google Dịch – kiểm tra mạng, tường lửa hoặc tiện ích chặn quảng cáo.",
};
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

async function requestOnce(text, { sl, tl, fetchImpl }, endpoint) {
  const url = `${endpoint.url}?client=gtx&dt=t&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      credentials: endpoint.credentials,
      // Tự xử lý chuyển hướng: theo sang trang "Sorry" (host tiện ích không có
      // quyền) chỉ ra lỗi chung "Failed to fetch".
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: `q=${encodeURIComponent(text)}`,
    });
  } catch {
    throw new TranslateError(MESSAGES.network, {
      code: "network",
      retryable: true,
    });
  }
  const { status } = response;
  const redirected =
    response.type === "opaqueredirect" || (status >= 300 && status < 400);
  if (redirected || status === 429)
    throw new TranslateError(MESSAGES.blocked, { status, code: "blocked" });
  if (!response.ok)
    throw new TranslateError(`Google Dịch lỗi HTTP ${status}`, {
      status,
      retryable: status >= 500,
      code: "http",
    });
  return parseGoogleResponse(await response.json());
}

const SWITCH_CODES = new Set(["blocked", "network"]);

// Một bộ dịch Google có trạng thái riêng: cửa đang dùng được.
export function createGoogleTranslator({
  endpoints = GOOGLE_ENDPOINTS,
  log = (...args) => console.warn("[Lồng Tiếng Việt] Google Dịch", ...args),
} = {}) {
  let preferred = 0;

  // Một cửa: thử lại khi mất kết nối hoặc lỗi máy chủ.
  async function viaEndpoint(text, options, endpoint) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestOnce(text, options, endpoint);
      } catch (error) {
        if (!error.retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(options.retryDelay ?? RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  // Bắt đầu từ cửa dùng được lần trước; cửa bị chặn/mất kết nối thì sang cửa
  // khác. Mọi cửa đều hỏng: báo "bị chặn" nếu có cửa bị chặn.
  async function request(text, options) {
    let blocked = null;
    let lastError = null;
    for (let step = 0; step < endpoints.length; step += 1) {
      const index = (preferred + step) % endpoints.length;
      try {
        const result = await viaEndpoint(text, options, endpoints[index]);
        preferred = index;
        return result;
      } catch (error) {
        log(endpoints[index].url, error.code || "", error.message);
        if (!SWITCH_CODES.has(error.code)) throw error;
        if (error.code === "blocked") blocked = blocked || error;
        lastError = error;
      }
    }
    throw blocked || lastError;
  }

  async function translateIndividually(indexes, texts, out, options) {
    const queue = indexes.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const index = queue.shift();
        const result = await request(sanitize(texts[index]), options);
        out[index] = result.trim();
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(SINGLE_CONCURRENCY, queue.length) },
        worker,
      ),
    );
  }

  return async function translateGoogle({
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
      const lines = (await request(joined, options)).split("\n");
      if (lines.length === chunk.length) {
        chunk.forEach((index, k) => {
          out[index] = lines[k].trim();
        });
      } else {
        await translateIndividually(chunk, texts, out, options);
      }
    }
    return out;
  };
}

// Bộ dịch dùng chung của service worker.
export const translateGoogle = createGoogleTranslator();
