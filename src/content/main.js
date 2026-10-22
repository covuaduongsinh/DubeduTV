// Điều phối trong trang: chọn provider theo site, theo dõi điều hướng SPA,
// bật/tắt lồng tiếng theo tab, nối provider → ghép câu → dịch → đọc.
(function () {
  const LTV = globalThis.LTV;
  if (LTV.contentLoaded) return;
  LTV.contentLoaded = true;

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
  const connection = LTV.createConnection();
  const bridge = LTV.bridge;
  const isTop = window === window.top;
  const state = {
    settings: LTV.mergeSettings({}),
    // active: người dùng (hoặc autoStart "always") bật cho cả thẻ;
    // autoFor: phiên được tự bật riêng (chế độ "cached" hoặc video nhúng).
    active: false,
    autoFor: null,
    autoPending: null,
    userChoice: null,
    forced: false,
    session: null,
    status: { state: "idle", message: "" },
    ui: { video: null, overlay: null, button: null },
  };
  const getSettings = () => state.settings;
  const voice = LTV.createVoiceFallback({ connection, getSettings, setStatus });
  const effectiveSettings = voice.effectiveSettings;
  const auto = LTV.createAutoStart({ connection, getSettings, isTop });

  function pickProvider() {
    if (typeof LTV.pickProvider === "function")
      return LTV.pickProvider(location);
    const provider = LTV.providers.find((item) => item.matches(location));
    if (provider) return provider;
    return state.forced
      ? LTV.providers.find((item) => item.id === "html5")
      : null;
  }

  const sessionIdFor = (provider, key) =>
    provider && key ? `${provider.id}:${key}` : null;
  const isOn = (id) => Boolean(id) && (state.active || state.autoFor === id);

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
    ui.overlay.setPill(!bar && !ui.button?.isAttached());
    const on = isOn(state.session?.id);
    ui.overlay.setActive(on);
    ui.button?.setActive(on);
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

  function createQueue(session, captions, sl) {
    const tl = state.settings.targetLang;
    return LTV.createTranslationQueue({
      sentences: session.sentences,
      connection,
      engine: state.settings.translator,
      cacheKeyFor: (engine) =>
        LTV.cacheKey({
          session: session.id,
          lang: captions.lang,
          tl,
          engine,
        }),
      sl,
      tl,
      title: captions.title || document.title,
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
      getSettings,
      effectiveSettings,
      isSuspended: () => Boolean(session.provider.isSuspended?.()),
      makeSpeech: () =>
        LTV.createSpeechClient({ connection, getSettings: effectiveSettings }),
      setStatus,
      onLine: (sentence) => state.ui.overlay?.setLine(sentence),
      onSpeechResult: voice.handle,
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
      captions = await LTV.loadSavedTranscript({
        connection,
        key: session.id,
        targetLang: state.settings.targetLang,
      });
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
    session.lang = captions.lang;
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
    voice.resetErrors();
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
        onSpeechResult: voice.handle,
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

  function currentId() {
    const provider = pickProvider();
    return sessionIdFor(provider, provider?.videoKey(location));
  }

  // Tự bật theo cài đặt autoStart khi người dùng chưa tự bật/tắt trong thẻ.
  async function maybeAutoStart(provider, id) {
    if (state.userChoice !== null || state.autoPending?.id === id) return;
    state.autoPending?.controller.abort();
    const pending = { id, controller: new AbortController() };
    state.autoPending = pending;
    const { signal } = pending.controller;
    const video = await LTV.util.waitFor(() => provider.findVideo(), {
      timeout: 15000,
      signal,
    });
    const decided =
      Boolean(video) && (await auto.decide({ sessionId: id, video, signal }));
    if (state.autoPending !== pending) return;
    state.autoPending = null;
    if (!decided || isOn(id) || currentId() !== id) return;
    state.autoFor = id;
    evaluate(true);
  }

  function evaluate(restart = false) {
    const provider = pickProvider();
    const key = provider ? provider.videoKey(location) : null;
    const id = sessionIdFor(provider, key);
    const current = state.session;
    const videoGone = current?.video && !current.video.isConnected;
    if (!restart && current && current.id === id && isOn(id) && !videoGone) {
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
    if (isOn(id)) {
      startSession(provider, key);
    } else {
      ensureUi(provider);
      setStatus("idle", "");
      maybeAutoStart(provider, id);
    }
  }

  function toggle(force) {
    const on = force === true ? true : !isOn(currentId());
    state.active = on;
    state.autoFor = null;
    state.autoPending?.controller.abort();
    state.autoPending = null;
    state.userChoice = on;
    auto.remember(on);
    voice.reset();
    if (on) {
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
      active: isOn(session?.id || currentId()),
      status: state.status,
      mode: session ? session.mode || "subtitles" : null,
      progress: session?.live
        ? session.live.progress()
        : session?.progress || null,
      sentences: session?.sentences?.length || 0,
      engineOverride: voice.override(),
      lang: session?.lang || null,
    };
  }

  // Thông tin để popup/phím tắt chọn khung có video (trang chính hoặc nhúng).
  function frameInfo() {
    const snapshot = statusSnapshot();
    const rect = state.ui.video?.isConnected
      ? state.ui.video.getBoundingClientRect()
      : null;
    return {
      top: isTop,
      provider: snapshot.provider,
      onVideo: snapshot.onVideo,
      active: snapshot.active && Boolean(state.session),
      area: rect ? Math.round(rect.width * rect.height) : 0,
    };
  }

  // Tạm dừng phiên trong khung này (đang nghe âm thanh cả thẻ) mà không ghi
  // nhớ là người dùng đã tắt.
  function pause() {
    state.active = false;
    state.autoFor = null;
    state.autoPending?.controller.abort();
    state.autoPending = null;
    stopSession();
    state.ui.overlay?.setActive(false);
    state.ui.button?.setActive(false);
  }

  function onRuntimeMessage(message, sender, sendResponse) {
    if (message?.type === "ltv:toggle") {
      if (message.force) state.forced = true;
      toggle(message.force ? true : undefined);
      sendResponse(statusSnapshot());
    } else if (message?.type === "ltv:getStatus") {
      sendResponse(statusSnapshot());
    } else if (message?.type === "ltv:probe") {
      chrome.runtime
        .sendMessage({
          type: "ltv:frameInfo",
          nonce: message.nonce,
          info: frameInfo(),
        })
        .catch(() => {});
    } else if (message?.type === "ltv:ping") {
      sendResponse({ ok: true, top: isTop });
    } else if (message?.type === "ltv:pause") {
      pause();
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
    if ("voiceEngine" in changes) voice.reset();
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
    state.userChoice = auto.explicit();
    state.active =
      state.userChoice ?? (state.settings.autoStart === "always" && isTop);
    chrome.storage.onChanged.addListener(onSettingsChanged);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    watchNavigation();
    evaluate();
    LTV.startAddons({
      connection,
      getSettings,
      siteId: pickProvider()?.id || null,
      isTop,
    });
  }

  init();
})();
