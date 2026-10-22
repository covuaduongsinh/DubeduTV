// Trang giả lập cho các site thêm ở v1.2: trang nhúng video YouTube, Google
// Drive (trang cha + khung trình phát khác nguồn), X/Twitter (playlist HLS có
// phụ đề WebVTT chia đoạn), câu hỏi trắc nghiệm Coursera và trang danh sách
// video YouTube (huy hiệu "Đã lồng").
import { LESSON, page } from "./fixtures.mjs";

function vttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const pad = (value, size) => String(value).padStart(size, "0");
  return `00:${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
}

// Trang bất kỳ (127.0.0.1) nhúng video YouTube từ nguồn khác (localhost).
export function embedHostPage(frameOrigin) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Blog cờ vua (mock)</title></head>
<body style="margin:0;background:#fff"><h1>Bài viết có video</h1>
<iframe id="player" src="${frameOrigin}/embed/knight02" width="854" height="480" allow="autoplay"></iframe></body></html>`;
}

// Google Drive: trang xem tệp nhúng khung trình phát (nguồn khác). variant
// "list": trang cha tự tải danh sách phụ đề (cần cookie đăng nhập); "cc":
// không có, phải bật phụ đề trên trình phát.
export function driveHostPage({ frameOrigin, hostOrigin, fileId, variant }) {
  const ttsurl = encodeURIComponent(
    `${hostOrigin}/timedtext?id=${fileId}&vid=abc123&hl=en`,
  );
  const frameQuery =
    variant === "list" ? `docid=${fileId}&ttsurl=${ttsurl}` : `docid=${fileId}`;
  const script =
    variant === "list"
      ? `fetch("/timedtext?id=${fileId}&vid=abc123&type=list").catch(() => {});`
      : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="ltv-test-drive-host" content="1">
<title>Bai giang ma.mp4 - Google Drive</title></head><body style="margin:0;background:#202124">
<iframe id="drive-player" src="${frameOrigin}/drive-embed/?${frameQuery}" width="854" height="480" allow="autoplay"></iframe>
<script>${script}</script></body></html>`;
}

// Khung trình phát của Drive (giống YouTube nhúng: không có player response).
export function driveEmbedPage() {
  return page(
    "drive",
    "Drive player (mock)",
    `<div id="movie_player" class="html5-video-player" data-mock-player style="position:relative;width:854px;height:480px;background:#000">
      <video class="html5-main-video" src="/media/silence.wav" style="width:100%;height:100%"></video></div>`,
    `const player = document.querySelector("[data-mock-player]");
    player.getVideoData = () => ({ video_id: "", title: "Bai giang ma.mp4" });
    player.getOption = (module, key) => (key === "tracklist" ? [{ languageCode: "en", displayName: "English" }] : {});
    player.loadModule = () => {};
    player.unloadModule = () => {};
    player.setOption = (module, key, value) => {
      if (!value || !value.languageCode) return;
      document.body.dataset.setOptionCalls = "1";
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/timedtext?docid=FILE1&lang=en&fmt=srv3&auth=player");
      xhr.send();
    };`,
  );
}

export function driveTrackList() {
  return `<?xml version="1.0" encoding="utf-8" ?><transcript_list docid="abc123">
<track id="0" name="" lang_code="en" lang_original="English" lang_translated="English" lang_default="true"/></transcript_list>`;
}

export function lessonSrv3() {
  const paragraphs = LESSON.map(
    ([start, end, text]) =>
      `<p t="${Math.round(start * 1000)}" d="${Math.round((end - start) * 1000)}">${text}</p>`,
  );
  return `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>${paragraphs.join("")}</body></timedtext>`;
}

// X/Twitter: bài đăng có video; trang tự tải master playlist (khác nguồn).
export function xPage(mediaOrigin) {
  return page(
    "x",
    "Chess Club on X: “Knight moves” / X",
    `<div data-testid="primaryColumn"><div data-testid="videoPlayer" style="position:relative;width:854px;height:480px">
      <video poster="${mediaOrigin}/ext_tw_video_thumb/999/pu/img/thumb.jpg" src="/media/silence.wav" style="width:100%;height:100%"></video>
    </div></div>`,
    `fetch(${JSON.stringify(`${mediaOrigin}/ext_tw_video/999/pu/pl/master.m3u8?tag=12`)}).catch(() => {});`,
  );
}

export function xMaster() {
  return `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:NAME="English",TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="/ext_tw_video/999/pu/pl/subs/en.m3u8?tag=12"
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=256000,BANDWIDTH=300000,RESOLUTION=480x270,CODECS="mp4a.40.2,avc1.4d001e",SUBTITLES="subs"
/ext_tw_video/999/pu/pl/avc1/480x270/a.m3u8
`;
}

export function xSubtitlePlaylist() {
  return `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:10.000,
seg0.vtt
#EXTINF:10.000,
seg1.vtt
#EXT-X-ENDLIST
`;
}

// Đoạn WebVTT: mốc tuyệt đối, câu vắt qua ranh giới có mặt ở cả hai đoạn.
export function xSegment(index) {
  const cues = LESSON.filter(([start, end]) =>
    index === 0 ? start < 10 : end > 10,
  ).map(
    ([start, end, text]) => `${vttTime(start)} --> ${vttTime(end)}\n${text}`,
  );
  return `WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n${cues.join("\n\n")}\n`;
}

// Câu hỏi trắc nghiệm Coursera (không có video).
export function quizPage() {
  return page(
    "coursera",
    "Quiz: Knight moves | Coursera (mock)",
    `<form id="quiz" style="padding:24px;color:#111;background:#fff" onsubmit="event.preventDefault(); document.body.dataset.submitted = '1';">
      <div class="question"><p>Which piece moves in an L shape?</p>
        <label><input type="radio" name="a" value="1"> The knight</label><br>
        <label><input type="radio" name="a" value="2"> The bishop</label><br>
        <label><input type="radio" name="a" value="3"> The rook</label>
      </div>
      <button type="submit">Submit</button>
    </form>`,
  );
}

// Trang danh sách video: knight01 đã có bản dịch, nosub01 đã có lời chép;
// nosub02 được thêm sau (trang tải thêm khi cuộn).
export function feedPage() {
  const card = (id) =>
    `<a href="/watch?v=${id}" data-id="${id}" style="display:inline-block;position:relative;margin:8px">
      <img src="/media/thumb.svg" width="320" height="180" alt=""></a>`;
  return page(
    "youtube",
    "YouTube (mock feed)",
    `<div id="feed">${["knight01", "nosub01", "unknown99"].map(card).join("")}</div>`,
    `setTimeout(() => { document.getElementById("feed").insertAdjacentHTML("beforeend", ${JSON.stringify(card("nosub02"))}); }, 1000);`,
  );
}

export const THUMB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#456"/></svg>`;
