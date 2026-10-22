// Kho lời chép của video không có phụ đề trong chrome.storage.local:
//   "t:<videoKey>" → { ts, lang, engine, duration, cues: [{ start, end, text }] }
// Lần xem sau, lời chép đủ phủ thời lượng được dùng như phụ đề. Giữ tối đa
// MAX_TRANSCRIPTS video gần nhất.

const PREFIX = "t:";
const INDEX_KEY = "ltv-transcript-index";
const MAX_TRANSCRIPTS = 60;
const MAX_CUES = 5000;

function overlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function isValidCue(cue) {
  return (
    cue &&
    Number.isFinite(cue.start) &&
    Number.isFinite(cue.end) &&
    cue.end >= cue.start &&
    typeof cue.text === "string" &&
    cue.text.trim() !== ""
  );
}

// Gộp lời chép mới vào cũ; bỏ cue mới trùng quá nửa với cue đã có (xem lại, tua).
export function mergeCues(existing, incoming) {
  const result = (existing || []).filter(isValidCue).slice();
  for (const cue of (incoming || []).filter(isValidCue)) {
    const length = Math.max(cue.end - cue.start, 0.1);
    const duplicate = result.some((item) => overlap(item, cue) > length * 0.5);
    if (!duplicate) {
      result.push({ start: cue.start, end: cue.end, text: cue.text.trim() });
    }
  }
  return result.sort((a, b) => a.start - b.start).slice(0, MAX_CUES);
}

// Tỉ lệ thời lượng video có lời chép (tính phần hợp của các khoảng, nới
// mỗi cue thêm 2 giây để khoảng lặng ngắn giữa các câu không bị tính là thiếu).
export function coverage(cues, duration) {
  if (!(duration > 0) || !cues?.length) return 0;
  let covered = 0;
  let reach = 0;
  for (const cue of cues.slice().sort((a, b) => a.start - b.start)) {
    const start = Math.max(cue.start, reach);
    const end = Math.min(duration, cue.end + 2);
    if (end > start) covered += end - start;
    reach = Math.max(reach, end);
  }
  return Math.min(1, covered / duration);
}

export function createTranscriptStore({ storage, max = MAX_TRANSCRIPTS }) {
  async function readIndex() {
    const data = await storage.get(INDEX_KEY);
    const index = data[INDEX_KEY];
    return index && typeof index === "object" ? index : {};
  }

  return {
    async get(key) {
      const data = await storage.get(PREFIX + key);
      const entry = data[PREFIX + key];
      if (!entry) return null;
      return { ...entry, coverage: coverage(entry.cues, entry.duration) };
    },
    async put(key, { lang, engine, duration, cues }) {
      if (!key || !Array.isArray(cues) || cues.length === 0) return;
      const data = await storage.get(PREFIX + key);
      const previous = data[PREFIX + key];
      const index = await readIndex();
      const now = Date.now();
      index[key] = now;
      const sorted = Object.entries(index).sort((a, b) => b[1] - a[1]);
      const evicted = sorted.slice(max).map(([name]) => name);
      for (const name of evicted) delete index[name];
      await storage.set({
        [PREFIX + key]: {
          ts: now,
          lang: lang || previous?.lang || "",
          engine: engine || previous?.engine || "",
          duration: Number(duration) || previous?.duration || 0,
          cues: mergeCues(previous?.cues, cues),
        },
        [INDEX_KEY]: index,
      });
      if (evicted.length > 0) {
        await storage.remove(evicted.map((name) => PREFIX + name));
      }
    },
    async clear() {
      const index = await readIndex();
      await storage.remove([
        INDEX_KEY,
        ...Object.keys(index).map((key) => PREFIX + key),
      ]);
    },
    async keys() {
      return Object.keys(await readIndex());
    },
    async count() {
      return Object.keys(await readIndex()).length;
    },
  };
}
