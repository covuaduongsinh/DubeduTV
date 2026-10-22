// Chọn phụ đề nguồn tốt nhất trong các track mà trang cung cấp.
// Track: { lang, kind: "manual" | "asr", label, ...thông tin riêng của site }.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  function sameLang(a, b) {
    return LTV.baseLang(a) === LTV.baseLang(b);
  }

  // Ngôn ngữ âm thanh gốc: phụ đề tự động (asr) luôn theo giọng nói gốc.
  function spokenLanguage(tracks) {
    const asr = tracks.find((track) => track.kind === "asr");
    return asr ? asr.lang : null;
  }

  function rank(track, spoken) {
    let score = 0;
    if (track.kind !== "asr") score += 100;
    if (spoken && sameLang(track.lang, spoken)) score += 20;
    if (LTV.baseLang(track.lang) === "en") score += 5;
    return score;
  }

  // Trả { track, needsTranslation } hoặc null khi không có track nào.
  function chooseTrack(tracks, { sourceLang, targetLang }) {
    const usable = (tracks || []).filter((track) => track && track.lang);
    if (usable.length === 0) return null;
    const ready = usable.find(
      (track) => track.kind !== "asr" && sameLang(track.lang, targetLang),
    );
    if (ready) return { track: ready, needsTranslation: false };
    const wanted =
      sourceLang && sourceLang !== "auto"
        ? usable.filter((track) => sameLang(track.lang, sourceLang))
        : [];
    const pool = wanted.length > 0 ? wanted : usable;
    const spoken = spokenLanguage(usable);
    const best = pool
      .slice()
      .sort((a, b) => rank(b, spoken) - rank(a, spoken))[0];
    return {
      track: best,
      needsTranslation: !sameLang(best.lang, targetLang),
    };
  }

  LTV.tracks = { chooseTrack, sameLang };
})(globalThis);
