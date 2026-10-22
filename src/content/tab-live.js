// "Nghe âm thanh cả thẻ" – phía trang chính của thẻ: nhận lời chép từ
// offscreen (qua service worker), dịch và đọc song song (video có thể nằm
// trong khung khác nguồn nên không dừng được), hiện phụ đề phủ theo khung
// video lớn nhất. Giảm tiếng gốc bằng GainNode ở offscreen qua một "video"
// giả có đồng hồ theo lúc bắt đầu thu.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  class TabVideo extends EventTarget {
    constructor({ startedAt, onVolume }) {
      super();
      this.startedAt = startedAt;
      this.onVolume = onVolume;
      this.level = 1;
      this.paused = false;
      this.seeking = false;
      this.playbackRate = 1;
    }

    get currentTime() {
      return (Date.now() - this.startedAt) / 1000;
    }

    get volume() {
      return this.level;
    }

    set volume(value) {
      this.level = value;
      this.onVolume(value);
      this.dispatchEvent(new Event("volumechange"));
    }

    pause() {}

    play() {
      return Promise.resolve();
    }
  }

  LTV.createTabVideo = (options) => new TabVideo(options);

  // Khung video lớn nhất đang thấy trên trang (iframe hoặc <video>).
  function largestMedia() {
    let best = null;
    let bestArea = 0;
    for (const element of document.querySelectorAll("iframe, video")) {
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = element;
        bestArea = area;
      }
    }
    return best;
  }

  // Một phiên nghe cả thẻ: video giả, lớp phủ cố định, bộ đọc song song,
  // đường dịch và bộ cắt cụm.
  function createSession(info, { connection, getSettings, voice }) {
    const video = LTV.createTabVideo({
      startedAt: info.startedAt,
      onVolume: (value) => connection.post({ type: "tabLive:gain", value }),
    });
    const overlay = LTV.createOverlay({
      container: document.documentElement,
      fixed: true,
      anchor: largestMedia,
      showPill: true,
      getSettings,
      onToggle: () => connection.post({ type: "tabLive:stop" }),
    });
    overlay.setActive(true);
    const speech = LTV.createSpeechClient({
      connection,
      getSettings: voice.effectiveSettings,
    });
    const dubber = LTV.createLiveDubber({
      video,
      speech,
      getSettings: () => ({
        ...voice.effectiveSettings(),
        liveMode: "parallel",
      }),
      lang: getSettings().targetLang,
      onLine: (sentence) => overlay.setLine(sentence),
      onSpeechResult: voice.handle,
    });
    const current = {
      video,
      overlay,
      speech,
      dubber,
      heard: 0,
      stopped: false,
    };
    current.pipeline = LTV.createLivePipeline({
      connection,
      getSettings,
      title: document.title,
      getLang: () => info.lang,
      setStatus: (name, message, opts) => overlay.setStatus(message, opts),
      isStopped: () => current.stopped,
      push: (sentence) => dubber.push(sentence),
    });
    current.cutter = LTV.createPhraseCutter({
      onPhrase: (phrase) => current.pipeline.enqueue(phrase),
      now: () => video.currentTime,
    });
    dubber.start();
    const engine = info.engine === "whisper" ? "Whisper" : "Chrome";
    overlay.setStatus(
      `Đang nghe âm thanh cả thẻ (${engine}) – lồng tiếng song song…`,
      { sticky: true },
    );
    return current;
  }

  LTV.createTabLiveHost = function createTabLiveHost(options) {
    const { connection, getSettings, voice } = options;
    let session = null;

    function stop(reason) {
      if (!session) return;
      const current = session;
      session = null;
      current.stopped = true;
      current.cutter.reset();
      current.dubber.stop();
      current.speech.dispose();
      if (!reason) return current.overlay.destroy();
      current.overlay.setLine(null);
      current.overlay.setActive(false);
      current.overlay.setStatus(reason);
      setTimeout(() => current.overlay.destroy(), 5000);
    }

    function start(info) {
      stop();
      session = createSession(info, { connection, getSettings, voice });
    }

    function onSegment(segment) {
      const { start, end, text } = segment;
      if (segment.key && session.cutter.has(segment.key))
        session.cutter.final(segment);
      else
        for (const sentence of LTV.segment.buildSentences([
          { start, end, text },
        ]))
          session.pipeline.enqueue(sentence);
      session.heard += 1;
      session.overlay.setStatus(
        `Đang nghe cả thẻ • đã chép ${session.heard} câu`,
      );
    }

    function handle(message) {
      if (message.event === "started") return start(message);
      if (message.event === "stopped") return stop(message.reason);
      if (!session) return;
      if (message.event === "interim") session.cutter.interim(message.result);
      else if (message.event === "segment") onSegment(message.segment);
      else if (message.event === "error")
        session.overlay.setStatus(message.message, {
          tone: "error",
          sticky: message.fatal,
        });
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "ltv:tabLive") handle(message);
      return false;
    });

    return {
      refresh: () => session?.overlay.refresh(),
      active: () => Boolean(session),
    };
  };
})(globalThis);
