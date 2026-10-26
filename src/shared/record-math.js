// Phép tính thuần cho "Quay video lồng tiếng": vùng cắt đúng video trong hình
// thu của thẻ, kích thước file quay, định dạng ghi và phụ đề .srt theo giờ
// của file quay.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const MAX_WIDTH = 1920;
  const MAX_HEIGHT = 1080;
  const MIN_SIDE = 64;
  // Câu hiện ngắn hơn chừng này (chớp qua khi tua) không đưa vào phụ đề.
  const MIN_CUE_MS = 200;

  // MP4 H.264 mở được ở mọi nơi (CapCut, Windows) nên đứng trước; Chromium
  // không có H.264 thì ghi WebM.
  LTV.RECORD_TYPES = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1.4d0028,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4;codecs=avc1,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  const even = (value) => Math.max(2, Math.round(value / 2) * 2);

  LTV.pickRecordType = function pickRecordType(isSupported) {
    return (
      LTV.RECORD_TYPES.find((type) => {
        try {
          return isSupported(type);
        } catch {
          return false;
        }
      }) || ""
    );
  };

  LTV.recordExtension = (type) => (/mp4/.test(type) ? "mp4" : "webm");

  // rect: vùng video (px CSS, theo khung nhìn), viewport: kích thước khung
  // nhìn (px CSS), frame: kích thước hình thu được (px). Trả vùng cắt theo
  // px của hình thu (toạ độ chẵn, nằm trong hình) hoặc null = lấy cả hình.
  LTV.cropRect = function cropRect(rect, viewport, frame) {
    if (!rect || !(viewport?.width > 0) || !(viewport?.height > 0)) return null;
    const scaleX = frame.width / viewport.width;
    const scaleY = frame.height / viewport.height;
    const left = Math.max(0, rect.x * scaleX);
    const top = Math.max(0, rect.y * scaleY);
    const right = Math.min(frame.width, (rect.x + rect.width) * scaleX);
    const bottom = Math.min(frame.height, (rect.y + rect.height) * scaleY);
    if (right - left < MIN_SIDE || bottom - top < MIN_SIDE) return null;
    const x = Math.floor(left / 2) * 2;
    const y = Math.floor(top / 2) * 2;
    return {
      x,
      y,
      width: Math.min(even(right - x), frame.width - x),
      height: Math.min(even(bottom - y), frame.height - y),
    };
  };

  // Kích thước file quay: theo tỉ lệ vùng cắt, cao bằng hình thu của cả thẻ
  // (bật toàn màn hình sau khi bắt đầu quay vẫn nét), tối đa 1920×1080.
  LTV.outputSize = function outputSize(crop, frame) {
    const height = frame?.height || crop.height;
    const width = (crop.width / crop.height) * height;
    const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
    return { width: even(width * scale), height: even(height * scale) };
  };

  // Đặt hình nguồn vào khung đích, giữ tỉ lệ (viền đen phần thừa).
  LTV.fitRect = function fitRect(source, target) {
    const scale = Math.min(
      target.width / source.width,
      target.height / source.height,
    );
    const width = source.width * scale;
    const height = source.height * scale;
    return {
      x: (target.width - width) / 2,
      y: (target.height - height) / 2,
      width,
      height,
    };
  };

  function stamp(ms) {
    const total = Math.max(0, Math.round(ms));
    const pad = (value, size = 2) => String(value).padStart(size, "0");
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor(total / 60000) % 60;
    const seconds = Math.floor(total / 1000) % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(total % 1000, 3)}`;
  }

  // events: [{ at, text }] – lúc (ms, đồng hồ máy) một câu hiện, text null khi
  // ẩn phụ đề. Mốc tính từ startedAt; câu đang hiện lúc dừng kết thúc ở endedAt.
  LTV.buildSrt = function buildSrt(events, { startedAt, endedAt }) {
    const cues = [];
    let open = null;
    const close = (at) => {
      if (open && at - open.start >= MIN_CUE_MS)
        cues.push({ ...open, end: at });
      open = null;
    };
    const sorted = [...events].sort((a, b) => a.at - b.at);
    for (const event of sorted) {
      const at = Math.max(0, event.at - startedAt);
      const text = String(event.text || "").trim();
      if (open && text === open.text) continue;
      close(at);
      if (text) open = { start: at, text };
    }
    close(Math.max(0, endedAt - startedAt));
    return cues
      .map(
        (cue, index) =>
          `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`,
      )
      .join("\n");
  };

  // Giữ keep bản quay mới nhất (đã xong); trả id các bản cần xoá.
  LTV.recordingsToPrune = function recordingsToPrune(list, keep) {
    return [...list]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(keep)
      .map((item) => item.id);
  };

  // Tên file an toàn cho Windows: "Tên video (lồng tiếng Việt).mp4".
  LTV.recordFileName = function recordFileName(title, extension) {
    const printable = Array.from(String(title || "Video"))
      .filter((char) => char.charCodeAt(0) >= 32)
      .join("");
    const base =
      printable
        .replace(/\s*-\s*YouTube\s*$/i, "")
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "Video";
    return `${base} (lồng tiếng Việt).${extension}`;
  };
})(globalThis);
