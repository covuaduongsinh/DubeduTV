// Chọn bộ dịch cho một yêu cầu: Claude hoặc Chrome trên máy khi được chọn,
// dòng nào chưa dịch được thì Google Dịch điền vào. Trả kèm engines[] – bộ
// dịch thật của từng dòng – để cache không gán bản dịch Google cho Claude.
// Từ điển thuật ngữ (shared/glossary.js) áp ở đây cho mọi bộ dịch: Claude
// nhận danh sách thuật ngữ trong lời dặn, Google/Chrome nhận câu đã bọc
// thuật ngữ cần giữ; mọi kết quả đều qua bước sửa cách dịch sai.
import "../shared/glossary.js";

const LTV = globalThis.LTV;

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

// Câu gửi cho từng bộ dịch và cách đưa kết quả về đúng thuật ngữ.
function glossaryPlan(clean, entries) {
  const prepared = clean.map((text) => LTV.glossary.prepare(text, entries));
  return {
    // Claude hiểu lời dặn thuật ngữ nên nhận câu gốc.
    textsFor: (engine) =>
      engine === "claude" ? clean : prepared.map((item) => item.text),
    terms: LTV.glossary.promptTerms(entries),
    finish: (index, output, engine) =>
      LTV.glossary.fix(
        clean[index],
        output,
        entries,
        engine === "claude" ? [] : prepared[index].inserted,
      ),
  };
}

// google({texts, sl, tl}) → string[]; engines: { claude?, chrome? } nhận
// {texts, sl, tl, title, context, terms} và trả mảng (null cho dòng không
// dịch được). glossarySettings() → { mode, custom } từ cài đặt.
export function createTranslateRouter({ google, engines, glossarySettings }) {
  return async function translate(request) {
    const { sl, tl, title, engine, context, domain } = request;
    const clean = cleanTexts(request.texts);
    const settings = glossarySettings ? await glossarySettings() : {};
    const plan = glossaryPlan(
      clean,
      LTV.glossary.entriesFor({ domain, ...settings }),
    );
    const results = clean.map(() => null);
    const used = clean.map(() => null);
    let warning = "";
    const preferred = engines[engine];
    if (preferred) {
      try {
        const output = await preferred({
          texts: plan.textsFor(engine),
          sl,
          tl,
          title,
          terms: plan.terms,
          context: Array.isArray(context) ? context.slice(-CONTEXT_LINES) : [],
        });
        clean.forEach((_, index) => {
          if (!usable(output?.[index])) return;
          results[index] = plan.finish(index, output[index], engine);
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
    const fill = (indexes, output, filler) =>
      indexes.forEach((index, k) => {
        if (!usable(output?.[k])) return;
        results[index] = plan.finish(index, output[k], filler);
        used[index] = filler;
      });
    try {
      const googleTexts = plan.textsFor("google");
      const filled = await google({
        texts: missing.map((index) => googleTexts[index]),
        sl,
        tl,
      });
      fill(missing, filled, "google");
      return { results, engines: used, warning };
    } catch (error) {
      const rescued = await rescueWithChrome(engines, request, error, {
        texts: missing.map((index) => plan.textsFor("chrome")[index]),
        terms: plan.terms,
      });
      if (rescued?.output) {
        fill(missing, rescued.output, "chrome");
        warning =
          "Google Dịch tạm không dùng được – đang dịch bằng Chrome trên máy";
      }
      const done = missing.every((index) => results[index]);
      if (done) return { results, engines: used, warning };
      // Nói rõ vì sao bộ dự phòng cũng không dịch được (vd. chưa tải gói dịch).
      const fallback = rescued?.error
        ? ` Dự phòng “Chrome trên máy” chưa dùng được: ${rescued.error}.`
        : "";
      return {
        results,
        engines: used,
        warning,
        error: `${error.message || "Lỗi dịch"}${fallback}`,
      };
    }
  };
}

// Google bị chặn hoặc mất kết nối: thử bộ dịch Chrome trên máy (nếu người
// dùng chưa chọn nó) cho các dòng còn thiếu. Trả { output } hoặc { error },
// null nếu không thử.
async function rescueWithChrome(engines, request, error, { texts, terms }) {
  const reachable = error?.code === "blocked" || error?.code === "network";
  if (!reachable || !engines.chrome || request.engine === "chrome") return null;
  try {
    const output = await engines.chrome({
      texts,
      sl: request.sl,
      tl: request.tl,
      title: request.title,
      terms,
      context: [],
    });
    return { output };
  } catch (chromeError) {
    return { error: chromeError?.message || String(chromeError) };
  }
}
