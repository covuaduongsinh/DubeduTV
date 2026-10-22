// Lỗi gọi dịch vụ ngoài (dịch, chép lời) có phân loại để service worker
// quyết định thử lại, chuyển nguồn dự phòng hay báo người dùng.
export class ServiceError extends Error {
  constructor(message, { status, retryable, code } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code || "";
    this.retryable = Boolean(retryable);
  }
}

export class TranslateError extends ServiceError {}

export class TranscribeError extends ServiceError {}
