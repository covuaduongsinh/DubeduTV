// Nghe cả thẻ: tìm khung có video lớn nhất mà tiện ích được phép chạy (quyền
// host sẵn có, hoặc quyền tuỳ chọn người dùng cấp từ popup) và nạp script vào
// khung đó nếu chưa có. Phiên nghe cả thẻ chạy ngay trong khung ấy với video
// thật: dừng/phát theo giọng đọc, phụ đề nằm trong khung (thấy cả khi toàn
// màn hình), lời chép lưu theo khoá của video.

// Các hàm dưới chạy trong từng khung (chrome.scripting chép nguyên thân hàm).
function bundleLoaded() {
  return Boolean(globalThis.LTV?.contentLoaded);
}

function mediaInfo() {
  return globalThis.LTV?.mediaInfo?.() || null;
}

export function createMediaLink({ scripting = chrome.scripting, bundleFiles }) {
  // Kết quả theo từng khung; khung không có quyền thì không có trong danh sách.
  async function inFrames(tabId, func) {
    try {
      return await scripting.executeScript({
        target: { tabId, allFrames: true },
        func,
      });
    } catch {
      return [];
    }
  }

  // → { frameId, key } của khung có video lớn nhất, hoặc null.
  async function find(tabId) {
    const loaded = await inFrames(tabId, bundleLoaded);
    const missing = loaded
      .filter((entry) => entry.result === false)
      .map((entry) => entry.frameId);
    if (missing.length > 0)
      await scripting
        .executeScript({
          target: { tabId, frameIds: missing },
          files: bundleFiles(),
        })
        .catch(() => {});
    let best = null;
    for (const { frameId, result } of await inFrames(tabId, mediaInfo)) {
      const area = Number(result?.area) || 0;
      if (area > (best?.area || 0) && result.key)
        best = { frameId, key: String(result.key), area };
    }
    return best ? { frameId: best.frameId, key: best.key } : null;
  }

  return { find };
}
