// Gộp cue phụ đề (thường là mảnh dòng 2–4 giây) thành câu trọn ý để dịch và
// đọc tự nhiên: làm sạch chú thích [Music], bỏ phần lặp của phụ đề cuộn,
// tách tại dấu kết câu, rồi gộp theo khoảng lặng / độ dài / thời lượng.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const DEFAULT_OPTIONS = {
    maxChars: 160,
    maxDuration: 9,
    pauseGap: 0.65,
    minDuration: 0.8,
    minChars: 8,
  };

  const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/;
  const ABBREVIATIONS = new Set([
    "mr.",
    "mrs.",
    "ms.",
    "dr.",
    "prof.",
    "vs.",
    "etc.",
    "e.g.",
    "i.e.",
    "st.",
    "no.",
  ]);

  function cleanText(text) {
    return String(text)
      .replace(/\[[^\]]*\]/g, " ")
      .replace(
        /\((?:[^)]*\b(?:music|applause|laughter|laughs|nhạc)\b[^)]*)\)/gi,
        " ",
      )
      .replace(/[♪♫]+/g, " ")
      .replace(/(^|\s)>>+/g, " ")
      .replace(/^\s*-\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function endsSentence(text) {
    if (!SENTENCE_END.test(text)) return false;
    const lastWord = text.split(" ").pop().toLowerCase();
    return !ABBREVIATIONS.has(lastWord);
  }

  function words(text) {
    return text.split(" ").filter(Boolean);
  }

  // Phụ đề cuộn lặp lại phần cuối dòng trước ở đầu dòng sau.
  function removeOverlap(previous, current) {
    if (current.startsWith(previous))
      return current.slice(previous.length).trim();
    const prevWords = words(previous.toLowerCase());
    const currWords = words(current);
    const lowerCurr = currWords.map((word) => word.toLowerCase());
    const limit = Math.min(prevWords.length, currWords.length);
    for (let size = limit; size >= 2; size -= 1) {
      const tail = prevWords.slice(prevWords.length - size).join(" ");
      if (tail === lowerCurr.slice(0, size).join(" ")) {
        return currWords.slice(size).join(" ");
      }
    }
    return current;
  }

  function normalizeCues(cues) {
    const sorted = cues
      .map((cue) => ({
        start: cue.start,
        end: cue.end,
        text: cleanText(cue.text),
      }))
      .filter((cue) => cue.text && Number.isFinite(cue.start))
      .sort((a, b) => a.start - b.start);
    const result = [];
    for (const cue of sorted) {
      const previous = result[result.length - 1];
      if (previous) {
        if (cue.text === previous.text) {
          previous.end = Math.max(previous.end, cue.end);
          continue;
        }
        cue.text = removeOverlap(previous.text, cue.text);
        if (!cue.text) {
          previous.end = Math.max(previous.end, cue.end);
          continue;
        }
        if (previous.end > cue.start) {
          previous.end = Math.max(previous.start + 0.2, cue.start);
        }
      }
      result.push({ ...cue, end: Math.max(cue.end, cue.start + 0.2) });
    }
    return result;
  }

  // Tách cue có dấu kết câu ở giữa, chia thời gian theo số ký tự.
  function splitAtSentences(cue) {
    const parts = cue.text.split(/(?<=[.!?…。！？]["'”’)\]]*)\s+(?=\S)/);
    const pieces = [];
    let buffer = "";
    for (const part of parts) {
      buffer = buffer ? `${buffer} ${part}` : part;
      if (endsSentence(buffer) || part === parts[parts.length - 1]) {
        pieces.push(buffer);
        buffer = "";
      }
    }
    if (pieces.length <= 1) return [cue];
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const duration = cue.end - cue.start;
    let cursor = cue.start;
    return pieces.map((piece) => {
      const start = cursor;
      cursor += (duration * piece.length) / total;
      return { start, end: cursor, text: piece };
    });
  }

  function shouldBreakBefore(current, next, options) {
    if (!current) return false;
    if (next.start - current.end > options.pauseGap) return true;
    if (current.text.length + 1 + next.text.length > options.maxChars)
      return true;
    return next.end - current.start > options.maxDuration;
  }

  function mergePieces(pieces, options) {
    const sentences = [];
    let current = null;
    const flush = () => {
      if (current) sentences.push(current);
      current = null;
    };
    for (const piece of pieces) {
      if (shouldBreakBefore(current, piece, options)) flush();
      if (current) {
        current.text = `${current.text} ${piece.text}`;
        current.end = Math.max(current.end, piece.end);
      } else {
        current = { ...piece };
      }
      if (endsSentence(current.text)) flush();
    }
    flush();
    return sentences;
  }

  function isTiny(sentence, options) {
    return (
      sentence.end - sentence.start < options.minDuration ||
      sentence.text.length < options.minChars
    );
  }

  // Câu quá ngắn ("Yes.", "Okay") gộp vào câu trước nếu liền mạch.
  function mergeTiny(sentences, options) {
    const result = [];
    for (const sentence of sentences) {
      const previous = result[result.length - 1];
      const canJoin =
        previous &&
        isTiny(sentence, options) &&
        sentence.start - previous.end <= 1 &&
        previous.text.length + sentence.text.length <= options.maxChars * 1.3;
      if (canJoin) {
        previous.text = `${previous.text} ${sentence.text}`;
        previous.end = Math.max(previous.end, sentence.end);
      } else {
        result.push({ ...sentence });
      }
    }
    return result;
  }

  function buildSentences(cues, overrides) {
    const options = { ...DEFAULT_OPTIONS, ...overrides };
    const pieces = normalizeCues(cues).flatMap(splitAtSentences);
    const merged = mergeTiny(mergePieces(pieces, options), options);
    return merged.map((sentence, id) => ({
      id,
      start: Math.round(sentence.start * 1000) / 1000,
      end: Math.round(sentence.end * 1000) / 1000,
      text: sentence.text,
    }));
  }

  LTV.segment = { cleanText, normalizeCues, buildSentences, endsSentence };
})(globalThis);
