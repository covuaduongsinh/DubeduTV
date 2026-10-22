// Tra cứu trên máy những video đã có bản dịch hoặc lời chép (huy hiệu
// "Đã lồng" và chế độ tự bật "chỉ video đã lồng"). Không gọi mạng.
import "../shared/defaults.js";

const LTV = globalThis.LTV;
const MAX_SESSIONS = 200;

export function createLibrary({ cache, transcripts }) {
  return {
    async lookup({ sessions, tl }) {
      const wanted = new Set(
        (Array.isArray(sessions) ? sessions : [])
          .slice(0, MAX_SESSIONS)
          .map(String),
      );
      const [cacheKeys, transcriptKeys] = await Promise.all([
        cache.keys(),
        transcripts.keys(),
      ]);
      const cached = new Set();
      for (const key of cacheKeys) {
        const parsed = LTV.parseCacheKey(key);
        if (
          parsed &&
          wanted.has(parsed.session) &&
          LTV.baseLang(parsed.tl) === LTV.baseLang(tl)
        )
          cached.add(parsed.session);
      }
      return {
        cached: [...cached],
        transcripts: transcriptKeys.filter((key) => wanted.has(key)),
      };
    },
  };
}
