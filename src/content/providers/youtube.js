// YouTube (www, m., Shorts, video nhúng /embed/): lấy danh sách phụ đề từ
// trình phát rồi tải json3. YouTube trả rỗng khi thiếu token chống bot (pot):
// dùng lại tham số đã ký từ lần trình phát tự tải phụ đề, nếu chưa có thì
// bật phụ đề trên trình phát (sau quảng cáo) để chính trình phát tải, dùng
// payload đó rồi trả lại trạng thái phụ đề cũ.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});
  LTV.providers = LTV.providers || [];

  const SIGNED_WAIT_MS = 1500;
  const AD_WAIT_MS = 60000;

  function videoKey(loc) {
    const url = new URL(loc.href);
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const match = /^\/(?:live|embed|shorts)\/([\w-]{6,})/.exec(url.pathname);
    return match ? match[1] : null;
  }

  function playerElement() {
    if (location.pathname.startsWith("/shorts/")) {
      const shorts = document.getElementById("shorts-player");
      if (shorts) return shorts;
    }
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  function isSuspended() {
    return Boolean(playerElement()?.matches(".ad-showing, .ad-interrupting"));
  }

  async function fetchCues(url, ctx) {
    try {
      const response = await ctx.bridge.call("fetch", { url }, 15000);
      return response?.ok ? LTV.captions.parseCaptions(response.text) : [];
    } catch {
      return [];
    }
  }

  // Tải track bằng tham số đã ký từ các lần trình phát tự tải phụ đề.
  async function cuesFromSigned(track, ctx) {
    const { signedSources, signedTrackUrl } = LTV.ytTimedtext;
    const sources = await LTV.util.waitFor(
      () => {
        const found = signedSources(ctx.bridge, ctx.key);
        return found.length > 0 ? found : null;
      },
      { timeout: SIGNED_WAIT_MS, interval: 250, signal: ctx.signal },
    );
    for (const capturedUrl of (sources || []).slice(0, 2)) {
      const url = signedTrackUrl({ capturedUrl, track, videoId: ctx.key });
      const cues = url ? await fetchCues(url, ctx) : [];
      if (cues.length > 0) return cues;
    }
    return [];
  }

  async function cuesFromPlayer(track, ctx) {
    const { captureMatches, withJson3 } = LTV.ytTimedtext;
    const matches = (capture) => captureMatches(capture, ctx.key, track);
    let capture = await ctx.bridge.waitForCapture(matches, {
      timeout: 50,
      signal: ctx.signal,
    });
    if (!capture) {
      // Bật phụ đề giữa quảng cáo sẽ tải phụ đề của quảng cáo.
      await LTV.util.waitFor(() => !isSuspended(), {
        timeout: AD_WAIT_MS,
        interval: 500,
        signal: ctx.signal,
      });
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

  // Thông tin video của đúng video đang mở (player response có thể còn của
  // video trước sau khi điều hướng); trang nhúng lấy danh sách phụ đề từ
  // module captions của trình phát.
  async function playerInfo(ctx) {
    const info = await LTV.util.waitFor(
      async () => {
        const result = await ctx.bridge.call("yt:info", {}, 3000);
        return result && result.videoId === ctx.key ? result : null;
      },
      { timeout: 12000, interval: 500, signal: ctx.signal },
    );
    if (info && info.tracks.length === 0) {
      info.tracks = await ctx.bridge
        .call("yt:tracklist", {}, 5000)
        .catch(() => []);
    }
    return info;
  }

  async function loadTrack(track, ctx) {
    let cues = track.baseUrl
      ? await fetchCues(LTV.ytTimedtext.withJson3(track.baseUrl), ctx)
      : [];
    if (cues.length === 0) cues = await cuesFromSigned(track, ctx);
    if (cues.length === 0) cues = await cuesFromPlayer(track, ctx);
    return cues;
  }

  LTV.providers.push({
    id: "youtube",
    label: "YouTube",
    matches: (loc) =>
      /(^|\.)youtube(-nocookie)?\.com$/.test(loc.hostname) ||
      (loc.hostname === "youtube.googleapis.com" &&
        !/[?&]docid=/.test(loc.search)),
    videoKey,
    findVideo: () =>
      playerElement()?.querySelector("video.html5-main-video") ||
      playerElement()?.querySelector("video") ||
      null,
    overlayContainer: (video) => {
      const player = playerElement();
      return { element: player || video.parentElement, fill: Boolean(player) };
    },
    controlsBar: () => playerElement()?.querySelector(".ytp-right-controls"),
    isSuspended,
    hideNativeCaptionsCss:
      ".html5-video-player .ytp-caption-window-container { display: none !important; }",
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
      const cues = await loadTrack(choice.track, ctx);
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
