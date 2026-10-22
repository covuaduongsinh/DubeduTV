// Bộ dịch "Chrome trên máy": chuyển yêu cầu sang offscreen document (nơi có
// Translator API) và đổi mã lỗi thành thông báo dễ hiểu; router dùng Google
// Dịch cho phần chưa dịch được.
import { TranslateError } from "./errors.js";

const MESSAGES = {
  "no-api": () =>
    "Trình duyệt chưa có bộ dịch trên máy (cần Google Chrome 138+ trên máy tính)",
  downloadable: ({ sl, tl }) =>
    `Chưa tải gói dịch ${sl}→${tl} – bấm “Tải gói dịch” trong popup`,
  downloading: ({ sl, tl }) => `Gói dịch ${sl}→${tl} đang tải`,
  unavailable: ({ sl, tl }) => `Bộ dịch của Chrome chưa hỗ trợ cặp ${sl}→${tl}`,
  "detect-unavailable": () =>
    "Chưa nhận diện được ngôn ngữ gốc trên máy – hãy chọn ngôn ngữ phụ đề gốc",
};

export function createChromeTranslate({
  ensureOffscreen,
  runtime = chrome.runtime,
}) {
  return async function translateChrome({ texts, sl, tl }) {
    await ensureOffscreen();
    let reply;
    try {
      reply = await runtime.sendMessage({
        target: "offscreen",
        type: "translate",
        texts,
        sl,
        tl,
      });
    } catch (error) {
      throw new TranslateError(
        `Bộ dịch trên máy không phản hồi (${error.message})`,
      );
    }
    if (reply?.ok) return reply.results;
    const describe = MESSAGES[reply?.code];
    throw new TranslateError(
      describe
        ? describe(reply)
        : `Bộ dịch trên máy lỗi: ${reply?.error || "không rõ"}`,
      { code: reply?.code || "" },
    );
  };
}
