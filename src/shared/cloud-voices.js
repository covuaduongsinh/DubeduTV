// Giọng AI đám mây (Azure, Google Cloud): mã vùng-ngôn ngữ của từng dịch vụ
// cho ngôn ngữ đích, giọng mặc định, và chọn giọng sẽ dùng. Danh sách giọng
// đã chuẩn hoá { name, label, locale } do tts-cloud.js đọc từ API.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  // Ngôn ngữ đích → [mã Azure, mã Google Cloud].
  const LOCALES = {
    vi: ["vi-VN", "vi-VN"],
    en: ["en-US", "en-US"],
    "zh-CN": ["zh-CN", "cmn-CN"],
    ja: ["ja-JP", "ja-JP"],
    ko: ["ko-KR", "ko-KR"],
    fr: ["fr-FR", "fr-FR"],
    de: ["de-DE", "de-DE"],
    es: ["es-ES", "es-ES"],
    ru: ["ru-RU", "ru-RU"],
    th: ["th-TH", "th-TH"],
    id: ["id-ID", "id-ID"],
  };

  // Giọng neural phổ biến của Azure, dùng khi chưa chọn giọng.
  const AZURE_DEFAULTS = {
    vi: ["vi-VN-HoaiMyNeural", "HoaiMy (nữ)"],
    en: ["en-US-JennyNeural", "Jenny (nữ)"],
    "zh-CN": ["zh-CN-XiaoxiaoNeural", "Xiaoxiao (nữ)"],
    ja: ["ja-JP-NanamiNeural", "Nanami (nữ)"],
    ko: ["ko-KR-SunHiNeural", "SunHi (nữ)"],
    fr: ["fr-FR-DeniseNeural", "Denise (nữ)"],
    de: ["de-DE-KatjaNeural", "Katja (nữ)"],
    es: ["es-ES-ElviraNeural", "Elvira (nữ)"],
    ru: ["ru-RU-SvetlanaNeural", "Svetlana (nữ)"],
    th: ["th-TH-PremwadeeNeural", "Premwadee (nữ)"],
    id: ["id-ID-GadisNeural", "Gadis (nữ)"],
  };

  // Google Cloud: chưa chọn giọng thì lấy giọng tự nhiên nhất trong danh sách
  // đã tải (Neural2/WaveNet cùng giá; Chirp3-HD đắt hơn), không có thì để
  // Google tự chọn theo mã ngôn ngữ.
  const GCLOUD_PREFERENCE = [
    "-Neural2-",
    "-Wavenet-",
    "-Chirp3-HD-",
    "-Standard-",
  ];

  function localeFor(engine, lang) {
    const pair = LOCALES[LTV.baseLang(lang)];
    if (!pair) return null;
    return engine === "azure" ? pair[0] : pair[1];
  }

  const sameLocale = (a, b) =>
    String(a || "").toLowerCase() === String(b || "").toLowerCase();

  // Mã vùng-ngôn ngữ của dịch vụ thuộc danh sách hỗ trợ.
  function supportedLocale(engine, locale) {
    const index = engine === "azure" ? 0 : 1;
    return Object.values(LOCALES).some((pair) =>
      sameLocale(pair[index], locale),
    );
  }

  // Các giọng của danh sách đã tải nói đúng ngôn ngữ đích.
  function forLang(engine, voices, lang) {
    const locale = localeFor(engine, lang);
    return (voices || []).filter(
      (voice) => locale && sameLocale(voice.locale, locale),
    );
  }

  function preferredGoogle(voices, lang) {
    const matching = forLang("gcloud", voices, lang);
    for (const marker of GCLOUD_PREFERENCE) {
      const found = matching.find((voice) => voice.name.includes(marker));
      if (found) return found.name;
    }
    return matching[0]?.name || null;
  }

  // Giọng sẽ dùng: giọng đã chọn nếu nói đúng ngôn ngữ đích, không thì giọng
  // mặc định. { locale: null } khi dịch vụ không hỗ trợ ngôn ngữ đích.
  function resolve({ engine, voice, lang, voices }) {
    const locale = localeFor(engine, lang);
    if (!locale) return { locale: null, name: null };
    const prefix = `${locale.toLowerCase()}-`;
    if (voice && String(voice).toLowerCase().startsWith(prefix))
      return { locale, name: voice };
    if (engine === "azure")
      return { locale, name: AZURE_DEFAULTS[LTV.baseLang(lang)][0] };
    return { locale, name: preferredGoogle(voices, lang) };
  }

  // Nhãn của mục "giọng mặc định" trong popup.
  function defaultLabel(engine, lang) {
    const known = engine === "azure" && AZURE_DEFAULTS[LTV.baseLang(lang)];
    return known ? `Mặc định – ${known[1]}` : "Mặc định theo ngôn ngữ";
  }

  LTV.cloudVoices = {
    localeFor,
    supportedLocale,
    forLang,
    resolve,
    defaultLabel,
  };
})(globalThis);
