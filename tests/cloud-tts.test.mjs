import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import "../src/shared/cloud-voices.js";
import "../src/content/voice-fallback.js";
import {
  buildAzureRequest,
  buildGoogleRequest,
  createCloudSpeech,
  listCloudVoices,
  normalizeVoices,
  synthesizeCloud,
} from "../src/background/tts-cloud.js";
import { createSpeech } from "../src/background/tts.js";
import { createFetchGuard } from "../src/background/fetch-guard.js";

function response(status, { bytes, json, text = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer,
    json: async () => json,
    text: async () => (json ? JSON.stringify(json) : text),
  };
}

const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3]);
const WAV_BASE64 = Buffer.from("RIFF....WAVEfmt ").toString("base64");

test("giọng AI: SSML của Azure có escape, header đúng; Google gửi key trong header", () => {
  const azure = buildAzureRequest({
    key: "K",
    name: "vi-VN-HoaiMyNeural",
    locale: "vi-VN",
    text: 'Tốt <e4> & "Mã"',
  });
  assert.equal(azure.path, "/cognitiveservices/v1");
  assert.equal(azure.init.headers["Ocp-Apim-Subscription-Key"], "K");
  assert.equal(
    azure.init.headers["X-Microsoft-OutputFormat"],
    "audio-24khz-48kbitrate-mono-mp3",
  );
  assert.match(azure.init.body, /xml:lang="vi-VN"/);
  assert.match(azure.init.body, /<voice name="vi-VN-HoaiMyNeural">/);
  assert.match(azure.init.body, /Tốt &lt;e4&gt; &amp; &quot;Mã&quot;/);
  const google = buildGoogleRequest({
    key: "G",
    name: null,
    locale: "vi-VN",
    text: "Xin chào",
  });
  assert.equal(google.path, "/v1/text:synthesize");
  assert.equal(google.init.headers["x-goog-api-key"], "G");
  assert.deepEqual(JSON.parse(google.init.body), {
    input: { text: "Xin chào" },
    voice: { languageCode: "vi-VN" },
    audioConfig: { audioEncoding: "MP3" },
  });
});

test("giọng AI: chọn giọng đúng ngôn ngữ đích, không thì giọng mặc định", () => {
  const voices = [
    { name: "vi-VN-Standard-A", locale: "vi-VN" },
    { name: "vi-VN-Wavenet-B", locale: "vi-VN" },
    { name: "en-US-Neural2-C", locale: "en-US" },
  ];
  const resolve = (engine, voice, lang) =>
    LTV.cloudVoices.resolve({ engine, voice, lang, voices });
  assert.deepEqual(resolve("azure", "vi-VN-NamMinhNeural", "vi"), {
    locale: "vi-VN",
    name: "vi-VN-NamMinhNeural",
  });
  assert.equal(
    resolve("azure", "vi-VN-NamMinhNeural", "en").name,
    "en-US-JennyNeural",
  );
  assert.equal(resolve("gcloud", "", "vi").name, "vi-VN-Wavenet-B");
  assert.equal(resolve("gcloud", "", "ja").name, null);
  assert.equal(resolve("gcloud", "", "zh-CN").locale, "cmn-CN");
  assert.equal(resolve("azure", "", "xx").locale, null);
});

test("giọng AI: Azure trả MP3 dạng base64; Google giữ nguyên audioContent", async () => {
  const calls = [];
  const azure = await synthesizeCloud({
    engine: "azure",
    key: "K",
    region: "southeastasia",
    voice: "",
    lang: "vi",
    text: "Xin chào",
    fetchImpl: async (url) => {
      calls.push(url);
      return response(200, { bytes: MP3 });
    },
  });
  assert.equal(
    calls[0],
    "https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1",
  );
  assert.equal(azure.mime, "audio/mpeg");
  assert.deepEqual(Buffer.from(azure.audio, "base64"), Buffer.from(MP3));
  const google = await synthesizeCloud({
    engine: "gcloud",
    key: "G",
    lang: "vi",
    text: "Xin chào",
    fetchImpl: async (url) => {
      calls.push(url);
      return response(200, { json: { audioContent: WAV_BASE64 } });
    },
  });
  assert.equal(
    calls[1],
    "https://texttospeech.googleapis.com/v1/text:synthesize",
  );
  assert.deepEqual(google, { audio: WAV_BASE64, mime: "audio/wav" });
});

test("giọng AI: key sai báo code auth (Azure 401, Google 400 API_KEY_INVALID); 429 thì thử lại", async () => {
  const azure = synthesizeCloud({
    engine: "azure",
    key: "bad",
    region: "eastus",
    lang: "vi",
    text: "a",
    fetchImpl: async () => response(401),
  });
  await assert.rejects(azure, (error) => {
    assert.equal(error.code, "auth");
    assert.match(error.message, /API key Azure không hợp lệ hoặc sai vùng/);
    return true;
  });
  const invalid = {
    error: {
      code: 400,
      message: "API key not valid. Please pass a valid API key.",
      details: [{ reason: "API_KEY_INVALID" }],
    },
  };
  await assert.rejects(
    synthesizeCloud({
      engine: "gcloud",
      key: "bad",
      lang: "vi",
      text: "a",
      fetchImpl: async () => response(400, { json: invalid }),
    }),
    (error) => error.code === "auth" && /API key not valid/.test(error.message),
  );
  let attempts = 0;
  const retried = await synthesizeCloud({
    engine: "azure",
    key: "K",
    region: "eastus",
    lang: "vi",
    text: "a",
    retryDelay: 0,
    fetchImpl: async () =>
      (attempts += 1) < 2 ? response(429) : response(200, { bytes: MP3 }),
  });
  assert.equal(attempts, 2);
  assert.equal(retried.mime, "audio/mpeg");
  await assert.rejects(
    synthesizeCloud({ engine: "gcloud", key: "", lang: "vi", text: "a" }),
    (error) => error.code === "auth",
  );
});

test("giọng AI: chuẩn hoá danh sách giọng, chỉ giữ ngôn ngữ hỗ trợ", async () => {
  const azure = normalizeVoices("azure", [
    {
      ShortName: "vi-VN-NamMinhNeural",
      LocalName: "Nam Minh",
      Gender: "Male",
      Locale: "vi-VN",
    },
    {
      ShortName: "sw-KE-ZuriNeural",
      LocalName: "Zuri",
      Gender: "Female",
      Locale: "sw-KE",
    },
  ]);
  assert.deepEqual(azure, [
    { name: "vi-VN-NamMinhNeural", label: "Nam Minh (nam)", locale: "vi-VN" },
  ]);
  const seen = [];
  const google = await listCloudVoices({
    engine: "gcloud",
    key: "G",
    fetchImpl: async (url, init) => {
      seen.push([url, init.headers["x-goog-api-key"]]);
      return response(200, {
        json: {
          voices: [
            {
              name: "vi-VN-Neural2-A",
              languageCodes: ["vi-VN"],
              ssmlGender: "FEMALE",
            },
            {
              name: "cmn-CN-Wavenet-A",
              languageCodes: ["cmn-CN"],
              ssmlGender: "FEMALE",
            },
            {
              name: "af-ZA-Standard-A",
              languageCodes: ["af-ZA"],
              ssmlGender: "FEMALE",
            },
          ],
        },
      });
    },
  });
  assert.deepEqual(seen, [
    ["https://texttospeech.googleapis.com/v1/voices", "G"],
  ]);
  assert.deepEqual(
    google.map((voice) => voice.label),
    ["Neural2-A (nữ)", "Wavenet-A (nữ)"],
  );
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => {
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(
        list.filter((k) => k in data).map((k) => [k, data[k]]),
      );
    },
    set: async (values) => Object.assign(data, values),
  };
}

test("giọng AI ở service worker: dùng key, vùng, giọng đã lưu; kiểm tra key lưu danh sách giọng", async () => {
  const storage = fakeStorage({ azureTtsKey: "K" });
  const urls = [];
  const cloud = createCloudSpeech({
    storage,
    readSettings: async () => LTV.mergeSettings({ azureRegion: "japaneast" }),
    fetchImpl: async (url, init) => {
      urls.push(url);
      if (url.endsWith("/voices/list"))
        return response(200, {
          json: [
            {
              ShortName: "vi-VN-HoaiMyNeural",
              LocalName: "Hoài My",
              Gender: "Female",
              Locale: "vi-VN",
            },
          ],
        });
      assert.match(init.body, /vi-VN-HoaiMyNeural/);
      return response(200, { bytes: MP3 });
    },
  });
  const ok = await cloud.synthesize({
    engine: "azure",
    voice: "",
    lang: "vi",
    text: "Chào",
  });
  assert.equal(ok.ok, true);
  assert.match(urls[0], /^https:\/\/japaneast\./);
  const missing = await cloud.synthesize({
    engine: "gcloud",
    lang: "vi",
    text: "Chào",
  });
  assert.deepEqual(
    { ok: missing.ok, code: missing.code },
    { ok: false, code: "auth" },
  );
  // Vùng lạ không lọt vào tên máy chủ: quay về vùng mặc định.
  const tested = await cloud.test({
    engine: "azure",
    apiKey: "K",
    region: "evil.example/x",
  });
  assert.deepEqual(tested, { count: 1, vietnamese: 1 });
  assert.match(
    urls.at(-1),
    /^https:\/\/southeastasia\.tts\.speech\.microsoft\.com\//,
  );
  assert.equal(storage.data.cloudVoices.azure[0].label, "Hoài My (nữ)");
});

test("giọng đọc: giọng AI phát qua offscreen kèm engine/giọng, lỗi trả code", async () => {
  const sent = [];
  const emitted = [];
  const speech = createSpeech({
    emit: (owner, message) => emitted.push(message),
    ensureOffscreen: async () => {},
    tts: { speak() {}, stop() {} },
    runtime: {
      sendMessage: async (message) => sent.push(message),
      lastError: null,
    },
  });
  await speech.speak({
    owner: "1:0",
    uttId: "u1",
    text: "Mã nhảy",
    lang: "vi",
    rate: 1.2,
    volume: 1,
    engine: "azure",
    voiceName: "vi-VN-NamMinhNeural",
  });
  assert.equal(sent[0].type, "play");
  assert.equal(sent[0].engine, "azure");
  assert.equal(sent[0].voice, "vi-VN-NamMinhNeural");
  speech.handleOffscreenEvent({
    uttId: "u1",
    event: "error",
    message: "x",
    code: "auth",
  });
  assert.deepEqual(emitted.at(-1), {
    type: "speech",
    uttId: "u1",
    event: "error",
    message: "x",
    code: "auth",
  });
  await speech.prefetch({
    texts: ["a"],
    lang: "vi",
    engine: "gcloud",
    voice: "vi-VN-Neural2-A",
  });
  await speech.prefetch({ texts: ["a"], lang: "vi", engine: "system" });
  const prefetches = sent.filter((message) => message.type === "prefetch");
  assert.equal(prefetches.length, 1);
  assert.equal(prefetches[0].engine, "gcloud");
});

test("giọng dự phòng: key giọng AI sai thì chuyển ngay sang Google; Google lỗi 2 lần thì sang giọng máy", async () => {
  const statuses = [];
  const fallback = LTV.createVoiceFallback({
    connection: { request: async () => ({ voice: "Microsoft An" }) },
    getSettings: () => LTV.mergeSettings({ voiceEngine: "azure" }),
    setStatus: (state, message) => statuses.push([state, message]),
  });
  await fallback.handle({
    ok: false,
    event: "error",
    code: "auth",
    message: "API key Azure không hợp lệ hoặc sai vùng",
  });
  assert.equal(fallback.effectiveSettings().voiceEngine, "google");
  assert.match(
    statuses.at(-1)[1],
    /API key Azure không hợp lệ.*tạm dùng giọng Google/,
  );
  await fallback.handle({ ok: false, event: "error", message: "HTTP 403" });
  assert.equal(fallback.effectiveSettings().voiceEngine, "google");
  await fallback.handle({ ok: false, event: "error", message: "HTTP 403" });
  assert.deepEqual(fallback.override(), {
    voiceEngine: "system",
    systemVoice: "Microsoft An",
  });
  fallback.reset();
  assert.equal(fallback.effectiveSettings().voiceEngine, "azure");
  // Lỗi thường (không phải key) của giọng AI: chờ lỗi lần hai.
  await fallback.handle({ ok: false, event: "error", code: "request" });
  assert.equal(fallback.effectiveSettings().voiceEngine, "azure");
  await fallback.handle({ ok: false, event: "error", code: "request" });
  assert.match(statuses.at(-1)[1], /Giọng AI Azure không phản hồi/);
});

test("content script không mượn được service worker để gọi API giọng AI", () => {
  const allowed = createFetchGuard({
    host_permissions: [
      "https://*.tts.speech.microsoft.com/*",
      "https://texttospeech.googleapis.com/*",
      "https://*.udemycdn.com/*",
    ],
  });
  assert.equal(
    allowed("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"),
    false,
  );
  assert.equal(allowed("https://texttospeech.googleapis.com/v1/voices"), false);
  assert.equal(allowed("https://a.udemycdn.com/x.vtt"), true);
});
