// Cài đặt mặc định và danh mục dùng chung cho service worker, popup, options
// và content script. Viết dạng script thường gắn vào globalThis.LTV để nạp
// được cả bằng <script>, content_scripts lẫn `import` (module).
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  LTV.DEFAULTS = Object.freeze({
    // Tự bật lồng tiếng khi mở video: "off" | "cached" (chỉ video đã lồng) | "always".
    autoStart: "off",
    targetLang: "vi",
    sourceLang: "auto",
    translator: "google",
    claudeModel: "claude-opus-5-5",
    voiceEngine: "google",
    systemVoice: "",
    rate: 1.1,
    maxRate: 1.8,
    autoRate: true,
    voiceVolume: 1,
    duckVolume: 0.15,
    subtitleMode: "translated",
    subtitleSize: 22,
    hideNativeCaptions: true,
    // Video không có phụ đề: tự chép lời (nhận dạng giọng nói) rồi lồng tiếng.
    asrEnabled: true,
    asrEngine: "chrome",
    asrLang: "en-US",
    liveMode: "consecutive",
    whisperProvider: "groq",
    // Nút "Dịch" câu hỏi trắc nghiệm (Coursera/Udemy) và huy hiệu "Đã lồng".
    quizTranslate: true,
    showBadges: true,
  });

  // Ngôn ngữ nói trong video (mã BCP-47 cho bộ nhận dạng giọng nói).
  LTV.SPEECH_LANGUAGES = [
    ["en-US", "English"],
    ["vi-VN", "Tiếng Việt"],
    ["zh-CN", "中文"],
    ["ja-JP", "日本語"],
    ["ko-KR", "한국어"],
    ["fr-FR", "Français"],
    ["de-DE", "Deutsch"],
    ["es-ES", "Español"],
    ["ru-RU", "Русский"],
    ["th-TH", "ไทย"],
    ["id-ID", "Bahasa Indonesia"],
    ["hi-IN", "हिन्दी"],
    ["pt-BR", "Português"],
    ["it-IT", "Italiano"],
    ["auto", "Tự nhận diện (chỉ Whisper)"],
  ];

  // Giới hạn hợp lệ cho các cài đặt dạng số.
  const NUMBER_RANGES = {
    rate: [0.5, 2.5],
    maxRate: [1, 3],
    voiceVolume: [0, 1],
    duckVolume: [0, 1],
    subtitleSize: [12, 48],
  };

  const ENUMS = {
    autoStart: ["off", "cached", "always"],
    translator: ["google", "claude", "chrome"],
    voiceEngine: ["google", "system"],
    subtitleMode: ["translated", "bilingual", "original", "off"],
    asrEngine: ["chrome", "whisper"],
    asrLang: LTV.SPEECH_LANGUAGES.map(([code]) => code),
    liveMode: ["consecutive", "parallel"],
    whisperProvider: ["groq", "openai"],
  };

  LTV.TARGET_LANGUAGES = [
    ["vi", "Tiếng Việt"],
    ["en", "English"],
    ["zh-CN", "中文 (简体)"],
    ["ja", "日本語"],
    ["ko", "한국어"],
    ["fr", "Français"],
    ["de", "Deutsch"],
    ["es", "Español"],
    ["ru", "Русский"],
    ["th", "ไทย"],
    ["id", "Bahasa Indonesia"],
  ];

  LTV.SOURCE_LANGUAGES = [["auto", "Tự động nhận diện"]].concat(
    LTV.TARGET_LANGUAGES.filter(([code]) => code !== "vi"),
  );

  LTV.CLAUDE_MODELS = [
    ["claude-opus-5-5", "Claude Opus 5.5 – dịch hay nhất (mặc định)"],
    ["claude-sonnet-5-5", "Claude Sonnet 5.5 – cân bằng"],
    ["claude-haiku-5-5", "Claude Haiku 5.5 – nhanh, rẻ nhất"],
  ];

  // Giá trị kiểu cũ còn lưu trong storage (v1.1: autoStart là true/false).
  const LEGACY = {
    autoStart: (value) =>
      typeof value === "boolean" ? (value ? "always" : "off") : value,
  };

  function validValue(key, stored) {
    const fallback = LTV.DEFAULTS[key];
    const value = LEGACY[key] ? LEGACY[key](stored) : stored;
    if (typeof value !== typeof fallback) return fallback;
    if (typeof value === "number") {
      const range = NUMBER_RANGES[key];
      if (!Number.isFinite(value)) return fallback;
      return range ? Math.min(range[1], Math.max(range[0], value)) : value;
    }
    if (ENUMS[key] && !ENUMS[key].includes(value)) return fallback;
    return value;
  }

  // Ghép cài đặt đã lưu với mặc định, bỏ qua giá trị sai kiểu hoặc ngoài phạm vi.
  LTV.mergeSettings = function mergeSettings(stored) {
    const result = {};
    for (const key of Object.keys(LTV.DEFAULTS)) {
      result[key] = validValue(key, stored ? stored[key] : undefined);
    }
    return result;
  };

  // Khoá cache bản dịch "<phiên>:<ngôn ngữ phụ đề>:<ngôn ngữ đích>:<bộ dịch>".
  // Mã phiên có thể chứa ":" nên tách từ bên phải.
  LTV.cacheKey = function cacheKey({ session, lang, tl, engine }) {
    return `${session}:${lang}:${tl}:${engine}`;
  };

  LTV.parseCacheKey = function parseCacheKey(key) {
    const parts = String(key || "").split(":");
    if (parts.length < 4) return null;
    const engine = parts.pop();
    const tl = parts.pop();
    const lang = parts.pop();
    return { session: parts.join(":"), lang, tl, engine };
  };

  // Mã ngôn ngữ gốc: "en-US" → "en", "zh-CN" giữ nguyên vì Google phân biệt.
  LTV.baseLang = function baseLang(code) {
    if (!code) return "";
    const lower = String(code).replace("_", "-").toLowerCase();
    if (lower.startsWith("zh")) return lower.includes("tw") ? "zh-TW" : "zh-CN";
    return lower.split("-")[0];
  };
})(globalThis);
