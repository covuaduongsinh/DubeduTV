// Cầu nối giữa content script (isolated world) và page-hook.js (MAIN world):
// nhận payload phụ đề mà trang tải về, gọi API trình phát của trang.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const FROM_CONTENT = "ltv-content";
  const FROM_PAGE = "ltv-page";
  const MAX_CAPTURES = 40;

  const pending = new Map();
  const captures = [];
  const listeners = new Set();
  let started = false;
  let sequence = 0;

  function handleReply(data) {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  }

  function handleCapture(data) {
    if (typeof data.body !== "string" || typeof data.url !== "string") return;
    const capture = {
      kind: data.kind,
      url: data.url,
      body: data.body,
      at: data.at,
    };
    const duplicate = captures.some(
      (item) =>
        item.url === capture.url && item.body.length === capture.body.length,
    );
    if (duplicate) return;
    captures.push(capture);
    if (captures.length > MAX_CAPTURES) captures.shift();
    for (const listener of listeners) listener(capture);
  }

  function start() {
    if (started) return;
    started = true;
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== FROM_PAGE) return;
      if (data.type === "reply") handleReply(data);
      else if (data.type === "capture") handleCapture(data);
    });
    // page-hook giữ lại payload tải trước khi content script sẵn sàng.
    window.postMessage({ source: FROM_CONTENT, type: "replay" }, "*");
  }

  function call(name, payload, timeoutMs = 8000) {
    start();
    return new Promise((resolve, reject) => {
      sequence += 1;
      const id = `${Date.now()}-${sequence}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("bridge-timeout"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.postMessage(
        { source: FROM_CONTENT, type: "call", id, call: name, payload },
        "*",
      );
    });
  }

  function onCapture(listener) {
    start();
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // Tìm payload đã bắt (mới nhất trước) hoặc chờ payload mới khớp điều kiện.
  function waitForCapture(predicate, { timeout = 8000, signal } = {}) {
    start();
    for (let i = captures.length - 1; i >= 0; i -= 1) {
      if (predicate(captures[i])) return Promise.resolve(captures[i]);
    }
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const finish = (value) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeout);
      signal?.addEventListener("abort", () => finish(null));
      unsubscribe = onCapture((capture) => {
        if (predicate(capture)) finish(capture);
      });
    });
  }

  LTV.bridge = {
    start,
    call,
    onCapture,
    waitForCapture,
    captures: () => captures.slice(),
  };
})(globalThis);
