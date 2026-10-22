import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import { FakeVideo, fakeClock, fakeSpeech } from "./fakes.mjs";

function setup({ translated = true, sentences: custom } = {}) {
  const clock = fakeClock();
  const video = new FakeVideo();
  const speech = fakeSpeech();
  const lines = [];
  const asked = [];
  const sentences = custom || [
    { id: 0, start: 1, end: 3, text: "First sentence.", tr: "Câu thứ nhất." },
    { id: 1, start: 3.2, end: 6, text: "Second sentence.", tr: "Câu thứ hai." },
    { id: 2, start: 10, end: 13, text: "Third sentence.", tr: "Câu thứ ba." },
  ];
  if (!translated) delete sentences[2].tr;
  const dubber = LTV.createDubber({
    video,
    sentences,
    speech,
    clock,
    lang: "vi",
    getSettings: () => LTV.DEFAULTS,
    ensureTranslated: (index) => asked.push(index),
    onLine: (line) => lines.push(line ? line.id : null),
  });
  // Video chạy theo đồng hồ giả.
  const play = (ms) =>
    clock.advance(ms, (now) => (video.currentTime = now / 1000));
  return { clock, video, speech, dubber, lines, asked, sentences, play };
}

test("đọc đúng câu khi đến giờ, giảm rồi trả lại âm lượng gốc", async () => {
  const t = setup();
  t.dubber.start();
  t.play(900);
  assert.equal(t.speech.calls.length, 0);
  t.play(200);
  assert.equal(t.speech.calls.length, 1);
  assert.equal(t.speech.calls[0].text, "Câu thứ nhất.");
  assert.equal(t.speech.calls[0].lang, "vi");
  assert.ok(t.speech.calls[0].rate >= LTV.DEFAULTS.rate);
  t.play(300);
  assert.ok(Math.abs(t.video.volume - LTV.DEFAULTS.duckVolume) < 1e-9);
  await t.speech.finish();
  t.play(100);
  assert.ok(Math.abs(t.video.volume - LTV.DEFAULTS.duckVolume) < 1e-9);
  t.clock.advance(800);
  assert.equal(t.video.volume, 1);
  assert.ok(t.lines.includes(0));
  t.dubber.stop();
});

test("chờ câu trước đọc xong rồi đọc ngay câu kế (trễ nhỏ)", async () => {
  const t = setup();
  t.dubber.start();
  t.play(1100);
  t.play(2300); // 3.4s: câu 2 đã bắt đầu, câu 1 vẫn đang đọc
  assert.equal(t.speech.calls.length, 1);
  await t.speech.finish();
  assert.equal(t.speech.calls.length, 2);
  assert.equal(t.speech.calls[1].text, "Câu thứ hai.");
  // Khung còn lại ngắn hơn nên đọc nhanh hơn câu đầu hoặc bằng.
  assert.ok(t.speech.calls[1].rate >= t.speech.calls[0].rate);
  t.dubber.stop();
});

test("trễ quá 1.5 giây thì cắt câu cũ để bắt kịp", () => {
  const t = setup();
  t.dubber.start();
  t.play(1100);
  t.play(3700); // 4.8s: trễ 1.6s so với câu 2
  assert.equal(t.speech.calls.length, 2);
  assert.ok(t.speech.stops >= 1);
  assert.equal(t.speech.calls[1].text, "Câu thứ hai.");
  t.dubber.stop();
});

test("tua video thì dừng giọng; nhảy vào giữa câu đã quá muộn thì bỏ qua", () => {
  const t = setup();
  t.dubber.start();
  t.play(1100);
  assert.equal(t.speech.calls.length, 1);
  t.video.seeking = true;
  t.video.dispatchEvent(new Event("seeking"));
  assert.equal(t.speech.speaking, null);
  t.video.currentTime = 5.5; // 2.3s sau khi câu 2 bắt đầu (dài 2.8s) → quá muộn
  t.video.seeking = false;
  t.video.dispatchEvent(new Event("seeked"));
  assert.equal(t.speech.calls.length, 1);
  t.dubber.stop();
});

test("câu chưa dịch thì yêu cầu dịch thay vì đọc", () => {
  const t = setup({ translated: false });
  t.dubber.start();
  t.video.currentTime = 10.1;
  t.dubber.tick();
  assert.deepEqual(t.asked.slice(-1), [2]);
  assert.equal(t.speech.calls.length, 0);
  t.sentences[2].tr = "Câu thứ ba.";
  t.dubber.tick();
  assert.equal(t.speech.calls.length, 1);
  t.dubber.stop();
});

test("tạm dừng video thì dừng giọng; người dùng chỉnh âm lượng được tôn trọng", async () => {
  const t = setup();
  t.dubber.start();
  t.play(1100);
  t.play(300);
  t.video.volume = 0.5; // người dùng kéo âm lượng trong lúc đang giảm
  t.video.paused = true;
  t.video.dispatchEvent(new Event("pause"));
  assert.equal(t.speech.speaking, null);
  t.clock.advance(1000);
  assert.equal(t.video.volume, 0.5);
  t.dubber.stop();
  assert.equal(t.video.volume, 0.5);
});

test("activeIndex giữ câu đến khi câu sau bắt đầu", () => {
  const { activeIndex } = LTV.dubberInternals;
  const sentences = [
    { start: 1, end: 2 },
    { start: 5, end: 6 },
  ];
  assert.equal(activeIndex(sentences, 0.5), -1);
  assert.equal(activeIndex(sentences, 1), 0);
  assert.equal(activeIndex(sentences, 4.9), 0);
  assert.equal(activeIndex(sentences, 5), 1);
  assert.equal(activeIndex(sentences, 7.5), -1);
});

test("câu mới bắt đầu giữa lúc đang nâng âm lượng không làm trôi mức gốc", async () => {
  const t = setup({
    sentences: [
      { id: 0, start: 1, end: 2, text: "One.", tr: "Một." },
      { id: 1, start: 2.6, end: 4, text: "Two.", tr: "Hai." },
    ],
  });
  t.dubber.start();
  t.play(1100);
  t.play(900); // 2.0s
  await t.speech.finish(); // nâng âm lượng bắt đầu ở 2.45s, kéo dài 240ms
  t.play(500); // 2.5s: đang nâng dở
  assert.ok(t.video.volume > 0.15 && t.video.volume < 1);
  t.play(200); // 2.7s: câu 2 bắt đầu giữa lúc nâng
  assert.equal(t.speech.calls.length, 2);
  t.play(400);
  assert.ok(Math.abs(t.video.volume - LTV.DEFAULTS.duckVolume) < 1e-9);
  await t.speech.finish();
  t.clock.advance(1000);
  assert.equal(t.video.volume, 1);
  t.dubber.stop();
});
