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

  // Bộ chép lời giả: phát lời theo kịch bản <script id="ltv-test-transcript">
  // khi video chạy qua mỗi câu (Chromium thử nghiệm không có dịch vụ nhận dạng
  // của Google). <html data-ltv-real-asr="1"> để dùng bộ nhận dạng thật.
  const realAsr = () => document.documentElement.dataset.ltvRealAsr === "1";
  const createRealRecognizer = LTV.createChromeRecognizer;
  const realSupported = LTV.chromeRecognizerSupported;
  LTV.chromeRecognizerSupported = () => (realAsr() ? realSupported() : true);
  LTV.createChromeRecognizer = function createChromeRecognizer(deps) {
    if (realAsr()) return createRealRecognizer(deps);
    const source = document.getElementById("ltv-test-transcript");
    const pending = JSON.parse(source?.textContent || "[]");
    let timer = null;
    return {
      engine: "chrome",
      async start({ onSegment }) {
        timer = setInterval(() => {
          while (
            pending.length > 0 &&
            pending[0].end + 0.4 <= deps.video.currentTime
          ) {
            onSegment(pending.shift());
          }
        }, 100);
      },
      stop: () => clearInterval(timer),
    };
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
          pausedAtStart: video.paused,
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
