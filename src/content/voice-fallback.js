// Giọng dự phòng: giọng Google lỗi liên tiếp thì tạm chuyển sang giọng máy
// cùng ngôn ngữ; giọng nào cũng lỗi thì báo lỗi trên video.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MAX_ERRORS = 2;

  LTV.createVoiceFallback = function createVoiceFallback({
    connection,
    getSettings,
    setStatus,
  }) {
    // Tên giọng máy dùng tạm khi giọng Google không phản hồi.
    let override = null;
    let errors = 0;

    async function findSystemVoice(lang) {
      try {
        const response = await connection.request(
          { type: "voices", lang },
          5000,
        );
        return response.voice || null;
      } catch {
        return null;
      }
    }

    function effectiveSettings() {
      const settings = getSettings();
      if (!override) return settings;
      return { ...settings, voiceEngine: "system", systemVoice: override };
    }

    async function handle(result) {
      if (result.ok || result.event === "interrupted") {
        if (result.ok) errors = 0;
        return;
      }
      errors += 1;
      if (errors < MAX_ERRORS) return;
      if (effectiveSettings().voiceEngine === "google") {
        const voice = await findSystemVoice(getSettings().targetLang);
        if (voice) {
          override = voice;
          errors = 0;
          setStatus(
            "warn",
            `Giọng Google không phản hồi – tạm dùng giọng máy “${voice}”.`,
            { tone: "warn" },
          );
          return;
        }
      }
      setStatus("error", `Lỗi giọng đọc: ${result.message || result.event}`, {
        tone: "error",
      });
    }

    return {
      effectiveSettings,
      handle,
      reset() {
        override = null;
        errors = 0;
      },
      resetErrors() {
        errors = 0;
      },
      override: () => override,
    };
  };
})(globalThis);
