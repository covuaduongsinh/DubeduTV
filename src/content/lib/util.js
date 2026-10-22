// Tiện ích nhỏ dùng chung cho content script.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  function sleep(ms, signal) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // Gọi lặp fn() đến khi trả giá trị truthy, hết giờ (null) hoặc bị huỷ.
  async function waitFor(fn, { timeout = 10000, interval = 250, signal } = {}) {
    const deadline = Date.now() + timeout;
    while (!signal?.aborted) {
      let value = null;
      try {
        value = await fn();
      } catch {
        value = null;
      }
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(interval, signal);
    }
    return null;
  }

  // FNV-1a 32-bit: khoá cache cho từng câu, đủ tốt trong phạm vi một video.
  function hashText(text) {
    let hash = 0x811c9dc5;
    const value = String(text);
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  }

  // Video lớn nhất đang hiển thị trên trang.
  function largestVideo(scope) {
    const videos = Array.from((scope || document).querySelectorAll("video"));
    let best = null;
    let bestArea = 0;
    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }
    return best;
  }

  LTV.util = { sleep, waitFor, hashText, largestVideo };
})(globalThis);
