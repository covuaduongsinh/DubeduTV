// Trang drive.google.com (top frame): trả lời khung trình phát về tệp đang
// xem và phụ đề của nó. Phụ đề Drive cần cookie đăng nhập nên chỉ trang cha
// tải được: thu địa chỉ timedtext trang đã tải (Resource Timing) và tham số
// ttsurl của khung trình phát, tự dựng URL danh sách/track cùng nguồn rồi tải
// kèm cookie. Không bao giờ tải URL do khung gửi sang.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MAX_BASES = 10;
  const MAX_BYTES = 6 * 1024 * 1024;
  const bases = [];
  let started = false;

  function record(url) {
    const timedtext = LTV.driveTimedtext;
    if (!url || !timedtext.isTimedtextUrl(url, location.origin)) return;
    const base = timedtext.baseOf(url);
    if (bases.includes(base)) return;
    bases.unshift(base);
    if (bases.length > MAX_BASES) bases.pop();
  }

  function observe() {
    const take = (entries) => entries.forEach((entry) => record(entry.name));
    take(performance.getEntriesByType("resource"));
    try {
      new PerformanceObserver((list) => take(list.getEntries())).observe({
        type: "resource",
        buffered: true,
      });
    } catch {
      // Trình duyệt không hỗ trợ.
    }
  }

  function scanFrames() {
    for (const frame of document.querySelectorAll('iframe[src*="/embed/"]'))
      record(LTV.driveTimedtext.ttsUrlFrom(frame.src));
  }

  async function fetchSameOrigin(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("Phụ đề quá lớn");
    return text;
  }

  async function tracks() {
    scanFrames();
    for (const base of bases) {
      try {
        const list = LTV.driveTimedtext.parseTrackList(
          await fetchSameOrigin(LTV.driveTimedtext.listUrl(base)),
        );
        if (list.length > 0) return { base, tracks: list };
      } catch {
        // Thử địa chỉ khác.
      }
    }
    return { base: null, tracks: [] };
  }

  // Ưu tiên json3 (có mốc từng từ), không được thì định dạng mặc định.
  async function fetchTrack({ base, track }) {
    if (!bases.includes(base)) throw new Error("unknown-base");
    const { trackUrl } = LTV.driveTimedtext;
    const json = await fetchSameOrigin(trackUrl(base, track, "json3")).catch(
      () => "",
    );
    if (json.trim().startsWith("{")) return { text: json };
    return { text: await fetchSameOrigin(trackUrl(base, track, "")) };
  }

  LTV.driveHost = {
    matches: (loc) => loc.hostname === "drive.google.com",
    start() {
      if (started) return;
      started = true;
      observe();
      LTV.driveChannel.serve({
        "drive:info": () => {
          scanFrames();
          return {
            fileId: LTV.driveTimedtext.fileIdFromPath(location.pathname),
            title: document.title.replace(/\s*-\s*Google Drive\s*$/, ""),
          };
        },
        "drive:tracks": tracks,
        "drive:fetch": fetchTrack,
      });
    },
  };
})(globalThis);
