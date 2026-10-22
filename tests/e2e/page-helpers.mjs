// Đọc trạng thái tiện ích trên trang giả lập (nhật ký giọng đọc giả, lớp phủ).

export const VIETNAMESE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export async function readLog(page) {
  const raw = await page.evaluate(() =>
    document.documentElement.getAttribute("data-ltv-test-log"),
  );
  return raw ? JSON.parse(raw) : [];
}

function overlayPart(page, selector) {
  return page.evaluate((part) => {
    const host = document.querySelector('[data-ltv="overlay"]');
    return host?.shadowRoot?.querySelector(part)?.textContent || "";
  }, selector);
}

export const overlayText = (page) => overlayPart(page, ".main");
export const overlayStatus = (page) => overlayPart(page, ".status");

// Chờ đến khi thông báo trên video khớp mẫu; trả về thông báo cuối cùng thấy được.
export async function waitForStatus(page, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let status = "";
  while (Date.now() < deadline) {
    status = await overlayStatus(page);
    if (pattern.test(status)) break;
    await page.waitForTimeout(300);
  }
  return status;
}

export function checker() {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  return { failures, check };
}
