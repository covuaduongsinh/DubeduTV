// Google Drive: video xem trên drive.google.com phát trong khung trình phát
// youtube.googleapis.com/embed (?docid=<mã tệp>). Provider chạy trong khung
// đó: hỏi trang Drive (có cookie) danh sách phụ đề và nội dung track; nếu
// trang chưa có địa chỉ phụ đề thì bật phụ đề trên trình phát để chính trình
// phát tải, rồi dùng payload đó.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});
  LTV.providers = LTV.providers || [];

  function playerElement() {
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  async function captionsFromHost(ctx) {
    const { base, tracks } = await LTV.driveChannel
      .call("drive:tracks")
      .catch(() => ({ base: null, tracks: [] }));
    const choice = base && LTV.tracks.chooseTrack(tracks, ctx.settings);
    if (!choice) return null;
    const { lang, name, kind } = choice.track;
    const { text } = await LTV.driveChannel
      .call("drive:fetch", { base, track: { lang, name, kind } })
      .catch(() => ({ text: "" }));
    const cues = LTV.captions.parseCaptions(text);
    return cues.length > 0 ? { cues, choice } : null;
  }

  async function playerTracks(ctx) {
    const info = await ctx.bridge.call("yt:info", {}, 3000).catch(() => null);
    if (info?.tracks?.length) return info.tracks;
    return ctx.bridge.call("yt:tracklist", {}, 5000).catch(() => []);
  }

  async function captionsFromPlayer(ctx) {
    const choice = LTV.tracks.chooseTrack(
      await playerTracks(ctx),
      ctx.settings,
    );
    if (!choice) return null;
    const matches = (capture) => capture.kind === "timedtext";
    let state = null;
    try {
      state = await ctx.bridge.call("yt:enableCaptions", {
        lang: choice.track.lang,
        kind: choice.track.kind,
      });
    } catch {
      state = null;
    }
    const capture = await ctx.bridge.waitForCapture(matches, {
      timeout: 8000,
      signal: ctx.signal,
    });
    if (state) ctx.bridge.call("yt:restoreCaptions", state).catch(() => {});
    const cues = capture ? LTV.captions.parseCaptions(capture.body) : [];
    return cues.length > 0 ? { cues, choice } : null;
  }

  LTV.providers.push({
    id: "drive",
    label: "Google Drive",
    matches: (loc) =>
      loc.hostname === "youtube.googleapis.com" &&
      /[?&]docid=/.test(loc.search),
    videoKey: (loc) => new URL(loc.href).searchParams.get("docid") || null,
    findVideo: () =>
      playerElement()?.querySelector("video") ||
      document.querySelector("video"),
    overlayContainer: (video) => {
      const player = playerElement();
      return { element: player || video.parentElement, fill: Boolean(player) };
    },
    controlsBar: () => playerElement()?.querySelector(".ytp-right-controls"),
    hideNativeCaptionsCss:
      ".html5-video-player .ytp-caption-window-container { display: none !important; }",
    async loadCaptions(ctx) {
      const info = await LTV.driveChannel.call("drive:info").catch(() => null);
      const found =
        (await captionsFromHost(ctx)) || (await captionsFromPlayer(ctx));
      if (!found)
        throw LTV.captionError(
          "Video trên Drive này không có phụ đề nên chưa lồng tiếng được.",
          { noCaptions: true },
        );
      return {
        cues: found.cues,
        lang: found.choice.track.lang,
        needsTranslation: found.choice.needsTranslation,
        label: found.choice.track.label,
        title: info?.title || document.title,
      };
    },
  });
})(globalThis);
