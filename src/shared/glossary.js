// Từ điển thuật ngữ khi dịch: Google/Chrome dịch máy móc thuật ngữ chuyên
// ngành ("knight" → "hiệp sĩ"). Với video cờ vua (tự nhận ra hoặc người dùng
// chọn) sửa các cách dịch sai đã biết thành thuật ngữ đúng – chỉ khi câu gốc
// có từ tiếng Anh tương ứng, nên câu khác không bị đụng tới. Từ điển riêng
// của người dùng: có khai cách dịch sai thì sửa như trên, không thì bọc thuật
// ngữ tiếng Việt trong [ ] trước khi dịch (Google giữ nguyên) rồi gỡ ngoặc.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MAX_CUSTOM = 100;
  const DETECT_LINES = 60;
  const DETECT_MIN_TERMS = 3;
  const TITLE_HINT =
    /\b(chess|échecs|ajedrez|schach|xadrez|scacchi)\b|cờ vua|шахмат/i;

  // [tên tiếng Anh, mẫu trong câu gốc, thuật ngữ đúng, các cách dịch sai].
  const CHESS_TERMS = [
    ["knight", /\bknights?\b/i, "Mã", ["hiệp sĩ", "kỵ sĩ", "kị sĩ"]],
    ["bishop", /\bbishops?\b/i, "Tượng", ["giám mục", "giáo chủ"]],
    ["rook", /\brooks?\b/i, "Xe", ["con quạ", "quạ"]],
    ["queen", /\bqueens?\b/i, "Hậu", ["nữ hoàng", "hoàng hậu"]],
    ["king", /\bkings?\b/i, "Vua", ["nhà vua"]],
    ["pawn", /\bpawns?\b/i, "Tốt", ["người cầm đồ", "cầm đồ", "con tốt"]],
    [
      "minor piece",
      /\bminor pieces?\b/i,
      "quân nhẹ",
      ["quân cờ nhỏ", "mảnh nhỏ"],
    ],
    [
      "major piece",
      /\bmajor pieces?\b/i,
      "quân nặng",
      ["quân cờ lớn", "mảnh lớn"],
    ],
    ["piece", /\bpieces?\b/i, "quân", ["mảnh ghép", "mảnh", "miếng"]],
    ["castling", /\bcastl(e|es|ed|ing)\b/i, "nhập thành", ["lâu đài"]],
    ["checkmate", /\bcheckmate/i, "chiếu hết", ["chiếu tướng"]],
    [
      "in check",
      /\b(is|are|in|into)\s+check\b/i,
      "bị chiếu",
      ["được kiểm tra", "bị kiểm tra"],
    ],
    [
      "check",
      /\b(gives?|giving|discovered|double|perpetual)\s+checks?\b/i,
      "chiếu",
      ["kiểm tra"],
    ],
    ["stalemate", /\bstalemate/i, "hết nước đi", ["sự bế tắc", "bế tắc"]],
    ["draw", /\bdraw(n|s)?\b/i, "hòa", ["bản vẽ", "rút thăm", "vẽ"]],
    ["resign", /\bresign(s|ed|ing|ation)?\b/i, "xin thua", ["từ chức"]],
    [
      "promotion",
      /\bpromot(e|es|ed|ing|ion)\b/i,
      "phong cấp",
      ["thăng cấp", "thăng chức", "khuyến mãi", "khuyến mại"],
    ],
    ["fork", /\bforks?\b/i, "đòn chĩa đôi", ["ngã ba", "cái nĩa", "nĩa"]],
    ["skewer", /\bskewers?\b/i, "đòn xiên", ["xiên que"]],
    ["opening", /\bopenings?\b/i, "khai cuộc", ["phần mở đầu", "khai mạc"]],
    [
      "middlegame",
      /\bmiddle ?games?\b/i,
      "trung cuộc",
      ["giữa trò chơi", "giữa ván đấu"],
    ],
    [
      "endgame",
      /\bend ?games?\b/i,
      "tàn cuộc",
      [
        "phần cuối của trò chơi",
        "trò chơi kết thúc",
        "kết thúc trò chơi",
        "cuối trò chơi",
      ],
    ],
    ["file", /\bfiles?\b/i, "cột", ["tập tin", "tệp tin"]],
    ["rank", /\branks?\b/i, "hàng ngang", ["cấp bậc", "xếp hạng"]],
    ["square", /\bsquares?\b/i, "ô", ["quảng trường", "hình vuông"]],
    [
      "board",
      /\bchess ?boards?\b|\bboard\b/i,
      "bàn cờ",
      ["hội đồng quản trị", "hội đồng"],
    ],
    ["capture", /\bcaptur(e|es|ed|ing)\b/i, "bắt", ["chụp"]],
    [
      "en passant",
      /\ben passant\b/i,
      "bắt tốt qua đường",
      ["một cách ngẫu nhiên", "khi đi qua"],
    ],
    ["grandmaster", /\bgrand ?masters?\b/i, "Đại kiện tướng", ["đại sư"]],
  ].map(([name, source, term, wrong]) => ({ name, source, term, wrong }));

  const LETTER = "[\\p{L}\\p{M}]";
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Biến thể sai đứng thành từ riêng (không nằm giữa từ khác).
  function variantPattern(variant) {
    return new RegExp(`(?<!${LETTER})${escape(variant)}(?!${LETTER})`, "giu");
  }

  function matchCase(found, term) {
    const first = found.charAt(0);
    return first !== first.toLowerCase()
      ? term.charAt(0).toUpperCase() + term.slice(1)
      : term;
  }

  function wordPattern(english) {
    const words = english.trim().split(/\s+/).map(escape).join("\\s+");
    return new RegExp(`\\b${words}(s|es)?\\b`, "i");
  }

  // "english = tiếng Việt | sai1; sai2" mỗi dòng (bỏ dòng trống, dòng #).
  function parseCustom(text) {
    const entries = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const match = /^([^=#|]+?)\s*=\s*([^|]+?)\s*(?:\|\s*(.+))?$/.exec(
        line.trim(),
      );
      if (!match || entries.length >= MAX_CUSTOM) continue;
      const wrong = (match[3] || "")
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
      entries.push({
        name: match[1].trim(),
        source: wordPattern(match[1]),
        term: match[2].trim(),
        wrong,
        protect: wrong.length === 0,
      });
    }
    return entries;
  }

  // "chess" nếu tiêu đề nói về cờ vua hoặc phụ đề có ≥3 thuật ngữ khác nhau.
  function detect({ title, texts }) {
    if (TITLE_HINT.test(title || "")) return "chess";
    const sample = (texts || []).slice(0, DETECT_LINES).join("\n");
    if (TITLE_HINT.test(sample)) return "chess";
    const found = CHESS_TERMS.filter((entry) => entry.source.test(sample));
    return found.length >= DETECT_MIN_TERMS ? "chess" : null;
  }

  // Lĩnh vực của nội dung theo cài đặt glossaryMode.
  function domainFor(settings, content) {
    if (settings.glossaryMode === "off") return null;
    if (settings.glossaryMode === "chess") return "chess";
    return detect(content);
  }

  // Phần ghép vào tên bộ dịch trong khoá cache ("google~chess.k2x").
  function cacheEngine(engine, settings, domain) {
    const suffix = tag({
      domain,
      mode: settings.glossaryMode,
      custom: settings.customTerms,
    });
    return suffix ? `${engine}~${suffix}` : engine;
  }

  // Các mục áp dụng cho một yêu cầu dịch.
  function entriesFor({ domain, mode, custom }) {
    if (mode === "off") return [];
    const chess = mode === "chess" || domain === "chess" ? CHESS_TERMS : [];
    return [...parseCustom(custom), ...chess];
  }

  // Trước khi dịch: bọc thuật ngữ cần giữ của từ điển riêng trong [ ].
  function prepare(text, entries) {
    const inserted = [];
    if (String(text).includes("[")) return { text, inserted };
    let result = String(text);
    for (const entry of entries) {
      if (!entry.protect) continue;
      const global = new RegExp(entry.source.source, "gi");
      result = result.replace(global, () => {
        inserted.push(entry.term);
        return `[${entry.term}]`;
      });
    }
    return { text: result, inserted };
  }

  // Sau khi dịch: trả đúng thuật ngữ vào chỗ ngoặc, rồi sửa cách dịch sai.
  function fix(source, translated, entries, inserted = []) {
    if (typeof translated !== "string") return translated;
    let result = translated;
    // Chỉ gỡ ngoặc khi chính mình đã bọc (câu gốc không có ngoặc).
    if (inserted.length > 0) {
      const groups = result.match(/\[\s*[^\]]+?\s*\]/g) || [];
      let index = 0;
      result = result.replace(/\[\s*([^\]]+?)\s*\]/g, (whole, inner) =>
        groups.length === inserted.length ? inserted[index++] : inner,
      );
    }
    for (const entry of entries) {
      if (!entry.source.test(source)) continue;
      for (const variant of entry.wrong)
        result = result.replace(variantPattern(variant), (found) =>
          matchCase(found, entry.term),
        );
    }
    return result;
  }

  // Phần ghép vào khoá cache: bản dịch với từ điển khác nhau không dùng lẫn.
  function tag({ domain, mode, custom }) {
    if (mode === "off") return "";
    const parts = [];
    if (mode === "chess" || domain === "chess") parts.push("chess");
    const terms = String(custom || "").trim();
    if (terms) parts.push(hash(terms));
    return parts.join(".");
  }

  function hash(text) {
    let value = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1)
      value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
    return (value >>> 0).toString(36);
  }

  // Danh sách cho lời dặn của Claude: "knight → Mã".
  function promptTerms(entries) {
    return entries.map((entry) => `${entry.name} → ${entry.term}`);
  }

  LTV.glossary = {
    CHESS_TERMS,
    parseCustom,
    detect,
    domainFor,
    cacheEngine,
    entriesFor,
    prepare,
    fix,
    tag,
    promptTerms,
  };
})(globalThis);
