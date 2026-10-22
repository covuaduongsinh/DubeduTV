// Đọc phụ đề WebVTT/SRT, YouTube json3 và YouTube XML (srv1/srv3) thành
// danh sách cue thống nhất: { start, end, text } tính bằng giây.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    "#39": "'",
  };

  function decodeEntities(text) {
    return String(text).replace(
      /&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi,
      (match, name) => {
        const lower = name.toLowerCase();
        if (lower.startsWith("#x")) {
          return String.fromCodePoint(parseInt(lower.slice(2), 16));
        }
        if (lower.startsWith("#")) {
          return String.fromCodePoint(parseInt(lower.slice(1), 10));
        }
        return NAMED_ENTITIES[lower] ?? match;
      },
    );
  }

  function stripTags(text) {
    return String(text).replace(/<[^>]*>/g, "");
  }

  function cleanPayload(text) {
    return decodeEntities(stripTags(text)).replace(/\s+/g, " ").trim();
  }

  // "01:02:03.456", "02:03.456", "00:00:01,000" → giây.
  function parseTimestamp(value) {
    const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(
      String(value).trim(),
    );
    if (!match) return null;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number((match[4] || "0").padEnd(3, "0"));
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
  }

  const TIMING_LINE = /^\s*(\S+)\s+-->\s+(\S+)/;

  function parseVttBlock(lines) {
    const timingIndex = lines.findIndex((line) => TIMING_LINE.test(line));
    if (timingIndex < 0) return null;
    const [, rawStart, rawEnd] = TIMING_LINE.exec(lines[timingIndex]);
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(rawEnd);
    if (start === null || end === null) return null;
    const text = cleanPayload(lines.slice(timingIndex + 1).join(" "));
    if (!text) return null;
    return { start, end: Math.max(end, start), text };
  }

  function parseVtt(source) {
    const normalized = String(source).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const cues = [];
    for (const block of normalized.split(/\n{2,}/)) {
      const lines = block.split("\n").filter((line) => line.trim() !== "");
      if (lines.length === 0) continue;
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
      const cue = parseVttBlock(lines);
      if (cue) cues.push(cue);
    }
    return cues;
  }

  // Cue YouTube ASR có thời gian từng từ: ước lượng thời điểm kết thúc từ
  // cuối thay vì dùng thời lượng hiển thị (kéo dài sang dòng sau).
  function json3End(event, segs) {
    const start = event.tStartMs || 0;
    const shownEnd = start + (event.dDurationMs || 0);
    const offsets = segs
      .map((seg) => seg.tOffsetMs)
      .filter((value) => typeof value === "number");
    if (offsets.length === 0) return shownEnd;
    const lastWord = segs[segs.length - 1].utf8 || "";
    const wordMs = Math.min(1200, 300 + lastWord.trim().length * 60);
    const spokenEnd = start + Math.max(...offsets) + wordMs;
    return Math.min(shownEnd || spokenEnd, spokenEnd);
  }

  function parseYouTubeJson3(source) {
    const data = typeof source === "string" ? JSON.parse(source) : source;
    const cues = [];
    for (const event of data?.events || []) {
      const segs = Array.isArray(event.segs) ? event.segs : [];
      if (segs.length === 0) continue;
      const text = cleanPayload(segs.map((seg) => seg.utf8 || "").join(""));
      if (!text) continue;
      const start = (event.tStartMs || 0) / 1000;
      const end = json3End(event, segs) / 1000;
      cues.push({ start, end: Math.max(end, start), text });
    }
    return cues;
  }

  function attribute(attributes, name) {
    const match = new RegExp(`\\b${name}="([\\d.]+)"`).exec(attributes);
    return match ? Number(match[1]) : null;
  }

  // srv3: <p t="ms" d="ms">…</p>; srv1: <text start="s" dur="s">…</text>.
  function parseXmlElements(xml, { tag, startName, durationName, scale }) {
    const cues = [];
    const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g");
    for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
      const startValue = attribute(match[1], startName);
      if (startValue === null) continue;
      // srv1 mã hoá thực thể hai lần (&amp;#39;), nên giải mã thêm một lượt.
      const text = cleanPayload(decodeEntities(match[2]));
      if (!text) continue;
      const start = startValue / scale;
      const duration = (attribute(match[1], durationName) || 0) / scale;
      cues.push({ start, end: start + duration, text });
    }
    return cues;
  }

  function parseYouTubeXml(source) {
    const xml = String(source);
    const srv3 = parseXmlElements(xml, {
      tag: "p",
      startName: "t",
      durationName: "d",
      scale: 1000,
    });
    if (srv3.length > 0) return srv3;
    return parseXmlElements(xml, {
      tag: "text",
      startName: "start",
      durationName: "dur",
      scale: 1,
    });
  }

  // Tự nhận diện định dạng; trả [] khi không đọc được.
  function parseCaptions(source) {
    const text = String(source || "")
      .replace(/^﻿/, "")
      .trimStart();
    if (!text) return [];
    try {
      if (text.startsWith("{")) return parseYouTubeJson3(text);
      if (text.startsWith("<")) return parseYouTubeXml(text);
      if (text.startsWith("WEBVTT") || text.includes("-->"))
        return parseVtt(text);
    } catch {
      return [];
    }
    return [];
  }

  LTV.captions = {
    decodeEntities,
    parseTimestamp,
    parseVtt,
    parseYouTubeJson3,
    parseYouTubeXml,
    parseCaptions,
  };
})(globalThis);
