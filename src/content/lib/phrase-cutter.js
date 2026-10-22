// Cắt sớm lời đang nghe (kết quả tạm của bộ nhận dạng) thành cụm ngắn để đọc
// ngay ở chế độ song song, thay vì chờ người nói hết câu: cắt sau dấu câu
// hoặc trước liên từ tiếng Anh khi đủ 4 từ (cụm đầu của mỗi lượt nói) hay 7
// từ (cụm sau), cắt cứng ở 14 từ; im lặng 700 ms thì đọc nốt phần đang chờ.
// Từ cuối của kết quả tạm còn có thể đổi nên chưa bao giờ bị cắt. Mốc thời
// gian của các cụm luôn tăng dần.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const DEFAULTS = {
    firstMin: 4,
    nextMin: 7,
    maxWords: 14,
    flushMs: 700,
    startLatency: 0.8,
    endLatency: 0.3,
  };
  const CONJUNCTIONS = new Set([
    "and",
    "but",
    "so",
    "because",
    "which",
    "that",
    "then",
    "or",
    "when",
    "if",
    "while",
    "although",
    "though",
    "since",
    "where",
    "who",
    "until",
    "unless",
    "whether",
    "after",
    "before",
  ]);
  const ENDS_CLAUSE = /[,.;:!?…]["')\]]*$/;

  const realClock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  const splitWords = (text) =>
    String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const round = (value) => Math.round(value * 1000) / 1000;

  // Số từ của cụm tiếp theo trong words, 0 nếu chưa cắt được.
  function findCut(words, min, max) {
    const limit = Math.min(words.length, max);
    for (let count = min; count <= limit; count += 1) {
      if (ENDS_CLAUSE.test(words[count - 1])) return count;
      const next = words[count]?.toLowerCase().replace(/[^a-z]/g, "");
      if (next && CONJUNCTIONS.has(next)) return count;
    }
    return words.length >= max ? max : 0;
  }

  LTV.createPhraseCutter = function createPhraseCutter({
    onPhrase,
    now,
    clock = realClock,
    options = {},
  }) {
    const config = { ...DEFAULTS, ...options };
    const entries = new Map();
    let lastEnd = 0;

    function emit(entry, count) {
      const words = entry.words.slice(entry.sent, entry.sent + count);
      const first = entry.sent === 0;
      const start = Math.max(
        lastEnd,
        first ? entry.firstHeard - config.startLatency : entry.lastEnd,
        0,
      );
      const end = Math.max(start + 0.3, now() - config.endLatency);
      entry.sent += count;
      entry.lastEnd = end;
      lastEnd = end;
      if (words.length > 0)
        onPhrase({
          start: round(start),
          end: round(end),
          text: words.join(" "),
        });
    }

    function cutStable(entry) {
      for (;;) {
        const stable = entry.words.slice(entry.sent, -1);
        const min = entry.sent === 0 ? config.firstMin : config.nextMin;
        const count = findCut(stable, min, config.maxWords);
        if (count === 0) return;
        emit(entry, count);
      }
    }

    function flush(entry) {
      const rest = entry.words.length - entry.sent;
      if (rest > 0) emit(entry, rest);
    }

    function entryFor({ key, firstHeard }) {
      if (!entries.has(key))
        entries.set(key, {
          sent: 0,
          words: [],
          firstHeard,
          lastEnd: 0,
          timer: null,
        });
      return entries.get(key);
    }

    return {
      // Kết quả tạm { key, text, firstHeard }.
      interim(result) {
        const entry = entryFor(result);
        entry.words = splitWords(result.text);
        entry.sent = Math.min(entry.sent, entry.words.length);
        cutStable(entry);
        clock.clearTimeout(entry.timer);
        entry.timer = clock.setTimeout(() => flush(entry), config.flushMs);
      },
      // Kết quả cuối của cùng lượt nói: đọc phần chưa đọc.
      final(result) {
        const entry = entryFor(result);
        clock.clearTimeout(entry.timer);
        entry.words = splitWords(result.text);
        flush(entry);
        entries.delete(result.key);
      },
      has: (key) => entries.has(key),
      reset() {
        for (const entry of entries.values()) clock.clearTimeout(entry.timer);
        entries.clear();
        lastEnd = 0;
      },
    };
  };

  LTV.phraseCut = { findCut };
})(globalThis);
