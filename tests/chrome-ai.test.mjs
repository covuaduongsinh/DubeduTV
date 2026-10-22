import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import "../src/shared/chrome-ai.js";
import { createChromeTranslate } from "../src/background/translate-chrome.js";

function installTranslator({ status = "available", fail = [] } = {}) {
  const created = [];
  globalThis.Translator = {
    availability: async () => status,
    create: async (options) => {
      created.push(options);
      return {
        translate: async (text) => {
          if (fail.includes(text)) throw new Error("boom");
          return `${options.targetLanguage}:${text}`;
        },
      };
    },
  };
  return created;
}

// Trình nhận diện giả dùng chung (chromeAI giữ lại instance đã tạo).
const detected = { language: "en", confidence: 0.9 };
function installDetector(language, confidence = 0.9) {
  Object.assign(detected, { language, confidence });
  globalThis.LanguageDetector = {
    availability: async () => "available",
    create: async () => ({
      detect: async () => [
        {
          detectedLanguage: detected.language,
          confidence: detected.confidence,
        },
      ],
    }),
  };
}

afterEach(() => {
  delete globalThis.Translator;
  delete globalThis.LanguageDetector;
});

test("chromeAI: mã ngôn ngữ của Translator API", () => {
  assert.equal(LTV.chromeAI.langCode("en-US"), "en");
  assert.equal(LTV.chromeAI.langCode("zh-CN"), "zh");
  assert.equal(LTV.chromeAI.langCode("zh-TW"), "zh-Hant");
  assert.equal(LTV.chromeAI.langCode("vi"), "vi");
});

test("chromeAI: không có API thì báo no-api", async () => {
  const reply = await LTV.chromeAI.translate({
    texts: ["a"],
    sl: "en",
    tl: "vi",
  });
  assert.deepEqual(reply, { ok: false, code: "no-api" });
});

test("chromeAI: dịch từng dòng, dòng lỗi thành null, dùng lại bộ dịch", async () => {
  const created = installTranslator({ fail: ["b"] });
  const first = await LTV.chromeAI.translate({
    texts: ["a", "b"],
    sl: "en-US",
    tl: "vi",
  });
  assert.deepEqual(first.results, ["vi:a", null]);
  await LTV.chromeAI.translate({ texts: ["c"], sl: "en", tl: "vi" });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], { sourceLanguage: "en", targetLanguage: "vi" });
});

test("chromeAI: chưa tải gói thì trả mã downloadable kèm cặp ngôn ngữ", async () => {
  installTranslator({ status: "downloadable" });
  const reply = await LTV.chromeAI.translate({
    texts: ["a"],
    sl: "ja",
    tl: "vi",
  });
  assert.deepEqual(reply, {
    ok: false,
    code: "downloadable",
    sl: "ja",
    tl: "vi",
  });
});

test("chromeAI: nguồn auto dùng LanguageDetector; cùng ngôn ngữ đích thì giữ nguyên", async () => {
  installTranslator();
  installDetector("fr");
  const reply = await LTV.chromeAI.translate({
    texts: ["bonjour"],
    sl: "auto",
    tl: "vi",
  });
  assert.deepEqual(reply.results, ["vi:bonjour"]);
  assert.equal(reply.sl, "fr");
  installDetector("vi");
  const same = await LTV.chromeAI.translate({
    texts: ["xin chào"],
    sl: "auto",
    tl: "vi",
  });
  assert.deepEqual(same.results, ["xin chào"]);
});

test("chromeAI: nguồn auto mà không nhận diện được thì báo lỗi", async () => {
  installTranslator();
  const reply = await LTV.chromeAI.translate({
    texts: ["?"],
    sl: "auto",
    tl: "vi",
  });
  assert.equal(reply.code, "detect-unavailable");
});

test("translate-chrome: lỗi offscreen thành thông báo tiếng Việt", async () => {
  const runtime = {
    sendMessage: async () => ({
      ok: false,
      code: "downloadable",
      sl: "en",
      tl: "vi",
    }),
  };
  const translate = createChromeTranslate({
    ensureOffscreen: async () => {},
    runtime,
  });
  await assert.rejects(translate({ texts: ["a"], sl: "en", tl: "vi" }), {
    message: "Chưa tải gói dịch en→vi – bấm “Tải gói dịch” trong popup",
    code: "downloadable",
  });
  runtime.sendMessage = async () => ({ ok: true, results: ["một"] });
  assert.deepEqual(await translate({ texts: ["one"], sl: "en", tl: "vi" }), [
    "một",
  ]);
});
