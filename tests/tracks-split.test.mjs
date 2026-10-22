import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";

const { chooseTrack } = LTV.tracks;

test("chooseTrack dùng thẳng phụ đề tiếng Việt thủ công", () => {
  const result = chooseTrack(
    [
      { lang: "en", kind: "manual" },
      { lang: "vi", kind: "manual" },
    ],
    { sourceLang: "auto", targetLang: "vi" },
  );
  assert.equal(result.track.lang, "vi");
  assert.equal(result.needsTranslation, false);
});

test("chooseTrack ưu tiên phụ đề thủ công cùng ngôn ngữ giọng nói gốc", () => {
  const result = chooseTrack(
    [
      { lang: "en", kind: "manual" },
      { lang: "fr", kind: "asr" },
      { lang: "fr-FR", kind: "manual" },
      { lang: "vi", kind: "asr" },
    ],
    { sourceLang: "auto", targetLang: "vi" },
  );
  assert.equal(result.track.lang, "fr-FR");
  assert.equal(result.needsTranslation, true);
});

test("chooseTrack theo ngôn ngữ nguồn đã chọn, rơi về toàn bộ nếu không có", () => {
  const tracks = [
    { lang: "en", kind: "asr" },
    { lang: "ja", kind: "manual" },
  ];
  assert.equal(
    chooseTrack(tracks, { sourceLang: "en", targetLang: "vi" }).track.lang,
    "en",
  );
  assert.equal(
    chooseTrack(tracks, { sourceLang: "de", targetLang: "vi" }).track.lang,
    "ja",
  );
  assert.equal(chooseTrack([], { sourceLang: "auto", targetLang: "vi" }), null);
});

test("splitForTts giữ đoạn ≤ giới hạn, ưu tiên cắt ở dấu câu", () => {
  const sentence = "Quân Mã đi theo hình chữ L, nhảy qua các quân khác.";
  assert.deepEqual(LTV.splitForTts(sentence, 200), [sentence]);
  const long = `${sentence} ${sentence} ${sentence} ${sentence}`;
  const chunks = LTV.splitForTts(long, 60);
  assert.ok(chunks.length >= 4);
  for (const chunk of chunks) assert.ok(chunk.length <= 60, chunk);
  assert.equal(chunks.join(" "), long);
  const word = "x".repeat(130);
  assert.deepEqual(
    LTV.splitForTts(word, 60).map((c) => c.length),
    [60, 60, 10],
  );
  assert.deepEqual(LTV.splitForTts("   "), []);
});

test("mergeSettings loại giá trị sai kiểu và kẹp phạm vi", () => {
  const settings = LTV.mergeSettings({
    rate: 9,
    duckVolume: "x",
    translator: "bing",
    targetLang: "en",
    unknown: 1,
  });
  assert.equal(settings.rate, 2.5);
  assert.equal(settings.duckVolume, LTV.DEFAULTS.duckVolume);
  assert.equal(settings.translator, "google");
  assert.equal(settings.targetLang, "en");
  assert.equal("unknown" in settings, false);
  assert.equal(LTV.baseLang("en_US"), "en");
  assert.equal(LTV.baseLang("zh-Hans"), "zh-CN");
});
