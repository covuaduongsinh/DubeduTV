// Chia câu dài thành các đoạn ngắn cho dịch vụ đọc trực tuyến (giới hạn
// khoảng 200 ký tự mỗi yêu cầu). Ưu tiên cắt ở dấu câu, rồi dấu phẩy, rồi
// khoảng trắng; chỉ cắt ngang từ khi một từ dài hơn giới hạn.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  function splitByPattern(text, pattern) {
    return text
      .split(pattern)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function packWords(text, max) {
    const chunks = [];
    let current = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (word.length > max) {
        if (current) chunks.push(current);
        for (let i = 0; i < word.length; i += max)
          chunks.push(word.slice(i, i + max));
        current = "";
      } else if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= max) {
        current = `${current} ${word}`;
      } else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function packParts(parts, max, fallback) {
    const chunks = [];
    let current = "";
    for (const part of parts) {
      if (part.length > max) {
        if (current) chunks.push(current);
        chunks.push(...fallback(part));
        current = "";
      } else if (!current) {
        current = part;
      } else if (current.length + 1 + part.length <= max) {
        current = `${current} ${part}`;
      } else {
        chunks.push(current);
        current = part;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  LTV.splitForTts = function splitForTts(text, max = 180) {
    const value = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!value) return [];
    if (value.length <= max) return [value];
    const byClause = (part) =>
      packParts(splitByPattern(part, /(?<=[,;:])\s+/), max, (piece) =>
        packWords(piece, max),
      );
    return packParts(splitByPattern(value, /(?<=[.!?…])\s+/), max, byClause);
  };
})(globalThis);
