// Kết nối content script ↔ service worker qua một port, tự nối lại khi
// service worker khởi động lại. request() khớp phản hồi theo reqId.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  LTV.createConnection = function createConnection() {
    let port = null;
    let dead = false;
    let sequence = 0;
    const listeners = new Set();
    const waiting = new Map();

    function rejectAll(reason) {
      for (const [id, entry] of waiting) {
        waiting.delete(id);
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
    }

    function handleMessage(message) {
      const entry = message?.reqId ? waiting.get(message.reqId) : null;
      if (entry) {
        waiting.delete(message.reqId);
        clearTimeout(entry.timer);
        entry.resolve(message);
        return;
      }
      for (const listener of listeners) listener(message);
    }

    function connect() {
      if (port || dead) return port;
      try {
        port = chrome.runtime.connect({ name: "ltv" });
      } catch {
        // Tiện ích đã được tải lại/cập nhật: content script cũ không còn dùng được.
        dead = true;
        return null;
      }
      port.onMessage.addListener(handleMessage);
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        port = null;
        if (!chrome.runtime?.id) dead = true;
        rejectAll("disconnected");
        for (const listener of listeners) listener({ type: "disconnected" });
      });
      return port;
    }

    function post(message) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = connect();
        if (!current) return false;
        try {
          current.postMessage(message);
          return true;
        } catch {
          port = null;
        }
      }
      return false;
    }

    function request(message, timeoutMs = 90000) {
      return new Promise((resolve, reject) => {
        sequence += 1;
        const reqId = `r${Date.now()}-${sequence}`;
        const timer = setTimeout(() => {
          waiting.delete(reqId);
          reject(new Error("timeout"));
        }, timeoutMs);
        waiting.set(reqId, { resolve, reject, timer });
        if (!post({ ...message, reqId })) {
          clearTimeout(timer);
          waiting.delete(reqId);
          reject(new Error("Tiện ích vừa được cập nhật – hãy tải lại trang."));
        }
      });
    }

    return {
      post,
      request,
      onMessage(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isDead: () => dead,
    };
  };
})(globalThis);
