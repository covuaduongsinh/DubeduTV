import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/shared/record-math.js";
import { createRecorder } from "../src/background/recorder.js";

const LTV = globalThis.LTV;

test("cropRect đổi vùng video (px CSS) sang px của hình thu, toạ độ chẵn", () => {
  // Khung nhìn 1280×720 CSS, hình thu 1920×1080 (tỉ lệ 1,5).
  const crop = LTV.cropRect(
    { x: 101, y: 51, width: 853, height: 480 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  );
  assert.deepEqual(crop, { x: 150, y: 76, width: 1282, height: 720 });
  for (const value of Object.values(crop)) assert.equal(value % 2, 0);
});

test("cropRect: toàn màn hình lấy cả hình, tràn biên thì kẹp lại, quá nhỏ thì bỏ cắt", () => {
  const frame = { width: 1920, height: 1080 };
  const viewport = { width: 1920, height: 1080 };
  assert.deepEqual(
    LTV.cropRect({ x: 0, y: 0, width: 1920, height: 1080 }, viewport, frame),
    { x: 0, y: 0, width: 1920, height: 1080 },
  );
  // Video cuộn lên trên một nửa: chỉ lấy phần còn thấy.
  assert.deepEqual(
    LTV.cropRect({ x: 0, y: -300, width: 1920, height: 800 }, viewport, frame),
    { x: 0, y: 0, width: 1920, height: 500 },
  );
  assert.equal(
    LTV.cropRect({ x: 0, y: 1060, width: 300, height: 200 }, viewport, frame),
    null,
  );
  assert.equal(LTV.cropRect(null, viewport, frame), null);
  assert.equal(
    LTV.cropRect({ x: 0, y: 0, width: 10, height: 10 }, {}, frame),
    null,
  );
});

test("outputSize giữ tỉ lệ vùng cắt, cao bằng hình thu, tối đa 1920×1080", () => {
  assert.deepEqual(
    LTV.outputSize({ width: 1282, height: 722 }, { width: 1920, height: 1080 }),
    { width: 1918, height: 1080 },
  );
  // Video dọc (Shorts).
  assert.deepEqual(
    LTV.outputSize({ width: 608, height: 1080 }, { width: 1920, height: 1080 }),
    { width: 608, height: 1080 },
  );
  // Hình thu 4K: thu nhỏ về 1080p.
  assert.deepEqual(
    LTV.outputSize(
      { width: 3840, height: 2160 },
      { width: 3840, height: 2160 },
    ),
    { width: 1920, height: 1080 },
  );
});

test("fitRect đặt hình vào khung giữ tỉ lệ, chừa viền đen", () => {
  assert.deepEqual(
    LTV.fitRect({ width: 1000, height: 1000 }, { width: 1920, height: 1080 }),
    { x: 420, y: 0, width: 1080, height: 1080 },
  );
});

test("pickRecordType ưu tiên MP4 H.264, không có thì WebM", () => {
  const chrome = (type) =>
    type === "video/mp4;codecs=avc1,mp4a.40.2" || type.startsWith("video/webm");
  assert.equal(LTV.pickRecordType(chrome), "video/mp4;codecs=avc1,mp4a.40.2");
  const chromium = (type) => type.startsWith("video/webm");
  assert.equal(LTV.pickRecordType(chromium), "video/webm;codecs=vp9,opus");
  assert.equal(
    LTV.pickRecordType(() => {
      throw new Error("x");
    }),
    "",
  );
  assert.equal(LTV.recordExtension("video/mp4;codecs=avc1"), "mp4");
  assert.equal(LTV.recordExtension("video/webm;codecs=vp9"), "webm");
});

test("buildSrt dựng phụ đề theo giờ của file quay", () => {
  const startedAt = 1_000_000;
  const srt = LTV.buildSrt(
    [
      { at: startedAt + 1234, text: "Quân Mã nhảy hình chữ L." },
      { at: startedAt + 1300, text: "Quân Mã nhảy hình chữ L." },
      { at: startedAt + 4000, text: null },
      { at: startedAt + 4100, text: "Chớp qua khi tua" },
      { at: startedAt + 4150, text: "Nó nhảy qua quân khác." },
      { at: startedAt + 3_725_500, text: "Câu cuối" },
    ],
    { startedAt, endedAt: startedAt + 3_727_000 },
  );
  assert.equal(
    srt,
    [
      "1\n00:00:01,234 --> 00:00:04,000\nQuân Mã nhảy hình chữ L.\n",
      "2\n00:00:04,150 --> 01:02:05,500\nNó nhảy qua quân khác.\n",
      "3\n01:02:05,500 --> 01:02:07,000\nCâu cuối\n",
    ].join("\n"),
  );
  assert.equal(LTV.buildSrt([], { startedAt, endedAt: startedAt + 10 }), "");
});

test("recordingsToPrune giữ các bản mới nhất", () => {
  const list = [
    { id: "a", createdAt: 1 },
    { id: "c", createdAt: 3 },
    { id: "b", createdAt: 2 },
    { id: "d", createdAt: 4 },
  ];
  assert.deepEqual(LTV.recordingsToPrune(list, 2), ["b", "a"]);
  assert.deepEqual(LTV.recordingsToPrune(list, 5), []);
});

test("recordFileName bỏ đuôi YouTube và ký tự Windows không cho", () => {
  assert.equal(
    LTV.recordFileName('Knight: tips / tricks? "Pro" - YouTube', "mp4"),
    "Knight tips tricks Pro (lồng tiếng Việt).mp4",
  );
  assert.equal(LTV.recordFileName("", "webm"), "Video (lồng tiếng Việt).webm");
});

// Service worker: điều phối quay với chrome.* giả.
function fakeChrome({
  frameReply = { ok: true, layout: { rect: null } },
} = {}) {
  const store = {};
  const log = [];
  const session = {
    get: async (key) => ({ [key]: store[key] }),
    set: async (items) => Object.assign(store, items),
    remove: async (key) => delete store[key],
  };
  const tabs = {
    sendMessage: async (tabId, message, options) => {
      log.push(`frame ${tabId}:${options.frameId} ${message.type}`);
      return message.type === "ltv:record:begin" ? frameReply : { ok: true };
    },
    get: async (tabId) => ({ id: tabId, title: "Knight lesson - YouTube" }),
    create: async ({ url }) => log.push(`open ${url}`),
  };
  const runtime = {
    getURL: (path) => `chrome-extension://x/${path}`,
    sendMessage: async (message) => {
      log.push(`offscreen ${message.type}`);
      if (message.type === "rec:start")
        return {
          ok: true,
          startedAt: 1000,
          mimeType: "video/mp4",
          cropped: true,
        };
      if (message.type === "rec:stop")
        return { ok: true, id: "rec-1", voices: 3 };
      return undefined;
    },
  };
  const offscreenDoc = {
    ensure: async (options) => log.push(`ensure media=${options.media}`),
  };
  return { store, log, session, tabs, runtime, offscreenDoc };
}

test("quay video: bắt đầu ở khung đang lồng tiếng, dừng thì mở trang tải", async () => {
  const fake = fakeChrome();
  const recorder = createRecorder(fake);
  const started = await recorder.start({ tabId: 7, frameId: 2, streamId: "s" });
  assert.equal(started.tabId, 7);
  assert.equal(started.cropped, true);
  assert.deepEqual(await recorder.status(7), {
    active: true,
    busy: true,
    startedAt: 1000,
  });
  assert.equal(await recorder.isRecording(8), false);
  // Tin của khung khác bị bỏ; của khung đang quay thì chuyển cho offscreen.
  await recorder.fromFrame({ tabId: 7, frameId: 0 }, { type: "record:line" });
  await recorder.fromFrame(
    { tabId: 7, frameId: 2 },
    { type: "record:line", text: "Quân Mã", at: 1500 },
  );
  await recorder.fromFrame(
    { tabId: 7, frameId: 2 },
    { type: "record:layout", layout: { rect: null } },
  );
  const stopped = await recorder.stop();
  assert.equal(stopped.voices, 3);
  assert.equal(await recorder.isRecording(7), false);
  assert.deepEqual(fake.log, [
    "frame 7:2 ltv:record:begin",
    "ensure media=true",
    "offscreen rec:start",
    "frame 7:2 ltv:record:sync",
    "offscreen rec:line",
    "offscreen rec:layout",
    "frame 7:2 ltv:record:end",
    "offscreen rec:stop",
    "open chrome-extension://x/recorder/result.html?id=rec-1",
  ]);
});

test("quay video: báo rõ khi chưa lồng tiếng hoặc thẻ đang nghe cả thẻ", async () => {
  const noVideo = createRecorder(fakeChrome({ frameReply: null }));
  await assert.rejects(
    noVideo.start({ tabId: 1, frameId: 0, streamId: "s" }),
    /bật lồng tiếng rồi bấm quay/,
  );
  const live = createRecorder({
    ...fakeChrome(),
    isTabLive: async () => true,
  });
  await assert.rejects(
    live.start({ tabId: 1, frameId: 0, streamId: "s" }),
    /Nghe âm thanh cả thẻ/,
  );
});

test("quay video: video hết hoặc đóng thẻ thì tự dừng và mở trang tải", async () => {
  const fake = fakeChrome();
  const recorder = createRecorder(fake);
  await recorder.start({ tabId: 3, frameId: 0, streamId: "s" });
  await recorder.fromFrame({ tabId: 3, frameId: 0 }, { type: "record:ended" });
  assert.equal(await recorder.isRecording(3), false);
  assert.ok(fake.log.includes("offscreen rec:stop"));
  await recorder.start({ tabId: 4, frameId: 0, streamId: "s" });
  await recorder.stopIfTab(5);
  assert.equal(await recorder.isRecording(4), true);
  // Offscreen tự chốt khi hình của thẻ mất.
  await recorder.fromOffscreen({ event: "finished", id: "rec-9" });
  assert.equal(await recorder.isRecording(4), false);
  assert.equal(
    fake.log.at(-1),
    "open chrome-extension://x/recorder/result.html?id=rec-9",
  );
});
