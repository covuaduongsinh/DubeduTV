// Giọng dự phòng: giọng đang dùng lỗi liên tiếp thì tạm chuyển theo chuỗi
// giọng AI đám mây → giọng Google → giọng máy cùng ngôn ngữ; API key giọng AI
// sai thì chuyển ngay. Giọng nào cũng lỗi thì báo lỗi trên video.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MAX_ERRORS = 2;
  const CLOUD_NAMES = { azure: "Azure", gcloud: "Google Cloud" };

  LTV.createVoiceFallback = function createVoiceFallback({
    connection,
    getSettings,
    setStatus,
  }) {
    // Giọng dùng tạm: { voiceEngine, systemVoice? }.
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
      return override ? { ...settings, ...override } : settings;
    }

    function useGoogle(engine, result) {
      override = { voiceEngine: "google" };
      errors = 0;
      const reason =
        result.code === "auth"
          ? result.message || `API key ${CLOUD_NAMES[engine]} không hợp lệ`
          : `Giọng AI ${CLOUD_NAMES[engine]} không phản hồi`;
      setStatus("warn", `${reason} – tạm dùng giọng Google.`, {
        tone: "warn",
      });
    }

    async function useSystem() {
      const voice = await findSystemVoice(getSettings().targetLang);
      if (!voice) return false;
      override = { voiceEngine: "system", systemVoice: voice };
      errors = 0;
      setStatus(
        "warn",
        `Giọng Google không phản hồi – tạm dùng giọng máy “${voice}”.`,
        { tone: "warn" },
      );
      return true;
    }

    async function handle(result) {
      if (result.ok || result.event === "interrupted") {
        if (result.ok) errors = 0;
        return;
      }
      errors += 1;
      const engine = effectiveSettings().voiceEngine;
      // Key sai thì đọc lại câu nào cũng lỗi: không chờ lỗi lần hai.
      if (
        CLOUD_NAMES[engine] &&
        (result.code === "auth" || errors >= MAX_ERRORS)
      ) {
        useGoogle(engine, result);
        return;
      }
      if (errors < MAX_ERRORS) return;
      if (engine === "google" && (await useSystem())) return;
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
      override: () => (override ? { ...override } : null),
    };
  };
})(globalThis);
