// Nghe cả thẻ với video thật trong khung này (service worker đã tìm thấy và
// nạp script vào khung chứa video): bộ đọc dừng/phát được video, phụ đề nằm
// cạnh video (vào toàn màn hình cùng trình phát), lời chép lưu theo khoá
// video để lần sau lồng tiếng lại khớp thời gian.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MAX_ANCHORS = 600;
  const TIMEUPDATE_EVERY_MS = 1000;
  const MARK_EVENTS = [
    "play",
    "playing",
    "pause",
    "seeking",
    "seeked",
    "ratechange",
    "waiting",
    "ended",
  ];

  // Video thật cho bộ đọc, trừ âm lượng: giảm tiếng gốc bằng GainNode ở
  // offscreen để bộ chép lời vẫn nghe rõ âm thanh của thẻ.
  class LinkedVideo {
    constructor(element, onVolume) {
      this.element = element;
      this.onVolume = onVolume;
      this.level = 1;
    }

    get currentTime() {
      return this.element.currentTime;
    }

    get paused() {
      return this.element.paused;
    }

    get seeking() {
      return this.element.seeking;
    }

    get ended() {
      return this.element.ended;
    }

    get playbackRate() {
      return this.element.playbackRate;
    }

    get duration() {
      return this.element.duration;
    }

    get volume() {
      return this.level;
    }

    set volume(value) {
      this.level = value;
      this.onVolume(value);
    }

    pause() {
      this.element.pause();
    }

    play() {
      return this.element.play();
    }

    addEventListener(...args) {
      this.element.addEventListener(...args);
    }

    removeEventListener(...args) {
      this.element.removeEventListener(...args);
    }
  }

  // Lời chép tính theo giây kể từ lúc bắt đầu thu; đổi sang thời gian video
  // bằng các mốc neo ghi mỗi khi video phát/dừng/tua/đổi tốc độ (và mỗi giây).
  LTV.createTimeMap = function createTimeMap({ video, now }) {
    const anchors = [];
    let lastUpdate = 0;

    function mark() {
      const moving = !video.paused && !video.seeking && !video.ended;
      anchors.push({
        capture: now(),
        time: video.currentTime,
        rate: moving ? video.playbackRate : 0,
      });
      if (anchors.length > MAX_ANCHORS) anchors.shift();
    }

    function onTimeUpdate() {
      if (Date.now() - lastUpdate < TIMEUPDATE_EVERY_MS) return;
      lastUpdate = Date.now();
      mark();
    }

    function toVideo(capture) {
      let anchor = anchors[0];
      for (let index = anchors.length - 1; index >= 0; index -= 1) {
        if (anchors[index].capture <= capture) {
          anchor = anchors[index];
          break;
        }
      }
      if (!anchor) return capture;
      return Math.max(
        0,
        anchor.time + (capture - anchor.capture) * anchor.rate,
      );
    }

    for (const name of MARK_EVENTS) video.addEventListener(name, mark);
    video.addEventListener("timeupdate", onTimeUpdate);
    mark();

    return {
      toVideo,
      dispose() {
        for (const name of MARK_EVENTS) video.removeEventListener(name, mark);
        video.removeEventListener("timeupdate", onTimeUpdate);
      },
    };
  };

  // Phần riêng của phiên có video thật; null nếu khung không còn video.
  LTV.createLinkedTabMedia = function createLinkedTabMedia(
    info,
    { connection, getSettings, onToggle },
  ) {
    const element = LTV.util.largestVideo(document);
    if (!element?.parentElement) return null;
    const now = () => (Date.now() - info.startedAt) / 1000;
    const timeMap = LTV.createTimeMap({ video: element, now });
    const saver = LTV.createTranscriptSaver({
      connection,
      key: info.key,
      video: element,
      meta: () => ({ lang: info.lang, engine: info.engine }),
    });
    return {
      video: new LinkedVideo(element, (value) =>
        connection.post({ type: "tabLive:gain", value }),
      ),
      overlay: LTV.createOverlay({
        container: element.parentElement,
        video: element,
        fill: false,
        showPill: true,
        getSettings,
        onToggle,
      }),
      liveMode: () => getSettings().liveMode,
      now,
      toVideo(item) {
        const start = timeMap.toVideo(item.start);
        return {
          ...item,
          start,
          end: Math.max(start, timeMap.toVideo(item.end)),
        };
      },
      save: (cue) => saver.add(cue),
      describe(engine) {
        const mode =
          getSettings().liveMode === "parallel" ? "song song" : "nối tiếp";
        return `Đang nghe âm thanh cả thẻ (${engine}) – lồng tiếng ${mode} ngay trên video…`;
      },
      dispose() {
        saver.flush();
        timeMap.dispose();
      },
    };
  };
})(globalThis);
