// Kiểm thử e2e: build bản --test, chạy máy chủ trang giả lập YouTube/Udemy/
// Coursera trên 127.0.0.1, nạp tiện ích vào Chromium thật (Playwright) và
// kiểm tra: lấy phụ đề → dịch thật qua Google → đọc đúng thứ tự/thời điểm →
// giảm rồi trả âm lượng → phụ đề trên video. Cần mạng tới translate.googleapis.com.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  chromeAsrErrorScenario,
  liveScenario,
  replayScenario,
  whisperErrorScenario,
} from "./live-scenarios.mjs";
import { waitForStatus } from "./page-helpers.mjs";
import { frameScenarios } from "./frame-scenarios.mjs";
import { startServer } from "./server.mjs";
import {
  runSite,
  udemyChecks,
  youtubeChecks,
  youtubeVariants,
} from "./site-scenarios.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionDir = join(root, "dist", "long-tieng-viet-test");

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

// Đường giọng đọc thật: service worker → offscreen → translate_tts. Ở môi trường
// kiểm thử host này bị chặn, nên kỳ vọng lỗi được báo về trang (không treo).
async function realSpeechPath(context) {
  const page = await context.newPage();
  const failures = [];
  await page.goto(`${baseUrl}/watch?v=real01&real=1`);
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  const status = await waitForStatus(
    page,
    /Lỗi giọng đọc|Giọng Google không phản hồi/,
    30000,
  );
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
  await page.waitForFunction(
    () =>
      !/Đang đọc/.test(document.querySelector("#cache-stats").textContent) &&
      !/Đang đọc/.test(document.querySelector("#transcript-stats").textContent),
    null,
    { timeout: 10000 },
  );
  const cache = await page.locator("#cache-stats").textContent();
  const transcripts = await page.locator("#transcript-stats").textContent();
  await page.close();
  const failures = [];
  if (!/Đang lưu bản dịch của [1-9]\d* video/.test(cache))
    failures.push(`thống kê cache sai: "${cache}"`);
  if (!/Đang lưu lời chép của [1-9]\d* video/.test(transcripts))
    failures.push(`thống kê lời chép sai: "${transcripts}"`);
  return {
    name: "Trang tuỳ chọn đọc bộ nhớ đệm và lời chép",
    failures,
    spoken: [cache, transcripts],
  };
}

let baseUrl = "";

// Các nhóm kịch bản theo thứ tự chạy (nhóm sau dùng cache/lời chép của nhóm
// trước). LTV_E2E_GROUPS="base,frames" để chạy một phần.
function selectScenarios(context, worker) {
  const groups = {
    base: [
      () =>
        runSite(context, {
          name: "YouTube (giả lập, timedtext cần PO token)",
          path: `${baseUrl}/watch?v=knight01`,
          extraChecks: youtubeChecks,
        }),
      () =>
        runSite(context, {
          name: "Udemy (giả lập, API bài giảng + VTT khác origin)",
          path: `${baseUrl}/udemy/course/demo/learn/lecture/4242`,
          extraChecks: udemyChecks(),
        }),
      () =>
        runSite(context, {
          name: "Coursera (giả lập, thẻ <track>)",
          path: `${baseUrl}/coursera/learn/demo/lecture/abc123`,
        }),
      () => realSpeechPath(context),
      () =>
        liveScenario(context, {
          baseUrl,
          worker,
          videoId: "nosub01",
          liveMode: "consecutive",
        }),
      () =>
        liveScenario(context, {
          baseUrl,
          worker,
          videoId: "nosub02",
          liveMode: "parallel",
        }),
      () => replayScenario(context, { baseUrl, videoId: "nosub01" }),
      () => whisperErrorScenario(context, { baseUrl, worker }),
      () => chromeAsrErrorScenario(context, { baseUrl }),
      () => optionsPage(context),
    ],
    youtube: youtubeVariants(context, baseUrl),
    frames: frameScenarios(context, { baseUrl, worker }),
  };
  const wanted = (process.env.LTV_E2E_GROUPS || Object.keys(groups).join(","))
    .split(",")
    .map((name) => name.trim());
  return wanted.flatMap((name) => groups[name] || []);
}

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
    for (const scenario of selectScenarios(context, worker))
      results.push(await scenario());
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
