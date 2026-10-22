// Địa chỉ phụ đề YouTube (timedtext). YouTube ngày càng đòi token chống bot
// (pot) mà chỉ trình phát mới có; khi trình phát đã tải phụ đề của video một
// lần (bất kỳ ngôn ngữ nào), dùng lại các tham số đã ký đó cho track mình cần
// thay vì phải bật đúng track trên trình phát.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const TRACK_PARAMS = ["lang", "kind", "name", "tlang", "fmt"];

  function parse(url) {
    try {
      return new URL(url, root.location?.href);
    } catch {
      return null;
    }
  }

  function withJson3(url) {
    const target = parse(url);
    target.searchParams.set("fmt", "json3");
    return target.href;
  }

  // Payload timedtext bắt được có đúng là track (ngôn ngữ + loại) cần tìm.
  function captureMatches(capture, videoId, track) {
    if (capture.kind !== "timedtext") return false;
    const params = parse(capture.url)?.searchParams;
    if (!params || params.get("tlang")) return false;
    if (params.get("v") && params.get("v") !== videoId) return false;
    const isAsr = params.get("kind") === "asr";
    return (
      LTV.tracks.sameLang(params.get("lang"), track.lang) &&
      isAsr === (track.kind === "asr")
    );
  }

  const isSigned = (params) =>
    params.has("pot") || params.has("signature") || params.has("sig");

  // URL timedtext đã ký của video (payload bắt được và resource), mới nhất trước.
  function signedSources(bridge, videoId) {
    const items = [...bridge.captures(), ...bridge.resources()]
      .filter((item) => item.kind === "timedtext")
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    const urls = [];
    for (const item of items) {
      const url = parse(item.url);
      if (!url || url.searchParams.get("v") !== videoId) continue;
      if (isSigned(url.searchParams) && !urls.includes(url.href))
        urls.push(url.href);
    }
    return urls;
  }

  // Ghép tham số đã ký của capturedUrl với ngôn ngữ/loại của track cần tải.
  function signedTrackUrl({ capturedUrl, track, videoId }) {
    const captured = parse(capturedUrl);
    if (!captured || captured.searchParams.get("v") !== videoId) return null;
    const base = track.baseUrl ? parse(track.baseUrl)?.searchParams : null;
    const result = new URL(captured.href);
    for (const key of TRACK_PARAMS) result.searchParams.delete(key);
    result.searchParams.set("lang", base?.get("lang") || track.lang);
    const kind = base ? base.get("kind") : track.kind === "asr" ? "asr" : "";
    if (kind) result.searchParams.set("kind", kind);
    if (base?.get("name")) result.searchParams.set("name", base.get("name"));
    result.searchParams.set("fmt", "json3");
    return result.href;
  }

  LTV.ytTimedtext = {
    withJson3,
    captureMatches,
    signedSources,
    signedTrackUrl,
  };
})(globalThis);
