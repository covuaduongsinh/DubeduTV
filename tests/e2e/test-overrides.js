// Chỉ có trong bản build --test. Chọn provider theo <meta name="ltv-test-provider">
// (trang giả lập chạy trên 127.0.0.1) và thay giọng đọc bằng bộ giả lập ghi
// nhật ký vào thuộc tính DOM để Playwright đọc. Đặt <html data-ltv-real-speech="1">
// để dùng đường giọng đọc thật (service worker → offscreen).
(function () {
  const LTV = globalThis.LTV;
  LTV.testMode = true;

  LTV.pickProvider = function pickProvider(loc) {
    const id = document.querySelector(
      'meta[name="ltv-test-provider"]',
    )?.content;
    if (id) return LTV.providers.find((provider) => provider.id === id) || null;
    return LTV.providers.find((provider) => provider.matches(loc)) || null;
  };

  const createRealSpeech = LTV.createSpeechClient;
  LTV.createSpeechClient = function createSpeechClient(deps) {
    if (document.documentElement.dataset.ltvRealSpeech === "1")
      return createRealSpeech(deps);
    const log = [];
    let current = null;
    const write = () =>
      document.documentElement.setAttribute(
        "data-ltv-test-log",
        JSON.stringify(log),
      );

    function stop() {
      if (!current) return;
      clearTimeout(current.timer);
      clearTimeout(current.probe);
      current.entry.interrupted = true;
      current.resolve({ ok: false, event: "interrupted" });
      current = null;
      write();
    }

    return {
      speak({ text, rate, lang }) {
        stop();
        const video = document.querySelector("video");
        const entry = {
          text,
          rate,
          lang,
          at: Math.round(video.currentTime * 100) / 100,
        };
        log.push(entry);
        write();
        const ms = (LTV.timing.estimateSeconds(text) / rate) * 1000;
        return new Promise((resolve) => {
          current = { entry, resolve };
          current.probe = setTimeout(() => {
            entry.volumeDuring = Math.round(video.volume * 100) / 100;
            write();
          }, ms / 2);
          current.timer = setTimeout(() => {
            entry.done = true;
            current = null;
            write();
            resolve({ ok: true, event: "end", elapsed: ms / 1000 });
          }, ms);
        });
      },
      stop,
      prefetch() {},
      dispose: stop,
    };
  };
})();
