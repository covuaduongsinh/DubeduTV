// Nhận diện câu hỏi trắc nghiệm trên trang học (Coursera, Udemy): nút nộp bài
// (Submit, Check, Gửi, Nộp…), khung câu hỏi chứa ô chọn đáp án, và các dòng
// chữ cần dịch (câu hỏi, từng đáp án). Chỉ dùng thuộc tính DOM cơ bản để
// kiểm thử được bằng nút giả.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const ACTION =
    /^(submit|check(\s+answers?)?|continue|next|gửi(\s+bài)?|nộp(\s+bài)?|kiểm\s+tra|tiếp(\s+tục|\s+theo)?)$/i;
  const INPUTS =
    'input[type="radio"], input[type="checkbox"], textarea, [role="radio"], [role="checkbox"]';
  const SKIP = new Set([
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "SCRIPT",
    "STYLE",
    "SVG",
    "NOSCRIPT",
  ]);
  const MAX_UP = 8;
  const MAX_CONTAINER_CHARS = 20000;
  const MAX_LEAVES = 60;
  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;

  function isQuizAction(text) {
    return ACTION.test(
      String(text || "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  // Tổ tiên gần nhất của nút có ô chọn đáp án (không quá lớn).
  function findQuizContainer(button) {
    let node = button.parentElement;
    for (let depth = 0; node && depth < MAX_UP; depth += 1) {
      if (node.querySelector(INPUTS))
        return (node.textContent || "").length <= MAX_CONTAINER_CHARS
          ? node
          : null;
      node = node.parentElement;
    }
    return null;
  }

  const skipped = (element) =>
    SKIP.has(String(element.tagName).toUpperCase()) ||
    Boolean(element.getAttribute?.("data-ltv"));
  const hasLetters = (text) => /\p{L}[\s\S]*\p{L}/u.test(text);

  function textOf(node) {
    if (node.nodeType === TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== ELEMENT_NODE || skipped(node)) return "";
    return Array.from(node.childNodes, textOf).join("");
  }

  function ownText(element) {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === TEXT_NODE)
      .map((node) => node.nodeValue || "")
      .join(" ");
  }

  // Các phần tử "dòng chữ": phần tử đầu tiên (từ trên xuống) tự chứa chữ;
  // phần tử chỉ bọc phần tử khác thì đi tiếp vào trong.
  function collectLeafTexts(container) {
    const leaves = [];
    const visit = (element) => {
      if (leaves.length >= MAX_LEAVES || skipped(element)) return;
      if (hasLetters(ownText(element))) {
        const text = textOf(element).replace(/\s+/g, " ").trim();
        if (hasLetters(text)) leaves.push({ element, text });
        return;
      }
      for (const child of element.children) visit(child);
    };
    for (const child of container.children) visit(child);
    return leaves;
  }

  LTV.quizText = { isQuizAction, findQuizContainer, collectLeafTexts };
})(globalThis);
