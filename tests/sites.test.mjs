import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";

const { signedTrackUrl, signedSources } = LTV.ytTimedtext;
const CAPTURED =
  "https://www.youtube.com/api/timedtext?v=abc123&ei=E&caps=asr&opi=1&xoaf=5&lang=fr&name=Fr&fmt=srv3&pot=POT&signature=SIG&sparams=ip";

test("timedtext: ghép tham số đã ký với track cần tải", () => {
  const url = new URL(
    signedTrackUrl({
      capturedUrl: CAPTURED,
      track: {
        baseUrl:
          "https://www.youtube.com/api/timedtext?v=abc123&lang=en&kind=asr",
        lang: "en",
        kind: "asr",
      },
      videoId: "abc123",
    }),
  );
  const params = url.searchParams;
  assert.equal(params.get("pot"), "POT");
  assert.equal(params.get("signature"), "SIG");
  assert.equal(params.get("sparams"), "ip");
  assert.equal(params.get("lang"), "en");
  assert.equal(params.get("kind"), "asr");
  assert.equal(params.get("name"), null);
  assert.equal(params.get("fmt"), "json3");
});

test("timedtext: track không có baseUrl (trang nhúng) dùng lang/kind của track", () => {
  const url = new URL(
    signedTrackUrl({
      capturedUrl: CAPTURED,
      track: { lang: "de", kind: "manual" },
      videoId: "abc123",
    }),
  );
  assert.equal(url.searchParams.get("lang"), "de");
  assert.equal(url.searchParams.has("kind"), false);
});

test("timedtext: video khác hoặc thiếu v thì không dùng", () => {
  const track = { lang: "en", kind: "asr" };
  assert.equal(
    signedTrackUrl({ capturedUrl: CAPTURED, track, videoId: "other" }),
    null,
  );
  assert.equal(
    signedTrackUrl({
      capturedUrl: "https://www.youtube.com/api/timedtext?lang=en&pot=P",
      track,
      videoId: "abc123",
    }),
    null,
  );
});

test("timedtext: nguồn đã ký mới nhất trước, bỏ URL chưa ký", () => {
  const bridge = {
    captures: () => [
      { kind: "timedtext", url: CAPTURED, at: 1 },
      {
        kind: "timedtext",
        url: "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
        at: 5,
      },
    ],
    resources: () => [
      { kind: "timedtext", url: `${CAPTURED}&x=2`, at: 3 },
      { kind: "hls", url: "https://video.twimg.com/a.m3u8", at: 9 },
    ],
  };
  assert.deepEqual(signedSources(bridge, "abc123"), [
    `${CAPTURED}&x=2`,
    CAPTURED,
  ]);
});
