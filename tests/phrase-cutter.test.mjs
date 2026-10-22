import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import { fakeClock, FakeVideo, fakeSpeech } from "./fakes.mjs";
import "../src/content/live-dubber.js";

function setup() {
  const clock = fakeClock();
  const phrases = [];
  let time = 0;
  const cutter = LTV.createPhraseCutter({
    onPhrase: (phrase) => phrases.push(phrase),
    now: () => time,
    clock,
  });
  return { clock, phrases, cutter, at: (value) => (time = value) };
}

// Đưa dần từng từ của câu vào như kết quả tạm, mỗi từ cách nhau 0.3 s.
function speak({ cutter, at }, key, text, startAt) {
  const words = text.split(" ");
  words.forEach((_, i) => {
    at(startAt + 0.3 * i);
    cutter.interim({
      key,
      text: words.slice(0, i + 1).join(" "),
      firstHeard: startAt + 0.8,
    });
  });
  at(startAt + 0.3 * words.length);
}

test("cụm đầu cắt sau dấu phẩy khi đủ 4 từ; phần còn lại đọc khi có kết quả cuối", () => {
  const ctx = setup();
  const text =
    "Welcome back to this chess lesson, and today we will learn how the knight moves.";
  speak(ctx, "1:0", text, 1);
  assert.deepEqual(
    ctx.phrases.map((p) => p.text),
    ["Welcome back to this chess lesson,"],
  );
  ctx.cutter.final({ key: "1:0", text, firstHeard: 1.8 });
  assert.deepEqual(
    ctx.phrases.map((p) => p.text),
    [
      "Welcome back to this chess lesson,",
      "and today we will learn how the knight moves.",
    ],
  );
  assert.equal(ctx.cutter.has("1:0"), false);
});

test("cắt trước liên từ (cụm sau cần 7 từ) và cắt cứng ở 14 từ", () => {
  const ctx = setup();
  speak(
    ctx,
    "1:0",
    "The knight jumps in an L shape because it can leap over other pieces when it moves",
    0,
  );
  assert.deepEqual(
    ctx.phrases.map((p) => p.text),
    ["The knight jumps in an L shape", "because it can leap over other pieces"],
  );
  const long = setup();
  speak(
    long,
    "2:0",
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
    0,
  );
  assert.equal(long.phrases[0].text.split(" ").length, 14);
});

test("không cắt ở từ cuối của kết quả tạm (còn có thể đổi)", () => {
  const ctx = setup();
  ctx.cutter.interim({
    key: "1:0",
    text: "Hello there my friend,",
    firstHeard: 1,
  });
  assert.equal(ctx.phrases.length, 0);
  ctx.cutter.interim({
    key: "1:0",
    text: "Hello there my friend, how",
    firstHeard: 1,
  });
  assert.deepEqual(
    ctx.phrases.map((p) => p.text),
    ["Hello there my friend,"],
  );
});

test("im lặng 700 ms thì đọc nốt phần đang chờ, kết quả cuối không đọc lặp", () => {
  const ctx = setup();
  ctx.at(2);
  ctx.cutter.interim({ key: "1:0", text: "so this is how", firstHeard: 2 });
  ctx.clock.advance(699);
  assert.equal(ctx.phrases.length, 0);
  ctx.clock.advance(1);
  assert.deepEqual(
    ctx.phrases.map((p) => p.text),
    ["so this is how"],
  );
  ctx.cutter.final({ key: "1:0", text: "so this is how", firstHeard: 2 });
  assert.equal(ctx.phrases.length, 1);
});

test("mốc thời gian các cụm tăng dần, kể cả giữa hai lượt nói", () => {
  const ctx = setup();
  speak(
    ctx,
    "1:0",
    "First part of the talk, and then the second part arrives here",
    1,
  );
  ctx.cutter.final({
    key: "1:0",
    text: "First part of the talk, and then the second part arrives here",
    firstHeard: 1.8,
  });
  speak(ctx, "1:1", "Another thought begins now, which is short", 2);
  ctx.cutter.final({
    key: "1:1",
    text: "Another thought begins now, which is short",
    firstHeard: 2.8,
  });
  const starts = ctx.phrases.map((p) => p.start);
  ctx.phrases.forEach((phrase, i) => {
    assert.ok(phrase.end > phrase.start);
    if (i > 0)
      assert.ok(
        phrase.start >= ctx.phrases[i - 1].end,
        `cụm ${i} lùi thời gian: ${starts}`,
      );
  });
  assert.equal(ctx.phrases[0].start, 1);
});

test("đọc song song: hàng đợi tối đa 3 câu, bỏ câu cũ nhất", () => {
  const clock = fakeClock();
  const video = new FakeVideo();
  video.paused = false;
  const speech = fakeSpeech();
  const settings = { ...LTV.mergeSettings({ liveMode: "parallel" }) };
  const dubber = LTV.createLiveDubber({
    video,
    speech,
    getSettings: () => settings,
    lang: "vi",
    clock,
  });
  dubber.start();
  for (let i = 0; i < 6; i += 1)
    dubber.push({ start: i, end: i + 1, tr: `câu ${i}` });
  assert.deepEqual(
    speech.calls.map((call) => call.text),
    ["câu 0"],
  );
  assert.equal(dubber.state().queued, 3);
  speech.finish({ ok: true, event: "end" });
  dubber.stop();
});
