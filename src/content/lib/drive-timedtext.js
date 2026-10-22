// Địa chỉ phụ đề của video trên Google Drive (timedtext cùng nguồn với
// drive.google.com, cần cookie đăng nhập): nhận diện URL, dựng URL danh sách
// track / tải một track từ tham số gốc, đọc danh sách track dạng XML.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  // Nguồn hợp lệ của trang Drive và khung trình phát (bản kiểm thử thay bằng
  // máy giả lập).
  LTV.DRIVE_ORIGINS = {
    parent: /^https:\/\/drive\.google\.com$/,
    child: /^https:\/\/youtube\.googleapis\.com$/,
  };

  const TRACK_PARAMS = ["type", "lang", "name", "kind", "fmt", "tlang"];

  function parse(url) {
    try {
      return new URL(url, root.location?.href);
    } catch {
      return null;
    }
  }

  function isTimedtextUrl(url, origin) {
    const target = parse(url);
    return (
      Boolean(target) &&
      target.origin === origin &&
      /^\/(?:u\/\d+\/)?timedtext$/.test(target.pathname)
    );
  }

  // Bỏ các tham số chọn track, giữ phần định danh video/đăng nhập.
  function baseOf(url) {
    const target = parse(url);
    for (const key of TRACK_PARAMS) target.searchParams.delete(key);
    return target.href;
  }

  function listUrl(base) {
    const target = new URL(baseOf(base));
    target.searchParams.set("type", "list");
    return target.href;
  }

  function trackUrl(base, { lang, name, kind }, fmt) {
    const target = new URL(baseOf(base));
    target.searchParams.set("type", "track");
    target.searchParams.set("lang", String(lang || ""));
    target.searchParams.set("name", String(name || ""));
    if (kind === "asr") target.searchParams.set("kind", "asr");
    if (fmt) target.searchParams.set("fmt", fmt);
    return target.href;
  }

  // <track lang_code="en" name="" kind="asr" lang_translated="English"/>.
  function parseTrackList(xml) {
    const tracks = [];
    for (const [, attrs] of String(xml || "").matchAll(/<track\b([^>]*)>/g)) {
      const get = (key) =>
        LTV.captions.decodeEntities(
          new RegExp(`\\b${key}="([^"]*)"`).exec(attrs)?.[1] || "",
        );
      const lang = get("lang_code");
      if (!lang) continue;
      tracks.push({
        lang,
        name: get("name"),
        kind: get("kind") === "asr" ? "asr" : "manual",
        label: get("lang_translated") || get("lang_original") || lang,
      });
    }
    return tracks;
  }

  const fileIdFromPath = (pathname) =>
    /\/file\/d\/([\w-]+)/.exec(String(pathname || ""))?.[1] || null;

  // Khung trình phát có thể mang sẵn địa chỉ phụ đề trong tham số ttsurl.
  function ttsUrlFrom(src) {
    return parse(src)?.searchParams.get("ttsurl") || null;
  }

  LTV.driveTimedtext = {
    isTimedtextUrl,
    baseOf,
    listUrl,
    trackUrl,
    parseTrackList,
    fileIdFromPath,
    ttsUrlFrom,
  };
})(globalThis);
