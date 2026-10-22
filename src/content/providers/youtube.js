// YouTube: lấy danh sách phụ đề từ player response, tải json3. Nếu YouTube
// trả rỗng (yêu cầu PO token), bật phụ đề trên trình phát để chính trình phát
// tải timedtext, dùng payload đó rồi trả lại trạng thái phụ đề cũ.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});
  LTV.providers = LTV.providers || [];

  function withJson3(url) {
    const target = new URL(url, location.href);
    target.searchParams.set("fmt", "json3");
    return target.href;
  }

  function videoKey(loc) {
    const url = new URL(loc.href);
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const match = /^\/(?:live|embed)\/([\w-]{6,})/.exec(url.pathname);
    return match ? match[1] : null;
  }

  function captureMatches(capture, videoId, track) {
    if (capture.kind !== "timedtext") return false;
    try {
      const params = new URL(capture.url).searchParams;
      if (params.get("tlang")) return false;
      if (params.get("v") && params.get("v") !== videoId) return false;
      const isAsr = params.get("kind") === "asr";
      return (
        LTV.tracks.sameLang(params.get("lang"), track.lang) &&
        isAsr === (track.kind === "asr")
      );
    } catch {
      return false;
    }
  }

  async function fetchCues(url, ctx) {
    try {
      const response = await ctx.bridge.call("fetch", { url }, 15000);
      return response?.ok ? LTV.captions.parseCaptions(response.text) : [];
    } catch {
      return [];
    }
  }

  async function cuesFromPlayer(track, ctx) {
    const matches = (capture) => captureMatches(capture, ctx.key, track);
    let capture = await ctx.bridge.waitForCapture(matches, {
      timeout: 50,
      signal: ctx.signal,
    });
    if (!capture) {
      let state = null;
      try {
        state = await ctx.bridge.call("yt:enableCaptions", {
          lang: track.lang,
          kind: track.kind,
        });
      } catch {
        state = null;
      }
      capture = await ctx.bridge.waitForCapture(matches, {
        timeout: 8000,
        signal: ctx.signal,
      });
      if (state) ctx.bridge.call("yt:restoreCaptions", state).catch(() => {});
    }
    if (!capture) return [];
    const cues = LTV.captions.parseCaptions(capture.body);
    if (cues.length > 0 || /[?&]fmt=json3\b/.test(capture.url)) return cues;
    return fetchCues(withJson3(capture.url), ctx);
  }

  async function playerInfo(ctx) {
    return LTV.util.waitFor(
      async () => {
        const info = await ctx.bridge.call("yt:info", {}, 3000);
        return info && info.videoId === ctx.key ? info : null;
      },
      { timeout: 12000, interval: 500, signal: ctx.signal },
    );
  }

  LTV.providers.push({
    id: "youtube",
    label: "YouTube",
    matches: (loc) => /(^|\.)youtube\.com$/.test(loc.hostname),
    videoKey,
    findVideo: () =>
      document.querySelector("#movie_player video.html5-main-video") ||
      document.querySelector("#movie_player video"),
    overlayContainer: (video) => ({
      element: document.getElementById("movie_player") || video.parentElement,
      fill: Boolean(document.getElementById("movie_player")),
    }),
    controlsBar: () =>
      document.querySelector("#movie_player .ytp-right-controls"),
    isSuspended: () =>
      Boolean(
        document.querySelector(
          "#movie_player.ad-showing, #movie_player.ad-interrupting",
        ),
      ),
    hideNativeCaptionsCss:
      "#movie_player .ytp-caption-window-container { display: none !important; }",
    async loadCaptions(ctx) {
      const info = await playerInfo(ctx);
      if (!info)
        throw LTV.captionError(
          "Không đọc được thông tin video YouTube – hãy tải lại trang.",
        );
      const choice = LTV.tracks.chooseTrack(info.tracks, ctx.settings);
      if (!choice)
        throw LTV.captionError(
          "Video này không có phụ đề (kể cả phụ đề tự động) nên chưa lồng tiếng được.",
          { noCaptions: true },
        );
      let cues = await fetchCues(withJson3(choice.track.baseUrl), ctx);
      if (cues.length === 0) cues = await cuesFromPlayer(choice.track, ctx);
      if (cues.length === 0) {
        throw LTV.captionError(
          "YouTube chưa trả phụ đề. Hãy bật CC một lần rồi bấm lồng tiếng lại.",
          { noCaptions: true },
        );
      }
      return {
        cues,
        lang: choice.track.lang,
        needsTranslation: choice.needsTranslation,
        label: choice.track.label,
        title: info.title,
      };
    },
  });
})(globalThis);
