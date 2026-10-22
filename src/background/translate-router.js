// Chọn bộ dịch cho một yêu cầu: Claude hoặc Chrome trên máy khi được chọn,
// dòng nào chưa dịch được thì Google Dịch điền vào. Trả kèm engines[] – bộ
// dịch thật của từng dòng – để cache không gán bản dịch Google cho Claude.

const MAX_TEXTS_PER_REQUEST = 200;
const MAX_TEXT_LENGTH = 2000;
const CONTEXT_LINES = 3;

function cleanTexts(texts) {
  return (Array.isArray(texts) ? texts : [])
    .slice(0, MAX_TEXTS_PER_REQUEST)
    .map((text) => String(text ?? "").slice(0, MAX_TEXT_LENGTH));
}

function usable(result) {
  return typeof result === "string" && result.trim() !== "";
}

// google({texts, sl, tl}) → string[]; engines: { claude?, chrome? } nhận
// {texts, sl, tl, title, context} và trả mảng (null cho dòng không dịch được).
export function createTranslateRouter({ google, engines }) {
  return async function translate({ texts, sl, tl, title, engine, context }) {
    const clean = cleanTexts(texts);
    const results = clean.map(() => null);
    const used = clean.map(() => null);
    let warning = "";
    const preferred = engines[engine];
    if (preferred) {
      try {
        const output = await preferred({
          texts: clean,
          sl,
          tl,
          title,
          context: Array.isArray(context) ? context.slice(-CONTEXT_LINES) : [],
        });
        clean.forEach((_, index) => {
          if (!usable(output?.[index])) return;
          results[index] = output[index];
          used[index] = engine;
        });
      } catch (error) {
        warning = `${error.message} – tạm dùng Google Dịch`;
      }
    }
    const missing = clean.flatMap((_, index) =>
      results[index] ? [] : [index],
    );
    if (missing.length === 0) return { results, engines: used, warning };
    try {
      const filled = await google({
        texts: missing.map((index) => clean[index]),
        sl,
        tl,
      });
      missing.forEach((index, k) => {
        if (!usable(filled[k])) return;
        results[index] = filled[k];
        used[index] = "google";
      });
      return { results, engines: used, warning };
    } catch (error) {
      return {
        results,
        engines: used,
        warning,
        error: error.message || "Lỗi dịch",
      };
    }
  };
}
