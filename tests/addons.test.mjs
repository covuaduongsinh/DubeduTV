import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import "../src/content/lib/quiz-text.js";
import "../src/content/badges.js";

// DOM giả tối thiểu cho quiz-text: phần tử, nút chữ, querySelector ô chọn.
function el(tag, attrs = {}, ...kids) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    childNodes: [],
    parentElement: null,
    getAttribute: (name) => attrs[name] ?? null,
    get children() {
      return node.childNodes.filter((child) => child.nodeType === 1);
    },
    get textContent() {
      return node.childNodes.map((child) => child.textContent).join("");
    },
    querySelector() {
      const isInput = (n) =>
        (n.tagName === "INPUT" &&
          ["radio", "checkbox"].includes(n.attrs.type)) ||
        n.tagName === "TEXTAREA" ||
        ["radio", "checkbox"].includes(n.attrs.role);
      const walk = (n) => n.children.some((c) => isInput(c) || walk(c));
      return walk(node) ? {} : null;
    },
  };
  for (const kid of kids) {
    const child =
      typeof kid === "string"
        ? { nodeType: 3, nodeValue: kid, textContent: kid }
        : kid;
    child.parentElement = node;
    node.childNodes.push(child);
  }
  return node;
}

function quiz() {
  const submit = el("button", {}, "Submit");
  const form = el(
    "form",
    {},
    el(
      "div",
      {},
      el("p", {}, "Which piece moves in an ", el("b", {}, "L"), " shape?"),
      el("label", {}, el("input", { type: "radio" }), " The knight"),
      el(
        "label",
        {},
        el("input", { type: "radio" }),
        el("span", {}, "The bishop"),
      ),
      el("span", { "data-ltv": "quiz-tr" }, "Bản dịch cũ"),
      el("p", {}, "12 / 3"),
    ),
    submit,
  );
  return { form, submit };
}

test("quiz: nhận diện nút nộp bài tiếng Anh và tiếng Việt", () => {
  for (const label of [
    "Submit",
    " Check answer ",
    "Gửi bài",
    "Nộp",
    "Kiểm tra",
    "Tiếp tục",
  ])
    assert.equal(LTV.quizText.isQuizAction(label), true, label);
  for (const label of ["Submit feedback", "Save", "Dịch"])
    assert.equal(LTV.quizText.isQuizAction(label), false, label);
});

test("quiz: khung câu hỏi là tổ tiên gần nhất có ô chọn đáp án", () => {
  const { form, submit } = quiz();
  assert.equal(LTV.quizText.findQuizContainer(submit), form);
  const lonely = el("div", {}, el("button", {}, "Submit"));
  assert.equal(LTV.quizText.findQuizContainer(lonely.children[0]), null);
});

test("quiz: lấy câu hỏi và từng đáp án, bỏ nút, bản dịch cũ và dòng không có chữ", () => {
  const { form } = quiz();
  const texts = LTV.quizText.collectLeafTexts(form).map((leaf) => leaf.text);
  assert.deepEqual(texts, [
    "Which piece moves in an L shape?",
    "The knight",
    "The bishop",
  ]);
});

test("huy hiệu: mã video từ đường dẫn YouTube", () => {
  globalThis.location = new URL("https://www.youtube.com/");
  assert.equal(
    LTV.videoIdFromHref("/watch?v=abc123DEF_-&list=PL1"),
    "abc123DEF_-",
  );
  assert.equal(
    LTV.videoIdFromHref("https://www.youtube.com/shorts/xyz98765"),
    "xyz98765",
  );
  assert.equal(LTV.videoIdFromHref("/channel/UC123"), null);
  assert.equal(LTV.videoIdFromHref("/watch?v=<bad>"), null);
  delete globalThis.location;
});
