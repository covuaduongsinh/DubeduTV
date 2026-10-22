// Phiên lồng tiếng cho video không có phụ đề: thu âm thanh của chính video
// (captureStream – không tắt tiếng tab, không cần micro), chép lời bằng Chrome
// hoặc Whisper, dịch từng câu ngay khi có rồi đưa cho bộ đọc trực tiếp.
// Lời chép được lưu để lần xem sau lồng tiếng khớp như video có phụ đề.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const SAVE_DELAY_MS = 4000;
  const NO_ENGINE_MESSAGE =
    "Video không có phụ đề. Để tự chép lời, hãy dùng Google Chrome 139+ hoặc nhập API key Whisper trong Tuỳ chọn.";
  const CONTEXT_LINES = 3;

  // Lấy audio track của video; trả lỗi dễ hiểu khi trang chặn thu âm.
  async function captureAudioTrack(video, signal) {
    let stream;
    try {
      stream = (video.captureStream || video.mozCaptureStream).call(video);
    } catch {
      throw LTV.captionError(
        "Video này chặn thu âm thanh (nguồn khác hoặc có bảo vệ bản quyền) nên chưa tự chép lời được.",
      );
    }
    const track = await LTV.util.waitFor(() => stream.getAudioTracks()[0], {
      timeout: 15000,
      interval: 300,
      signal,
    });
    if (!track) {
      throw LTV.captionError(
        "Chưa thu được âm thanh – hãy bấm phát video rồi thử lại.",
      );
    }
    return track;
  }

  async function chooseEngine(settings) {
    let hasKey = false;
    try {
      const { whisperApiKey } = await chrome.storage.local.get("whisperApiKey");
      hasKey = Boolean(whisperApiKey);
    } catch {
      hasKey = false;
    }
    if (settings.asrEngine === "whisper" && hasKey) return "whisper";
    if (LTV.chromeRecognizerSupported()) return "chrome";
    return hasKey ? "whisper" : null;
  }

  // Gom lời chép mới và gửi service worker lưu theo lô (debounce).
  function createTranscriptSaver({ connection, key, video, meta }) {
    const unsaved = [];
    let timer = null;

    function flush() {
      clearTimeout(timer);
      timer = null;
      if (unsaved.length === 0) return;
      connection.post({
        type: "transcript:put",
        key,
        ...meta(),
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        cues: unsaved.splice(0),
      });
    }

    return {
      add(cue) {
        unsaved.push(cue);
        if (!timer) timer = setTimeout(flush, SAVE_DELAY_MS);
      },
      flush,
    };
  }

  // Dịch một câu vừa chép, kèm vài câu trước làm ngữ cảnh.
  async function translateLive(
    { connection, settings, lang, title, recent },
    text,
  ) {
    const tl = settings.targetLang;
    if (LTV.tracks.sameLang(lang, tl)) return { text };
    const response = await connection.request({
      type: "translate",
      texts: [text],
      context: recent.slice(-CONTEXT_LINES),
      sl: lang === "auto" ? "auto" : LTV.baseLang(lang),
      tl,
      title,
      engine: settings.translator,
    });
    return { text: response.results?.[0] || null, warning: response.warning };
  }

  function listeningMessage(engine) {
    const label = engine === "whisper" ? "Whisper" : "Chrome";
    return `Video không có phụ đề – đang nghe và chép lời (${label})…`;
  }

  function spokenLanguage(engine, settings) {
    return engine === "chrome" && settings.asrLang === "auto"
      ? "en-US"
      : settings.asrLang;
  }

  LTV.createLiveSession = function createLiveSession(options) {
    const { sessionId, video, connection, getSettings, title } = options;
    const setStatus = options.setStatus || (() => {});
    const isSuspended = options.isSuspended || (() => false);
    const recent = [];
    const parts = { recognizer: null, dubber: null, speech: null, track: null };
    let translating = Promise.resolve();
    let stopped = false;
    let heard = 0;
    let lang = "en-US";
    let engine = null;
    const saver = createTranscriptSaver({
      connection,
      key: sessionId,
      video,
      meta: () => ({ lang, engine }),
    });

    async function deliver(sentence) {
      const context = {
        connection,
        settings: getSettings(),
        lang,
        title,
        recent,
      };
      const result = await translateLive(context, sentence.text);
      recent.push(sentence.text);
      if (result.warning) setStatus("warn", result.warning, { tone: "warn" });
      if (result.text && !stopped)
        parts.dubber.push({ ...sentence, tr: result.text });
    }

    function handleSegment(segment) {
      if (stopped || isSuspended()) return;
      saver.add(segment);
      for (const sentence of LTV.segment.buildSentences([segment])) {
        translating = translating
          .then(() => deliver(sentence))
          .catch((error) =>
            setStatus("error", `Lỗi dịch: ${error.message}`, { tone: "error" }),
          );
      }
      heard += 1;
      setStatus("live", `Đang nghe & lồng tiếng • đã chép ${heard} câu`);
    }

    function handleError(message, fatal) {
      setStatus("error", message, { tone: "error", sticky: fatal });
    }

    function createParts(settings) {
      parts.speech = options.makeSpeech();
      parts.dubber = LTV.createLiveDubber({
        video,
        speech: parts.speech,
        getSettings: options.effectiveSettings || getSettings,
        lang: settings.targetLang,
        onLine: options.onLine,
        onSpeechResult: options.onSpeechResult,
      });
      parts.recognizer =
        engine === "whisper"
          ? LTV.createWhisperRecognizer({ connection, video })
          : LTV.createChromeRecognizer({ video });
    }

    return {
      async start() {
        const settings = getSettings();
        engine = await chooseEngine(settings);
        if (!engine) throw LTV.captionError(NO_ENGINE_MESSAGE);
        lang = spokenLanguage(engine, settings);
        parts.track = await captureAudioTrack(video, options.signal);
        if (stopped) return;
        createParts(settings);
        parts.dubber.start();
        await parts.recognizer.start({
          track: parts.track,
          lang,
          onSegment: handleSegment,
          onError: handleError,
        });
        setStatus("live", listeningMessage(engine), { sticky: true });
      },
      stop() {
        if (stopped) return;
        stopped = true;
        parts.recognizer?.stop();
        parts.dubber?.stop();
        parts.speech?.dispose();
        saver.flush();
        parts.track?.stop();
      },
      progress: () => ({ done: heard, total: heard }),
      engine: () => engine,
    };
  };
})(globalThis);
