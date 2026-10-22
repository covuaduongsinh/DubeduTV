import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";

const {
  parseVtt,
  parseYouTubeJson3,
  parseYouTubeXml,
  parseCaptions,
  parseTimestamp,
} = LTV.captions;

test("parseTimestamp đọc giờ, phút, giây và mili giây", () => {
  assert.equal(parseTimestamp("00:00:01.500"), 1.5);
  assert.equal(parseTimestamp("01:02.250"), 62.25);
  assert.equal(parseTimestamp("1:00:00,001"), 3600.001);
  assert.equal(parseTimestamp("abc"), null);
});

test("parseVtt bỏ header, NOTE, STYLE, thẻ, timestamp nội tuyến và giải mã thực thể", () => {
  const vtt = [
    "﻿WEBVTT",
    "Kind: captions",
    "",
    "NOTE ghi chú",
    "",
    "STYLE",
    "::cue { color: red }",
    "",
    "1",
    "00:00:01.000 --> 00:00:03.500 align:start position:0%",
    "<v Anna>Hello &amp; <c.yellow>welcome</c></v>",
    "to the <00:00:02.000><c>lesson</c>",
    "",
    "00:04.000 --> 00:06.000",
    "Tom&#39;s move &lt;e4&gt;",
  ].join("\r\n");
  assert.deepEqual(parseVtt(vtt), [
    { start: 1, end: 3.5, text: "Hello & welcome to the lesson" },
    { start: 4, end: 6, text: "Tom's move <e4>" },
  ]);
});

test("parseVtt đọc được SRT", () => {
  const srt =
    "1\n00:00:01,000 --> 00:00:02,000\nFirst\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond\n";
  assert.deepEqual(
    parseVtt(srt).map((cue) => cue.text),
    ["First", "Second"],
  );
});

test("parseYouTubeJson3 bỏ sự kiện trống và aAppend, ước lượng kết thúc theo từ", () => {
  const json3 = {
    events: [
      { tStartMs: 0, dDurationMs: 100000, id: 1, wpWinPosId: 1 },
      {
        tStartMs: 1000,
        dDurationMs: 5000,
        segs: [
          { utf8: "the" },
          { utf8: " knight", tOffsetMs: 400 },
          { utf8: " jumps", tOffsetMs: 900 },
        ],
      },
      { tStartMs: 3000, dDurationMs: 10, aAppend: 1, segs: [{ utf8: "\n" }] },
      { tStartMs: 6000, dDurationMs: 2000, segs: [{ utf8: "Manual line." }] },
    ],
  };
  const cues = parseYouTubeJson3(JSON.stringify(json3));
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0].text, "the knight jumps");
  assert.equal(cues[0].start, 1);
  // 1000 + 900 + (300 + 5*60) = 2500ms, nhỏ hơn thời lượng hiển thị 6000ms.
  assert.equal(cues[0].end, 2.5);
  assert.deepEqual(cues[1], { start: 6, end: 8, text: "Manual line." });
});

test("parseYouTubeXml đọc srv3 và srv1", () => {
  const srv3 =
    '<timedtext format="3"><body><p t="1500" d="2000">Hi <s t="200">there</s></p><p t="4000" d="1000" w="1">&amp;more</p></body></timedtext>';
  assert.deepEqual(parseYouTubeXml(srv3), [
    { start: 1.5, end: 3.5, text: "Hi there" },
    { start: 4, end: 5, text: "&more" },
  ]);
  const srv1 =
    '<transcript><text start="0.5" dur="1.25">It&amp;#39;s fine</text></transcript>';
  assert.deepEqual(parseYouTubeXml(srv1), [
    { start: 0.5, end: 1.75, text: "It's fine" },
  ]);
});

test("parseCaptions tự nhận diện định dạng và chịu được dữ liệu hỏng", () => {
  assert.equal(
    parseCaptions(
      '{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"a"}]}]}',
    ).length,
    1,
  );
  assert.equal(parseCaptions("WEBVTT\n\n00:01.000 --> 00:02.000\nx").length, 1);
  assert.deepEqual(parseCaptions("{broken"), []);
  assert.deepEqual(parseCaptions(""), []);
  assert.deepEqual(parseCaptions("plain text"), []);
});
