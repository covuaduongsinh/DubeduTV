// Bộ đọc cho video không có phụ đề (lời chép tới dần trong lúc xem):
//   "consecutive" – dịch nối tiếp: có câu mới thì tạm dừng video, đọc xong
//                   hàng đợi thì phát tiếp. Nghe đủ ý, không chồng tiếng.
//   "parallel"    – đọc song song: video chạy liên tục, đọc ngay khi có câu,
//                   tăng tốc khi dồn câu, bỏ câu đã trễ quá xa.
// Người dùng tự bấm phát/dừng thì tôn trọng, không giành quyền điều khiển.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MAX_BEHIND_SECONDS = 15;
  const BACKLOG_BOOST = 0.15;
  // Song song: chờ quá ngần này câu thì bỏ câu cũ nhất để không trễ mãi.
  const MAX_PARALLEL_QUEUE = 3;

  const realClock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };

  // Tốc độ đọc: song song thì tăng theo số câu đang chờ; nối tiếp thì video
  // đã dừng nên đọc ở tốc độ cài đặt.
  function liveRate(settings, mode, backlog, videoRate) {
    if (mode === "consecutive") return settings.rate;
    const speed = videoRate > 0 ? videoRate : 1;
    const base = settings.rate * speed;
    if (!settings.autoRate) return base;
    const ceiling = Math.max(base, settings.maxRate * speed);
    return (
      Math.round(Math.min(ceiling, base + BACKLOG_BOOST * backlog) * 100) / 100
    );
  }

  // Giữ video dừng trong lúc đọc (chế độ nối tiếp) và phân biệt thao tác của
  // người dùng với lệnh dừng/phát của chính tiện ích.
  function createPlaybackHold(video) {
    let held = false;
    let expectingPause = false;
    let userPaused = false;

    function onPause() {
      if (expectingPause) {
        expectingPause = false;
        return;
      }
      userPaused = true;
    }

    function onPlay() {
      userPaused = false;
      // Người dùng tự phát tiếp trong lúc đang đọc: để video chạy, đọc nốt.
      held = false;
    }

    return {
      hold() {
        if (video.paused || userPaused) return;
        expectingPause = true;
        held = true;
        video.pause();
      },
      release() {
        if (!held) return;
        held = false;
        if (video.paused && !userPaused) video.play()?.catch?.(() => {});
      },
      isHeld: () => held,
      attach() {
        video.addEventListener("pause", onPause);
        video.addEventListener("play", onPlay);
      },
      detach() {
        video.removeEventListener("pause", onPause);
        video.removeEventListener("play", onPlay);
      },
    };
  }

  LTV.createLiveDubber = function createLiveDubber(options) {
    const { video, speech, getSettings, lang } = options;
    const clock = options.clock || realClock;
    const onLine = options.onLine || (() => {});
    const onSpeechResult = options.onSpeechResult || (() => {});
    const ducker = LTV.createDucker(video, getSettings, clock);
    const playback = createPlaybackHold(video);
    const queue = [];
    let speaking = null;
    let token = 0;
    let running = false;

    function dropStale(mode) {
      if (mode !== "parallel") return;
      while (
        queue.length > 0 &&
        video.currentTime - queue[0].end > MAX_BEHIND_SECONDS
      ) {
        queue.shift();
      }
    }

    function cancelSpeech() {
      token += 1;
      if (speaking) speech.stop();
      speaking = null;
    }

    function speakNext() {
      if (!running || speaking) return;
      const settings = getSettings();
      const mode = settings.liveMode;
      dropStale(mode);
      const sentence = queue.shift();
      if (!sentence) {
        playback.release();
        return;
      }
      if (mode === "consecutive") playback.hold();
      if (!video.paused) ducker.down();
      const rate = liveRate(settings, mode, queue.length, video.playbackRate);
      token += 1;
      const myToken = token;
      speaking = sentence;
      onLine(sentence);
      speech.speak({ text: sentence.tr, rate, lang }).then((result) => {
        if (myToken !== token) return;
        speaking = null;
        ducker.upSoon();
        onSpeechResult(result, sentence);
        if (queue.length === 0) onLine(null);
        speakNext();
      });
    }

    function onSeeking() {
      queue.length = 0;
      if (speaking) ducker.upSoon();
      cancelSpeech();
      onLine(null);
    }

    return {
      start() {
        if (running) return;
        running = true;
        playback.attach();
        video.addEventListener("seeking", onSeeking);
      },
      push(sentence) {
        if (!running || !sentence?.tr) return;
        if (getSettings().liveMode === "parallel")
          while (queue.length >= MAX_PARALLEL_QUEUE) queue.shift();
        queue.push(sentence);
        speakNext();
      },
      stop() {
        if (!running) return;
        running = false;
        playback.detach();
        video.removeEventListener("seeking", onSeeking);
        queue.length = 0;
        cancelSpeech();
        ducker.restore();
        playback.release();
        onLine(null);
      },
      state: () => ({
        queued: queue.length,
        speaking: Boolean(speaking),
        held: playback.isHeld(),
      }),
    };
  };

  LTV.liveRate = liveRate;
})(globalThis);
