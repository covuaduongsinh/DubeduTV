import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import "../src/content/lib/hls.js";
import "../src/content/lib/drive-timedtext.js";
import "../src/shared/frame-probe.js";

const MASTER_URL =
  "https://video.twimg.com/ext_tw_video/999/pu/pl/master.m3u8?tag=12";

test("hls: thuộc tính có dấu phẩy trong ngoặc kép", () => {
  assert.deepEqual(
    LTV.hls.parseAttributes(
      'TYPE=SUBTITLES,NAME="English, CC",LANGUAGE="en",URI="subs/en.m3u8"',
    ),
    {
      TYPE: "SUBTITLES",
      NAME: "English, CC",
      LANGUAGE: "en",
      URI: "subs/en.m3u8",
    },
  );
});

test("hls: master playlist liệt kê phụ đề với URI tuyệt đối", () => {
  const master = LTV.hls.parseMaster(
    `#EXTM3U
#EXT-X-MEDIA:NAME="English",TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",DEFAULT=YES,URI="/ext_tw_video/999/pu/pl/subs/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=300000,SUBTITLES="subs"
avc1/480x270/a.m3u8`,
    MASTER_URL,
  );
  assert.equal(master.isMaster, true);
  assert.deepEqual(master.subtitles, [
    {
      lang: "en",
      label: "English",
      kind: "manual",
      uri: "https://video.twimg.com/ext_tw_video/999/pu/pl/subs/en.m3u8",
      isDefault: true,
    },
  ]);
});

test("hls: media playlist cộng dồn mốc bắt đầu các đoạn", () => {
  const segments = LTV.hls.parseMedia(
    "#EXTM3U\n#EXTINF:6.0,\nseg0.vtt\n#EXTINF:4.5,\nseg1.vtt\n#EXT-X-ENDLIST",
    "https://video.twimg.com/a/subs/en.m3u8",
  );
  assert.deepEqual(segments, [
    { uri: "https://video.twimg.com/a/subs/seg0.vtt", start: 0, duration: 6 },
    { uri: "https://video.twimg.com/a/subs/seg1.vtt", start: 6, duration: 4.5 },
  ]);
});

const vtt = (map, cues) =>
  `WEBVTT\n${map ? `X-TIMESTAMP-MAP=${map}\n` : ""}\n${cues.join("\n\n")}\n`;

test("hls: ghép đoạn – mốc tuyệt đối, cue vắt qua ranh giới chỉ giữ một", () => {
  const map = "MPEGTS:900000,LOCAL:00:00:00.000";
  const cues = LTV.hls.cuesFromSegments([
    {
      start: 0,
      text: vtt(map, [
        "00:00:01.000 --> 00:00:03.000\nHello",
        "00:00:09.000 --> 00:00:11.000\nAcross",
      ]),
    },
    {
      start: 10,
      text: vtt(map, [
        "00:00:09.000 --> 00:00:11.000\nAcross",
        "00:00:12.000 --> 00:00:14.000\nBye",
      ]),
    },
  ]);
  assert.deepEqual(
    cues.map((c) => [c.start, c.text]),
    [
      [1, "Hello"],
      [9, "Across"],
      [12, "Bye"],
    ],
  );
});

test("hls: đoạn có bản đồ thời gian riêng và đoạn ghi mốc tương đối", () => {
  const shifted = LTV.hls.cuesFromSegments([
    {
      start: 0,
      text: vtt("LOCAL:00:00:00.000,MPEGTS:900000", [
        "00:00:01.000 --> 00:00:02.000\nA",
      ]),
    },
    {
      start: 10,
      text: vtt("MPEGTS:1800000,LOCAL:00:00:00.000", [
        "00:00:00.500 --> 00:00:02.000\nB",
      ]),
    },
  ]);
  assert.deepEqual(
    shifted.map((c) => c.start),
    [1, 10.5],
  );
  const relative = LTV.hls.cuesFromSegments([
    { start: 0, text: vtt(null, ["00:00:01.000 --> 00:00:02.000\nA"]) },
    { start: 20, text: vtt(null, ["00:00:01.000 --> 00:00:02.000\nB"]) },
  ]);
  assert.deepEqual(
    relative.map((c) => c.start),
    [1, 21],
  );
});

test("hls: mã media trong ảnh bìa / playlist của X", () => {
  assert.equal(
    LTV.hls.mediaIdFromUrl(
      "https://pbs.twimg.com/ext_tw_video_thumb/1799/pu/img/x.jpg",
    ),
    "1799",
  );
  assert.equal(
    LTV.hls.mediaIdFromUrl(
      "https://video.twimg.com/amplify_video/42/pl/master.m3u8",
    ),
    "42",
  );
  assert.equal(
    LTV.hls.mediaIdFromUrl("https://pbs.twimg.com/media/abc.jpg"),
    null,
  );
});

test("drive: dựng URL danh sách và track từ địa chỉ timedtext gốc", () => {
  const { listUrl, trackUrl, isTimedtextUrl, fileIdFromPath, ttsUrlFrom } =
    LTV.driveTimedtext;
  const base =
    "https://drive.google.com/u/0/timedtext?id=v1&vid=x&type=track&lang=fr&name=&fmt=json3";
  assert.equal(
    listUrl(base),
    "https://drive.google.com/u/0/timedtext?id=v1&vid=x&type=list",
  );
  assert.equal(
    trackUrl(base, { lang: "en", name: "", kind: "asr" }, "json3"),
    "https://drive.google.com/u/0/timedtext?id=v1&vid=x&type=track&lang=en&name=&kind=asr&fmt=json3",
  );
  assert.equal(isTimedtextUrl(base, "https://drive.google.com"), true);
  assert.equal(
    isTimedtextUrl(
      "https://drive.google.com/file/d/1/view",
      "https://drive.google.com",
    ),
    false,
  );
  assert.equal(isTimedtextUrl(base, "https://evil.example"), false);
  assert.equal(fileIdFromPath("/file/d/1AbC_d-9/view"), "1AbC_d-9");
  assert.equal(
    ttsUrlFrom(
      "https://youtube.googleapis.com/embed/?docid=1&ttsurl=https%3A%2F%2Fdrive.google.com%2Ftimedtext%3Fid%3D1",
    ),
    "https://drive.google.com/timedtext?id=1",
  );
});

test("drive: đọc danh sách track XML", () => {
  const tracks = LTV.driveTimedtext.parseTrackList(
    `<transcript_list><track id="0" name="" lang_code="en" lang_original="English" lang_translated="English"/>
    <track id="1" name="CC &amp; notes" lang_code="vi" kind="asr" lang_translated="Tiếng Việt"/></transcript_list>`,
  );
  assert.deepEqual(tracks, [
    { lang: "en", name: "", kind: "manual", label: "English" },
    { lang: "vi", name: "CC & notes", kind: "asr", label: "Tiếng Việt" },
  ]);
  assert.equal(LTV.DRIVE_ORIGINS.parent.test("https://drive.google.com"), true);
  assert.equal(
    LTV.DRIVE_ORIGINS.child.test("https://youtube.googleapis.com.evil.com"),
    false,
  );
});

test("chọn khung: đang lồng tiếng → có video lớn nhất → trang chính", () => {
  const frame = (frameId, info) => ({ frameId, info });
  assert.equal(LTV.chooseFrame([]), null);
  assert.equal(
    LTV.chooseFrame([
      frame(0, { onVideo: true, area: 100 }),
      frame(3, { onVideo: true, active: true, area: 50 }),
    ]),
    3,
  );
  assert.equal(
    LTV.chooseFrame([
      frame(0, { onVideo: false }),
      frame(5, { onVideo: true, area: 10 }),
      frame(7, { onVideo: true, area: 90 }),
    ]),
    7,
  );
  assert.equal(LTV.chooseFrame([frame(4, {}), frame(0, {})]), 0);
});

test("frame probe: chỉ nhận trả lời đúng nonce và đúng thẻ", async () => {
  let listener = null;
  let sent = null;
  const probe = LTV.createFrameProbe({
    runtime: { onMessage: { addListener: (fn) => (listener = fn) } },
    tabs: {
      sendMessage: async (tabId, message) => {
        sent = message;
        listener(
          {
            type: "ltv:frameInfo",
            nonce: message.nonce,
            info: { onVideo: true },
          },
          { tab: { id: tabId }, frameId: 2 },
        );
        listener(
          { type: "ltv:frameInfo", nonce: message.nonce, info: {} },
          { tab: { id: 99 }, frameId: 0 },
        );
        listener(
          { type: "ltv:frameInfo", nonce: "other", info: {} },
          { tab: { id: tabId }, frameId: 1 },
        );
      },
    },
  });
  const frames = await probe.probe(7, 10);
  assert.equal(sent.type, "ltv:probe");
  assert.deepEqual(frames, [{ frameId: 2, info: { onVideo: true } }]);
});
