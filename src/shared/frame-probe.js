// Chọn khung (frame) để popup/phím tắt điều khiển: trang có thể có video ở
// trang chính hoặc trong khung nhúng (YouTube nhúng, Drive). Hỏi mọi khung
// của thẻ (ltv:probe), mỗi khung trả ltv:frameInfo kèm sender.frameId; không
// cần lưu trạng thái nên vẫn đúng khi service worker khởi động lại.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const PROBE_WAIT_MS = 250;

  // Khung đang lồng tiếng (video lớn nhất) → khung có video (lớn nhất, trang
  // chính khi bằng nhau) → trang chính → khung đầu tiên.
  function chooseFrame(frames) {
    if (!frames || frames.length === 0) return null;
    const larger = (a, b) =>
      (b.info.area || 0) - (a.info.area || 0) || a.frameId - b.frameId;
    const active = frames.filter((frame) => frame.info.active).sort(larger);
    if (active.length > 0) return active[0].frameId;
    const onVideo = frames.filter((frame) => frame.info.onVideo).sort(larger);
    if (onVideo.length > 0) return onVideo[0].frameId;
    return frames.some((frame) => frame.frameId === 0) ? 0 : frames[0].frameId;
  }

  function createFrameProbe({
    tabs = chrome.tabs,
    runtime = chrome.runtime,
  } = {}) {
    const waiting = new Map();

    function receive(message, sender) {
      if (message?.type !== "ltv:frameInfo") return false;
      const entry = waiting.get(message.nonce);
      if (entry && sender.tab?.id === entry.tabId)
        entry.frames.push({
          frameId: sender.frameId ?? 0,
          info: message.info || {},
        });
      return false;
    }
    runtime.onMessage.addListener(receive);

    // Danh sách { frameId, info } của các khung trả lời trong waitMs.
    async function probe(tabId, waitMs = PROBE_WAIT_MS) {
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry = { tabId, frames: [] };
      waiting.set(nonce, entry);
      tabs.sendMessage(tabId, { type: "ltv:probe", nonce }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waiting.delete(nonce);
      return entry.frames;
    }

    return { probe, receive };
  }

  LTV.chooseFrame = chooseFrame;
  LTV.createFrameProbe = createFrameProbe;
})(globalThis);
