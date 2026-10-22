// Bật/tắt lồng tiếng theo thẻ: nhớ lựa chọn của người dùng (sessionStorage)
// và quyết định tự bật khi mở video theo cài đặt autoStart:
//   "off" – không tự bật; "always" – mọi video;
//   "cached" – chỉ video đã có bản dịch hoặc lời chép lưu trên máy.
// Trong khung video nhúng chỉ tự bật khi video bắt đầu phát, để trang có
// nhiều video nhúng tự chạy (tắt tiếng) không bị dịch hết.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const ACTIVE_KEY = "ltv-active";

  function waitForPlaying(video, signal) {
    if (!video.paused && video.currentTime > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (value) => {
        video.removeEventListener("playing", onPlaying);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onPlaying = () => finish(true);
      const onAbort = () => finish(false);
      video.addEventListener("playing", onPlaying);
      signal?.addEventListener("abort", onAbort);
    });
  }

  LTV.createAutoStart = function createAutoStart({
    connection,
    getSettings,
    isTop,
  }) {
    async function known(sessionId) {
      try {
        const response = await connection.request(
          {
            type: "library:lookup",
            sessions: [sessionId],
            tl: getSettings().targetLang,
          },
          10000,
        );
        return [
          ...(response.cached || []),
          ...(response.transcripts || []),
        ].includes(sessionId);
      } catch {
        return false;
      }
    }

    return {
      // true/false nếu người dùng đã bật/tắt trong thẻ này, không thì null.
      explicit() {
        try {
          const stored = sessionStorage.getItem(ACTIVE_KEY);
          if (stored === "1" || stored === "0") return stored === "1";
        } catch {
          // sessionStorage có thể bị chặn.
        }
        return null;
      },
      remember(active) {
        try {
          sessionStorage.setItem(ACTIVE_KEY, active ? "1" : "0");
        } catch {
          // Bỏ qua.
        }
      },
      async decide({ sessionId, video, signal }) {
        const mode = getSettings().autoStart;
        if (mode === "off") return false;
        if (mode === "cached" && !(await known(sessionId))) return false;
        if (signal?.aborted) return false;
        return isTop ? true : waitForPlaying(video, signal);
      },
    };
  };
})(globalThis);
