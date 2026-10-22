// Kịch bản e2e cho video có phụ đề trên từng site: lấy phụ đề → dịch thật qua
// Google → đọc đúng thứ tự/thời điểm → giảm rồi trả âm lượng → phụ đề trên
// video. Trang có thể chạy trong khung nhúng (target trả về Frame).
import { LESSON } from "./fixtures.mjs";
import { VIETNAMESE, overlayText, readLog } from "./page-helpers.mjs";
import { requests } from "./server.mjs";

async function waitForFrame(page, pattern) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const frame = page.frames().find((item) => pattern.test(item.url()));
    if (frame) {
      await frame.waitForSelector("video", { state: "attached" });
      return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`không thấy khung ${pattern}`);
}

// target: chuỗi regex URL của khung chứa video (mặc định là trang chính).
export async function openTarget(context, path, frameUrl) {
  const page = await context.newPage();
  await page.goto(path);
  const target = frameUrl ? await waitForFrame(page, frameUrl) : page;
  await target.waitForSelector("video", { state: "attached" });
  await target.evaluate(() => document.querySelector("video").play());
  return { page, target };
}

async function collectSpeech(target, count, timeoutMs) {
  const lines = new Set();
  let log = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    log = await readLog(target);
    const text = await overlayText(target);
    if (text) lines.add(text);
    if (log.filter((entry) => entry.done).length >= count) break;
    await target.waitForTimeout(250);
  }
  return { log, lines };
}

function speechChecks(check, log, lines) {
  const done = log.filter((entry) => entry.done && !entry.interrupted);
  check(
    done.length >= LESSON.length,
    `chỉ đọc xong ${done.length}/${LESSON.length} câu`,
  );
  check(
    done.every((entry) => VIETNAMESE.test(entry.text)),
    "có câu đọc không phải tiếng Việt",
  );
  log.forEach((entry, i) => {
    const sentence = LESSON[i];
    if (sentence)
      check(
        entry.at >= sentence[0] - 0.2,
        `câu ${i + 1} đọc sớm (${entry.at}s < ${sentence[0]}s)`,
      );
  });
  check(
    log.every((entry, i) => i === 0 || entry.at >= log[i - 1].at),
    "thứ tự đọc không tăng dần theo thời gian",
  );
  const ducked = done.filter((entry) => entry.volumeDuring !== undefined);
  check(
    ducked.length > 0 && ducked.every((entry) => entry.volumeDuring <= 0.2),
    "âm lượng gốc không được giảm khi đọc",
  );
  check(
    [...lines].some((text) => VIETNAMESE.test(text)),
    "phụ đề tiếng Việt không hiện trên video",
  );
  return done;
}

export async function runSite(context, { name, path, frameUrl, extraChecks }) {
  const { page, target } = await openTarget(context, path, frameUrl);
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const { log, lines } = await collectSpeech(target, LESSON.length, 45000);
  const done = speechChecks(check, log, lines);
  await target.evaluate(() => document.querySelector("video").pause());
  await target.waitForTimeout(1200);
  const volume = await target.evaluate(
    () => document.querySelector("video").volume,
  );
  check(volume > 0.95, `âm lượng gốc không được trả lại (còn ${volume})`);
  if (extraChecks) await extraChecks(target, check, page);
  await page.close();
  return {
    name,
    failures,
    spoken: done.map(
      (entry) => `${entry.at.toFixed(2)}s ×${entry.rate} ${entry.text}`,
    ),
  };
}

const sawRequest = (pattern) => requests.some((entry) => pattern.test(entry));

export async function youtubeChecks(page, check) {
  const button = await page.$('.ytp-right-controls [data-ltv="button"]');
  check(Boolean(button), "không có nút VI trên thanh điều khiển YouTube");
  const unloaded = await page.evaluate(
    () => document.body.dataset.captionsUnloaded === "1",
  );
  check(unloaded, "không trả lại trạng thái phụ đề YouTube sau khi lấy");
  check(
    sawRequest(/^\/api\/timedtext.*pot=TOKEN/),
    "không bắt được timedtext có pot",
  );
}

export function udemyChecks() {
  return async (page, check) => {
    check(
      requests.includes("/cdn/udemy-en.vtt"),
      "không tải VTT Udemy qua service worker (khác origin)",
    );
  };
}

// Trình phát đã tự tải phụ đề (tiếng Pháp) kèm token: dùng lại tham số đã ký
// cho track tiếng Anh, không phải bật phụ đề trên trình phát.
function signedChecks(videoId) {
  return async (page, check) => {
    const calls = await page.evaluate(
      () => document.body.dataset.setOptionCalls || "0",
    );
    check(calls === "0", "vẫn phải bật phụ đề trên trình phát");
    check(
      requests.some(
        (r) =>
          r.startsWith("/api/timedtext") &&
          r.includes(`v=${videoId}`) &&
          r.includes("lang=en") &&
          r.includes("signature=SIG"),
      ),
      "không tải track tiếng Anh bằng tham số đã ký",
    );
  };
}

async function pillChecks(page, check) {
  const pill = await page.evaluate(() => {
    const host = document.querySelector('[data-ltv="overlay"]');
    const button = host?.shadowRoot?.querySelector(".pill");
    return Boolean(button && !button.hidden);
  });
  check(pill, "không có nút VI nổi khi trình phát không có thanh điều khiển");
}

export function youtubeVariants(context, baseUrl) {
  return [
    () =>
      runSite(context, {
        name: "YouTube – dùng lại token phụ đề trình phát đã tải (XHR)",
        path: `${baseUrl}/watch?v=signed01&signed=xhr`,
        extraChecks: signedChecks("signed01"),
      }),
    () =>
      runSite(context, {
        name: "YouTube – token chỉ thấy qua Resource Timing (img)",
        path: `${baseUrl}/watch?v=signed02&signed=img`,
        extraChecks: signedChecks("signed02"),
      }),
    () =>
      runSite(context, {
        name: "YouTube Shorts",
        path: `${baseUrl}/shorts/short001`,
        extraChecks: pillChecks,
      }),
    () =>
      runSite(context, {
        name: "YouTube giao diện di động (không có #movie_player)",
        path: `${baseUrl}/watch?v=mobile01&layout=mobile`,
        extraChecks: pillChecks,
      }),
  ];
}
