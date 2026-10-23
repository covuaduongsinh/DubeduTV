// Hàng đợi dịch: chỉ dịch trước một đoạn câu từ vị trí đang xem (lô đầu nhỏ
// để bắt đầu đọc sau vài giây), đoạn này trượt theo video. Không dịch cả video
// một lúc: video dài hàng giờ sẽ thành hàng trăm yêu cầu dồn dập và Google
// Dịch tạm chặn cả mạng của người dùng. Bản dịch lưu cache theo
// video và theo bộ dịch thật đã dịch câu đó (Google dự phòng không bị lưu
// thành bản dịch Claude); khi mở lại chỉ đọc cache của bộ dịch đang chọn.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const FIRST_BATCH = 10;
  const BATCH = 40;
  const MAX_BATCH_CHARS = 4000;
  const MAX_INFLIGHT = 2;
  // Số câu dịch trước tính từ vị trí đang xem (thường 10–15 phút video).
  const LOOKAHEAD = 200;
  const CONTEXT_LINES = 3;
  const MAX_FAILURES = 3;
  const RETRY_AFTER_MS = 8000;

  // Chỉ số các câu chưa dịch, chưa gửi, trong [start, end) (giới hạn số câu và
  // ký tự).
  function collectFrom(sentences, pending, { start, end, size }) {
    const batch = [];
    let chars = 0;
    for (let i = start; i < end && batch.length < size; i += 1) {
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

  function countDone(sentences, from = 0, to = sentences.length) {
    let count = 0;
    for (let i = from; i < to; i += 1) if (sentences[i].tr) count += 1;
    return count;
  }

  // Yêu cầu dịch một lô, kèm vài câu đứng trước làm ngữ cảnh.
  function translateRequest(options, batch) {
    const { sentences } = options;
    const contextStart = Math.max(0, batch[0] - CONTEXT_LINES);
    return {
      type: "translate",
      texts: batch.map((index) => sentences[index].text),
      context: sentences.slice(contextStart, batch[0]).map((s) => s.text),
      sl: options.sl,
      tl: options.tl,
      title: options.title,
      engine: options.engine,
      domain: options.domain || null,
    };
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
    const { sentences, connection, cacheKeyFor, engine } = options;
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
    const doneCount = (from, to) => countDone(sentences, from, to);
    const windowEnd = () => Math.min(sentences.length, cursor + LOOKAHEAD);
    // Tiến độ của đoạn dịch trước, không phải của cả video.
    const progress = () => ({
      done: doneCount(cursor, windowEnd()),
      total: windowEnd() - cursor,
    });
    const report = () => {
      const { done, total } = progress();
      onProgress(done, total);
    };

    function nextBatch() {
      const size = firstBatchSent ? BATCH : FIRST_BATCH;
      return collectFrom(sentences, pending, {
        start: cursor,
        end: windowEnd(),
        size,
      });
    }

    async function send(batch) {
      batch.forEach((index) => pending.add(index));
      inflight += 1;
      firstBatchSent = true;
      try {
        const response = await connection.request(
          translateRequest(options, batch),
        );
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
          report();
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
        report();
      },
      // Gọi khi bắt đầu xem, mỗi khi đọc sang câu mới và khi tua: đoạn dịch
      // trước trượt theo vị trí này.
      ensureFrom(index) {
        const start = Math.min(Math.max(0, index), sentences.length);
        // Tua tới đoạn chưa dịch: lô đầu nhỏ để đọc lại nhanh.
        if (start !== cursor && !sentences[start]?.tr && !pending.has(start))
          firstBatchSent = false;
        cursor = start;
        if (Date.now() >= pausedUntil && failures >= MAX_FAILURES) failures = 0;
        pump();
      },
      progress,
      cancel() {
        cancelled = true;
      },
    };
  };
})(globalThis);
