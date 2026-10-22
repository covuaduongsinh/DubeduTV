// Ước lượng thời lượng đọc và chọn tốc độ để câu lồng tiếng vừa khung giờ
// của phụ đề gốc. Tốc độ đọc thực tế (ký tự/giây) được hiệu chỉnh dần sau
// mỗi câu đã đọc xong.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const DEFAULT_CPS = 14;
  const MIN_CPS = 6;
  const MAX_CPS = 30;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Ký tự phát âm: chữ và số; dấu phẩy/chấm tính thêm như một quãng ngắt.
  function spokenLength(text) {
    const value = String(text);
    const letters = (value.match(/[\p{L}\p{N}]/gu) || []).length;
    const pauses = (value.match(/[,;:.!?…]/g) || []).length;
    return letters + pauses * 2;
  }

  function estimateSeconds(text, cps) {
    return Math.max(0.4, spokenLength(text) / (cps || DEFAULT_CPS));
  }

  // available: số giây thực còn lại trước câu kế tiếp.
  function chooseRate({
    text,
    available,
    baseRate,
    maxRate,
    autoRate,
    cps,
    videoRate,
  }) {
    const speed = videoRate > 0 ? videoRate : 1;
    const base = clamp(baseRate * speed, 0.5, 4);
    if (!autoRate || !(available > 0)) return base;
    const needed = estimateSeconds(text, cps) / available;
    const ceiling = Math.max(base, clamp(maxRate * speed, 1, 4));
    return Math.round(clamp(Math.max(base, needed), 0.5, ceiling) * 100) / 100;
  }

  // Cập nhật ký tự/giây từ một câu đọc trọn vẹn (EMA α = 0.3).
  function calibrateCps(previous, text, elapsedSeconds, rate) {
    const current = previous || DEFAULT_CPS;
    if (!(elapsedSeconds > 0.3) || !(rate > 0)) return current;
    const length = spokenLength(text);
    if (length < 12) return current;
    const measured = length / elapsedSeconds / rate;
    return clamp(current * 0.7 + measured * 0.3, MIN_CPS, MAX_CPS);
  }

  LTV.timing = {
    DEFAULT_CPS,
    spokenLength,
    estimateSeconds,
    chooseRate,
    calibrateCps,
  };
})(globalThis);
