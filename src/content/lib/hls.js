// Playlist HLS (m3u8) và phụ đề WebVTT chia đoạn (video X/Twitter): đọc danh
// sách phụ đề trong master playlist, các đoạn của playlist phụ đề và ghép cue
// của mọi đoạn về cùng một trục thời gian theo X-TIMESTAMP-MAP.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MPEGTS_HZ = 90000;

  // KEY=VALUE,KEY="giá trị có thể chứa dấu phẩy".
  function parseAttributes(text) {
    const result = {};
    for (const [, key, raw] of String(text).matchAll(
      /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g,
    )) {
      result[key] = raw.startsWith('"') ? raw.slice(1, -1) : raw;
    }
    return result;
  }

  function resolve(uri, base) {
    try {
      return new URL(uri, base).href;
    } catch {
      return null;
    }
  }

  function lines(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  // { isMaster, subtitles: [{ lang, label, kind, uri, isDefault }] }.
  function parseMaster(text, url) {
    const all = lines(text);
    const subtitles = [];
    for (const line of all) {
      if (!line.startsWith("#EXT-X-MEDIA:")) continue;
      const attrs = parseAttributes(line.slice("#EXT-X-MEDIA:".length));
      const uri = attrs.URI ? resolve(attrs.URI, url) : null;
      if (attrs.TYPE !== "SUBTITLES" || !uri) continue;
      subtitles.push({
        lang: attrs.LANGUAGE || "und",
        label: attrs.NAME || attrs.LANGUAGE || "",
        kind: /auto/i.test(attrs.NAME || "") ? "asr" : "manual",
        uri,
        isDefault: attrs.DEFAULT === "YES",
      });
    }
    return {
      isMaster: all.some((line) => line.startsWith("#EXT-X-STREAM-INF")),
      subtitles,
    };
  }

  // Các đoạn của một media playlist: [{ uri, start, duration }].
  function parseMedia(text, url) {
    const segments = [];
    let start = 0;
    let duration = 0;
    for (const line of lines(text)) {
      if (line.startsWith("#EXTINF:")) {
        duration = parseFloat(line.slice("#EXTINF:".length)) || 0;
      } else if (!line.startsWith("#")) {
        const uri = resolve(line, url);
        if (uri) segments.push({ uri, start, duration });
        start += duration;
        duration = 0;
      }
    }
    return segments;
  }

  // X-TIMESTAMP-MAP=MPEGTS:<90 kHz>,LOCAL:<hh:mm:ss.mmm> (thứ tự bất kỳ).
  function parseTimestampMap(vtt) {
    const header = /X-TIMESTAMP-MAP=([^\r\n]*)/.exec(String(vtt || ""))?.[1];
    const mpegts = header && /MPEGTS:(\d+)/.exec(header)?.[1];
    const local = header && /LOCAL:([\d:.]+)/.exec(header)?.[1];
    if (!mpegts || !local) return null;
    return {
      mpegts: Number(mpegts),
      local: LTV.captions.parseTimestamp(local),
    };
  }

  // Ghép cue của các đoạn [{ text, start }]: lấy bản đồ thời gian của đoạn
  // đầu làm gốc; đoạn ghi mốc tương đối (cue kết thúc trước đầu đoạn) thì
  // cộng thêm thời điểm bắt đầu đoạn. Bỏ cue trùng ở ranh giới hai đoạn.
  function cuesFromSegments(segments) {
    let base = null;
    const cues = [];
    for (const segment of segments) {
      const parsed = LTV.captions.parseCaptions(segment.text);
      if (parsed.length === 0) continue;
      const map = parseTimestampMap(segment.text);
      if (map && !base) base = map;
      let shift =
        map && base
          ? (map.mpegts - base.mpegts) / MPEGTS_HZ - (map.local - base.local)
          : 0;
      if (parsed[parsed.length - 1].end + shift < segment.start - 1)
        shift += segment.start;
      for (const cue of parsed)
        cues.push({ ...cue, start: cue.start + shift, end: cue.end + shift });
    }
    cues.sort((a, b) => a.start - b.start);
    return cues.filter(
      (cue, i) =>
        i === 0 ||
        cue.text !== cues[i - 1].text ||
        Math.abs(cue.start - cues[i - 1].start) > 0.5,
    );
  }

  // Mã media trong URL ảnh bìa / playlist của X (để khớp video với playlist).
  function mediaIdFromUrl(url) {
    return (
      /\/(?:ext_tw_video|amplify_video|tweet_video)(?:_thumb)?\/(\d+)\//.exec(
        String(url || ""),
      )?.[1] || null
    );
  }

  LTV.hls = {
    parseAttributes,
    parseMaster,
    parseMedia,
    parseTimestampMap,
    cuesFromSegments,
    mediaIdFromUrl,
  };
})(globalThis);
