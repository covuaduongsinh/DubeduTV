import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChunks,
  createGoogleTranslator,
  parseGoogleResponse,
  translateGoogle,
} from "../src/background/translate-google.js";
import { createTranslateRouter } from "../src/background/translate-router.js";
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
    const q =
      init.method === "GET"
        ? new URL(url).searchParams.get("q")
        : decodeURIComponent(init.body.slice(2));
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

test("translateGoogle gộp câu vào một yêu cầu GET", async () => {
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

// Google chặn tạm: chuyển hướng sang trang "Sorry" (fetch redirect: "manual").
const SORRY = { ok: false, status: 0, type: "opaqueredirect" };

// Giả lập Google theo kiểu gọi: block(url, init) → true thì trả trang "Sorry".
function googleBy(block) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const q =
      init.method === "GET"
        ? parsed.searchParams.get("q")
        : decodeURIComponent(init.body.slice(2));
    calls.push({
      host: parsed.host,
      method: init.method,
      credentials: init.credentials,
      redirect: init.redirect,
      q,
      length: url.length,
    });
    if (block(parsed, init)) return SORRY;
    const lines = q.split("\n").map((line) => `[${line}]`);
    return jsonResponse([[[lines.join("\n"), q]]]);
  };
  return { calls, fetchImpl };
}

const quiet = { log: () => {}, minGapMs: 0 };

test("Google Dịch gọi GET trước như link mở trên thẻ; GET bị chặn thì POST, và nhớ cách gọi đó", async () => {
  const google = googleBy((url, init) => init.method === "GET");
  const translate = createGoogleTranslator(quiet);
  const fetchImpl = google.fetchImpl;
  assert.deepEqual(await translate({ texts: ["x"], tl: "vi", fetchImpl }), [
    "[x]",
  ]);
  assert.deepEqual(
    google.calls.map((c) => [c.host, c.method, c.credentials, c.redirect]),
    [
      ["translate.googleapis.com", "GET", "omit", "manual"],
      ["translate.googleapis.com", "POST", "omit", "manual"],
    ],
  );
  assert.equal(google.calls[0].q, "x");
  await translate({ texts: ["y"], tl: "vi", fetchImpl });
  assert.equal(google.calls.length, 3);
  assert.equal(google.calls[2].method, "POST");
  assert.equal(google.calls[2].q, "y");
});

test("Google Dịch: chỉ translate.google.com kèm cookie qua được thì dùng cửa đó", async () => {
  const google = googleBy((url) => url.host === "translate.googleapis.com");
  const translate = createGoogleTranslator(quiet);
  await translate({ texts: ["x"], tl: "vi", fetchImpl: google.fetchImpl });
  const last = google.calls.at(-1);
  assert.deepEqual(
    [last.host, last.method, last.credentials],
    ["translate.google.com", "GET", "include"],
  );
  assert.equal(google.calls.length, 4);
});

test("Google Dịch kiểu GET chia văn bản dài thành nhiều yêu cầu ngắn, giữ đúng thứ tự dòng", async () => {
  const google = googleBy((url, init) => init.method === "POST");
  const translate = createGoogleTranslator(quiet);
  const texts = Array.from(
    { length: 50 },
    (_, i) => `Line ${i} ${"word ".repeat(18)}`,
  );
  const result = await translate({
    texts,
    tl: "vi",
    fetchImpl: google.fetchImpl,
  });
  assert.deepEqual(
    result,
    texts.map((text) => `[${text.trim()}]`),
  );
  const gets = google.calls.filter((c) => c.method === "GET");
  assert.ok(gets.length >= 3, `chỉ ${gets.length} yêu cầu GET`);
  assert.ok(gets.every((c) => c.length < 6500));
});

test("Google Dịch: mọi cách gọi bị chặn thì báo rõ, chỉ chỗ kiểm tra, rồi tạm ngừng gọi", async () => {
  let clock = 0;
  const google = googleBy(() => true);
  const translate = createGoogleTranslator({ ...quiet, now: () => clock });
  const blocked = (error) =>
    error.code === "blocked" &&
    /tạm chặn/.test(error.message) &&
    /Kiểm tra kết nối Google Dịch/.test(error.message);
  await assert.rejects(
    translate({ texts: ["x"], tl: "vi", fetchImpl: google.fetchImpl }),
    blocked,
  );
  assert.equal(google.calls.length, 5);
  // Trong lúc tạm ngừng: không gọi Google nữa.
  await assert.rejects(
    translate({ texts: ["y"], tl: "vi", fetchImpl: google.fetchImpl }),
    blocked,
  );
  assert.equal(google.calls.length, 5);
  clock += 61 * 1000;
  await assert.rejects(
    translate({ texts: ["z"], tl: "vi", fetchImpl: google.fetchImpl }),
    blocked,
  );
  assert.equal(google.calls.length, 10);
});

test('Google Dịch mất mạng thì báo "Không kết nối được" thay cho "Failed to fetch"', async () => {
  let attempts = 0;
  const offline = createGoogleTranslator(quiet);
  await assert.rejects(
    offline({
      texts: ["x"],
      tl: "vi",
      retryDelay: 0,
      fetchImpl: async () => {
        attempts += 1;
        throw new TypeError("Failed to fetch");
      },
    }),
    (error) =>
      error.code === "network" && /Không kết nối được/.test(error.message),
  );
  // Mỗi cách gọi thử 3 lần (lần đầu + 2 lần thử lại).
  assert.equal(attempts, 15);
});

test("Kiểm tra kết nối Google Dịch báo từng cách gọi, rồi dùng ngay cách qua được", async () => {
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    if (init.method === "POST" && parsed.host === "translate.googleapis.com")
      return SORRY;
    if (init.credentials === "omit") return jsonResponse({}, 429);
    if (parsed.host === "translate.google.com" && init.method === "GET")
      throw new TypeError("Failed to fetch");
    if (parsed.host === "translate.google.com")
      return { ok: true, status: 200, json: async () => JSON.parse("<html>") };
    return jsonResponse([[["hiệp sĩ", "knight"]]]);
  };
  const translate = createGoogleTranslator(quiet);
  const results = await translate.diagnose({ fetchImpl });
  assert.deepEqual(
    results.map((row) => [row.id, row.ok]),
    [
      ["api-get", false],
      ["api-post", false],
      ["api-get-cookie", true],
      ["web-get-cookie", false],
      ["web-post-cookie", false],
    ],
  );
  assert.match(results[0].detail, /429/);
  assert.match(results[1].detail, /Sorry/);
  assert.equal(results[2].detail, "“knight” → “hiệp sĩ”");
  assert.match(results[3].detail, /không kết nối/);
  assert.match(results[4].detail, /không phải bản dịch/);
  assert.ok(results.every((row) => row.label));
  // Lần dịch sau đi thẳng cách gọi vừa qua được.
  const calls = [];
  await translate({
    texts: ["knight"],
    tl: "vi",
    fetchImpl: async (url, init) => {
      calls.push(init);
      return fetchImpl(url, init);
    },
  });
  assert.deepEqual(
    calls.map((init) => [init.method, init.credentials]),
    [["GET", "include"]],
  );
});

test("router: Google bị chặn thì dịch bằng Chrome trên máy và ghi đúng bộ dịch", async () => {
  const blockedError = Object.assign(new Error("Google Dịch đang tạm chặn"), {
    code: "blocked",
  });
  const translate = createTranslateRouter({
    google: async () => {
      throw blockedError;
    },
    engines: { chrome: async ({ texts }) => texts.map((text) => `vi:${text}`) },
  });
  const reply = await translate({
    texts: ["a", "b"],
    sl: "en",
    tl: "vi",
    engine: "google",
  });
  assert.deepEqual(reply.results, ["vi:a", "vi:b"]);
  assert.deepEqual(reply.engines, ["chrome", "chrome"]);
  assert.match(reply.warning, /Chrome trên máy/);
  assert.equal(reply.error, undefined);
  const noChrome = createTranslateRouter({
    google: async () => {
      throw blockedError;
    },
    engines: { chrome: async () => [null, null] },
  });
  const failed = await noChrome({
    texts: ["a", "b"],
    sl: "en",
    tl: "vi",
    engine: "google",
  });
  assert.match(failed.error, /tạm chặn/);
  // Chrome chưa có gói dịch: lỗi nói luôn cách bật bộ dự phòng.
  const noPack = createTranslateRouter({
    google: async () => {
      throw blockedError;
    },
    engines: {
      chrome: async () => {
        throw new Error(
          "Chưa tải gói dịch en→vi – bấm “Tải gói dịch” trong popup",
        );
      },
    },
  });
  const packMissing = await noPack({
    texts: ["a"],
    sl: "en",
    tl: "vi",
    engine: "google",
  });
  assert.match(
    packMissing.error,
    /tạm chặn.*Dự phòng “Chrome trên máy” chưa dùng được: Chưa tải gói dịch en→vi/,
  );
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
