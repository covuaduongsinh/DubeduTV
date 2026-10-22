// Điều phối trong trang: chọn provider theo site, theo dõi điều hướng SPA,
// bật/tắt lồng tiếng theo tab, nối provider → ghép câu → dịch → đọc.
(function () {
  const LTV = globalThis.LTV;
  if (LTV.contentLoaded) return;
  LTV.contentLoaded = true;

  const ACTIVE_KEY = "ltv-active";
  const NAV_POLL_MS = 800;
  const RESTART_KEYS = [
    "targetLang",
    "sourceLang",
    "translator",
    "claudeModel",
    "asrEnabled",
    "asrEngine",
    "asrLang",
  ];
  // Lời chép đã lưu phủ ít nhất ngần này thời lượng thì dùng như phụ đề.
  const TRANSCRIPT_MIN_COVERAGE = 0.9;

  const connection = LTV.createConnection();
  const bridge = LTV.bridge;
  const state = {
    settings: LTV.mergeSettings({}),
    active: false,
    forced: false,
    engineOverride: null,
    session: null,
    status: { state: "idle", message: "" },
    ui: { video: null, overlay: null, button: null },
  };
  let speechErrors = 0;

  function effectiveSettings() {
    // engineOverride: tên giọng máy dùng tạm khi giọng Google không phản hồi.
    if (!state.engineOverride) return state.settings;
    return {
      ...state.settings,
      voiceEngine: "system",
      systemVoice: state.engineOverride,
    };
  }

  function pickProvider() {
    if (typeof LTV.pickProvider === "function")
      return LTV.pickProvider(location);
    const provider = LTV.providers.find((item) => item.matches(location));
    if (provider) return provider;
    return state.forced
      ? LTV.providers.find((item) => item.id === "html5")
      : null;
  }

  function readActive() {
    try {
      const stored = sessionStorage.getItem(ACTIVE_KEY);
      if (stored === "1" || stored === "0") return stored === "1";
    } catch {
      // sessionStorage có thể bị chặn.
    }
    return state.settings.autoStart;
  }

  function writeActive(active) {
    try {
      sessionStorage.setItem(ACTIVE_KEY, active ? "1" : "0");
    } catch {
      // Bỏ qua.
    }
  }

  function setStatus(
    name,
    message,
    { tone = "info", sticky = false, extra } = {},
  ) {
    state.status = { state: name, message, ...extra };
    state.ui.overlay?.setStatus(message, { tone, sticky });
  }

  function ensureUi(provider) {
    const video = provider.findVideo();
    if (!video) return null;
    const ui = state.ui;
    if (ui.video !== video || !ui.overlay?.isAttached()) {
      ui.overlay?.destroy();
      const target = provider.overlayContainer(video);
      if (!target.element) return null;
      ui.overlay = LTV.createOverlay({
        container: target.element,
        video,
        fill: target.fill,
        showPill: !provider.controlsBar,
        getSettings: () => state.settings,
        onToggle: () => toggle(),
      });
      ui.video = video;
    }
    const bar = provider.controlsBar?.();
    if (bar && !ui.button?.isAttached()) {
      ui.button?.destroy();
      ui.button = LTV.createPlayerButton(bar, () => toggle());
    }
    ui.overlay.setActive(state.active);
    ui.button?.setActive(state.active);
    return video;
  }

  function applyNativeCaptionStyle(session) {
    session.style?.remove();
    session.style = null;
    if (
      !state.settings.hideNativeCaptions ||
      !session.provider.hideNativeCaptionsCss
    )
      return;
    const style = document.createElement("style");
    style.setAttribute("data-ltv", "hide-native-captions");
    style.textContent = session.provider.hideNativeCaptionsCss;
    document.documentElement.appendChild(style);
    session.style = style;
  }

  function stopSession() {
    const session = state.session;
    if (!session) return;
    state.session = null;
    session.controller.abort();
    session.queue?.cancel();
    session.live?.stop();
    session.dubber?.stop();
    session.speech?.dispose();
    session.style?.remove();
    state.ui.overlay?.setLine(null);
  }

  function sourceLangFor(lang) {
    if (state.settings.sourceLang !== "auto") return state.settings.sourceLang;
    return lang && lang !== "und" ? LTV.baseLang(lang) : "auto";
  }

  async function handleSpeechResult(result) {
    if (result.ok || result.event === "interrupted") {
      if (result.ok) speechErrors = 0;
      return;
    }
    speechErrors += 1;
    const settings = effectiveSettings();
    if (speechErrors >= 2 && settings.voiceEngine === "google") {
      const voice = await findSystemVoice(state.settings.targetLang);
      if (voice) {
        state.engineOverride = voice;
        speechErrors = 0;
        setStatus(
          "warn",
          `Giọng Google không phản hồi – tạm dùng giọng máy “${voice}”.`,
          { tone: "warn" },
        );
        return;
      }
    }
    if (speechErrors >= 2)
      setStatus("error", `Lỗi giọng đọc: ${result.message || result.event}`, {
        tone: "error",
      });
  }

  async function findSystemVoice(lang) {
    try {
      const response = await connection.request({ type: "voices", lang }, 5000);
      return response.voice || null;
    } catch {
      return null;
    }
  }

  function createQueue(session, captions, sl) {
    const tl = state.settings.targetLang;
    return LTV.createTranslationQueue({
      sentences: session.sentences,
      connection,
      cacheKey: `${session.id}:${captions.lang}:${tl}:${state.settings.translator}`,
      sl,
      tl,
      title: captions.title || document.title,
      getSettings: () => state.settings,
      onProgress: (done, total) => {
        session.progress = { done, total };
      },
      onWarning: (message) => setStatus("warn", message, { tone: "warn" }),
      onError: (message, failures) => {
        if (failures >= 2)
          setStatus("error", `Lỗi dịch: ${message}`, { tone: "error" });
      },
    });
  }

  // Lời chép từ lần xem trước, nếu phủ gần hết video thì dùng như phụ đề.
  async function savedTranscript(session) {
    let entry = null;
    try {
      const response = await connection.request(
        { type: "transcript:get", key: session.id },
        10000,
      );
      entry = response.entry;
    } catch {
      entry = null;
    }
    if (!entry || !(entry.coverage >= TRANSCRIPT_MIN_COVERAGE)) return null;
    return {
      cues: entry.cues,
      lang: entry.lang,
      needsTranslation: !LTV.tracks.sameLang(
        entry.lang,
        state.settings.targetLang,
      ),
      label: "lời chép tự động đã lưu",
      title: document.title,
    };
  }

  async function startLive(session, video) {
    if (!state.settings.asrEnabled) throw session.noCaptions;
    session.mode = "live";
    setStatus("loading", "Video không có phụ đề – chuẩn bị tự chép lời…", {
      sticky: true,
    });
    session.live = LTV.createLiveSession({
      sessionId: session.id,
      video,
      connection,
      signal: session.signal,
      title: document.title,
      getSettings: () => state.settings,
      effectiveSettings,
      isSuspended: () => Boolean(session.provider.isSuspended?.()),
      makeSpeech: () =>
        LTV.createSpeechClient({ connection, getSettings: effectiveSettings }),
      setStatus,
      onLine: (sentence) => state.ui.overlay?.setLine(sentence),
      onSpeechResult: handleSpeechResult,
    });
    await session.live.start();
  }

  async function prepareSession(session) {
    const { provider, signal } = session;
    const video = await LTV.util.waitFor(() => ensureUi(provider), {
      timeout: 15000,
      signal,
    });
    if (!video) throw LTV.captionError("Không tìm thấy video trên trang.");
    session.video = video;
    setStatus("loading", "Đang lấy phụ đề…", { sticky: true });
    const ctx = {
      key: session.key,
      video,
      settings: state.settings,
      signal,
      bridge,
      connection,
    };
    let captions;
    try {
      captions = await provider.loadCaptions(ctx);
    } catch (error) {
      if (!error.noCaptions || signal.aborted) throw error;
      captions = await savedTranscript(session);
      if (!captions) {
        // Không có phụ đề: startSession chuyển sang tự chép lời.
        session.noCaptions = error;
        return video;
      }
    }
    if (signal.aborted) return null;
    const sentences = LTV.segment.buildSentences(captions.cues);
    if (sentences.length === 0)
      throw LTV.captionError("Phụ đề của video này trống.");
    session.sentences = sentences;
    session.label = captions.label || captions.lang;
    if (!captions.needsTranslation) {
      for (const sentence of sentences) sentence.tr = sentence.text;
    } else {
      session.queue = createQueue(
        session,
        captions,
        sourceLangFor(captions.lang),
      );
      await session.queue.loadCache();
    }
    return video;
  }

  async function startSession(provider, key) {
    const controller = new AbortController();
    const session = {
      id: `${provider.id}:${key}`,
      provider,
      key,
      controller,
      signal: controller.signal,
      progress: { done: 0, total: 0 },
    };
    state.session = session;
    speechErrors = 0;
    try {
      const video = await prepareSession(session);
      if (!video || session.signal.aborted) return;
      if (session.noCaptions) {
        await startLive(session, video);
        return;
      }
      applyNativeCaptionStyle(session);
      const makeSpeech = LTV.createSpeechClient;
      session.speech = makeSpeech({
        connection,
        getSettings: effectiveSettings,
      });
      session.dubber = LTV.createDubber({
        video,
        sentences: session.sentences,
        speech: session.speech,
        getSettings: effectiveSettings,
        lang: state.settings.targetLang,
        isSuspended: () => Boolean(provider.isSuspended?.()),
        ensureTranslated: (index) => session.queue?.ensureFrom(index),
        onLine: (sentence) => state.ui.overlay?.setLine(sentence),
        onSpeechResult: handleSpeechResult,
      });
      session.queue?.ensureFrom(0);
      session.dubber.start();
      setStatus(
        "dubbing",
        `Đang lồng tiếng • ${session.sentences.length} câu • ${session.label}`,
      );
    } catch (error) {
      if (session.signal.aborted) return;
      setStatus("error", error.userMessage || `Lỗi: ${error.message}`, {
        tone: "error",
        sticky: true,
      });
    }
  }

  function evaluate(restart = false) {
    const provider = pickProvider();
    const key = provider ? provider.videoKey(location) : null;
    const id = provider && key ? `${provider.id}:${key}` : null;
    const current = state.session;
    const videoGone = current?.video && !current.video.isConnected;
    if (
      !restart &&
      current &&
      current.id === id &&
      state.active &&
      !videoGone
    ) {
      ensureUi(provider);
      return;
    }
    stopSession();
    if (!provider || !key) {
      setStatus(
        provider ? "idle" : "unsupported",
        provider ? "Mở một video để lồng tiếng" : "",
      );
      return;
    }
    if (state.active) {
      startSession(provider, key);
    } else {
      ensureUi(provider);
      setStatus("idle", "");
    }
  }

  function toggle(force) {
    state.active = force === true ? true : !state.active;
    writeActive(state.active);
    state.engineOverride = null;
    if (state.active) {
      evaluate(true);
    } else {
      stopSession();
      setStatus("idle", "Đã tắt lồng tiếng");
      state.ui.overlay?.setActive(false);
      state.ui.button?.setActive(false);
    }
  }

  function statusSnapshot() {
    const provider = pickProvider();
    const session = state.session;
    return {
      supported: Boolean(provider),
      provider: provider?.label || null,
      onVideo: Boolean(provider && provider.videoKey(location)),
      active: state.active,
      status: state.status,
      mode: session ? session.mode || "subtitles" : null,
      progress: session?.live
        ? session.live.progress()
        : session?.progress || null,
      sentences: session?.sentences?.length || 0,
      engineOverride: state.engineOverride,
    };
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (message?.type === "ltv:toggle") {
      if (message.force) state.forced = true;
      toggle(message.force ? true : undefined);
      sendResponse(statusSnapshot());
    } else if (message?.type === "ltv:getStatus") {
      sendResponse(statusSnapshot());
    }
    return false;
  }

  function onSettingsChanged(changes, area) {
    if (area !== "sync") return;
    const previous = state.settings;
    state.settings = LTV.mergeSettings({
      ...previous,
      ...Object.fromEntries(
        Object.entries(changes).map(([k, v]) => [k, v.newValue]),
      ),
    });
    if ("voiceEngine" in changes) state.engineOverride = null;
    if (state.session) {
      applyNativeCaptionStyle(state.session);
      state.ui.overlay?.refresh();
      if (
        RESTART_KEYS.some(
          (key) => key in changes && previous[key] !== state.settings[key],
        )
      )
        evaluate(true);
    }
  }

  function watchNavigation() {
    let lastHref = location.href;
    const check = () => {
      if (connection.isDead()) return;
      if (location.href !== lastHref) {
        lastHref = location.href;
        evaluate();
        return;
      }
      const session = state.session;
      if (session?.video && !session.video.isConnected) evaluate(true);
      else if (!session) {
        const provider = pickProvider();
        if (provider && provider.videoKey(location)) ensureUi(provider);
      }
    };
    setInterval(check, NAV_POLL_MS);
    document.addEventListener("yt-navigate-finish", () => evaluate());
    window.addEventListener("popstate", () => evaluate());
  }

  async function init() {
    bridge.start();
    try {
      state.settings = LTV.mergeSettings(await chrome.storage.sync.get(null));
    } catch {
      state.settings = LTV.mergeSettings({});
    }
    state.active = readActive();
    chrome.storage.onChanged.addListener(onSettingsChanged);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    watchNavigation();
    evaluate();
  }

  init();
})();
