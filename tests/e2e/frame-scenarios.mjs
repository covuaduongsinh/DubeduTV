// Kịch bản e2e cho video trong khung nhúng khác nguồn (YouTube nhúng, Google
// Drive) và video X/Twitter (phụ đề HLS chia đoạn). Trang chính chạy trên
// 127.0.0.1, khung trình phát và máy chủ media trên localhost.
import { tabIdOf } from "./page-helpers.mjs";
import { requests } from "./server.mjs";
import { runSite } from "./site-scenarios.mjs";

const EMBED_FRAME = /localhost:\d+\/embed\//;
const DRIVE_FRAME = /localhost:\d+\/drive-embed\//;

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
