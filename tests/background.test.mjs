import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChunks,
  parseGoogleResponse,
  translateGoogle,
} from "../src/background/translate-google.js";
import {
  buildClaudeRequest,
  buildHeaders,
  parseClaudeResponse,
  translateClaude,
} from "../src/background/translate-claude.js";
import { createCache } from "../src/background/cache.js";
import { createFetchGuard } from "../src/background/fetch-guard.js";

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

// Giả lập Google: dịch "x" thành "[x]" và giữ nguyên ký tự xuống dòng.
function fakeGoogle({ dropNewlines = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const q = decodeURIComponent(init.body.slice(2));
    calls.push({ url, q });
    const lines = q.split("\n").map((line) => `[${line}]`);
    const joined = dropNewlines ? lines.join(" ") : lines.join("\n");
    return jsonResponse([[[joined, q, null, null, 3]], null, "en"]);
  };
  return { calls, fetchImpl };
}

test("buildChunks chia theo giới hạn ký tự", () => {
  assert.deepEqual(buildChunks(["aaaa", "bbbb", "cc"], 10), [[0, 1], [2]]);
  assert.deepEqual(buildChunks([], 10), []);
});

test("parseGoogleResponse nối các đoạn câu", () => {
  const data = [
    [
      ["Xin chào.\n", "Hello.\n"],
      ["Bạn khỏe không?", "How are you?"],
    ],
  ];
  assert.equal(parseGoogleResponse(data), "Xin chào.\nBạn khỏe không?");
  assert.throws(() => parseGoogleResponse({}), /không hợp lệ/);
});

test("translateGoogle gộp câu vào một yêu cầu POST", async () => {
  const google = fakeGoogle();
  const result = await translateGoogle({
    texts: ["one", "two\nlines", "three"],
    tl: "vi",
    fetchImpl: google.fetchImpl,
  });
  assert.deepEqual(result, ["[one]", "[two lines]", "[three]"]);
  assert.equal(google.calls.length, 1);
  assert.match(google.calls[0].url, /client=gtx.*sl=auto&tl=vi/);
});

test("translateGoogle dịch lại từng câu khi số dòng lệch", async () => {
  const google = fakeGoogle({ dropNewlines: true });
  const result = await translateGoogle({
    texts: ["a", "b"],
    tl: "vi",
    fetchImpl: google.fetchImpl,
  });
  assert.deepEqual(result, ["[a]", "[b]"]);
  assert.equal(google.calls.length, 3);
});

test("translateGoogle thử lại khi gặp 429", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) return jsonResponse({}, 429);
    return jsonResponse([[["ok", "x"]]]);
  };
  const result = await translateGoogle({
    texts: ["x"],
    tl: "vi",
    fetchImpl,
    retryDelay: 1,
  });
  assert.deepEqual(result, ["ok"]);
  assert.equal(attempts, 2);
});

test("buildClaudeRequest dùng structured output, effort thấp và fallback cho Opus", () => {
  const body = buildClaudeRequest({
    texts: ["Hello"],
    sl: "en",
    tl: "vi",
    title: "Lesson",
    model: "claude-opus-5-5",
    context: ["Before"],
  });
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.output_config.effort, "low");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.fallbacks, "default");
  assert.equal("temperature" in body, false);
  assert.deepEqual(JSON.parse(body.messages[0].content), {
    video_title: "Lesson",
    context_before: ["Before"],
    lines: [{ id: 0, text: "Hello" }],
  });
  assert.match(body.system, /Vietnamese/);
  const haiku = buildClaudeRequest({
    texts: ["x"],
    tl: "vi",
    model: "claude-haiku-5-5",
  });
  assert.equal("fallbacks" in haiku, false);
  assert.equal(
    buildHeaders("k", "claude-opus-5-5")["anthropic-beta"],
    "server-side-fallback-2026-07-01",
  );
  assert.equal(
    buildHeaders("k", "claude-haiku-5-5")["anthropic-beta"],
    undefined,
  );
  assert.equal(
    buildHeaders("k", "claude-haiku-5-5")["anthropic-version"],
    "2026-10-21",
  );
});

test("parseClaudeResponse khớp theo id, bỏ id lạ, báo refusal", () => {
  const data = {
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "" },
      {
        type: "text",
        text: JSON.stringify({
          translations: [
            { id: 1, text: " Hai " },
            { id: 0, text: "Một" },
            { id: 7, text: "lạ" },
          ],
        }),
      },
    ],
  };
  assert.deepEqual(parseClaudeResponse(data, 3), ["Một", "Hai", null]);
  assert.throws(
    () => parseClaudeResponse({ stop_reason: "refusal", content: [] }, 1),
    /từ chối/,
  );
  assert.throws(
    () => parseClaudeResponse({ content: [{ type: "text", text: "{" }] }, 1),
    /JSON/,
  );
});

test("translateClaude chia đôi lô khi bị max_tokens và báo lỗi key", async () => {
  const sizes = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const lines = JSON.parse(body.messages[0].content).lines;
    sizes.push(lines.length);
    assert.equal(init.headers["x-api-key"], "sk-test");
    if (lines.length > 2)
      return jsonResponse({ stop_reason: "max_tokens", content: [] });
    const translations = lines.map((line) => ({
      id: line.id,
      text: `vi:${line.text}`,
    }));
    return jsonResponse({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ translations }) }],
    });
  };
  const result = await translateClaude({
    texts: ["a", "b", "c", "d"],
    tl: "vi",
    apiKey: "sk-test",
    model: "claude-haiku-5-5",
    fetchImpl,
  });
  assert.deepEqual(result, ["vi:a", "vi:b", "vi:c", "vi:d"]);
  assert.deepEqual(sizes, [4, 2, 2]);
  await assert.rejects(
    translateClaude({
      texts: ["a"],
      tl: "vi",
      apiKey: "bad",
      model: "claude-opus-5-5",
      fetchImpl: async () =>
        jsonResponse({ error: { message: "invalid x-api-key" } }, 401),
    }),
    /API key Claude không hợp lệ/,
  );
  await assert.rejects(
    translateClaude({ texts: ["a"], tl: "vi", apiKey: "" }),
    /Chưa nhập/,
  );
});

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
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

test("cache gộp bản dịch theo video và loại video cũ nhất", async () => {
  const storage = memoryStorage();
  const cache = createCache({ storage, maxVideos: 2, writeDelay: 100000 });
  cache.merge("yt:a", { h1: "một" });
  assert.deepEqual(await cache.get("yt:a"), { h1: "một" });
  await cache.flush();
  cache.merge("yt:a", { h2: "hai" });
  await cache.flush();
  assert.deepEqual(await cache.get("yt:a"), { h1: "một", h2: "hai" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  cache.merge("yt:b", { h: "b" });
  await cache.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  cache.merge("yt:c", { h: "c" });
  await cache.flush();
  assert.equal("v:yt:a" in storage.data, false);
  assert.deepEqual(Object.keys(storage.data["ltv-cache-index"]).sort(), [
    "yt:b",
    "yt:c",
  ]);
  await cache.clear();
  assert.deepEqual(storage.data, {});
});

test("fetch guard chỉ cho phép host đã khai báo, trừ API dịch", () => {
  const allowed = createFetchGuard({
    host_permissions: [
      "https://*.udemycdn.com/*",
      "https://www.coursera.org/*",
      "https://api.anthropic.com/*",
      "http://127.0.0.1/*",
    ],
  });
  assert.equal(allowed("https://vtt-c.udemycdn.com/123/en.vtt?token=x"), true);
  assert.equal(allowed("https://udemycdn.com/a.vtt"), true);
  assert.equal(
    allowed("https://www.coursera.org/api/subtitleAssetProxy.v1/x?format=vtt"),
    true,
  );
  assert.equal(allowed("http://127.0.0.1:8123/vtt/a.vtt"), true);
  assert.equal(allowed("https://evil.com/?u=udemycdn.com"), false);
  assert.equal(allowed("https://eviludemycdn.com/a.vtt"), false);
  assert.equal(allowed("https://api.anthropic.com/v1/messages"), false);
  assert.equal(allowed("file:///etc/passwd"), false);
  assert.equal(allowed("not a url"), false);
});
