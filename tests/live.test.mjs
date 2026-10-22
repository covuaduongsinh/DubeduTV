import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import { FakeVideo, fakeClock, fakeSpeech } from "./fakes.mjs";

test("chunk planner cắt khi đủ dài và gặp khoảng lặng, hoặc chạm tối đa", () => {
  const planner = LTV.createChunkPlanner({ minSeconds: 5, maxSeconds: 15 });
  let cut = false;
  for (let i = 0; i < 50 && !cut; i += 1) cut = planner.push(0.2, 0.1);
  assert.equal(cut, false, "đang nói 5 giây thì chưa cắt");
  for (let i = 0; i < 3; i += 1) cut = planner.push(0.001, 0.1);
  assert.equal(cut, false, "lặng 0.3 giây chưa đủ");
  cut = planner.push(0.001, 0.1);
  assert.equal(cut, true, "lặng 0.4 giây sau 5 giây thì cắt");
  assert.equal(planner.hasSpeech(), true);
  planner.reset();
  let steps = 0;
  while (!planner.push(0.3, 0.1)) steps += 1;
  assert.ok(steps >= 148 && steps <= 150, `cắt ở tối đa 15 giây (${steps})`);
  planner.reset();
  for (let i = 0; i < 100; i += 1) planner.push(0.002, 0.1);
  assert.equal(planner.hasSpeech(), false, "đoạn im lặng bị đánh dấu để bỏ");
  planner.reset();
  let blind = 0;
  while (!planner.pushBlind(0.1)) blind += 1;
  assert.ok(blind > 90 && blind < 110);
  assert.equal(LTV.rms([0.5, -0.5]), 0.5);
});

test("asrTiming ước lượng mốc câu từ lúc có kết quả", () => {
  assert.deepEqual(
    LTV.asrTiming({ firstHeard: 10.8, finalAt: 14.6, rate: 1 }),
    { start: 10, end: 14 },
  );
  const fast = LTV.asrTiming({ firstHeard: 2, finalAt: 6, rate: 2 });
  assert.equal(fast.start, 0.4);
  assert.equal(fast.end, 4.8);
  const tiny = LTV.asrTiming({ firstHeard: 0.2, finalAt: 0.5, rate: 1 });
  assert.equal(tiny.start, 0);
  assert.equal(tiny.end, 0.5);
  assert.equal(
    LTV.chromeRecognizerSupported(),
    false,
    "Node không có Web Speech",
  );
});

test("captionError đánh dấu trường hợp không có phụ đề", () => {
  const plain = LTV.captionError("x");
  assert.equal(plain.noCaptions, false);
  assert.equal(plain.userMessage, "x");
  assert.equal(LTV.captionError("y", { noCaptions: true }).noCaptions, true);
});

function setupLive(liveMode) {
  const clock = fakeClock();
  const video = new FakeVideo();
  const speech = fakeSpeech();
  const lines = [];
  const settings = { ...LTV.DEFAULTS, liveMode };
  const dubber = LTV.createLiveDubber({
    video,
    speech,
    clock,
    lang: "vi",
    getSettings: () => settings,
    onLine: (line) => lines.push(line ? line.text : null),
  });
  dubber.start();
  const sentence = (text, start) => ({
    text,
    tr: `vi:${text}`,
    start,
    end: start + 2,
  });
  return { clock, video, speech, dubber, lines, settings, sentence };
}

test("nối tiếp: có câu thì tạm dừng video, đọc hết hàng đợi rồi phát tiếp", async () => {
  const t = setupLive("consecutive");
  t.video.currentTime = 5;
  t.dubber.push(t.sentence("One.", 2));
  assert.equal(t.video.paused, true);
  assert.equal(t.speech.calls.length, 1);
  assert.equal(t.speech.calls[0].rate, LTV.DEFAULTS.rate);
  t.dubber.push(t.sentence("Two.", 4));
  assert.equal(t.speech.calls.length, 1, "chờ câu đang đọc");
  await t.speech.finish();
  assert.equal(t.speech.calls.length, 2);
  assert.equal(t.video.paused, true, "còn câu thì vẫn dừng");
  await t.speech.finish();
  assert.equal(t.video.paused, false, "hết hàng đợi thì phát tiếp");
  assert.equal(t.video.volume, 1, "video dừng nên không cần giảm tiếng");
  assert.deepEqual(t.lines.filter(Boolean), ["One.", "Two."]);
  t.dubber.stop();
});

test("nối tiếp: người dùng tự dừng thì đọc xong không tự phát lại", async () => {
  const t = setupLive("consecutive");
  t.video.pause(); // người dùng bấm dừng
  t.dubber.push(t.sentence("One.", 0));
  await t.speech.finish();
  assert.equal(t.video.paused, true);
  t.dubber.stop();
  assert.equal(t.video.paused, true);
});

test("nối tiếp: người dùng bấm phát trong lúc đọc thì để video chạy", async () => {
  const t = setupLive("consecutive");
  t.dubber.push(t.sentence("One.", 0));
  assert.equal(t.video.paused, true);
  t.video.play(); // người dùng không muốn chờ
  await t.speech.finish();
  assert.equal(t.video.paused, false);
  t.dubber.stop();
});

test("song song: không dừng video, giảm tiếng, tăng tốc khi dồn câu, bỏ câu quá trễ", async () => {
  const t = setupLive("parallel");
  t.video.currentTime = 10;
  t.dubber.push(t.sentence("One.", 8));
  t.dubber.push(t.sentence("Two.", 9));
  t.dubber.push(t.sentence("Three.", 9.5));
  assert.equal(t.video.paused, false);
  t.clock.advance(300);
  assert.ok(Math.abs(t.video.volume - LTV.DEFAULTS.duckVolume) < 1e-9);
  await t.speech.finish();
  assert.ok(t.speech.calls[1].rate > t.speech.calls[0].rate - 1e-9);
  assert.ok(
    t.speech.calls[1].rate > LTV.DEFAULTS.rate,
    "còn câu chờ thì đọc nhanh hơn",
  );
  t.video.currentTime = 40; // câu "Three." đã trễ quá 15 giây
  await t.speech.finish();
  assert.equal(t.speech.calls.length, 2);
  t.clock.advance(1000);
  assert.equal(t.video.volume, 1);
  t.dubber.stop();
});

test("tua video thì bỏ hàng đợi và dừng giọng; stop trả lại video đang bị dừng", async () => {
  const t = setupLive("consecutive");
  t.dubber.push(t.sentence("One.", 0));
  t.dubber.push(t.sentence("Two.", 1));
  t.video.dispatchEvent(new Event("seeking"));
  assert.equal(t.speech.speaking, null);
  assert.equal(t.dubber.state().queued, 0);
  t.dubber.push(t.sentence("Three.", 2));
  assert.equal(t.video.paused, true);
  t.dubber.stop();
  assert.equal(
    t.video.paused,
    false,
    "tắt lồng tiếng thì không để video bị kẹt dừng",
  );
  assert.equal(
    LTV.liveRate(
      { rate: 1.2, maxRate: 1.8, autoRate: true },
      "parallel",
      10,
      1,
    ),
    1.8,
  );
  assert.equal(
    LTV.liveRate(
      { rate: 1.2, maxRate: 1.8, autoRate: false },
      "parallel",
      10,
      1,
    ),
    1.2,
  );
});
