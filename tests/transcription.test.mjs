import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWhisperForm,
  parseWhisperResponse,
  testWhisperKey,
  transcribeWhisper,
} from "../src/background/transcribe-whisper.js";
import {
  coverage,
  createTranscriptStore,
  mergeCues,
} from "../src/background/transcripts.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

test("buildWhisperForm gửi verbose_json, mốc theo đoạn, ngôn ngữ và prompt", () => {
  const form = buildWhisperForm({
    audio: new Blob(["x"], { type: "audio/webm" }),
    mime: "audio/webm;codecs=opus",
    lang: "en-US",
    prompt: "a".repeat(300),
    model: "whisper-large-v3-turbo",
  });
  assert.equal(form.get("model"), "whisper-large-v3-turbo");
  assert.equal(form.get("response_format"), "verbose_json");
  assert.equal(form.get("timestamp_granularities[]"), "segment");
  assert.equal(form.get("language"), "en");
  assert.equal(form.get("prompt").length, 200);
  assert.equal(form.get("file").name, "chunk.webm");
  const auto = buildWhisperForm({
    audio: new Blob(["x"]),
    lang: "auto",
    model: "m",
  });
  assert.equal(auto.get("language"), null);
});

test("parseWhisperResponse lọc đoạn im lặng và câu ảo giác", () => {
  const result = parseWhisperResponse({
    language: "english",
    segments: [
      {
        start: 0,
        end: 2.5,
        text: " The knight moves in an L shape. ",
        no_speech_prob: 0.01,
      },
      {
        start: 2.5,
        end: 4,
        text: "Thank you for watching!",
        no_speech_prob: 0.2,
      },
      { start: 4, end: 6, text: "hmm", no_speech_prob: 0.9 },
      { start: 6, end: 8, text: "  " },
      { start: 8, end: 9.5, text: "It jumps over pieces." },
    ],
  });
  assert.equal(result.language, "english");
  assert.deepEqual(result.segments, [
    { start: 0, end: 2.5, text: "The knight moves in an L shape." },
    { start: 8, end: 9.5, text: "It jumps over pieces." },
  ]);
  assert.deepEqual(
    parseWhisperResponse({ text: "Hello there", duration: 3 }).segments,
    [{ start: 0, end: 3, text: "Hello there" }],
  );
});

test("transcribeWhisper gọi đúng endpoint, thử lại khi 429, báo lỗi key", async () => {
  const calls = [];
  let attempts = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, body: init.body });
    attempts += 1;
    if (attempts === 1) return jsonResponse({}, 429);
    return jsonResponse({ segments: [{ start: 0, end: 1, text: "Hi" }] });
  };
  const result = await transcribeWhisper({
    audio: new Blob(["x"]),
    mime: "audio/webm",
    lang: "en",
    provider: "groq",
    apiKey: "gsk_test",
    fetchImpl,
    retryDelay: 1,
  });
  assert.deepEqual(result.segments, [{ start: 0, end: 1, text: "Hi" }]);
  assert.equal(
    calls[0].url,
    "https://api.groq.com/openai/v1/audio/transcriptions",
  );
  assert.equal(calls[0].auth, "Bearer gsk_test");
  assert.ok(calls[0].body instanceof FormData);
  const openai = [];
  await transcribeWhisper({
    audio: new Blob(["x"]),
    provider: "openai",
    apiKey: "sk",
    fetchImpl: async (url, init) => {
      openai.push([url, init.body.get("model")]);
      return jsonResponse({ segments: [] });
    },
  });
  assert.deepEqual(openai, [
    ["https://api.openai.com/v1/audio/transcriptions", "whisper-1"],
  ]);
  await assert.rejects(
    transcribeWhisper({
      audio: new Blob(["x"]),
      apiKey: "bad",
      fetchImpl: async () =>
        jsonResponse({ error: { message: "Invalid API Key" } }, 401),
    }),
    /API key Whisper không hợp lệ/,
  );
  await assert.rejects(
    transcribeWhisper({ audio: new Blob(["x"]), apiKey: "" }),
    /Chưa nhập/,
  );
  await assert.rejects(
    testWhisperKey({
      apiKey: "bad",
      fetchImpl: async () => jsonResponse({}, 401),
    }),
    /không hợp lệ/,
  );
  assert.equal(
    await testWhisperKey({
      apiKey: "ok",
      fetchImpl: async () => jsonResponse({ data: [] }),
    }),
    true,
  );
});

test("mergeCues bỏ đoạn trùng khi xem lại và sắp theo thời gian", () => {
  const merged = mergeCues(
    [
      { start: 0, end: 3, text: "One." },
      { start: 10, end: 12, text: "Three." },
    ],
    [
      { start: 0.4, end: 3.2, text: "One again." },
      { start: 4, end: 7, text: "Two." },
      { start: 5, end: 4, text: "bad" },
      { start: 8, end: 9, text: "  " },
    ],
  );
  assert.deepEqual(
    merged.map((cue) => cue.text),
    ["One.", "Two.", "Three."],
  );
});

test("coverage tính phần thời lượng có lời chép", () => {
  const cues = [
    { start: 0, end: 8, text: "a" },
    { start: 9, end: 18, text: "b" },
  ];
  assert.equal(coverage(cues, 20), 1);
  assert.equal(coverage(cues, 40), 0.5);
  assert.equal(coverage([], 10), 0);
  assert.equal(coverage(cues, 0), 0);
});

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        list.filter((key) => key in data).map((key) => [key, data[key]]),
      );
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

test("kho lời chép gộp theo video, tính độ phủ và loại video cũ", async () => {
  const storage = memoryStorage();
  const store = createTranscriptStore({ storage, max: 2 });
  await store.put("yt:a", {
    lang: "en-US",
    engine: "chrome",
    duration: 20,
    cues: [{ start: 0, end: 8, text: "a" }],
  });
  await store.put("yt:a", {
    duration: 20,
    cues: [{ start: 9, end: 18, text: "b" }],
  });
  const entry = await store.get("yt:a");
  assert.equal(entry.cues.length, 2);
  assert.equal(entry.lang, "en-US");
  assert.equal(entry.coverage, 1);
  await new Promise((resolve) => setTimeout(resolve, 3));
  await store.put("yt:b", {
    duration: 5,
    cues: [{ start: 0, end: 1, text: "x" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 3));
  await store.put("yt:c", {
    duration: 5,
    cues: [{ start: 0, end: 1, text: "y" }],
  });
  assert.equal(await store.get("yt:a"), null);
  assert.equal(await store.count(), 2);
  await store.clear();
  assert.equal(await store.count(), 0);
});
