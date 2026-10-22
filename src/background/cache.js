// Cache bản dịch theo từng video trong chrome.storage.local:
//   "v:<videoKey>" → { ts, items: { <hash câu>: <bản dịch> } }
// Giữ tối đa MAX_VIDEOS video gần nhất (LRU theo thời điểm dùng).

const PREFIX = "v:";
const INDEX_KEY = "ltv-cache-index";
const MAX_VIDEOS = 150;
const WRITE_DELAY_MS = 1500;

export function createCache({
  storage,
  maxVideos = MAX_VIDEOS,
  writeDelay = WRITE_DELAY_MS,
}) {
  const dirty = new Map();
  let timer = null;

  async function readIndex() {
    const data = await storage.get(INDEX_KEY);
    return data[INDEX_KEY] && typeof data[INDEX_KEY] === "object"
      ? data[INDEX_KEY]
      : {};
  }

  async function flush() {
    timer = null;
    if (dirty.size === 0) return;
    const batch = new Map(dirty);
    dirty.clear();
    const keys = Array.from(batch.keys(), (key) => PREFIX + key);
    const existing = await storage.get(keys);
    const index = await readIndex();
    const updates = {};
    const now = Date.now();
    for (const [key, items] of batch) {
      const previous = existing[PREFIX + key]?.items || {};
      updates[PREFIX + key] = { ts: now, items: { ...previous, ...items } };
      index[key] = now;
    }
    const sorted = Object.entries(index).sort((a, b) => b[1] - a[1]);
    const evicted = sorted.slice(maxVideos).map(([key]) => key);
    for (const key of evicted) delete index[key];
    updates[INDEX_KEY] = index;
    await storage.set(updates);
    if (evicted.length > 0)
      await storage.remove(evicted.map((key) => PREFIX + key));
  }

  function schedule() {
    if (timer === null)
      timer = setTimeout(() => flush().catch(() => {}), writeDelay);
  }

  return {
    async get(key) {
      const data = await storage.get(PREFIX + key);
      const saved = data[PREFIX + key]?.items || {};
      return { ...saved, ...dirty.get(key) };
    },
    merge(key, items) {
      if (!key || !items || Object.keys(items).length === 0) return;
      dirty.set(key, { ...dirty.get(key), ...items });
      schedule();
    },
    flush,
    async clear() {
      dirty.clear();
      const index = await readIndex();
      await storage.remove([
        INDEX_KEY,
        ...Object.keys(index).map((key) => PREFIX + key),
      ]);
    },
    // Khoá các video đang có bản dịch (kể cả mục chưa kịp ghi).
    async keys() {
      return [...new Set([...Object.keys(await readIndex()), ...dirty.keys()])];
    },
    async stats() {
      const index = await readIndex();
      const bytes = storage.getBytesInUse
        ? await storage.getBytesInUse(null)
        : 0;
      return { videos: Object.keys(index).length, bytes };
    },
  };
}
