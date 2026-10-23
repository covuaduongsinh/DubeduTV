// "Nghe âm thanh cả thẻ" – phía trang: nhận lời chép từ offscreen (qua service
// worker), dịch và đọc. Service worker gửi tới khung có video thật khi với
// tới được (tab-linked.js: nối tiếp hoặc song song, phụ đề cạnh video, lưu
// lời chép); không thì tới trang chính: đọc song song theo một "video" giả có
// đồng hồ tính từ lúc bắt đầu thu, phụ đề phủ cố định theo khung video lớn
// nhất. Tiếng gốc giảm bằng GainNode ở offscreen.
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

  // Phần riêng khi không với tới video: video giả, lớp phủ cố định, song song.
  function unlinkedMedia(info, { connection, getSettings, onToggle }) {
    const video = LTV.createTabVideo({
      startedAt: info.startedAt,
      onVolume: (value) => connection.post({ type: "tabLive:gain", value }),
    });
    return {
      video,
      overlay: LTV.createOverlay({
        container: document.documentElement,
        fixed: true,
        anchor: largestMedia,
        showPill: true,
        getSettings,
        onToggle,
      }),
      liveMode: () => "parallel",
      now: () => video.currentTime,
      toVideo: (item) => item,
      save() {},
      describe: (engine) =>
        `Đang nghe âm thanh cả thẻ (${engine}) – chỉ đọc song song vì chưa điều khiển được video trong trang…`,
      dispose() {},
    };
  }

  // Một phiên nghe cả thẻ: phần riêng (media), bộ đọc, đường dịch, bộ cắt cụm.
  function createSession(info, { connection, getSettings, voice }) {
    const deps = {
      connection,
      getSettings,
      onToggle: () => connection.post({ type: "tabLive:stop" }),
    };
    const media =
      (info.linked && LTV.createLinkedTabMedia(info, deps)) ||
      unlinkedMedia(info, deps);
    const { overlay } = media;
    overlay.setActive(true);
    const speech = LTV.createSpeechClient({
      connection,
      getSettings: voice.effectiveSettings,
    });
    const dubber = LTV.createLiveDubber({
      video: media.video,
      speech,
      getSettings: () => ({
        ...voice.effectiveSettings(),
        liveMode: media.liveMode(),
      }),
      lang: getSettings().targetLang,
      onLine: (sentence) => overlay.setLine(sentence),
      onSpeechResult: voice.handle,
    });
    const current = {
      media,
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
    // Bộ cắt cụm chạy theo đồng hồ thu; cụm đọc được đổi sang thời gian video.
    current.cutter = LTV.createPhraseCutter({
      onPhrase: (phrase) => current.pipeline.enqueue(media.toVideo(phrase)),
      now: media.now,
    });
    dubber.start();
    const engine = info.engine === "whisper" ? "Whisper" : "Chrome";
    overlay.setStatus(media.describe(engine), { sticky: true });
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
      current.media.dispose();
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
      const { start, end, text } = session.media.toVideo(segment);
      session.media.save({ start, end, text });
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
      // Kết quả tạm chỉ dùng khi đọc song song (nối tiếp đọc theo câu).
      if (message.event === "interim") {
        if (session.media.liveMode() === "parallel")
          session.cutter.interim(message.result);
      } else if (message.event === "segment") onSegment(message.segment);
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
