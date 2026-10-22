// Hàng đợi dịch: ưu tiên các câu quanh vị trí đang xem (lô đầu nhỏ để bắt đầu
// đọc sau vài giây), sau đó dịch dần phần còn lại. Bản dịch lưu cache theo
// video và theo bộ dịch thật đã dịch câu đó (Google dự phòng không bị lưu
// thành bản dịch Claude); khi mở lại chỉ đọc cache của bộ dịch đang chọn.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const FIRST_BATCH = 10;
  const BATCH = 40;
  const MAX_BATCH_CHARS = 4000;
  const MAX_INFLIGHT = 2;
  const CONTEXT_LINES = 3;
  const MAX_FAILURES = 3;
  const RETRY_AFTER_MS = 8000;

  // Chỉ số các câu chưa dịch, chưa gửi, từ start trở đi (giới hạn số câu và ký tự).
  function collectFrom(sentences, pending, start, size) {
    const batch = [];
    let chars = 0;
    for (let i = start; i < sentences.length && batch.length < size; i += 1) {
      if (sentences[i].tr || pending.has(i)) continue;
      if (
        batch.length > 0 &&
        chars + sentences[i].text.length > MAX_BATCH_CHARS
      )
        break;
      batch.push(i);
      chars += sentences[i].text.length;
    }
    return batch;
  }

  // Gán bản dịch vào câu; trả về các mục mới để lưu cache, nhóm theo bộ dịch
  // { engine: { hash: bản dịch } }.
  function applyResults(sentences, hashes, batch, response) {
    const fresh = {};
    (response.results || []).forEach((result, k) => {
      const index = batch[k];
      if (index === undefined || typeof result !== "string" || !result.trim())
        return;
      sentences[index].tr = result.trim();
      const engine = response.engines?.[k];
      if (!engine) return;
      fresh[engine] = fresh[engine] || {};
      fresh[engine][hashes[index]] = sentences[index].tr;
    });
    return fresh;
  }

  async function readCache(connection, key) {
    try {
      const response = await connection.request(
        { type: "cache:get", key },
        15000,
      );
      return response.items || {};
    } catch {
      return {}; // Không có cache vẫn dịch bình thường.
    }
  }

  function saveFresh(connection, cacheKeyFor, fresh) {
    for (const [engine, items] of Object.entries(fresh))
      connection.post({ type: "cache:put", key: cacheKeyFor(engine), items });
  }

  LTV.createTranslationQueue = function createTranslationQueue(options) {
    const { sentences, connection, cacheKeyFor, engine, sl, tl, title } =
      options;
    const domain = options.domain || null;
    const onProgress = options.onProgress || (() => {});
    const onWarning = options.onWarning || (() => {});
    const onError = options.onError || (() => {});
    const pending = new Set();
    let cursor = 0;
    let inflight = 0;
    let failures = 0;
    let pausedUntil = 0;
    let cancelled = false;
    let firstBatchSent = false;

    const hashes = sentences.map((sentence) =>
      LTV.util.hashText(sentence.text),
    );
    const doneCount = () =>
      sentences.reduce((count, s) => count + (s.tr ? 1 : 0), 0);

    function nextBatch() {
      const size = firstBatchSent ? BATCH : FIRST_BATCH;
      const forward = collectFrom(sentences, pending, cursor, size);
      return forward.length > 0
        ? forward
        : collectFrom(sentences, pending, 0, size);
    }

    async function send(batch) {
      batch.forEach((index) => pending.add(index));
      inflight += 1;
      firstBatchSent = true;
      const contextStart = Math.max(0, batch[0] - CONTEXT_LINES);
      try {
        const response = await connection.request({
          type: "translate",
          texts: batch.map((index) => sentences[index].text),
          context: sentences.slice(contextStart, batch[0]).map((s) => s.text),
          sl,
          tl,
          title,
          engine,
          domain,
        });
        if (cancelled) return;
        const done = doneCount();
        saveFresh(
          connection,
          cacheKeyFor,
          applyResults(sentences, hashes, batch, response),
        );
        const applied = doneCount() - done;
        if (response.warning) onWarning(response.warning);
        if (response.error && applied === 0) throw new Error(response.error);
        failures = 0;
      } catch (error) {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_FAILURES) pausedUntil = Date.now() + RETRY_AFTER_MS;
        onError(error.message || String(error), failures);
      } finally {
        batch.forEach((index) => pending.delete(index));
        inflight -= 1;
        if (!cancelled) {
          onProgress(doneCount(), sentences.length);
          pump();
        }
      }
    }

    function pump() {
      if (cancelled || Date.now() < pausedUntil) return;
      while (inflight < MAX_INFLIGHT) {
        const batch = nextBatch();
        if (batch.length === 0) return;
        send(batch);
      }
    }

    return {
      async loadCache() {
        const items = await readCache(connection, cacheKeyFor(engine));
        sentences.forEach((sentence, index) => {
          if (!sentence.tr && items[hashes[index]])
            sentence.tr = items[hashes[index]];
        });
        onProgress(doneCount(), sentences.length);
      },
      ensureFrom(index) {
        const start = Math.max(0, index);
        if (start !== cursor) cursor = start;
        if (Date.now() >= pausedUntil && failures >= MAX_FAILURES) failures = 0;
        pump();
      },
      progress: () => ({ done: doneCount(), total: sentences.length }),
      cancel() {
        cancelled = true;
      },
    };
  };
})(globalThis);
