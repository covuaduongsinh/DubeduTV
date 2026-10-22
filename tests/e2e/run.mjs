// Kiểm thử e2e: build bản --test, chạy máy chủ trang giả lập YouTube/Udemy/
// Coursera trên 127.0.0.1, nạp tiện ích vào Chromium thật (Playwright) và
// kiểm tra: lấy phụ đề → dịch thật qua Google → đọc đúng thứ tự/thời điểm →
// giảm rồi trả âm lượng → phụ đề trên video. Cần mạng tới translate.googleapis.com.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  LESSON,
  courseraPage,
  lessonJson3,
  lessonVtt,
  silenceWav,
  udemyPage,
  youtubePage,
} from "./fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionDir = join(root, "dist", "long-tieng-viet-test");
const VIETNAMESE =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const requests = [];

function startServer() {
  const wav = silenceWav();
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push(url.pathname + url.search);
    const send = (status, type, body) => {
      response.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
      });
      response.end(body);
    };
    const port = server.address().port;
    if (url.pathname === "/watch") return send(200, "text/html", youtubePage());
    if (url.pathname.startsWith("/udemy/"))
      return send(200, "text/html", udemyPage(`http://localhost:${port}`));
    if (url.pathname.startsWith("/coursera/"))
      return send(200, "text/html", courseraPage());
    if (url.pathname === "/media/silence.wav")
      return send(200, "audio/wav", wav);
    if (url.pathname === "/api/timedtext") {
      // Giống YouTube hiện nay: thiếu PO token thì trả rỗng.
      return send(
        200,
        "application/json",
        url.searchParams.get("pot") ? lessonJson3() : "",
      );
    }
    if (
      url.pathname.startsWith(
        "/api-2.0/users/me/subscribed-courses/77/lectures/4242/",
      )
    ) {
      const captions = [
        {
          url: `http://localhost:${port}/cdn/udemy-en.vtt`,
          locale_id: "en_US",
          source: "manual",
          video_label: "English",
        },
      ];
      return send(
        200,
        "application/json",
        JSON.stringify({ _class: "lecture", asset: { captions } }),
      );
    }
    if (
      url.pathname === "/cdn/udemy-en.vtt" ||
      url.pathname === "/subs/coursera-en.vtt"
    ) {
      return send(200, "text/vtt", lessonVtt());
    }
    return send(404, "text/plain", "not found");
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function launch() {
  const userDataDir = mkdtempSync(join(tmpdir(), "ltv-e2e-"));
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--autoplay-policy=no-user-gesture-required",
      // Tự truyền --proxy-server (không qua tuỳ chọn proxy của Playwright, vốn
      // ép cả loopback đi qua proxy) để trang giả lập 127.0.0.1 đi thẳng.
      ...(proxy ? [`--proxy-server=${proxy}`] : []),
    ],
  });
  let [worker] = context.serviceWorkers();
  if (!worker)
    worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  // API chrome.* có thể chưa gắn xong ngay khi service worker vừa khởi động.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await worker.evaluate(() => typeof chrome?.storage?.sync === "object"))
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { context, worker, userDataDir };
}

async function readLog(page) {
  const raw = await page.evaluate(() =>
    document.documentElement.getAttribute("data-ltv-test-log"),
  );
  return raw ? JSON.parse(raw) : [];
}

async function overlayText(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-ltv="overlay"]');
    return host?.shadowRoot?.querySelector(".main")?.textContent || "";
  });
}

async function runSite(context, { name, path, extraChecks }) {
  const page = await context.newPage();
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const response = await page.goto(path);
  if (process.env.LTV_E2E_DEBUG)
    console.log(path, response?.status(), (await page.content()).slice(0, 300));
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  const lines = new Set();
  let log = [];
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    log = await readLog(page);
    const text = await overlayText(page);
    if (text) lines.add(text);
    if (log.filter((entry) => entry.done).length >= LESSON.length) break;
    await page.waitForTimeout(250);
  }
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
  await page.evaluate(() => document.querySelector("video").pause());
  await page.waitForTimeout(1200);
  const volume = await page.evaluate(
    () => document.querySelector("video").volume,
  );
  check(volume > 0.95, `âm lượng gốc không được trả lại (còn ${volume})`);
  check(
    [...lines].some((text) => VIETNAMESE.test(text)),
    "phụ đề tiếng Việt không hiện trên video",
  );
  if (extraChecks) await extraChecks(page, check);
  await page.close();
  return {
    name,
    failures,
    spoken: done.map(
      (entry) => `${entry.at.toFixed(2)}s ×${entry.rate} ${entry.text}`,
    ),
  };
}

async function youtubeChecks(page, check) {
  const button = await page.$('.ytp-right-controls [data-ltv="button"]');
  check(Boolean(button), "không có nút VI trên thanh điều khiển YouTube");
  const unloaded = await page.evaluate(
    () => document.body.dataset.captionsUnloaded === "1",
  );
  check(unloaded, "không trả lại trạng thái phụ đề YouTube sau khi lấy");
  check(
    requests.some(
      (r) => r.startsWith("/api/timedtext") && r.includes("pot=TOKEN"),
    ),
    "không bắt được timedtext có pot",
  );
}

function udemyChecks() {
  return async (page, check) => {
    check(
      requests.includes("/cdn/udemy-en.vtt"),
      "không tải VTT Udemy qua service worker (khác origin)",
    );
  };
}

// Đường giọng đọc thật: service worker → offscreen → translate_tts. Ở môi trường
// kiểm thử host này bị chặn, nên kỳ vọng lỗi được báo về trang (không treo).
async function realSpeechPath(context) {
  const page = await context.newPage();
  const failures = [];
  await page.goto(`${baseUrl}/watch?v=real01&real=1`);
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  let status = "";
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    status = await page.evaluate(
      () =>
        document
          .querySelector('[data-ltv="overlay"]')
          ?.shadowRoot?.querySelector(".status")?.textContent || "",
    );
    if (/Lỗi giọng đọc|Giọng Google không phản hồi/.test(status)) break;
    await page.waitForTimeout(300);
  }
  const contexts = await context.serviceWorkers()[0].evaluate(
    async () =>
      (
        await chrome.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
        })
      ).length,
  );
  if (contexts !== 1)
    failures.push("không tạo offscreen document cho giọng Google");
  if (!/Lỗi giọng đọc|Giọng Google không phản hồi/.test(status))
    failures.push(`không báo lỗi giọng đọc (status: "${status}")`);
  await page.close();
  return {
    name: "Giọng Google qua offscreen (đường lỗi)",
    failures,
    spoken: [`status: ${status}`],
  };
}

// Trang tuỳ chọn mở dạng tab vẫn phải gọi được lệnh của service worker.
async function optionsPage(context) {
  const id = new URL(context.serviceWorkers()[0].url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options/options.html`);
  const stats = page.locator("#cache-stats");
  await page.waitForFunction(
    () => !/Đang đọc/.test(document.querySelector("#cache-stats").textContent),
    null,
    {
      timeout: 10000,
    },
  );
  const text = await stats.textContent();
  await page.close();
  const failures = /Đang lưu bản dịch của [1-9]\d* video/.test(text)
    ? []
    : [`thống kê cache sai: "${text}"`];
  return {
    name: "Trang tuỳ chọn đọc bộ nhớ đệm bản dịch",
    failures,
    spoken: [text],
  };
}

let baseUrl = "";

async function main() {
  execFileSync(
    process.execPath,
    [join(root, "scripts", "build.mjs"), "--test"],
    { stdio: "inherit" },
  );
  const server = await startServer();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const { context, worker, userDataDir } = await launch();
  const results = [];
  try {
    await worker.evaluate(() =>
      chrome.storage.sync.set({ autoStart: true, voiceEngine: "google" }),
    );
    results.push(
      await runSite(context, {
        name: "YouTube (giả lập, timedtext cần PO token)",
        path: `${baseUrl}/watch?v=knight01`,
        extraChecks: youtubeChecks,
      }),
      await runSite(context, {
        name: "Udemy (giả lập, API bài giảng + VTT khác origin)",
        path: `${baseUrl}/udemy/course/demo/learn/lecture/4242`,
        extraChecks: udemyChecks(),
      }),
      await runSite(context, {
        name: "Coursera (giả lập, thẻ <track>)",
        path: `${baseUrl}/coursera/learn/demo/lecture/abc123`,
      }),
      await realSpeechPath(context),
      await optionsPage(context),
    );
  } finally {
    await context.close();
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
  let failed = 0;
  for (const result of results) {
    console.log(
      `\n${result.failures.length === 0 ? "PASS" : "FAIL"}  ${result.name}`,
    );
    for (const line of result.spoken) console.log(`      ${line}`);
    for (const failure of result.failures) console.log(`   ✗ ${failure}`);
    if (result.failures.length > 0) failed += 1;
  }
  console.log(`\n${results.length - failed}/${results.length} kịch bản đạt`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
