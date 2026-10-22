// Bộ đồng bộ lồng tiếng: theo video.currentTime đọc đúng câu, tự tăng tốc
// cho vừa khung giờ, bắt kịp khi bị trễ, xử lý pause/seek/quảng cáo, và giảm
// âm lượng video gốc trong lúc đọc. Phụ thuộc được truyền vào để kiểm thử.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const TICK_MS = 120;
  const LEAD_SECONDS = 0.08;
  const MAX_LAG_SECONDS = 1.5;
  const LINE_HOLD_SECONDS = 0.6;
  const UNDUCK_DELAY_MS = 450;
  const FADE_STEPS = 8;
  const FADE_STEP_MS = 30;

  const realClock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };

  function createDucker(video, getSettings, clock) {
    let userVolume = video.volume;
    let ducked = false;
    let lastWrite = null;
    let fadeTimer = null;
    let upTimer = null;

    function write(value) {
      lastWrite = Math.min(1, Math.max(0, value));
      video.volume = lastWrite;
    }

    // Người dùng tự chỉnh âm lượng: tôn trọng mức mới.
    function onVolumeChange() {
      if (lastWrite !== null && Math.abs(video.volume - lastWrite) < 0.002)
        return;
      clock.clearInterval(fadeTimer);
      userVolume = video.volume;
      ducked = false;
      lastWrite = null;
    }
    video.addEventListener("volumechange", onVolumeChange);

    function fadeTo(target) {
      clock.clearInterval(fadeTimer);
      const from = video.volume;
      let step = 0;
      fadeTimer = clock.setInterval(() => {
        step += 1;
        write(from + ((target - from) * step) / FADE_STEPS);
        if (step >= FADE_STEPS) clock.clearInterval(fadeTimer);
      }, FADE_STEP_MS);
    }

    function up() {
      if (!ducked) return;
      ducked = false;
      fadeTo(userVolume);
    }

    return {
      // userVolume chỉ đổi khi người dùng tự chỉnh (onVolumeChange); không đọc
      // lại video.volume ở đây vì có thể đang giữa một lần fade.
      down() {
        clock.clearTimeout(upTimer);
        const level = getSettings().duckVolume;
        if (level >= 1) return;
        ducked = true;
        fadeTo(userVolume * level);
      },
      upSoon() {
        clock.clearTimeout(upTimer);
        upTimer = clock.setTimeout(up, UNDUCK_DELAY_MS);
      },
      restore() {
        clock.clearTimeout(upTimer);
        clock.clearInterval(fadeTimer);
        if (ducked) write(userVolume);
        ducked = false;
        video.removeEventListener("volumechange", onVolumeChange);
      },
    };
  }

  // Chỉ số câu cuối cùng đã bắt đầu tại thời điểm t (tìm nhị phân).
  function lastStartedAt(sentences, t) {
    let low = 0;
    let high = sentences.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (sentences[middle].start <= t + LEAD_SECONDS) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }

  // Câu đang "giữ khung": từ lúc bắt đầu đến khi câu kế tiếp bắt đầu.
  function activeIndex(sentences, t) {
    const index = lastStartedAt(sentences, t);
    if (index < 0) return -1;
    const next = sentences[index + 1];
    const until = next
      ? Math.max(sentences[index].end, next.start)
      : sentences[index].end + 1;
    return t < until ? index : -1;
  }

  function tooLate(sentence, t) {
    const late = t - sentence.start;
    return late > 2 && late > (sentence.end - sentence.start) * 0.6;
  }

  // Câu hiển thị trên video: câu đang đọc, hoặc câu đang tới giờ (giữ thêm chút sau khi hết).
  function lineFor(sentences, speakingIndex, index, t) {
    if (speakingIndex >= 0) return sentences[speakingIndex];
    if (index >= 0 && t <= sentences[index].end + LINE_HOLD_SECONDS)
      return sentences[index];
    return null;
  }

  // Tốc độ đọc để câu vừa khung từ bây giờ tới lúc câu kế tiếp bắt đầu.
  function rateFor({ sentences, index, t, videoRate, settings, cps }) {
    const sentence = sentences[index];
    const next = sentences[index + 1];
    const slotEnd = next
      ? Math.max(next.start, sentence.end)
      : sentence.end + 1.5;
    return LTV.timing.chooseRate({
      text: sentence.tr,
      available: (slotEnd - t) / videoRate,
      baseRate: settings.rate,
      maxRate: settings.maxRate,
      autoRate: settings.autoRate,
      cps,
      videoRate,
    });
  }

  // Việc cần làm với câu vừa tới giờ: xin dịch, chờ câu đang đọc, bỏ qua, hay đọc.
  function nextAction(sentence, t, isSpeaking) {
    if (!sentence.tr) return "translate";
    if (isSpeaking && t - sentence.start <= MAX_LAG_SECONDS) return "wait";
    return tooLate(sentence, t) ? "skip" : "speak";
  }

  const NO_OP = () => {};
  const OPTION_DEFAULTS = {
    clock: realClock,
    isSuspended: () => false,
    ensureTranslated: NO_OP,
    onLine: NO_OP,
    onSpeechResult: NO_OP,
  };

  // Giọng đọc của bộ đồng bộ: mỗi lúc một câu; token loại bỏ kết quả của câu
  // đã bị cắt; tự hiệu chỉnh tốc độ đọc thực tế (ký tự/giây).
  function createVoice({
    video,
    sentences,
    speech,
    getSettings,
    lang,
    ducker,
  }) {
    let speaking = null;
    let token = 0;
    let cps = LTV.timing.DEFAULT_CPS;

    function prefetchAfter(index) {
      const upcoming = sentences
        .slice(index + 1, index + 3)
        .map((item) => item.tr)
        .filter(Boolean);
      if (upcoming.length > 0) speech.prefetch(upcoming, lang);
    }

    return {
      index: () => (speaking ? speaking.index : -1),
      isSpeaking: () => Boolean(speaking),
      stop() {
        if (!speaking) return;
        token += 1;
        speaking = null;
        speech.stop();
        ducker.upSoon();
      },
      // Đọc câu index; onFinished(result, sentence) khi câu kết thúc tự nhiên.
      start(index, t, onFinished) {
        const sentence = sentences[index];
        const videoRate = video.playbackRate || 1;
        const settings = getSettings();
        const rate = rateFor({ sentences, index, t, videoRate, settings, cps });
        token += 1;
        const myToken = token;
        speaking = { index, rate };
        ducker.down();
        prefetchAfter(index);
        speech.speak({ text: sentence.tr, rate, lang }).then((result) => {
          if (myToken !== token) return;
          speaking = null;
          if (result.ok) {
            cps = LTV.timing.calibrateCps(
              cps,
              sentence.tr,
              result.elapsed,
              rate,
            );
          }
          ducker.upSoon();
          onFinished(result, sentence);
        });
      },
    };
  }

  const VIDEO_EVENTS = ["pause", "play", "playing", "seeked", "ratechange"];

  LTV.createDubber = function createDubber(options) {
    const config = { ...OPTION_DEFAULTS, ...options };
    const { video, sentences, clock, isSuspended, onLine } = config;
    const ducker = createDucker(video, config.getSettings, clock);
    const voice = createVoice({ ...config, ducker });
    let lastStarted = -1;
    let running = false;
    let tickTimer = null;
    let shownLine = undefined;

    function showLine(index, t) {
      const line = lineFor(sentences, voice.index(), index, t);
      if (line !== shownLine) {
        shownLine = line;
        onLine(line);
      }
    }

    function onFinished(result, sentence) {
      config.onSpeechResult(result, sentence);
      tick();
    }

    function tick() {
      if (!running) return;
      if (isSuspended() || video.paused || video.seeking || video.ended) {
        if (voice.isSpeaking()) {
          voice.stop();
          lastStarted = -1;
        }
        if (isSuspended()) showLine(-1, 0);
        return;
      }
      const t = video.currentTime;
      const index = activeIndex(sentences, t);
      showLine(index, t);
      if (index < 0 || index === lastStarted) return;
      const action = nextAction(sentences[index], t, voice.isSpeaking());
      if (action === "translate") config.ensureTranslated(index);
      if (action === "translate" || action === "wait") return;
      // Trễ quá MAX_LAG_SECONDS: cắt câu cũ để bắt kịp video.
      voice.stop();
      lastStarted = index;
      if (action === "skip") return;
      voice.start(index, t, onFinished);
      showLine(index, t);
    }

    function onSeeking() {
      voice.stop();
      lastStarted = -1;
      showLine(-1, 0);
    }

    return {
      start() {
        if (running) return;
        running = true;
        video.addEventListener("seeking", onSeeking);
        for (const name of VIDEO_EVENTS) video.addEventListener(name, tick);
        tickTimer = clock.setInterval(tick, TICK_MS);
        tick();
      },
      stop() {
        if (!running) return;
        running = false;
        clock.clearInterval(tickTimer);
        video.removeEventListener("seeking", onSeeking);
        for (const name of VIDEO_EVENTS) video.removeEventListener(name, tick);
        voice.stop();
        ducker.restore();
        shownLine = undefined;
        onLine(null);
      },
      tick,
    };
  };

  LTV.createDucker = createDucker;
  LTV.dubberInternals = { activeIndex, lastStartedAt, tooLate, nextAction };
})(globalThis);
