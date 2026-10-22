// Máy chủ trang giả lập cho e2e. Trang chính chạy trên 127.0.0.1; khung nhúng,
// CDN và máy chủ media chạy trên localhost (cùng cổng) để thật sự khác nguồn.
// Mọi yêu cầu được ghi vào `requests` để kịch bản kiểm tra.
import { createServer } from "node:http";
import {
  STORY,
  courseraPage,
  lessonJson3,
  lessonVtt,
  silenceWav,
  udemyPage,
  youtubePage,
} from "./fixtures.mjs";
import {
  THUMB_SVG,
  driveEmbedPage,
  driveHostPage,
  driveTrackList,
  embedHostPage,
  feedPage,
  lessonSrv3,
  quizPage,
  xMaster,
  xPage,
  xSegment,
  xSubtitlePlaylist,
} from "./fixtures-sites.mjs";

export const requests = [];

const HTML = "text/html";

function media() {
  return {
    "/media/silence.wav": silenceWav(),
    "/media/short.wav": silenceWav(19),
    "/media/tone.wav": silenceWav(20, 8000, true),
  };
}

// Giống YouTube hiện nay: thiếu PO token thì trả rỗng; track tiếng Pháp rỗng.
function youtubeTimedtext(url) {
  const params = url.searchParams;
  if (!params.get("pot") || params.get("lang") === "fr") return "";
  return lessonJson3(params.get("v")?.startsWith("story") ? STORY : undefined);
}

// Drive: chỉ trả phụ đề khi có cookie đăng nhập (trang cha) hoặc yêu cầu từ
// chính trình phát (auth=player).
function driveTimedtext(url, request) {
  const params = url.searchParams;
  if (params.get("auth") === "player") return [200, lessonSrv3()];
  if (!/drive_auth=1/.test(request.headers.cookie || "")) return [403, ""];
  if (params.get("type") === "list") return [200, driveTrackList()];
  if (params.get("lang") !== "en") return [404, ""];
  return [200, params.get("fmt") === "json3" ? lessonJson3() : lessonSrv3()];
}

function xMedia(pathname) {
  if (pathname.endsWith("/pl/master.m3u8")) return xMaster();
  if (pathname.endsWith("/subs/en.m3u8")) return xSubtitlePlaylist();
  const segment = /\/subs\/seg(\d)\.vtt$/.exec(pathname);
  return segment ? xSegment(Number(segment[1])) : null;
}

function route(url, request, origins) {
  const { pathname } = url;
  if (pathname === "/watch")
    return [
      200,
      HTML,
      youtubePage({ layout: url.searchParams.get("layout") || "watch" }),
    ];
  if (pathname.startsWith("/shorts/"))
    return [200, HTML, youtubePage({ layout: "shorts" })];
  if (pathname.startsWith("/embed/"))
    return [200, HTML, youtubePage({ layout: "embed" })];
  if (pathname === "/embed-host")
    return [200, HTML, embedHostPage(origins.frame)];
  if (pathname.startsWith("/udemy/"))
    return [200, HTML, udemyPage(origins.frame)];
  if (pathname.startsWith("/coursera/learn/demo/quiz/"))
    return [200, HTML, quizPage()];
  if (pathname.startsWith("/coursera/")) return [200, HTML, courseraPage()];
  if (pathname === "/feed") return [200, HTML, feedPage()];
  if (pathname.startsWith("/drive/file/"))
    return [
      200,
      HTML,
      driveHostPage({
        frameOrigin: origins.frame,
        hostOrigin: origins.host,
        fileId: pathname.split("/")[4],
        variant: url.searchParams.get("variant") || "list",
      }),
      { "set-cookie": "drive_auth=1; Path=/; SameSite=Lax" },
    ];
  if (pathname === "/drive-embed/") return [200, HTML, driveEmbedPage()];
  if (pathname.startsWith("/x/status/"))
    return [200, HTML, xPage(origins.frame)];
  return null;
}

function data(url, request, origins) {
  const { pathname } = url;
  if (pathname === "/api/timedtext")
    return [200, "application/json", youtubeTimedtext(url)];
  if (pathname === "/timedtext") {
    const [status, body] = driveTimedtext(url, request);
    return [status, "text/xml", body];
  }
  if (
    pathname.startsWith(
      "/api-2.0/users/me/subscribed-courses/77/lectures/4242/",
    )
  )
    return [200, "application/json", udemyLecture(origins.frame)];
  if (pathname === "/cdn/udemy-en.vtt" || pathname === "/subs/coursera-en.vtt")
    return [200, "text/vtt", lessonVtt()];
  if (pathname === "/media/thumb.svg") return [200, "image/svg+xml", THUMB_SVG];
  if (pathname.startsWith("/ext_tw_video/")) {
    const body = xMedia(pathname);
    return body
      ? [
          200,
          pathname.endsWith(".vtt")
            ? "text/vtt"
            : "application/vnd.apple.mpegurl",
          body,
        ]
      : [404, "text/plain", ""];
  }
  return null;
}

function udemyLecture(frameOrigin) {
  const captions = [
    {
      url: `${frameOrigin}/cdn/udemy-en.vtt`,
      locale_id: "en_US",
      source: "manual",
      video_label: "English",
    },
  ];
  return JSON.stringify({ _class: "lecture", asset: { captions } });
}

export function startServer() {
  const files = media();
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push(url.pathname + url.search);
    const port = server.address().port;
    const origins = {
      host: `http://127.0.0.1:${port}`,
      frame: `http://localhost:${port}`,
    };
    const send = (status, type, body, headers = {}) => {
      response.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        ...headers,
      });
      response.end(body);
    };
    if (files[url.pathname]) return send(200, "audio/wav", files[url.pathname]);
    const page = route(url, request, origins);
    if (page) return send(page[0], page[1], page[2], page[3]);
    const found = data(url, request, origins);
    if (!found) return send(404, "text/plain", "not found");
    return send(...found);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}
