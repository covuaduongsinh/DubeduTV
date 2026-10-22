// Phía content của giọng đọc: speak() trả Promise khi câu kết thúc với
// { ok, event, message, elapsed } – elapsed là số giây thực sự đã đọc.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  LTV.createSpeechClient = function createSpeechClient({
    connection,
    getSettings,
  }) {
    let current = null;
    let sequence = 0;

    function finish(event, message) {
      const utterance = current;
      if (!utterance) return;
      current = null;
      clearTimeout(utterance.timer);
      const elapsed = utterance.startedAt
        ? (performance.now() - utterance.startedAt) / 1000
        : 0;
      utterance.resolve({ ok: event === "end", event, message, elapsed });
    }

    const unsubscribe = connection.onMessage((message) => {
      if (message?.type === "disconnected") {
        finish("error", "Mất kết nối tới tiện ích");
        return;
      }
      if (
        message?.type !== "speech" ||
        !current ||
        message.uttId !== current.uttId
      )
        return;
      if (message.event === "start") current.startedAt = performance.now();
      else finish(message.event, message.message);
    });

    function speak({ text, rate, lang }) {
      finish("interrupted");
      const settings = getSettings();
      sequence += 1;
      const uttId = `u${Date.now()}-${sequence}`;
      return new Promise((resolve) => {
        const expected = LTV.timing.estimateSeconds(text) / Math.max(rate, 0.5);
        current = { uttId, resolve, startedAt: 0, timer: null };
        // Lưới an toàn nếu sự kiện kết thúc bị mất (service worker khởi động lại…).
        current.timer = setTimeout(
          () => finish("error", "Hết thời gian chờ giọng đọc"),
          expected * 3000 + 10000,
        );
        const sent = connection.post({
          type: "speak",
          uttId,
          text,
          lang,
          rate,
          volume: settings.voiceVolume,
          engine: settings.voiceEngine,
          voiceName:
            settings.voiceEngine === "system" ? settings.systemVoice : "",
        });
        if (!sent)
          finish("error", "Tiện ích vừa được cập nhật – hãy tải lại trang.");
      });
    }

    function stop() {
      if (!current) return;
      connection.post({ type: "stop" });
      finish("interrupted");
    }

    function prefetch(texts, lang) {
      const settings = getSettings();
      if (settings.voiceEngine !== "google" || texts.length === 0) return;
      connection.post({ type: "prefetch", engine: "google", texts, lang });
    }

    function dispose() {
      stop();
      unsubscribe();
    }

    return { speak, stop, prefetch, dispose };
  };
})(globalThis);
