import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import { fakeClock, fakeSpeech } from "./fakes.mjs";
import "../src/content/live-dubber.js";
import "../src/content/tab-linked.js";
import "../src/content/tab-live.js";
import "../src/offscreen/tab-capture.js";
import { createTabLive } from "../src/background/tab-live.js";
import { createMediaLink } from "../src/background/media-link.js";

function fakeAudioContext({ running = true } = {}) {
  const log = [];
  class Context {
    constructor() {
      this.state = "suspended";
      this.currentTime = 1.5;
      this.destination = { name: "destination" };
    }
    async resume() {
      if (running) this.state = "running";
    }
    async close() {
      log.push("close");
    }
    createMediaStreamSource() {
      return { connect: (node) => (log.push("source→gain"), node) };
    }
    createGain() {
      const gain = {
        gain: {
          setTargetAtTime: (value, at) => log.push(`gain ${value}@${at}`),
        },
        connect: (node) => (log.push(`gain→${node.name}`), node),
      };
      return gain;
    }
  }
  return { Context, log };
}

test("thu cả thẻ: phát lại âm thanh thẻ qua GainNode, đặt mức giảm", async () => {
  const { Context, log } = fakeAudioContext();
  const graph = await LTV.createTabAudioGraph({}, Context);
  graph.setGain(0.15);
  graph.setGain(7);
  await graph.close();
  assert.deepEqual(log, [
    "source→gain",
    "gain→destination",
    "gain 0.15@1.5",
    "gain 1@1.5",
    "close",
  ]);
});

test("thu cả thẻ: AudioContext không chạy thì báo lỗi (thẻ không bị câm)", async () => {
  const { Context, log } = fakeAudioContext({ running: false });
  await assert.rejects(LTV.createTabAudioGraph({}, Context), /Không phát lại/);
  assert.ok(log.includes("close"));
});

test("video giả của thẻ: đọc song song làm giảm rồi trả tiếng gốc qua gain", async () => {
  const clock = fakeClock();
  const gains = [];
  const video = LTV.createTabVideo({
    startedAt: Date.now(),
    onVolume: (value) => gains.push(Math.round(value * 100) / 100),
  });
  const speech = fakeSpeech();
  const settings = LTV.mergeSettings({ liveMode: "parallel", duckVolume: 0.2 });
  const dubber = LTV.createLiveDubber({
    video,
    speech,
    getSettings: () => settings,
    lang: "vi",
    clock,
  });
  dubber.start();
  dubber.push({ start: 0, end: 1, tr: "xin chào" });
  clock.advance(1000);
  assert.equal(gains.at(-1), 0.2);
  speech.finish({ ok: true, event: "end" });
  await new Promise((resolve) => setImmediate(resolve));
  clock.advance(3000);
  assert.equal(gains.at(-1), 1);
  dubber.stop();
});

function fakeChrome({
  pingOkAfter = 0,
  startReply = { ok: true, startedAt: 1000 },
} = {}) {
  const store = {};
  const sent = [];
  const runtimeSent = [];
  let pings = 0;
  return {
    sent,
    runtimeSent,
    session: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (values) => Object.assign(store, values),
      remove: async (key) => delete store[key],
    },
    tabs: {
      sendMessage: async (tabId, message, options) => {
        sent.push({ tabId, message, frameId: options?.frameId });
        if (message.type === "ltv:ping") {
          pings += 1;
          if (pings <= pingOkAfter) throw new Error("no receiver");
          return { ok: true };
        }
        if (
          message.type === "ltv:tabLive" &&
          message.event === "segment" &&
          tabId === 66
        )
          throw new Error("gone");
        return undefined;
      },
    },
    runtime: {
      sendMessage: async (message) => {
        runtimeSent.push(message);
        return message.type === "tab:start" ? startReply : undefined;
      },
    },
  };
}

function coordinator(fake, extra = {}) {
  const injected = [];
  const ensured = [];
  const live = createTabLive({
    offscreenDoc: { ensure: async (options) => ensured.push(options) },
    injectTopFrame: async (tabId) => injected.push(tabId),
    readSettings: async () =>
      LTV.mergeSettings({ asrLang: "auto", asrEngine: "whisper" }),
    hasWhisperKey: async () => false,
    tabs: fake.tabs,
    runtime: fake.runtime,
    session: fake.session,
    ...extra,
  });
  return { live, injected, ensured };
}

test("điều phối nghe cả thẻ: nạp script khi trang chưa có, tạm dừng khung, báo trang chính", async () => {
  const fake = fakeChrome({ pingOkAfter: 1 });
  const { live, injected, ensured } = coordinator(fake);
  const state = await live.start({ tabId: 7, streamId: "S" });
  assert.deepEqual(injected, [7]);
  assert.deepEqual(ensured, [{ media: true }]);
  assert.deepEqual(state, {
    tabId: 7,
    startedAt: 1000,
    lang: "en-US",
    engine: "chrome",
    frameId: 0,
    linked: false,
    key: "",
  });
  const start = fake.runtimeSent.find((m) => m.type === "tab:start");
  assert.deepEqual(start, {
    target: "offscreen",
    type: "tab:start",
    streamId: "S",
    lang: "en-US",
    engine: "chrome",
  });
  assert.ok(
    fake.sent.some(
      (s) => s.message.type === "ltv:pause" && s.frameId === undefined,
    ),
  );
  assert.ok(
    fake.sent.some((s) => s.message.event === "started" && s.frameId === 0),
  );
  assert.deepEqual(await live.status(7), { active: true, tabId: 7 });
  assert.deepEqual(await live.status(8), { active: false, tabId: 7 });
});

test("điều phối nghe cả thẻ: chỉ thẻ đang nghe chỉnh được gain; mất trang thì dừng", async () => {
  const fake = fakeChrome();
  const { live } = coordinator(fake);
  await live.start({ tabId: 66, streamId: "S" });
  await live.gain(5, 0.1);
  await live.gain(66, 0.2);
  const gains = fake.runtimeSent.filter((m) => m.type === "tab:gain");
  assert.deepEqual(
    gains.map((m) => m.value),
    [0.2],
  );
  await live.relay({
    target: "background",
    type: "tabLive:event",
    event: "segment",
    segment: {},
  });
  assert.equal((await live.status(66)).active, true);
  const relayed = fake.sent.find((s) => s.message.event === "segment");
  assert.equal(relayed.message.type, "ltv:tabLive");
  await live.relay({ event: "segment", segment: {} });
  assert.equal((await live.status(66)).active, false);
  assert.ok(fake.runtimeSent.some((m) => m.type === "tab:stop"));
});

test("điều phối nghe cả thẻ: offscreen lỗi thì báo lỗi, không ghi trạng thái", async () => {
  const fake = fakeChrome({
    startReply: { ok: false, error: "Thẻ này không có âm thanh" },
  });
  const { live } = coordinator(fake);
  await assert.rejects(
    live.start({ tabId: 3, streamId: "S" }),
    /không có âm thanh/,
  );
  assert.equal((await live.status(3)).active, false);
});

test("tìm khung có video: nạp script vào khung chưa có, chọn video lớn nhất", async () => {
  const calls = [];
  const scripting = {
    executeScript: async ({ target, func, files }) => {
      calls.push({ target, func: func?.name, files });
      if (func?.name === "bundleLoaded")
        return [
          { frameId: 0, result: true },
          { frameId: 3, result: false },
        ];
      if (func?.name === "mediaInfo")
        return [
          { frameId: 0, result: { area: 100, key: "html5:top" } },
          { frameId: 3, result: { area: 5000, key: "html5:frame" } },
          { frameId: 4, result: null },
        ];
      return [];
    },
  };
  const link = createMediaLink({ scripting, bundleFiles: () => ["a.js"] });
  assert.deepEqual(await link.find(9), { frameId: 3, key: "html5:frame" });
  assert.deepEqual(calls[1], {
    target: { tabId: 9, frameIds: [3] },
    func: undefined,
    files: ["a.js"],
  });
  const none = createMediaLink({
    scripting: {
      executeScript: async () => {
        throw new Error("no access");
      },
    },
    bundleFiles: () => [],
  });
  assert.equal(await none.find(9), null);
});

test("điều phối nghe cả thẻ: có video thật thì gửi lời chép tới khung đó; có lời chép thì đọc lại", async () => {
  const fake = fakeChrome();
  const { live } = coordinator(fake, {
    findMedia: async () => ({ frameId: 5, key: "html5:frame" }),
  });
  const state = await live.start({ tabId: 7, streamId: "S" });
  assert.equal(state.linked, true);
  assert.equal(state.key, "html5:frame");
  assert.ok(
    fake.sent.some((s) => s.message.event === "started" && s.frameId === 5),
  );
  await live.relay({
    event: "segment",
    segment: { start: 1, end: 2, text: "a" },
  });
  assert.equal(fake.sent.at(-1).frameId, 5);
  const again = fakeChrome();
  const replaying = coordinator(again, {
    findMedia: async () => ({ frameId: 5, key: "html5:frame" }),
    hasTranscript: async (key) => key === "html5:frame",
  });
  assert.deepEqual(await replaying.live.start({ tabId: 7, streamId: "S" }), {
    tabId: 7,
    replay: true,
  });
  assert.ok(
    again.sent.some(
      (s) =>
        s.message.type === "ltv:toggle" && s.message.force && s.frameId === 5,
    ),
  );
  assert.equal(again.runtimeSent.length, 0);
  assert.equal((await replaying.live.status(7)).active, false);
});

test("quy đổi thời gian thu → thời gian video theo các lần phát/dừng/tua", () => {
  const video = new EventTarget();
  Object.assign(video, {
    currentTime: 0,
    paused: false,
    seeking: false,
    ended: false,
    playbackRate: 1,
  });
  let capture = 0;
  const map = LTV.createTimeMap({ video, now: () => capture });
  const at = (seconds, change) => {
    capture = seconds;
    Object.assign(video, change);
    video.dispatchEvent(new Event(change.paused ? "pause" : "play"));
  };
  at(3, { currentTime: 3, paused: true });
  at(5, { currentTime: 3, paused: false });
  at(8, { currentTime: 30, paused: false, playbackRate: 2 });
  assert.equal(map.toVideo(2), 2);
  assert.equal(map.toVideo(4), 3);
  assert.equal(map.toVideo(6), 4);
  assert.equal(map.toVideo(9), 32);
  map.dispose();
});
