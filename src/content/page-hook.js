// Chạy trong MAIN world từ document_start: ghi lại phụ đề mà chính trình phát
// của trang tải về (fetch/XHR), ghi địa chỉ phụ đề/playlist trang đã tải
// (Resource Timing – thấy cả yêu cầu không qua fetch/XHR) và cho content
// script gọi API trình phát YouTube. Không sửa dữ liệu của trang; mọi lỗi đều
// bị nuốt để trang chạy bình thường.
(function () {
  if (window.__ltvPageHook) return;
  window.__ltvPageHook = true;

  const FROM_PAGE = "ltv-page";
  const FROM_CONTENT = "ltv-content";
  const MAX_BUFFER = 30;
  const MAX_RESOURCES = 60;
  const MAX_BODY = 6 * 1024 * 1024;
  const buffer = [];
  const resources = [];
  const GRAPHQL =
    /\/i\/api\/graphql\/[^/]+\/(?:TweetDetail|TweetResultByRestId)\b/;
  const TWIMG_M3U8 = /https:\/\/video\.twimg\.com\/[^"\s]+?\.m3u8[^"\s]*/g;

  function classify(url) {
    // YouTube: /api/timedtext; Google Drive: /timedtext, /u/0/timedtext.
    if (/\/(?:api\/|u\/\d+\/)?timedtext(?:[?#]|$)/.test(url))
      return "timedtext";
    if (/\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
    if (
      /\/api-2\.0\/users\/me\/subscribed-courses\/\d+\/lectures\/\d+/.test(url)
    ) {
      return "udemy-lecture";
    }
    if (/\.vtt(?:[?#]|$)|subtitleAssetProxy|[?&]format=vtt\b/i.test(url))
      return "vtt";
    return null;
  }

  function absolute(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return String(url);
    }
  }

  function publish(kind, url, body) {
    if (typeof body !== "string" || !body || body.length > MAX_BODY) return;
    const message = {
      source: FROM_PAGE,
      type: "capture",
      kind,
      url,
      body,
      at: Date.now(),
    };
    buffer.push(message);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    window.postMessage(message, "*");
  }

  // Chỉ ghi địa chỉ (không có nội dung) – từ Resource Timing hoặc dữ liệu trang.
  function publishResource(kind, url) {
    if (resources.some((item) => item.url === url)) return;
    const message = {
      source: FROM_PAGE,
      type: "resource",
      kind,
      url,
      at: Date.now(),
    };
    resources.push(message);
    if (resources.length > MAX_RESOURCES) resources.shift();
    window.postMessage(message, "*");
  }

  function observeResources() {
    if (typeof PerformanceObserver !== "function") return;
    const record = (entries) => {
      for (const entry of entries) {
        const kind = classify(entry.name);
        if (kind === "timedtext" || kind === "hls")
          publishResource(kind, entry.name);
      }
    };
    try {
      new PerformanceObserver((list) => record(list.getEntries())).observe({
        type: "resource",
        buffered: true,
      });
    } catch {
      // Trình duyệt không hỗ trợ.
    }
  }

  // X/Twitter: playlist video nằm trong dữ liệu bài đăng trang đã tải.
  function scanGraphql(text) {
    const normalized = text.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
    for (const match of normalized.match(TWIMG_M3U8) || [])
      publishResource("hls", match);
  }

  function watchFetch(url, result) {
    const kind = classify(url);
    if (!kind && !GRAPHQL.test(url)) return;
    result
      .then((response) => response.clone().text())
      .then((text) =>
        kind ? publish(kind, absolute(url), text) : scanGraphql(text),
      )
      .catch(() => {});
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input) {
      const result = originalFetch.apply(this, arguments);
      try {
        watchFetch(
          typeof input === "string" ? input : input?.url || String(input),
          result,
        );
      } catch {
        // Không can thiệp vào yêu cầu của trang.
      }
      return result;
    };
  }

  const xhrProto = XMLHttpRequest.prototype;
  const originalOpen = xhrProto.open;
  const originalSend = xhrProto.send;
  xhrProto.open = function (method, url) {
    try {
      this.__ltvUrl = String(url);
    } catch {
      this.__ltvUrl = "";
    }
    return originalOpen.apply(this, arguments);
  };
  xhrProto.send = function () {
    const kind = this.__ltvUrl ? classify(this.__ltvUrl) : null;
    if (kind) {
      this.addEventListener("load", () => {
        try {
          let text = null;
          if (this.responseType === "" || this.responseType === "text")
            text = this.responseText;
          else if (this.responseType === "json")
            text = JSON.stringify(this.response);
          publish(kind, absolute(this.responseURL || this.__ltvUrl), text);
        } catch {
          // Bỏ qua phản hồi không đọc được.
        }
      });
    }
    return originalSend.apply(this, arguments);
  };

  function youtubePlayer() {
    if (location.pathname.startsWith("/shorts/")) {
      const shorts = document.getElementById("shorts-player");
      if (shorts) return shorts;
    }
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  function trackName(track) {
    if (track.name?.simpleText) return track.name.simpleText;
    if (Array.isArray(track.name?.runs))
      return track.name.runs.map((run) => run.text).join("");
    return track.languageCode;
  }

  function call(player, name, ...args) {
    try {
      return player?.[name]?.(...args) ?? null;
    } catch {
      return null;
    }
  }

  // Thông tin video từ player response; trang nhúng (embed) có thể chỉ có
  // getVideoData() – khi đó danh sách phụ đề lấy qua yt:tracklist.
  function youtubeInfo() {
    const player = youtubePlayer();
    let response = call(player, "getPlayerResponse");
    if (!response && window === window.top)
      response = window.ytInitialPlayerResponse || null;
    const data = call(player, "getVideoData") || {};
    const tracks =
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return {
      videoId: response?.videoDetails?.videoId || data.video_id || null,
      title: response?.videoDetails?.title || data.title || document.title,
      source: response ? "response" : "player",
      tracks: tracks.map((track) => ({
        baseUrl: track.baseUrl,
        lang: track.languageCode,
        kind: track.kind === "asr" ? "asr" : "manual",
        label: trackName(track),
      })),
    };
  }

  function sameTrack(option, lang, kind) {
    const optionKind = option?.kind === "asr" ? "asr" : "manual";
    return option?.languageCode === lang && optionKind === kind;
  }

  // Danh sách phụ đề từ module captions của trình phát (không có baseUrl).
  function youtubeTracklist() {
    const player = youtubePlayer();
    call(player, "loadModule", "captions");
    const list = call(player, "getOption", "captions", "tracklist") || [];
    return list
      .filter((item) => item?.languageCode)
      .map((item) => ({
        lang: item.languageCode,
        kind: item.kind === "asr" ? "asr" : "manual",
        label: item.displayName || item.languageName || item.languageCode,
      }));
  }

  // Bật phụ đề trên trình phát để chính trình phát tải timedtext (kèm token).
  function youtubeEnableCaptions({ lang, kind }) {
    const player = youtubePlayer();
    if (!player?.setOption) throw new Error("no-player");
    let previous = null;
    try {
      previous = player.getOption("captions", "track") || null;
    } catch {
      previous = null;
    }
    player.loadModule?.("captions");
    let list = [];
    try {
      list = player.getOption("captions", "tracklist") || [];
    } catch {
      list = [];
    }
    const option = list.find((item) => sameTrack(item, lang, kind)) || {
      languageCode: lang,
      ...(kind === "asr" ? { kind: "asr" } : {}),
    };
    player.setOption("captions", "track", option);
    const hadCaptions = Boolean(previous && previous.languageCode);
    return { previous: hadCaptions ? previous : null };
  }

  function youtubeRestoreCaptions({ previous }) {
    const player = youtubePlayer();
    if (!player?.setOption) return false;
    if (previous) player.setOption("captions", "track", previous);
    else {
      player.setOption("captions", "track", {});
      player.unloadModule?.("captions");
    }
    return true;
  }

  async function pageFetch({ url }) {
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) throw new Error("cross-origin");
    const response = await originalFetch.call(window, target.href, {
      credentials: "include",
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  }

  const handlers = {
    "yt:info": youtubeInfo,
    "yt:tracklist": youtubeTracklist,
    "yt:enableCaptions": youtubeEnableCaptions,
    "yt:restoreCaptions": youtubeRestoreCaptions,
    fetch: pageFetch,
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== FROM_CONTENT) return;
    if (data.type === "replay") {
      for (const message of [...buffer, ...resources])
        window.postMessage(message, "*");
      return;
    }
    if (data.type !== "call" || !handlers[data.call]) return;
    Promise.resolve()
      .then(() => handlers[data.call](data.payload || {}))
      .then(
        (result) =>
          window.postMessage(
            { source: FROM_PAGE, type: "reply", id: data.id, result },
            "*",
          ),
        (error) =>
          window.postMessage(
            {
              source: FROM_PAGE,
              type: "reply",
              id: data.id,
              error: String(error?.message || error),
            },
            "*",
          ),
      );
  });
  observeResources();
})();
