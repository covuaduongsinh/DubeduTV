import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";

const { buildSentences, cleanText, normalizeCues } = LTV.segment;
const { chooseRate, calibrateCps, estimateSeconds } = LTV.timing;

test("cleanText bỏ chú thích âm thanh và ký hiệu người nói", () => {
  assert.equal(cleanText("[Music] >> Hello (applause) there ♪"), "Hello there");
  assert.equal(cleanText("- Are you sure?"), "Are you sure?");
  assert.equal(cleanText("(this stays)"), "(this stays)");
});

test("normalizeCues bỏ phần lặp của phụ đề cuộn", () => {
  const cues = normalizeCues([
    { start: 0, end: 2, text: "today we will learn" },
    { start: 2, end: 4, text: "today we will learn how the knight" },
    { start: 4, end: 6, text: "how the knight moves on the board" },
    { start: 6, end: 6.5, text: "moves on the board" },
  ]);
  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["today we will learn", "how the knight", "moves on the board"],
  );
  assert.equal(cues[2].end, 6.5);
});

test("buildSentences gộp mảnh thành câu theo dấu câu", () => {
  const sentences = buildSentences([
    { start: 0, end: 1.5, text: "Welcome to this" },
    { start: 1.5, end: 3, text: "short lesson. Today we" },
    { start: 3, end: 5, text: "learn the knight." },
    { start: 5.1, end: 6, text: "Ready?" },
  ]);
  assert.deepEqual(
    sentences.map((s) => s.text),
    ["Welcome to this short lesson.", "Today we learn the knight. Ready?"],
  );
  assert.equal(sentences[0].start, 0);
  assert.ok(sentences[0].end > 1.5 && sentences[0].end < 3);
  assert.equal(sentences[1].end, 6);
  assert.deepEqual(
    sentences.map((s) => s.id),
    [0, 1],
  );
});

test("buildSentences tách theo khoảng lặng và độ dài khi không có dấu câu", () => {
  const cues = [];
  for (let i = 0; i < 12; i += 1) {
    cues.push({
      start: i * 2,
      end: i * 2 + 1.9,
      text: `word${i} goes here now`,
    });
  }
  cues.push({ start: 40, end: 42, text: "after a long pause" });
  const sentences = buildSentences(cues, { maxDuration: 9 });
  assert.ok(sentences.length >= 3);
  for (const s of sentences) assert.ok(s.end - s.start <= 9.5, s.text);
  assert.equal(sentences[sentences.length - 1].text, "after a long pause");
});

test("buildSentences không cắt sau chữ viết tắt", () => {
  const sentences = buildSentences([
    { start: 0, end: 2, text: "Mr. Smith plays e4." },
    { start: 2, end: 4, text: "Then he castles." },
  ]);
  assert.deepEqual(
    sentences.map((s) => s.text),
    ["Mr. Smith plays e4.", "Then he castles."],
  );
});

test("chooseRate tăng tốc khi câu dài so với khung giờ, trong giới hạn", () => {
  const text = "a".repeat(56);
  assert.equal(estimateSeconds(text, 14), 4);
  const base = {
    text,
    baseRate: 1.1,
    maxRate: 1.8,
    autoRate: true,
    cps: 14,
    videoRate: 1,
  };
  assert.equal(chooseRate({ ...base, available: 10 }), 1.1);
  assert.equal(chooseRate({ ...base, available: 2.5 }), 1.6);
  assert.equal(chooseRate({ ...base, available: 1 }), 1.8);
  assert.equal(chooseRate({ ...base, available: 1, autoRate: false }), 1.1);
  assert.equal(chooseRate({ ...base, available: 10, videoRate: 2 }), 2.2);
});

test("calibrateCps hội tụ về tốc độ đo được và bỏ qua mẫu xấu", () => {
  const text = "x".repeat(40);
  const next = calibrateCps(14, text, 2, 1);
  assert.ok(next > 14 && next < 20);
  assert.equal(calibrateCps(14, text, 0.1, 1), 14);
  assert.equal(calibrateCps(14, "short", 2, 1), 14);
});
