// Dịch và nhận diện ngôn ngữ ngay trên máy bằng API có sẵn của Google Chrome
// 138+ (Translator, LanguageDetector). Gói ngôn ngữ tải một lần và cần thao
// tác của người dùng, nên việc tải nằm ở popup/tuỳ chọn; offscreen document
// chỉ dùng gói đã có sẵn.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MIN_CONFIDENCE = 0.5;
  const DETECT_SAMPLE_CHARS = 2000;

  // Mã ngôn ngữ của Translator API: "en-US" → "en", "zh-CN" → "zh".
  function langCode(code) {
    const base = LTV.baseLang(code);
    if (base === "zh-CN") return "zh";
    if (base === "zh-TW") return "zh-Hant";
    return base;
  }

  const supported = () => typeof root.Translator?.create === "function";
  const detectorSupported = () =>
    typeof root.LanguageDetector?.create === "function";

  // "available" | "downloadable" | "downloading" | "unavailable" | "no-api".
  async function pairStatus(sl, tl) {
    if (!supported()) return "no-api";
    try {
      return await root.Translator.availability({
        sourceLanguage: langCode(sl),
        targetLanguage: langCode(tl),
      });
    } catch {
      return "unavailable";
    }
  }

  async function detectorStatus() {
    if (!detectorSupported()) return "no-api";
    try {
      return await root.LanguageDetector.availability();
    } catch {
      return "unavailable";
    }
  }

  const translators = new Map();
  let detector = null;

  function translatorFor(sl, tl) {
    const key = `${sl}>${tl}`;
    if (!translators.has(key)) {
      const created = root.Translator.create({
        sourceLanguage: sl,
        targetLanguage: tl,
      });
      created.catch(() => translators.delete(key));
      translators.set(key, created);
    }
    return translators.get(key);
  }

  // Ngôn ngữ của đoạn văn (mã Translator) hoặc null nếu không chắc.
  async function detect(texts) {
    if ((await detectorStatus()) !== "available") return null;
    detector = detector || root.LanguageDetector.create();
    try {
      const instance = await detector;
      const sample = texts.join("\n").slice(0, DETECT_SAMPLE_CHARS);
      const [best] = await instance.detect(sample);
      if (!best || best.confidence < MIN_CONFIDENCE) return null;
      return best.detectedLanguage === "und" ? null : best.detectedLanguage;
    } catch {
      detector = null;
      return null;
    }
  }

  // { ok: true, results, sl } (null cho dòng lỗi) hoặc { ok: false, code, sl, tl }.
  async function translate({ texts, sl, tl }) {
    if (!supported()) return { ok: false, code: "no-api" };
    const list = Array.isArray(texts) ? texts.map(String) : [];
    const source = !sl || sl === "auto" ? await detect(list) : langCode(sl);
    if (!source) return { ok: false, code: "detect-unavailable" };
    const target = langCode(tl);
    if (LTV.baseLang(source) === LTV.baseLang(target))
      return { ok: true, results: list, sl: source };
    const status = await pairStatus(source, target);
    if (status !== "available")
      return { ok: false, code: status, sl: source, tl: target };
    let translator;
    try {
      translator = await translatorFor(source, target);
    } catch (error) {
      return { ok: false, code: "create-failed", error: error.message };
    }
    const results = [];
    for (const text of list) {
      try {
        results.push(await translator.translate(text));
      } catch {
        results.push(null);
      }
    }
    return { ok: true, results, sl: source };
  }

  // Tải gói dịch (phải gọi ngay trong sự kiện bấm của người dùng).
  async function download({ sl, tl, onProgress }) {
    const monitor = (target) =>
      target.addEventListener("downloadprogress", (event) =>
        onProgress?.(event.loaded),
      );
    const translator = await root.Translator.create({
      sourceLanguage: langCode(sl),
      targetLanguage: langCode(tl),
      monitor,
    });
    translator.destroy?.();
    if (detectorSupported() && (await detectorStatus()) !== "available") {
      const created = await root.LanguageDetector.create({ monitor });
      created.destroy?.();
    }
  }

  LTV.chromeAI = {
    langCode,
    supported,
    pairStatus,
    detectorStatus,
    detect,
    translate,
    download,
  };
})(globalThis);
