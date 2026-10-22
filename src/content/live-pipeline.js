// Phần dùng chung của lồng tiếng trực tiếp (video không phụ đề, nghe cả thẻ):
// dịch từng câu vừa nghe được kèm vài câu trước làm ngữ cảnh, giữ đúng thứ
// tự rồi đưa cho bộ đọc; và đọc lại lời chép đã lưu từ lần xem trước.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const CONTEXT_LINES = 3;
  const MAX_RECENT = 20;
  // Lời chép đã lưu phủ ít nhất ngần này thời lượng thì dùng như phụ đề.
  const TRANSCRIPT_MIN_COVERAGE = 0.9;

  // Dịch một câu vừa chép, kèm vài câu trước làm ngữ cảnh.
  LTV.translateLive = async function translateLive(
    { connection, settings, lang, title, recent },
    text,
  ) {
    const tl = settings.targetLang;
    if (LTV.tracks.sameLang(lang, tl)) return { text };
    const response = await connection.request({
      type: "translate",
      texts: [text],
      context: recent.slice(-CONTEXT_LINES),
      sl: lang === "auto" ? "auto" : LTV.baseLang(lang),
      tl,
      title,
      engine: settings.translator,
    });
    return { text: response.results?.[0] || null, warning: response.warning };
  };

  // Lời chép từ lần xem trước, nếu phủ gần hết video thì dùng như phụ đề.
  LTV.loadSavedTranscript = async function loadSavedTranscript({
    connection,
    key,
    targetLang,
  }) {
    let entry = null;
    try {
      const response = await connection.request(
        { type: "transcript:get", key },
        10000,
      );
      entry = response.entry;
    } catch {
      entry = null;
    }
    if (!entry || !(entry.coverage >= TRANSCRIPT_MIN_COVERAGE)) return null;
    return {
      cues: entry.cues,
      lang: entry.lang,
      needsTranslation: !LTV.tracks.sameLang(entry.lang, targetLang),
      label: "lời chép tự động đã lưu",
      title: document.title,
    };
  };

  // Dịch nối tiếp các câu (giữ thứ tự) rồi gọi push({...câu, tr}).
  LTV.createLivePipeline = function createLivePipeline(options) {
    const { connection, getSettings, title, getLang, setStatus, push } =
      options;
    const isStopped = options.isStopped || (() => false);
    const recent = [];
    let chain = Promise.resolve();

    async function deliver(sentence) {
      const context = {
        connection,
        settings: getSettings(),
        lang: getLang(),
        title,
        recent,
      };
      const result = await LTV.translateLive(context, sentence.text);
      recent.push(sentence.text);
      if (recent.length > MAX_RECENT) recent.shift();
      if (result.warning) setStatus("warn", result.warning, { tone: "warn" });
      if (result.text && !isStopped()) push({ ...sentence, tr: result.text });
    }

    return {
      enqueue(sentence) {
        chain = chain
          .then(() => deliver(sentence))
          .catch((error) =>
            setStatus("error", `Lỗi dịch: ${error.message}`, { tone: "error" }),
          );
      },
    };
  };
})(globalThis);
