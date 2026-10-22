// Quyết định khi nào cắt đoạn âm thanh gửi Whisper: đủ dài và gặp khoảng lặng
// (để không cắt giữa từ), hoặc chạm độ dài tối đa. Đoạn gần như im lặng được
// đánh dấu để bỏ qua, tránh Whisper "bịa" câu từ tiếng ồn.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const DEFAULTS = {
    minSeconds: 5,
    maxSeconds: 15,
    silenceSeconds: 0.35,
    threshold: 0.01,
    minSpeechSeconds: 0.3,
  };

  LTV.createChunkPlanner = function createChunkPlanner(overrides) {
    const options = { ...DEFAULTS, ...overrides };
    let elapsed = 0;
    let silentFor = 0;
    let speech = 0;

    return {
      // Một khung phân tích: rms (0–1) kéo dài `seconds`. Trả true khi nên cắt.
      push(rms, seconds) {
        elapsed += seconds;
        if (rms >= options.threshold) {
          speech += seconds;
          silentFor = 0;
        } else {
          silentFor += seconds;
        }
        if (elapsed >= options.maxSeconds) return true;
        return (
          elapsed >= options.minSeconds && silentFor >= options.silenceSeconds
        );
      },
      // Không đo được âm lượng (AudioContext bị chặn): cắt theo thời gian, coi là có tiếng.
      pushBlind(seconds) {
        elapsed += seconds;
        speech += seconds;
        return elapsed >= options.maxSeconds * 0.7;
      },
      hasSpeech: () => speech >= options.minSpeechSeconds,
      elapsed: () => elapsed,
      reset() {
        elapsed = 0;
        silentFor = 0;
        speech = 0;
      },
    };
  };

  LTV.rms = function rms(samples) {
    let sum = 0;
    for (const value of samples) sum += value * value;
    return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
  };
})(globalThis);
