// Dịch bằng endpoint miễn phí của Google Dịch (client=gtx, không cần key).
// Gộp nhiều câu thành một yêu cầu, ngăn bằng "\n"; nếu số dòng trả về lệch
// thì dịch lại từng câu để không bao giờ gán nhầm bản dịch.

import { TranslateError } from "./errors.js";

const API_URL = "https://translate.googleapis.com/translate_a/single";
const WEB_URL = "https://translate.google.com/translate_a/single";

// Các kiểu gọi Google Dịch, thử lần lượt; kiểu dùng được được nhớ cho các lần
// sau. Google có thể tạm chặn một kiểu gọi từ IP dùng chung (mạng nhà/4G
// thường nhiều người chung một IP) bằng trang xác minh "Sorry" mà vẫn cho
// kiểu khác qua. Đã gặp thực tế: POST bị chặn trong khi GET (giống hệt khi mở
// link trên thẻ) vẫn dịch được, nên GET đi trước; sau đó là các kiểu kèm
// cookie Google của trình duyệt như khi người dùng tự mở Google Dịch.
export const GOOGLE_VARIANTS = [
  {
    id: "api-get",
    label: "translate.googleapis.com · GET",
    url: API_URL,
    method: "GET",
    credentials: "omit",
  },
  {
    id: "api-post",
    label: "translate.googleapis.com · POST",
    url: API_URL,
    method: "POST",
    credentials: "omit",
  },
  {
    id: "api-get-cookie",
    label: "translate.googleapis.com · GET kèm cookie",
    url: API_URL,
    method: "GET",
    credentials: "include",
  },
  {
    id: "web-get-cookie",
    label: "translate.google.com · GET kèm cookie",
    url: WEB_URL,
    method: "GET",
    credentials: "include",
  },
  {
    id: "web-post-cookie",
    label: "translate.google.com · POST kèm cookie",
    url: WEB_URL,
    method: "POST",
    credentials: "include",
  },
];

const DIAGNOSE_HINT = "Tuỳ chọn → Kiểm tra kết nối Google Dịch để xem chi tiết";
const MESSAGES = {
  blocked:
    "Google Dịch đang tạm chặn yêu cầu từ mạng của bạn (trang xác minh “Sorry”). Thử lại sau vài phút hoặc chọn bộ dịch “Chrome trên máy”.",
  network:
    "Không kết nối được Google Dịch – kiểm tra mạng, tường lửa hoặc tiện ích chặn quảng cáo.",
  invalid: "Phản hồi Google Dịch không hợp lệ",
};
const MAX_CHARS_PER_REQUEST = 4500;
const SINGLE_CONCURRENCY = 4;
const RETRY_DELAYS_MS = [1000, 2500];
// GET đặt câu trong URL: mỗi nhóm dòng tối đa chừng này ký tự sau khi mã hoá.
const MAX_GET_QUERY = 6000;
// Giãn cách giữa hai lần gọi, và thời gian ngừng gọi sau khi mọi kiểu gọi
// đều bị chặn (gọi tiếp chỉ khiến Google chặn lâu hơn).
const MIN_GAP_MS = 200;
const COOL_DOWN_MS = 60 * 1000;

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

// Kiểu GET: chia văn bản theo dòng thành các nhóm ngắn (số dòng không đổi).
export function splitForGet(text, maxEncoded = MAX_GET_QUERY) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const line of text.split("\n")) {
    const length = encodeURIComponent(line).length + 3;
    if (current.length > 0 && size + length > maxEncoded) {
      groups.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += length;
  }
  groups.push(current.join("\n"));
  return groups;
}

export function parseGoogleResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new TranslateError(MESSAGES.invalid, { code: "invalid" });
  }
  return data[0]
    .map((segment) => (Array.isArray(segment) ? segment[0] || "" : ""))
    .join("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callVariant(text, options, variant) {
  const { sl, tl, fetchImpl } = options;
  const get = variant.method === "GET";
  const q = `q=${encodeURIComponent(text)}`;
  const url = `${variant.url}?client=gtx&dt=t&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`;
  await options.pace?.();
  let response;
  try {
    response = await fetchImpl(get ? `${url}&${q}` : url, {
      method: variant.method,
      credentials: variant.credentials,
      // Tự xử lý chuyển hướng: theo sang trang "Sorry" (host tiện ích không có
      // quyền) chỉ ra lỗi chung "Failed to fetch".
      redirect: "manual",
      ...(get
        ? {}
        : {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body: q,
          }),
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
  let data;
  try {
    data = await response.json();
  } catch {
    throw new TranslateError(MESSAGES.invalid, { code: "invalid" });
  }
  return parseGoogleResponse(data);
}

async function requestOnce(text, options, variant) {
  if (variant.method !== "GET") return callVariant(text, options, variant);
  const parts = [];
  for (const group of splitForGet(text))
    parts.push(await callVariant(group, options, variant));
  return parts.join("\n");
}

function describeFailure(error) {
  if (error.code === "blocked")
    return error.status === 429
      ? "HTTP 429 – Google báo gửi quá nhiều yêu cầu"
      : "bị chuyển sang trang xác minh “Sorry”";
  if (error.code === "network") return "không kết nối được";
  if (error.code === "invalid") return "trả về nội dung không phải bản dịch";
  return error.message || String(error);
}

function withHint(error) {
  return new TranslateError(`${error.message} (${DIAGNOSE_HINT}.)`, {
    status: error.status,
    code: error.code,
  });
}

// Thử mỗi kiểu gọi một lần với chữ "knight" (không thử lại), báo kết quả
// từng kiểu: [{ id, label, ok, detail }].
async function diagnoseVariants(variants, fetchImpl) {
  const options = { sl: "en", tl: "vi", fetchImpl };
  const results = [];
  for (const variant of variants) {
    const row = { id: variant.id, label: variant.label };
    try {
      const text = await requestOnce("knight", options, variant);
      results.push({ ...row, ok: true, detail: `“knight” → “${text}”` });
    } catch (error) {
      results.push({ ...row, ok: false, detail: describeFailure(error) });
    }
  }
  return results;
}

// Một bộ dịch Google có trạng thái riêng: kiểu gọi đang dùng được, nhịp gọi
// và thời gian tạm ngừng sau khi bị chặn.
export function createGoogleTranslator({
  variants = GOOGLE_VARIANTS,
  minGapMs = MIN_GAP_MS,
  coolDownMs = COOL_DOWN_MS,
  now = Date.now,
  log = (...args) => console.warn("[Lồng Tiếng Việt] Google Dịch", ...args),
} = {}) {
  let preferred = 0;
  let nextSlot = 0;
  let coolUntil = 0;
  let coolError = null;

  async function pace() {
    const wait = nextSlot - now();
    nextSlot = Math.max(now(), nextSlot) + minGapMs;
    if (wait > 0) await sleep(wait);
  }

  // Một kiểu gọi: thử lại khi mất kết nối hoặc lỗi máy chủ.
  async function viaVariant(text, options, variant) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestOnce(text, options, variant);
      } catch (error) {
        if (!error.retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(options.retryDelay ?? RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  // Bắt đầu từ kiểu gọi dùng được lần trước, hỏng thì sang kiểu khác. Mọi
  // kiểu đều hỏng: báo "bị chặn" nếu có kiểu bị chặn, rồi tạm ngừng gọi.
  async function request(text, options) {
    if (now() < coolUntil) throw coolError;
    let blocked = null;
    let lastError = null;
    for (let step = 0; step < variants.length; step += 1) {
      const index = (preferred + step) % variants.length;
      try {
        const result = await viaVariant(text, options, variants[index]);
        preferred = index;
        return result;
      } catch (error) {
        log(variants[index].id, error.code || "", error.message);
        if (error.code === "blocked") blocked = blocked || error;
        lastError = error;
      }
    }
    const failure = withHint(blocked || lastError);
    if (blocked) {
      coolUntil = now() + coolDownMs;
      coolError = failure;
    }
    throw failure;
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

  async function translateGoogle({
    texts,
    sl = "auto",
    tl,
    fetchImpl = fetch,
    retryDelay,
  }) {
    const out = Array.from({ length: texts.length }, () => null);
    const options = { sl: sl || "auto", tl, fetchImpl, retryDelay, pace };
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
  }

  // Kiểm tra kết nối; có kiểu gọi qua được thì dùng ngay kiểu đó và bỏ tạm
  // ngừng.
  translateGoogle.diagnose = async function diagnose({
    fetchImpl = fetch,
  } = {}) {
    const results = await diagnoseVariants(variants, fetchImpl);
    const working = results.findIndex((row) => row.ok);
    if (working >= 0) {
      preferred = working;
      coolUntil = 0;
    }
    return results;
  };

  return translateGoogle;
}

// Bộ dịch dùng chung của service worker.
export const translateGoogle = createGoogleTranslator();
