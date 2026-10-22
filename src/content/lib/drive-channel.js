// Kênh postMessage giữa khung trình phát của Drive (youtube.googleapis.com) và
// trang drive.google.com: khung hỏi, trang cha (có cookie đăng nhập) trả lời.
// Hai phía đều kiểm tra nguồn của nhau.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const REQUEST = "ltv-drive-child";
  const REPLY = "ltv-drive-host";
  let sequence = 0;

  // Nguồn của trang trên cùng nếu đúng là Drive, không thì null.
  function topOrigin() {
    const origins = root.location?.ancestorOrigins;
    const origin = origins?.length ? origins[origins.length - 1] : null;
    return origin && LTV.DRIVE_ORIGINS.parent.test(origin) ? origin : null;
  }

  function call(name, payload = {}, timeoutMs = 15000) {
    const origin = topOrigin();
    if (!origin || window === window.top)
      return Promise.reject(new Error("not-in-drive"));
    sequence += 1;
    const id = `${Date.now()}-${sequence}`;
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = event.data;
        if (event.source !== window.top || event.origin !== origin) return;
        if (data?.source !== REPLY || data.id !== id) return;
        finish();
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error("drive-timeout"));
      }, timeoutMs);
      const finish = () => {
        clearTimeout(timer);
        removeEventListener("message", onMessage);
      };
      addEventListener("message", onMessage);
      window.top.postMessage(
        { source: REQUEST, id, call: name, payload },
        origin,
      );
    });
  }

  // Phía trang Drive: trả lời yêu cầu từ khung trình phát đúng nguồn.
  function serve(handlers) {
    addEventListener("message", (event) => {
      const data = event.data;
      if (data?.source !== REQUEST || !event.source) return;
      if (!LTV.DRIVE_ORIGINS.child.test(event.origin)) return;
      const handler = handlers[data.call];
      if (!handler) return;
      const reply = (body) =>
        event.source.postMessage(
          { source: REPLY, id: data.id, ...body },
          event.origin,
        );
      Promise.resolve()
        .then(() => handler(data.payload || {}))
        .then(
          (result) => reply({ result }),
          (error) => reply({ error: String(error?.message || error) }),
        );
    });
  }

  LTV.driveChannel = { call, serve, topOrigin };
})(globalThis);
