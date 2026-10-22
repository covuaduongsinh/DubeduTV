// X/Twitter: video trong bài đăng (/status/<id>). Phụ đề nằm trong playlist
// HLS của video: tìm master playlist mà trang đã tải (khớp theo mã media trong
// ảnh bìa của video), đọc nhóm SUBTITLES, tải các đoạn WebVTT rồi ghép lại.
// Chỉ dùng dữ liệu chính trang đã tải, không gọi API riêng của X.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});
  LTV.providers = LTV.providers || [];

  // Máy chủ playlist/phụ đề video của X (bản kiểm thử thay bằng máy giả lập).
  LTV.X_MEDIA_HOST = /^video\.twimg\.com$/;

  const PLAYLIST_WAIT_MS = 8000;
  const SEGMENT_CONCURRENCY = 3;
  const MAX_SEGMENTS = 400;

  const statusId = (loc) => /\/status\/(\d+)/.exec(loc.pathname)?.[1] || null;

  function findVideo() {
    const column =
      document.querySelector('[data-testid="primaryColumn"]') || document;
    return column.querySelector('[data-testid="videoPlayer"] video');
  }

  function isMediaUrl(url) {
    try {
      return LTV.X_MEDIA_HOST.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  // Playlist của đúng video (mới nhất trước); payload có nội dung đứng trước.
  function playlistCandidates(bridge, mediaId) {
    const matches = (item) =>
      item.kind === "hls" &&
      isMediaUrl(item.url) &&
      /\/pl\//.test(item.url) &&
      (!mediaId || item.url.includes(`/${mediaId}/`));
    const newest = (a, b) => (b.at || 0) - (a.at || 0);
    const captured = bridge.captures().filter(matches).sort(newest);
    const known = bridge
      .resources()
      .filter(matches)
      .filter((item) => !captured.some((c) => c.url === item.url))
      .sort(newest);
    return [...captured, ...known];
  }

  async function findMaster(ctx, mediaId) {
    const candidates = await LTV.util.waitFor(
      () => {
        const list = playlistCandidates(ctx.bridge, mediaId);
        return list.length > 0 ? list : null;
      },
      { timeout: PLAYLIST_WAIT_MS, interval: 300, signal: ctx.signal },
    );
    for (const item of (candidates || []).slice(0, 6)) {
      const text =
        item.body ?? (await LTV.html5.fetchText(item.url, ctx).catch(() => ""));
      const master = LTV.hls.parseMaster(text, item.url);
      if (master.isMaster) return master;
    }
    return null;
  }

  async function loadSegments(segments, ctx) {
    const list = segments.slice(0, MAX_SEGMENTS);
    const texts = list.map(() => "");
    let next = 0;
    async function worker() {
      while (next < list.length && !ctx.signal?.aborted) {
        const index = next;
        next += 1;
        texts[index] = await LTV.html5
          .fetchText(list[index].uri, ctx)
          .catch(() => "");
      }
    }
    await Promise.all(Array.from({ length: SEGMENT_CONCURRENCY }, worker));
    return list.map((segment, i) => ({ start: segment.start, text: texts[i] }));
  }

  async function loadTrack(track, ctx) {
    const playlist = await LTV.html5.fetchText(track.uri, ctx);
    const segments = LTV.hls.parseMedia(playlist, track.uri);
    // Playlist chỉ có một tệp VTT (không chia đoạn) cũng dùng được.
    if (segments.length === 0 && /-->/.test(playlist))
      return LTV.captions.parseCaptions(playlist);
    return LTV.hls.cuesFromSegments(await loadSegments(segments, ctx));
  }

  LTV.providers.push({
    id: "x",
    label: "X (Twitter)",
    matches: (loc) => /(^|\.)(x|twitter)\.com$/.test(loc.hostname),
    videoKey: statusId,
    findVideo,
    overlayContainer: (video) => ({
      element:
        video.closest('[data-testid="videoPlayer"]') || video.parentElement,
      fill: Boolean(video.closest('[data-testid="videoPlayer"]')),
    }),
    hideNativeCaptionsCss:
      "video::cue { color: transparent !important; background: transparent !important; }",
    async loadCaptions(ctx) {
      const mediaId = LTV.hls.mediaIdFromUrl(ctx.video.poster);
      const master = await findMaster(ctx, mediaId);
      const choice =
        master && LTV.tracks.chooseTrack(master.subtitles, ctx.settings);
      if (!choice)
        throw LTV.captionError(
          "Video này trên X không có phụ đề (CC) nên chưa lồng tiếng được.",
          { noCaptions: true },
        );
      const cues = await loadTrack(choice.track, ctx);
      if (cues.length === 0)
        throw LTV.captionError("Không tải được phụ đề của video trên X.", {
          noCaptions: true,
        });
      return {
        cues,
        lang: choice.track.lang,
        needsTranslation: choice.needsTranslation,
        label: choice.track.label,
        title: document.title.replace(/\s*\/\s*X\s*$/, ""),
      };
    },
  });
})(globalThis);
