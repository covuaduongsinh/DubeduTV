// Lỗi dịch có phân loại để service worker quyết định thử lại hay chuyển bộ dịch.
export class TranslateError extends Error {
  constructor(message, { status, retryable, code } = {}) {
    super(message);
    this.name = "TranslateError";
    this.status = status;
    this.code = code || "";
    this.retryable = Boolean(retryable);
  }
}
