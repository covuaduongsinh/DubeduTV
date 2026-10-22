// Nút "Dịch" cho câu hỏi trắc nghiệm (Coursera, Udemy): đặt cạnh nút nộp
// bài, dịch câu hỏi và các đáp án bằng bộ dịch đang chọn, hiện bản dịch
// nghiêng ngay dưới từng dòng; bấm lại để ẩn/hiện. Không nộp bài thay người học.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const SCAN_DELAY_MS = 1500;
  const MAX_BATCH = 50;
  const MAX_BATCH_CHARS = 4000;
  const BUTTON_STYLE =
    "margin:0 8px;padding:6px 14px;border-radius:4px;border:1px solid #2B3990;background:#fff;color:#2B3990;font:600 14px/1.2 Roboto,Arial,sans-serif;cursor:pointer;";
  const LINE_STYLE =
    "display:block;margin-top:2px;color:#2B3990;font-style:italic;opacity:.9;";

  function batches(texts) {
    const result = [];
    let current = [];
    let chars = 0;
    for (const text of texts) {
      if (
        current.length >= MAX_BATCH ||
        (current.length > 0 && chars + text.length > MAX_BATCH_CHARS)
      ) {
        result.push(current);
        current = [];
        chars = 0;
      }
      current.push(text);
      chars += text.length;
    }
    if (current.length > 0) result.push(current);
    return result;
  }

  function lineFor(text) {
    const line = document.createElement("span");
    line.setAttribute("data-ltv", "quiz-tr");
    line.style.cssText = LINE_STYLE;
    line.textContent = text;
    return line;
  }

  // Dịch các dòng theo lô bằng bộ dịch đang chọn.
  async function translateTexts(connection, settings, texts) {
    const domain = LTV.glossary.domainFor(settings, {
      title: document.title,
      texts,
    });
    const results = [];
    for (const batch of batches(texts)) {
      const response = await connection.request({
        type: "translate",
        texts: batch,
        context: [],
        sl: settings.sourceLang,
        tl: settings.targetLang,
        title: document.title,
        engine: settings.translator,
        domain,
      });
      if (response.error && !response.results?.some(Boolean))
        throw new Error(response.error);
      results.push(...batch.map((_, i) => response.results?.[i] || null));
    }
    return results;
  }

  // Nút Dịch của một câu hỏi: dịch lần đầu, sau đó ẩn/hiện bản dịch.
  function addButton(action, container, show) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-ltv", "quiz-btn");
    button.title = "Dịch câu hỏi và các đáp án (Lồng Tiếng Việt)";
    button.style.cssText = BUTTON_STYLE;
    button.textContent = "Dịch";
    let lines = null;
    let busy = false;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      // Câu hỏi đã đổi (trang học chuyển câu): dịch lại.
      if (lines && lines.some((line) => !line.isConnected)) lines = null;
      if (lines) {
        const hide = !lines[0]?.hidden;
        for (const line of lines) line.hidden = hide;
        button.textContent = hide ? "Hiện bản dịch" : "Ẩn bản dịch";
        return;
      }
      busy = true;
      button.textContent = "Đang dịch…";
      try {
        lines = await show(container);
        button.textContent = "Ẩn bản dịch";
      } catch (error) {
        button.textContent = "Dịch lại";
        button.title = `Lỗi dịch: ${error.message}`;
      } finally {
        busy = false;
      }
    });
    action.insertAdjacentElement("beforebegin", button);
  }

  LTV.createQuizTranslator = function createQuizTranslator({
    connection,
    getSettings,
  }) {
    const seen = new WeakSet();
    let timer = null;

    async function show(container) {
      const leaves = LTV.quizText.collectLeafTexts(container);
      const translated = await translateTexts(
        connection,
        getSettings(),
        leaves.map((leaf) => leaf.text),
      );
      const lines = [];
      leaves.forEach((leaf, i) => {
        if (!translated[i] || translated[i] === leaf.text) return;
        const line = lineFor(translated[i]);
        leaf.element.appendChild(line);
        lines.push(line);
      });
      return lines;
    }

    function clear() {
      for (const node of document.querySelectorAll(
        '[data-ltv="quiz-btn"], [data-ltv="quiz-tr"]',
      ))
        node.remove();
    }

    function scan() {
      timer = null;
      if (!getSettings().quizTranslate) return clear();
      const actions = document.querySelectorAll(
        'button, [role="button"], input[type="submit"]',
      );
      for (const action of actions) {
        if (seen.has(action) || action.getAttribute("data-ltv")) continue;
        const label = action.textContent || action.value || "";
        if (!LTV.quizText.isQuizAction(label)) continue;
        // Ô chọn đáp án có thể hiện sau nút: chưa thấy thì lần quét sau thử lại.
        const container = LTV.quizText.findQuizContainer(action);
        if (!container) continue;
        seen.add(action);
        if (!container.querySelector('[data-ltv="quiz-btn"]'))
          addButton(action, container, show);
      }
    }

    const schedule = () => {
      if (!timer) timer = setTimeout(scan, SCAN_DELAY_MS);
    };
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    schedule();

    return {
      refresh() {
        if (!getSettings().quizTranslate) clear();
        schedule();
      },
    };
  };
})(globalThis);
