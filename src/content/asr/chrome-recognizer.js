// Chép lời bằng bộ nhận dạng giọng nói có sẵn của Google Chrome (Web Speech
// API, Chrome 139+ nhận thẳng audio track của video – không cần micro). Dùng
// nhận dạng trên máy khi gói ngôn ngữ đã có, không thì dùng dịch vụ của Google.
// Chrome không trả mốc thời gian nên mốc câu được ước lượng theo lúc có kết quả.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  // Kết quả tạm đầu tiên đến sau khi bắt đầu nói ~0.8 s; kết quả cuối đến sau
  // khi nói xong ~0.6 s (tính theo thời gian thực, nhân tốc độ phát).
  const FIRST_RESULT_LATENCY = 0.8;
  const FINAL_RESULT_LATENCY = 0.6;
  const RESTART_DELAY_MS = 300;
  const MAX_NETWORK_ERRORS = 3;

  const FATAL_ERRORS = {
    "not-allowed":
      "Trình duyệt không cho phép nhận dạng giọng nói trên trang này.",
    "service-not-allowed":
      "Trình duyệt không cho phép dùng dịch vụ nhận dạng giọng nói.",
    "language-not-supported":
      "Chrome chưa nhận dạng được ngôn ngữ này – hãy chọn ngôn ngữ khác hoặc dùng Whisper.",
    "audio-capture": "Không đọc được âm thanh của video.",
  };
  const NETWORK_MESSAGE =
    "Không kết nối được dịch vụ nhận dạng giọng nói của Chrome (cần Google Chrome 139+ và mạng) – có thể dùng Whisper trong Tuỳ chọn.";

  function constructor() {
    return root.SpeechRecognition || root.webkitSpeechRecognition || null;
  }

  // Chrome 139+ mới nhận audio track; dấu hiệu là có hàm tĩnh available().
  LTV.chromeRecognizerSupported = function chromeRecognizerSupported() {
    const Ctor = constructor();
    return Boolean(Ctor && typeof Ctor.available === "function");
  };

  LTV.asrTiming = function asrTiming({ firstHeard, finalAt, rate }) {
    const speed = rate > 0 ? rate : 1;
    const start = Math.max(0, firstHeard - FIRST_RESULT_LATENCY * speed);
    const end = Math.max(start + 0.5, finalAt - FINAL_RESULT_LATENCY * speed);
    const ms = (value) => Math.round(value * 1000) / 1000;
    return { start: ms(start), end: ms(end) };
  };

  async function canRunLocally(Ctor, lang) {
    try {
      const status = await Ctor.available({
        langs: [lang],
        processLocally: true,
      });
      return status === "available";
    } catch {
      return false;
    }
  }

  // Phát kết quả của một sự kiện onresult. Mỗi lượt nói có khoá riêng
  // (lần khởi động + chỉ số kết quả) để bộ cắt cụm ghép tạm với cuối.
  function emitResults(event, { video, firstHeard, epoch, handlers }) {
    let finals = 0;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!firstHeard.has(i)) firstHeard.set(i, video.currentTime);
      const text = String(result[0]?.transcript || "").trim();
      const key = `${epoch}:${i}`;
      if (!result.isFinal) {
        if (text)
          handlers.onInterim?.({ key, text, firstHeard: firstHeard.get(i) });
        continue;
      }
      const timing = LTV.asrTiming({
        firstHeard: firstHeard.get(i),
        finalAt: video.currentTime,
        rate: video.playbackRate,
      });
      finals += 1;
      if (text)
        handlers.onSegment({
          ...timing,
          text,
          key,
          firstHeard: firstHeard.get(i),
        });
      firstHeard.delete(i);
    }
    return finals;
  }

  LTV.createChromeRecognizer = function createChromeRecognizer({ video }) {
    let recognition = null;
    let running = false;
    let local = false;
    let networkErrors = 0;
    let restartTimer = null;
    let handlers = null;
    let firstHeard = new Map();
    let epoch = 0;

    function handleResult(event) {
      const context = { video, firstHeard, epoch, handlers };
      if (emitResults(event, context) > 0) networkErrors = 0;
    }

    function handleError(event) {
      if (FATAL_ERRORS[event.error]) {
        running = false;
        handlers.onError(FATAL_ERRORS[event.error], true);
      } else if (event.error === "network") {
        networkErrors += 1;
        if (networkErrors >= MAX_NETWORK_ERRORS) {
          running = false;
          handlers.onError(NETWORK_MESSAGE, true);
        }
      }
    }

    function resumeOnPlay() {
      video.removeEventListener("play", resumeOnPlay);
      if (running && !recognition) begin();
    }

    function handleEnd() {
      recognition = null;
      if (!running) return;
      // Đang tạm dừng thì chờ phát tiếp mới nghe lại (tránh khởi động liên tục).
      if (video.paused) video.addEventListener("play", resumeOnPlay);
      else
        restartTimer = setTimeout(
          begin,
          RESTART_DELAY_MS * (1 + networkErrors),
        );
    }

    function begin() {
      if (!running || recognition) return;
      const Ctor = constructor();
      recognition = new Ctor();
      recognition.lang = handlers.lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      if (local) recognition.processLocally = true;
      firstHeard = new Map();
      epoch += 1;
      recognition.onresult = handleResult;
      recognition.onerror = handleError;
      recognition.onend = handleEnd;
      recognition.start(handlers.track);
    }

    return {
      engine: "chrome",
      async start({ track, lang, onSegment, onInterim, onError }) {
        const Ctor = constructor();
        handlers = {
          track,
          lang: lang === "auto" ? "en-US" : lang,
          onSegment,
          onInterim,
          onError,
        };
        local = await canRunLocally(Ctor, handlers.lang);
        running = true;
        begin();
      },
      stop() {
        running = false;
        clearTimeout(restartTimer);
        video.removeEventListener("play", resumeOnPlay);
        try {
          recognition?.abort();
        } catch {
          // Đã dừng.
        }
        recognition = null;
      },
      isLocal: () => local,
    };
  };
})(globalThis);
