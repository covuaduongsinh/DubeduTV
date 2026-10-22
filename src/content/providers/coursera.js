// Coursera: trình phát gắn thẻ <track> (VTT cùng origin) vào video bài giảng.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});
  LTV.providers = LTV.providers || [];

  LTV.providers.push({
    id: "coursera",
    label: "Coursera",
    matches: (loc) => /(^|\.)coursera\.org$/.test(loc.hostname),
    videoKey: (loc) => (/\/lecture\//.test(loc.pathname) ? loc.pathname : null),
    findVideo: () => LTV.util.largestVideo(document),
    overlayContainer: (video) => ({
      element: video.parentElement,
      fill: false,
    }),
    hideNativeCaptionsCss:
      ".vjs-text-track-display { visibility: hidden !important; } video::cue { color: transparent !important; background: transparent !important; }",
    async loadCaptions(ctx) {
      await LTV.util.waitFor(
        () =>
          LTV.html5.trackElements(ctx.video).length > 0 ||
          ctx.video.textTracks?.length > 0,
        {
          timeout: 8000,
          signal: ctx.signal,
        },
      );
      const result = await LTV.html5.loadFromVideo(ctx.video, ctx);
      if (!result) {
        throw LTV.captionError(
          "Bài giảng Coursera này chưa có phụ đề đọc được. Hãy bật phụ đề (CC) rồi thử lại.",
          { noCaptions: true },
        );
      }
      return { ...result, title: document.title };
    },
  });
})(globalThis);
