// Nguồn phụ đề chung cho video HTML5: thẻ <track>, video.textTracks và
// tệp VTT mà trình phát của trang đã tải (page-hook bắt được). Dùng làm
// dự phòng cho Udemy/Coursera và cho nút "Thử lồng tiếng trang này".
(function (root) {
  const LTV = (root.LTV = root.LTV || {});
  LTV.providers = LTV.providers || [];

  // noCaptions: video không có phụ đề dùng được → có thể chuyển sang tự chép lời.
  // captureBlocked: trang chặn thu âm video → gợi ý "Nghe âm thanh cả thẻ".
  LTV.captionError = function captionError(
    message,
    { noCaptions = false, captureBlocked = false } = {},
  ) {
    const error = new Error(message);
    error.userMessage = message;
    error.noCaptions = noCaptions;
    error.captureBlocked = captureBlocked;
    return error;
  };

  // Tải văn bản phụ đề: cùng origin thì tải thẳng (kèm cookie), khác origin
  // thì nhờ service worker (có quyền host đã khai báo).
  async function fetchText(url, ctx) {
    const target = new URL(url, location.href);
    if (target.origin === location.origin) {
      try {
        const response = await fetch(target.href, { credentials: "include" });
        if (response.ok) return await response.text();
      } catch {
        // Thử lại qua service worker bên dưới.
      }
    }
    const response = await ctx.connection.request(
      { type: "fetchText", url: target.href },
      30000,
    );
    if (!response.ok)
      throw new Error(response.error || `HTTP ${response.status}`);
    return response.text;
  }

  function trackElements(video) {
    return Array.from(video.querySelectorAll("track[src]"))
      .filter(
        (track) =>
          !track.kind ||
          track.kind === "subtitles" ||
          track.kind === "captions",
      )
      .map((track) => ({
        url: track.src,
        lang: track.srclang || "und",
        kind: "manual",
        label: track.label || track.srclang || "",
      }));
  }

  function textTrackCandidates(video) {
    return Array.from(video.textTracks || [])
      .filter(
        (track) => track.kind === "subtitles" || track.kind === "captions",
      )
      .map((track) => ({
        lang: track.language || "und",
        kind: "manual",
        label: track.label,
        ref: track,
      }));
  }

  async function cuesFromTextTracks(video, ctx) {
    const choice = LTV.tracks.chooseTrack(
      textTrackCandidates(video),
      ctx.settings,
    );
    if (!choice) return null;
    const track = choice.track.ref;
    if (track.mode === "disabled") track.mode = "hidden";
    const cues = await LTV.util.waitFor(
      () => (track.cues && track.cues.length > 0 ? track.cues : null),
      {
        timeout: 3000,
        signal: ctx.signal,
      },
    );
    if (!cues) return null;
    const list = Array.from(cues)
      .map((cue) => ({
        start: cue.startTime,
        end: cue.endTime,
        text: LTV.captions.decodeEntities(
          String(cue.text || "").replace(/<[^>]*>/g, ""),
        ),
      }))
      .filter((cue) => cue.text.trim());
    if (list.length === 0) return null;
    return {
      cues: list,
      lang: choice.track.lang,
      needsTranslation: choice.needsTranslation,
      label: track.label,
    };
  }

  function langFromUrl(url) {
    const match =
      /[/_.-]([a-z]{2})(?:[-_][A-Za-z]{2})?\.vtt\b/.exec(url) ||
      /[?&](?:lang|language|locale)=([a-z]{2})/i.exec(url);
    return match ? match[1].toLowerCase() : "und";
  }

  async function loadFromVideo(video, ctx) {
    const tracks = trackElements(video);
    const choice = LTV.tracks.chooseTrack(tracks, ctx.settings);
    if (choice) {
      try {
        const cues = LTV.captions.parseCaptions(
          await fetchText(choice.track.url, ctx),
        );
        if (cues.length > 0) {
          return {
            cues,
            lang: choice.track.lang,
            needsTranslation: choice.needsTranslation,
            label: choice.track.label,
          };
        }
      } catch {
        // Thử các nguồn khác.
      }
    }
    const fromTextTracks = await cuesFromTextTracks(video, ctx);
    if (fromTextTracks) return fromTextTracks;
    const captured = ctx.bridge
      .captures()
      .reverse()
      .find((capture) => capture.kind === "vtt");
    if (captured) {
      const cues = LTV.captions.parseCaptions(captured.body);
      const lang = langFromUrl(captured.url);
      const target = ctx.settings.targetLang;
      if (cues.length > 0) {
        return {
          cues,
          lang,
          needsTranslation: !LTV.tracks.sameLang(lang, target),
          label: "",
        };
      }
    }
    return null;
  }

  LTV.html5 = { fetchText, trackElements, loadFromVideo, langFromUrl };

  LTV.providers.push({
    id: "html5",
    label: "Video HTML5",
    // Chỉ dùng khi người dùng chủ động bật trên trang chưa hỗ trợ sẵn.
    matches: () => false,
    videoKey: () => location.href.split("#")[0],
    findVideo: () => LTV.util.largestVideo(document),
    overlayContainer: (video) => ({
      element: video.parentElement,
      fill: false,
    }),
    hideNativeCaptionsCss:
      "video::cue { color: transparent !important; background: transparent !important; }",
    async loadCaptions(ctx) {
      const result = await loadFromVideo(ctx.video, ctx);
      if (!result) {
        throw LTV.captionError(
          "Video trên trang này không có phụ đề đọc được nên chưa lồng tiếng được.",
          { noCaptions: true },
        );
      }
      return { ...result, title: document.title };
    },
  });
})(globalThis);
