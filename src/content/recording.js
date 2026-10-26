// Quay video lồng tiếng – phần trong khung có video: báo vị trí video (để
// offscreen cắt đúng vùng hình), báo từng câu phụ đề tiếng Việt (để dựng .srt
// khớp file quay), ẩn thanh điều khiển của trình phát và các nút của tiện
// ích trong lúc quay (phụ đề vẫn hiện), báo khi video hết để tự dừng quay.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const LAYOUT_EVERY_MS = 1000;
  const STYLE_ID = "ltv-recording-style";
  const HIDE_SELECTORS = [
    ".ytp-chrome-top",
    ".ytp-chrome-bottom",
    ".ytp-gradient-top",
    ".ytp-gradient-bottom",
    ".ytp-ce-element",
    ".ytp-pause-overlay",
    ".ytp-paid-content-overlay",
    ".ytp-tooltip",
    '[data-ltv="button"]',
  ];

  // Vị trí video theo khung nhìn của khung này. Khung nhúng (không toàn màn
  // hình) không biết mình nằm đâu trong thẻ: báo rect null = quay cả thẻ.
  LTV.recordLayout = function recordLayout(video, win = root) {
    const rect = video.getBoundingClientRect();
    const crop = win === win.top || Boolean(win.document.fullscreenElement);
    return {
      rect: crop
        ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
        : null,
      viewport: { width: win.innerWidth, height: win.innerHeight },
    };
  };

  LTV.createRecordingReporter = function createRecordingReporter({
    connection,
    getVideo,
    getOverlay,
  }) {
    let active = false;
    let timer = null;
    let video = null;
    let lastText;
    // Câu đang hiện trên lớp phủ (để bản quay có cả câu đang dở lúc bấm quay).
    let shown = null;

    function sendLayout() {
      if (!active || !video?.isConnected) return;
      connection.post({
        type: "record:layout",
        layout: LTV.recordLayout(video),
      });
    }

    function onEnded() {
      if (active) connection.post({ type: "record:ended" });
    }

    function setHidden(hidden) {
      document.getElementById(STYLE_ID)?.remove();
      getOverlay()?.setRecording?.(hidden);
      if (!hidden) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `${HIDE_SELECTORS.join(",")}{opacity:0!important;pointer-events:none!important}`;
      (document.head || document.documentElement).appendChild(style);
    }

    function listen(on) {
      const method = on ? "addEventListener" : "removeEventListener";
      root[method]("resize", sendLayout);
      root[method]("scroll", sendLayout, { capture: true, passive: true });
      document[method]("fullscreenchange", sendLayout);
      video?.[method]("ended", onEnded);
    }

    function end() {
      if (active) {
        listen(false);
        active = false;
        clearInterval(timer);
        setHidden(false);
        video = null;
      }
      return { ok: true };
    }

    // Câu đang hiện (null khi không có phụ đề).
    function line(sentence) {
      if (!active) return;
      const text = sentence?.tr || null;
      if (text === lastText) return;
      lastText = text;
      connection.post({ type: "record:line", text, at: Date.now() });
    }

    return {
      begin() {
        end();
        video = getVideo();
        if (!video?.isConnected)
          return {
            ok: false,
            error:
              "Chưa thấy video đang lồng tiếng trong thẻ này – bật lồng tiếng rồi bấm quay.",
          };
        active = true;
        lastText = undefined;
        listen(true);
        timer = setInterval(sendLayout, LAYOUT_EVERY_MS);
        setHidden(true);
        return { ok: true, layout: LTV.recordLayout(video) };
      },
      end,
      // Bản quay đã chạy: gửi lại vị trí và câu đang hiện (tin gửi lúc bộ
      // quay còn đang khởi động bị bỏ).
      sync() {
        lastText = undefined;
        line(shown);
        sendLayout();
        return { ok: active };
      },
      line,
      // Hiện câu trên lớp phủ và báo cho bản quay.
      show(sentence) {
        shown = sentence;
        getOverlay()?.setLine(sentence);
        line(sentence);
      },
      isActive: () => active,
    };
  };
})(globalThis);
