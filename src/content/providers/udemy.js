// Udemy: lấy danh sách phụ đề (asset.captions) từ API bài giảng mà trang đã
// gọi, hoặc tự gọi API đó; tải VTT từ udemycdn qua service worker. Dự phòng
// bằng nguồn HTML5 chung (VTT trình phát đã tải khi bật CC).
(function (root) {
  const LTV = (root.LTV = root.LTV || {});
  LTV.providers = LTV.providers || [];

  function lectureId(loc) {
    const match = /\/learn\/lecture\/(\d+)/.exec(loc.pathname);
    return match ? match[1] : null;
  }

  function extractCaptions(body) {
    let data = null;
    try {
      data = JSON.parse(body);
    } catch {
      return [];
    }
    const list = data?.asset?.captions || data?.captions || [];
    return list
      .filter((caption) => caption && typeof caption.url === "string")
      .map((caption) => ({
        url: caption.url,
        lang: caption.locale_id || caption.locale?.locale || "und",
        kind: caption.source === "auto" ? "asr" : "manual",
        label: caption.video_label || caption.title || caption.locale_id || "",
      }));
  }

  function courseIdFromPage(captures) {
    for (const capture of captures) {
      const match = /\/subscribed-courses\/(\d+)\//.exec(capture.url);
      if (match) return match[1];
    }
    const args = document
      .querySelector("[data-module-args]")
      ?.getAttribute("data-module-args");
    if (args) {
      try {
        const parsed = JSON.parse(args);
        if (parsed.courseId) return String(parsed.courseId);
      } catch {
        // Bỏ qua thuộc tính không phải JSON.
      }
    }
    const element = document.querySelector("[data-course-id]");
    return element ? element.getAttribute("data-course-id") : null;
  }

  async function captionsFor(id, ctx) {
    const capture = await ctx.bridge.waitForCapture(
      (item) =>
        item.kind === "udemy-lecture" &&
        item.url.includes(`/lectures/${id}/`) &&
        item.body.includes("captions"),
      { timeout: 4000, signal: ctx.signal },
    );
    if (capture) return extractCaptions(capture.body);
    const courseId = courseIdFromPage(ctx.bridge.captures());
    if (!courseId) return [];
    const url = `/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${id}/?fields[lecture]=asset&fields[asset]=captions`;
    try {
      const response = await ctx.bridge.call("fetch", { url }, 15000);
      return response?.ok ? extractCaptions(response.text) : [];
    } catch {
      return [];
    }
  }

  LTV.providers.push({
    id: "udemy",
    label: "Udemy",
    matches: (loc) => /(^|\.)udemy\.com$/.test(loc.hostname),
    videoKey: (loc) => {
      const id = lectureId(loc);
      return id ? `lecture-${id}` : null;
    },
    findVideo: () => LTV.util.largestVideo(document),
    overlayContainer: (video) => ({
      element: video.parentElement,
      fill: false,
    }),
    hideNativeCaptionsCss:
      '[data-purpose="captions-cue-text"], [class*="captions-display--captions-container"] { visibility: hidden !important; }',
    async loadCaptions(ctx) {
      const id = ctx.key.replace("lecture-", "");
      const tracks = await captionsFor(id, ctx);
      const choice = LTV.tracks.chooseTrack(tracks, ctx.settings);
      if (choice) {
        try {
          const cues = LTV.captions.parseCaptions(
            await LTV.html5.fetchText(choice.track.url, ctx),
          );
          if (cues.length > 0) {
            return {
              cues,
              lang: choice.track.lang,
              needsTranslation: choice.needsTranslation,
              label: choice.track.label,
              title: document.title,
            };
          }
        } catch {
          // Dùng nguồn dự phòng bên dưới.
        }
      }
      const fallback = await LTV.html5.loadFromVideo(ctx.video, ctx);
      if (fallback) return { ...fallback, title: document.title };
      throw LTV.captionError(
        "Chưa lấy được phụ đề Udemy. Hãy bật phụ đề (CC) trong trình phát rồi bấm lồng tiếng lại.",
        { noCaptions: true },
      );
    },
  });
})(globalThis);
