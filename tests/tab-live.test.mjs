import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import { fakeClock, fakeSpeech } from "./fakes.mjs";
import "../src/content/live-dubber.js";
import "../src/content/tab-live.js";
import "../src/offscreen/tab-capture.js";
import { createTabLive } from "../src/background/tab-live.js";

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
