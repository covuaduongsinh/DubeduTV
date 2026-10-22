import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import { createTranslateRouter } from "../src/background/translate-router.js";
import { createLibrary } from "../src/background/library.js";
import "../src/content/lib/translate-queue.js";

const google = async ({ texts }) => texts.map((text) => `[g] ${text}`);

test("router: bộ dịch được chọn dịch dở thì Google điền phần còn lại", async () => {
  const translate = createTranslateRouter({
    google,
    engines: {
      claude: async ({ texts }) =>
        texts.map((t, i) => (i === 1 ? null : `[c] ${t}`)),
    },
  });
  const reply = await translate({ texts: ["a", "b", "c"], engine: "claude" });
  assert.deepEqual(reply.results, ["[c] a", "[g] b", "[c] c"]);
  assert.deepEqual(reply.engines, ["claude", "google", "claude"]);
  assert.equal(reply.warning, "");
});

test("router: bộ dịch lỗi thì cảnh báo và dùng Google", async () => {
  const translate = createTranslateRouter({
    google,
    engines: {
      chrome: async () => {
        throw new Error("Chưa tải gói dịch en→vi");
      },
    },
  });
  const reply = await translate({ texts: ["a"], engine: "chrome" });
  assert.deepEqual(reply.engines, ["google"]);
  assert.match(reply.warning, /Chưa tải gói dịch.*tạm dùng Google Dịch/);
});

test("router: Google cũng lỗi thì trả lỗi kèm phần đã dịch", async () => {
  const translate = createTranslateRouter({
    google: async () => {
      throw new Error("HTTP 503");
    },
    engines: {},
  });
  const reply = await translate({ texts: ["a"], engine: "google" });
  assert.deepEqual(reply.results, [null]);
  assert.equal(reply.error, "HTTP 503");
});

test("khoá cache tách đúng cả khi mã phiên có dấu hai chấm", () => {
  const key = LTV.cacheKey({
    session: "coursera:/learn/x:y/lecture/1",
    lang: "en",
    tl: "vi",
    engine: "claude",
  });
  assert.deepEqual(LTV.parseCacheKey(key), {
    session: "coursera:/learn/x:y/lecture/1",
    lang: "en",
    tl: "vi",
    engine: "claude",
  });
  assert.equal(LTV.parseCacheKey("a:b"), null);
});

test("library: tìm video đã có bản dịch theo ngôn ngữ đích và lời chép", async () => {
  const library = createLibrary({
    cache: {
      keys: async () => [
        "youtube:aaa:en:vi:google",
        "youtube:bbb:en:fr:google",
        "drive:f1:en:vi:claude",
      ],
    },
    transcripts: { keys: async () => ["youtube:ccc"] },
  });
  const found = await library.lookup({
    sessions: ["youtube:aaa", "youtube:bbb", "youtube:ccc", "youtube:ddd"],
    tl: "vi",
  });
  assert.deepEqual(found.cached, ["youtube:aaa"]);
  assert.deepEqual(found.transcripts, ["youtube:ccc"]);
});

test("cài đặt v1.1: autoStart true/false đổi sang chế độ mới", () => {
  assert.equal(LTV.mergeSettings({ autoStart: true }).autoStart, "always");
  assert.equal(LTV.mergeSettings({ autoStart: false }).autoStart, "off");
  assert.equal(LTV.mergeSettings({ autoStart: "cached" }).autoStart, "cached");
  assert.equal(LTV.mergeSettings({ autoStart: "x" }).autoStart, "off");
  assert.equal(LTV.mergeSettings({}).quizTranslate, true);
  assert.equal(LTV.mergeSettings({ showBadges: false }).showBadges, false);
});

function fakeConnection(reply, cache = {}) {
  const posts = [];
  const requests = [];
  return {
    posts,
    requests,
    post: (message) => posts.push(message),
    request: async (message) => {
      requests.push(message);
      if (message.type === "cache:get")
        return { items: cache[message.key] || {} };
      return reply(message);
    },
  };
}

test("hàng đợi dịch lưu cache theo bộ dịch thật, đọc cache của bộ dịch đang chọn", async () => {
  const sentences = [{ text: "one" }, { text: "two" }];
  const hash = LTV.util.hashText("one");
  const connection = fakeConnection(
    (message) => ({
      results: message.texts.map((text) => (text === "two" ? "hai" : "?")),
      engines: message.texts.map(() => "google"),
    }),
    { "k:claude": { [hash]: "một (cache)" } },
  );
  const queue = LTV.createTranslationQueue({
    sentences,
    connection,
    engine: "claude",
    cacheKeyFor: (engine) => `k:${engine}`,
    sl: "en",
    tl: "vi",
    title: "",
  });
  await queue.loadCache();
  assert.equal(sentences[0].tr, "một (cache)");
  queue.ensureFrom(0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sentences[1].tr, "hai");
  const translateCall = connection.requests.find((m) => m.type === "translate");
  assert.equal(translateCall.engine, "claude");
  assert.deepEqual(translateCall.texts, ["two"]);
  assert.deepEqual(connection.posts, [
    {
      type: "cache:put",
      key: "k:google",
      items: { [LTV.util.hashText("two")]: "hai" },
    },
  ]);
});
