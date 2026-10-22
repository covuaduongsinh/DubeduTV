// Chạy trong MAIN world từ document_start: ghi lại phụ đề mà chính trình phát
// của trang tải về (fetch/XHR) và cho content script gọi API trình phát
// YouTube. Không sửa dữ liệu của trang; mọi lỗi đều bị nuốt để trang chạy bình thường.
(function () {
  if (window.__ltvPageHook) return;
  window.__ltvPageHook = true;

  const FROM_PAGE = "ltv-page";
  const FROM_CONTENT = "ltv-content";
  const MAX_BUFFER = 30;
  const MAX_BODY = 6 * 1024 * 1024;
  const buffer = [];

  function classify(url) {
    if (/\/api\/timedtext\b/.test(url)) return "timedtext";
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

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input) {
      const result = originalFetch.apply(this, arguments);
      try {
        const url =
          typeof input === "string" ? input : input?.url || String(input);
        const kind = classify(url);
        if (kind) {
          result
            .then((response) => response.clone().text())
            .then((text) => publish(kind, absolute(url), text))
            .catch(() => {});
        }
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
    return document.getElementById("movie_player");
  }

  function trackName(track) {
    if (track.name?.simpleText) return track.name.simpleText;
    if (Array.isArray(track.name?.runs))
      return track.name.runs.map((run) => run.text).join("");
    return track.languageCode;
  }

  function youtubeInfo() {
    const player = youtubePlayer();
    let response = null;
    try {
      response = player?.getPlayerResponse?.() || null;
    } catch {
      response = null;
    }
    if (!response) response = window.ytInitialPlayerResponse || null;
    const tracks =
      response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return {
      videoId: response?.videoDetails?.videoId || null,
      title: response?.videoDetails?.title || document.title,
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
    "yt:enableCaptions": youtubeEnableCaptions,
    "yt:restoreCaptions": youtubeRestoreCaptions,
    fetch: pageFetch,
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== FROM_CONTENT) return;
    if (data.type === "replay") {
      for (const message of buffer) window.postMessage(message, "*");
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
})();
