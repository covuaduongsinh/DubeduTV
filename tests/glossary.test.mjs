import { test } from "node:test";
import assert from "node:assert/strict";
import { LTV } from "./helpers.mjs";
import { createTranslateRouter } from "../src/background/translate-router.js";
import { buildSystemPrompt } from "../src/background/translate-claude.js";

const chess = LTV.glossary.entriesFor({
  domain: "chess",
  mode: "auto",
  custom: "",
});

test("thuật ngữ: sửa cách dịch sai của Google khi câu gốc có thuật ngữ", () => {
  const cases = [
    [
      "The knight jumps in an L shape.",
      "Hiệp sĩ nhảy theo hình chữ L.",
      "Mã nhảy theo hình chữ L.",
    ],
    [
      "It can jump over other pieces.",
      "Nó có thể nhảy qua các mảnh khác.",
      "Nó có thể nhảy qua các quân khác.",
    ],
    [
      "The bishop pins the knight to the queen.",
      "Giám mục ghim hiệp sĩ cho nữ hoàng.",
      "Tượng ghim Mã cho Hậu.",
    ],
    ["This is checkmate!", "Đây là chiếu tướng!", "Đây là chiếu hết!"],
    ["White is in check.", "Trắng đang được kiểm tra.", "Trắng đang bị chiếu."],
    [
      "A knight fork wins the rook.",
      "Một ngã ba hiệp sĩ sẽ thắng xe.",
      "Một đòn chĩa đôi Mã sẽ thắng xe.",
    ],
    [
      "He resigned after a blunder.",
      "Ông đã từ chức sau một sai lầm.",
      "Ông đã xin thua sau một sai lầm.",
    ],
    [
      "Put the rook on the open file.",
      "Đặt quân xe vào tập tin đang mở.",
      "Đặt quân xe vào cột đang mở.",
    ],
    [
      "Bishops and knights are minor pieces.",
      "Giám mục và hiệp sĩ là những quân cờ nhỏ.",
      "Tượng và Mã là những quân nhẹ.",
    ],
    [
      "After castling, the king is safe.",
      "Sau khi nhập thành, nhà vua được an toàn.",
      "Sau khi nhập thành, Vua được an toàn.",
    ],
  ];
  for (const [source, google, expected] of cases)
    assert.equal(LTV.glossary.fix(source, google, chess), expected, source);
});

test("thuật ngữ: không sửa khi câu gốc không có từ tương ứng", () => {
  assert.equal(
    LTV.glossary.fix(
      "Let me check the score.",
      "Để tôi kiểm tra tỷ số.",
      chess,
    ),
    "Để tôi kiểm tra tỷ số.",
  );
  assert.equal(
    LTV.glossary.fix(
      "A statue stands here.",
      "Một bức tượng đứng ở đây.",
      chess,
    ),
    "Một bức tượng đứng ở đây.",
  );
});

test("thuật ngữ: nhận ra nội dung cờ vua theo tiêu đề hoặc ≥3 thuật ngữ", () => {
  assert.equal(
    LTV.glossary.detect({ title: "Learn Chess in 10 minutes", texts: [] }),
    "chess",
  );
  assert.equal(
    LTV.glossary.detect({ title: "Bài 3 – Cờ vua cho bé", texts: [] }),
    "chess",
  );
  assert.equal(
    LTV.glossary.detect({
      title: "Lesson",
      texts: ["The knight and bishop", "protect the pawn"],
    }),
    "chess",
  );
  assert.equal(
    LTV.glossary.detect({
      title: "Medieval history",
      texts: ["The knight rode to the castle gate."],
    }),
    null,
  );
  const off = { glossaryMode: "off" };
  assert.equal(LTV.glossary.domainFor(off, { title: "chess" }), null);
  assert.equal(
    LTV.glossary.domainFor({ glossaryMode: "chess" }, { title: "x" }),
    "chess",
  );
});

test("từ điển riêng: đọc dòng, bọc thuật ngữ cần giữ rồi trả đúng sau khi dịch", () => {
  const custom = LTV.glossary.parseCustom(
    "# ghi chú\nzwischenzug = nước trung gian\nfianchetto = phát triển Tượng ra cánh | phi ăng kết tô\nkhông hợp lệ",
  );
  assert.equal(custom.length, 2);
  assert.equal(custom[0].protect, true);
  assert.deepEqual(custom[1].wrong, ["phi ăng kết tô"]);
  const prepared = LTV.glossary.prepare(
    "A zwischenzug changes everything.",
    custom,
  );
  assert.equal(prepared.text, "A [nước trung gian] changes everything.");
  // Google có thể đổi chữ trong ngoặc: số ngoặc khớp thì trả đúng thuật ngữ.
  assert.equal(
    LTV.glossary.fix(
      "A zwischenzug changes everything.",
      "Một [nước trung gian ấy] thay đổi mọi thứ.",
      custom,
      prepared.inserted,
    ),
    "Một nước trung gian thay đổi mọi thứ.",
  );
  assert.equal(
    LTV.glossary.fix("Play the fianchetto.", "Chơi phi ăng kết tô.", custom),
    "Chơi phát triển Tượng ra cánh.",
  );
});

test("thuật ngữ: khoá cache khác nhau theo lĩnh vực và từ điển riêng", () => {
  const auto = { glossaryMode: "auto", customTerms: "" };
  assert.equal(LTV.glossary.cacheEngine("google", auto, null), "google");
  assert.equal(
    LTV.glossary.cacheEngine("google", auto, "chess"),
    "google~chess",
  );
  const custom = { glossaryMode: "auto", customTerms: "a = b" };
  assert.match(
    LTV.glossary.cacheEngine("claude", custom, "chess"),
    /^claude~chess\.\w+$/,
  );
  assert.equal(
    LTV.glossary.cacheEngine(
      "google",
      { glossaryMode: "off", customTerms: "a = b" },
      "chess",
    ),
    "google",
  );
  const parsed = LTV.parseCacheKey(
    LTV.cacheKey({
      session: "youtube:a",
      lang: "en",
      tl: "vi",
      engine: "google~chess",
    }),
  );
  assert.equal(parsed.session, "youtube:a");
});

test("router: Google qua từ điển; Claude nhận danh sách thuật ngữ trong lời dặn", async () => {
  const seen = {};
  const translate = createTranslateRouter({
    google: async ({ texts }) => texts.map(() => "Hiệp sĩ nhảy."),
    engines: {
      claude: async (request) => {
        seen.claude = request;
        return request.texts.map(() => null);
      },
    },
    glossarySettings: async () => ({
      mode: "auto",
      custom: "zwischenzug = nước trung gian",
    }),
  });
  const reply = await translate({
    texts: ["The knight jumps. zwischenzug"],
    engine: "claude",
    domain: "chess",
  });
  assert.deepEqual(reply.results, ["Mã nhảy."]);
  assert.deepEqual(seen.claude.texts, ["The knight jumps. zwischenzug"]);
  assert.ok(seen.claude.terms.includes("knight → Mã"));
  assert.ok(seen.claude.terms.includes("zwischenzug → nước trung gian"));
  const prompt = buildSystemPrompt("en", "vi", seen.claude.terms);
  assert.match(
    prompt,
    /Always use these Vietnamese terms: zwischenzug → nước trung gian; knight → Mã/,
  );
  assert.doesNotMatch(buildSystemPrompt("en", "vi"), /Always use/);
});
