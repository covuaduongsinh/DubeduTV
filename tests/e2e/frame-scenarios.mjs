// Kịch bản e2e cho video trong khung nhúng khác nguồn (YouTube nhúng, Google
// Drive) và video X/Twitter (phụ đề HLS chia đoạn). Trang chính chạy trên
// 127.0.0.1, khung trình phát và máy chủ media trên localhost.
import { VIETNAMESE, checker, readLog } from "./page-helpers.mjs";
import { requests } from "./server.mjs";
import { runSite } from "./site-scenarios.mjs";

const EMBED_FRAME = /localhost:\d+\/embed\//;
const DRIVE_FRAME = /localhost:\d+\/drive-embed\//;

async function tabIdOf(worker, pathPart) {
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  return tabs.find((tab) => tab.url?.includes(pathPart))?.id;
}

// Popup mở dạng trang (?tabId=) phải chọn đúng khung nhúng: hiện YouTube,
// đang bật, và bấm tắt chỉ dừng phiên trong khung đó.
function popupChecks(context, worker) {
  return async (frame, check) => {
    const tabId = await tabIdOf(worker, "/embed-host");
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${id}/popup/popup.html?tabId=${tabId}`,
    );
    await popup
      .waitForFunction(
        () => document.getElementById("site")?.textContent === "YouTube",
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    const site = await popup.locator("#site").textContent();
    const label = await popup.locator("#toggle").textContent();
    check(site === "YouTube", `popup không chọn khung nhúng (site: "${site}")`);
    check(/Tắt/.test(label), `popup không thấy phiên đang bật ("${label}")`);
    await popup.click("#toggle");
    await popup.waitForTimeout(800);
    const after = await popup.locator("#toggle").textContent();
    check(
      /Bật/.test(after),
      `popup không tắt được phiên trong khung ("${after}")`,
    );
    await popup.close();
  };
}

function driveChecks(variant) {
  return async (frame, check) => {
    const calls = await frame.evaluate(
      () => document.body.dataset.setOptionCalls || "0",
    );
    if (variant === "list") {
      check(
        requests.some(
          (r) =>
            r.startsWith("/timedtext?") &&
            r.includes("type=track") &&
            r.includes("fmt=json3"),
        ),
        "trang Drive không tải track phụ đề (kèm cookie)",
      );
      check(calls === "0", "vẫn phải bật phụ đề trên trình phát");
    } else {
      check(calls === "1", "không bật phụ đề trên trình phát Drive");
    }
  };
}

async function xChecks(page, check) {
  for (const part of ["/pl/subs/en.m3u8", "/subs/seg0.vtt", "/subs/seg1.vtt"])
    check(
      requests.some((r) => r.includes(part)),
      `không tải ${part} của playlist phụ đề`,
    );
}

// Nghe âm thanh cả thẻ trên trang có video nhúng khác nguồn: luồng âm thanh
// và bộ chép lời giả trong offscreen (headless không bấm được biểu tượng
// tiện ích để lấy luồng thật). Kiểm tra đường service worker → offscreen →
// trang chính: dịch thật, đọc, lớp phủ cố định, dừng và dọn dẹp.
export async function tabLiveScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  await worker.evaluate(() =>
    chrome.storage.sync.set({ asrEngine: "chrome", asrLang: "en-US" }),
  );
  const page = await context.newPage();
  await page.goto(`${baseUrl}/embed-host`);
  await page.waitForTimeout(1500);
  const tabId = await tabIdOf(worker, "/embed-host");
  const control = await context.newPage();
  await control.goto(
    `chrome-extension://${new URL(worker.url()).host}/options/options.html`,
  );
  const send = (message) =>
    control.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const started = await send({
    type: "ltv:tabLive:start",
    tabId,
    streamId: "test:tone",
  });
  check(started?.ok, `không bắt đầu nghe cả thẻ: ${started?.error}`);
  let log = [];
  for (let i = 0; i < 120 && log.filter((e) => e.done).length < 3; i += 1) {
    await page.waitForTimeout(250);
    log = await readLog(page);
  }
  const done = log.filter((entry) => entry.done);
  check(done.length >= 3, `chỉ đọc xong ${done.length}/3 câu`);
  check(
    done.every((entry) => VIETNAMESE.test(entry.text)),
    "có câu không phải tiếng Việt",
  );
  const fixed = await page.evaluate(
    () => document.querySelector('[data-ltv="overlay"]')?.style.position,
  );
  check(fixed === "fixed", `lớp phủ không cố định theo màn hình (${fixed})`);
  await send({ type: "ltv:tabLive:stop" });
  await page.waitForTimeout(1000);
  const status = await send({ type: "ltv:tabLive:status", tabId });
  const capture = await worker.evaluate(() =>
    chrome.runtime.sendMessage({ target: "offscreen", type: "tab:status" }),
  );
  check(status?.active === false, "service worker vẫn ghi đang nghe");
  check(capture?.active === false, "offscreen vẫn đang thu âm thanh thẻ");
  await control.close();
  await page.close();
  return {
    name: "Nghe âm thanh cả thẻ (video nhúng khác nguồn, luồng giả lập)",
    failures,
    spoken: done.map((entry) => entry.text),
  };
}

export function frameScenarios(context, { baseUrl, worker }) {
  return [
    () =>
      runSite(context, {
        name: "YouTube nhúng trong trang khác (khung khác nguồn) + popup",
        path: `${baseUrl}/embed-host`,
        frameUrl: EMBED_FRAME,
        extraChecks: popupChecks(context, worker),
      }),
    () =>
      runSite(context, {
        name: "Google Drive – trang Drive tải phụ đề kèm cookie",
        path: `${baseUrl}/drive/file/d/FILE1/view?variant=list`,
        frameUrl: DRIVE_FRAME,
        extraChecks: driveChecks("list"),
      }),
    () =>
      runSite(context, {
        name: "Google Drive – bật phụ đề trên trình phát",
        path: `${baseUrl}/drive/file/d/FILE2/view?variant=cc`,
        frameUrl: DRIVE_FRAME,
        extraChecks: driveChecks("cc"),
      }),
    () =>
      runSite(context, {
        name: "X/Twitter – phụ đề trong playlist HLS (2 đoạn WebVTT)",
        path: `${baseUrl}/x/status/123`,
        extraChecks: xChecks,
      }),
  ];
}
