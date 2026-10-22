// Cài đặt mặc định và danh mục dùng chung cho service worker, popup, options
// và content script. Viết dạng script thường gắn vào globalThis.LTV để nạp
// được cả bằng <script>, content_scripts lẫn `import` (module).
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  LTV.DEFAULTS = Object.freeze({
    autoStart: false,
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
  });

  // Giới hạn hợp lệ cho các cài đặt dạng số.
  const NUMBER_RANGES = {
    rate: [0.5, 2.5],
    maxRate: [1, 3],
    voiceVolume: [0, 1],
    duckVolume: [0, 1],
    subtitleSize: [12, 48],
  };

  const ENUMS = {
    translator: ["google", "claude"],
    voiceEngine: ["google", "system"],
    subtitleMode: ["translated", "bilingual", "original", "off"],
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

  function validValue(key, value) {
    const fallback = LTV.DEFAULTS[key];
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

  // Mã ngôn ngữ gốc: "en-US" → "en", "zh-CN" giữ nguyên vì Google phân biệt.
  LTV.baseLang = function baseLang(code) {
    if (!code) return "";
    const lower = String(code).replace("_", "-").toLowerCase();
    if (lower.startsWith("zh")) return lower.includes("tw") ? "zh-TW" : "zh-CN";
    return lower.split("-")[0];
  };
})(globalThis);
