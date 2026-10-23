// Kịch bản e2e "Nghe âm thanh cả thẻ" (luồng âm thanh và bộ chép lời giả
// trong offscreen – headless không bấm được biểu tượng tiện ích để lấy luồng
// thật). Kiểm tra đường service worker → offscreen → trang: dịch thật, đọc,
// phụ đề, dừng và dọn dẹp, với ba trường hợp:
//   - khung trình phát tiện ích được phép chạy (bản test có quyền 127.0.0.1):
//     nạp script vào khung, nối tiếp trên video thật, phụ đề trong khung kể
//     cả khi toàn màn hình, lưu lời chép rồi lần sau đọc lại theo lời chép;
//   - khung trên origin không có quyền (127.0.0.2): đọc song song ở trang chính.
import {
  VIETNAMESE,
  checker,
  overlayStatus,
  readLog,
  tabIdOf,
} from "./page-helpers.mjs";

const FRAME = /\/plain-frame$/;

async function controller(context, worker) {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/options/options.html`,
  );
  return {
    send: (message) =>
      page.evaluate((m) => chrome.runtime.sendMessage(m), message),
    close: () => page.close(),
  };
}

async function openHost(context, url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(1500);
  const frame = page.frames().find((item) => FRAME.test(item.url()));
  return { page, frame };
}

async function waitDone(target, count, tries = 120) {
  let log = [];
  for (
    let i = 0;
    i < tries && log.filter((e) => e.done).length < count;
    i += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    log = await readLog(target);
  }
  return log.filter((entry) => entry.done);
}

async function stopAndCheck(control, worker, tabId, check) {
  await control.send({ type: "ltv:tabLive:stop" });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const status = await control.send({ type: "ltv:tabLive:status", tabId });
  const capture = await worker.evaluate(() =>
    chrome.runtime.sendMessage({ target: "offscreen", type: "tab:status" }),
  );
  check(status?.active === false, "service worker vẫn ghi đang nghe");
  check(capture?.active === false, "offscreen vẫn đang thu âm thanh thẻ");
}

// Khung không có quyền: trang chính đọc song song, lớp phủ cố định.
export async function unlinkedTabScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  await worker.evaluate(() =>
    chrome.storage.sync.set({ asrEngine: "chrome", asrLang: "en-US" }),
  );
  const { page } = await openHost(context, `${baseUrl}/media-host?frame=ip2`);
  const tabId = await tabIdOf(worker, "/media-host?frame=ip2");
  const control = await controller(context, worker);
  const started = await control.send({
    type: "ltv:tabLive:start",
    tabId,
    streamId: "test:tone",
  });
  check(started?.ok, `không bắt đầu nghe cả thẻ: ${started?.error}`);
  check(started?.linked === false, "khung không có quyền mà vẫn liên kết");
  const status = await overlayStatus(page);
  check(
    /chỉ đọc song song/.test(status),
    `trạng thái không báo đọc song song ("${status}")`,
  );
  const done = await waitDone(page, 3);
  check(done.length >= 3, `chỉ đọc xong ${done.length}/3 câu`);
  check(
    done.every((entry) => VIETNAMESE.test(entry.text)),
    "có câu không phải tiếng Việt",
  );
  const fixed = await page.evaluate(
    () => document.querySelector('[data-ltv="overlay"]')?.style.position,
  );
  check(fixed === "fixed", `lớp phủ không cố định theo màn hình (${fixed})`);
  await stopAndCheck(control, worker, tabId, check);
  await control.close();
  await page.close();
  return {
    name: "Nghe cả thẻ – khung chưa cấp quyền: đọc song song ở trang chính",
    failures,
    spoken: done.map((entry) => entry.text),
  };
}

// Phụ đề khi toàn màn hình: cả khung trình phát (lớp phủ nằm trong) và chính
// <video> (track phụ đề của video).
async function fullscreenChecks(page, frame, check) {
  // Chrome chỉ cho thẻ đang hiện vào toàn màn hình.
  await page.bringToFront();
  const exit = () =>
    frame.evaluate(() => document.exitFullscreen().catch(() => {}));
  await frame.click("#fs-video");
  let state = {};
  for (let i = 0; i < 40 && !VIETNAMESE.test(state.cue || ""); i += 1) {
    await frame.waitForTimeout(250);
    state = await frame.evaluate(() => {
      const track = Array.from(document.querySelector("video").textTracks).find(
        (item) => item.label === "Lồng Tiếng Việt" && item.mode === "showing",
      );
      return {
        cue: track?.cues?.[0]?.text || "",
        fullscreen: document.fullscreenElement?.tagName || "",
      };
    });
  }
  check(
    VIETNAMESE.test(state.cue),
    `video toàn màn hình không có phụ đề (${JSON.stringify(state)})`,
  );
  await exit();
  await frame.waitForTimeout(300);
  await frame.click("#fs-player");
  await frame.waitForTimeout(500);
  const inside = await frame.evaluate(() => ({
    fullscreen: document.fullscreenElement?.id || "",
    contains: Boolean(
      document.fullscreenElement?.contains(
        document.querySelector('[data-ltv="overlay"]'),
      ),
    ),
  }));
  check(
    inside.contains,
    `khung trình phát toàn màn hình không chứa lớp phủ (${JSON.stringify(inside)})`,
  );
  await exit();
}

async function savedTranscript(worker, frameUrl) {
  const all = await worker.evaluate(() => chrome.storage.local.get(null));
  return all[`t:html5:${frameUrl}`] || null;
}

// Khung có quyền: liên kết video thật, nối tiếp, phụ đề trong khung, lưu lời chép.
export async function linkedTabScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  await worker.evaluate(() =>
    chrome.storage.sync.set({
      asrEngine: "chrome",
      asrLang: "en-US",
      liveMode: "consecutive",
    }),
  );
  const host = baseUrl.replace("127.0.0.1", "localhost");
  const { page, frame } = await openHost(
    context,
    `${host}/media-host?frame=ip1&ad=ip2`,
  );
  check(Boolean(frame), "không thấy khung trình phát");
  const tabId = await tabIdOf(worker, "/media-host?frame=ip1");
  const control = await controller(context, worker);
  await frame.evaluate(() => document.querySelector("video").play());
  const started = await control.send({
    type: "ltv:tabLive:start",
    tabId,
    streamId: "test:tone",
  });
  check(started?.ok, `không bắt đầu nghe cả thẻ: ${started?.error}`);
  check(
    started?.linked === true && started.frameId > 0,
    `không liên kết video trong khung (${JSON.stringify(started)})`,
  );
  await waitDone(frame, 1);
  await fullscreenChecks(page, frame, check);
  const done = await waitDone(frame, 3);
  check(done.length >= 3, `chỉ đọc xong ${done.length}/3 câu trong khung`);
  check(
    done.every((entry) => VIETNAMESE.test(entry.text)),
    "có câu không phải tiếng Việt",
  );
  check(
    done.filter((entry) => entry.pausedAtStart).length >= 2,
    "nối tiếp không dừng video thật khi đọc",
  );
  check(
    (await page.evaluate(() =>
      document.querySelector('[data-ltv="overlay"]'),
    )) === null,
    "trang chính vẫn có lớp phủ",
  );
  await stopAndCheck(control, worker, tabId, check);
  const entry = await savedTranscript(worker, frame.url());
  check(
    entry?.cues?.length >= 3 && entry.duration > 6,
    `không lưu lời chép theo video (${JSON.stringify(entry)?.slice(0, 120)})`,
  );
  await control.close();
  await page.close();
  return {
    name: "Nghe cả thẻ – khung có quyền: nối tiếp trên video thật, phụ đề toàn màn hình, lưu lời chép",
    failures,
    spoken: done.map((entry) => `${entry.at}s ${entry.text}`),
  };
}

// Lần sau: đã có lời chép đủ phủ → đọc lại khớp thời gian, không thu âm thanh.
export async function replayTabScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  const host = baseUrl.replace("127.0.0.1", "localhost");
  const { page, frame } = await openHost(
    context,
    `${host}/media-host?frame=ip1`,
  );
  const tabId = await tabIdOf(worker, "/media-host?frame=ip1");
  const control = await controller(context, worker);
  await frame.evaluate(() => document.querySelector("video").play());
  const started = await control.send({
    type: "ltv:tabLive:start",
    tabId,
    streamId: "test:tone",
  });
  check(
    started?.ok && started.replay === true,
    `không đọc lại theo lời chép (${JSON.stringify(started)})`,
  );
  const done = await waitDone(frame, 2);
  check(done.length >= 2, `chỉ đọc lại ${done.length}/2 câu`);
  check(
    done.every((entry) => VIETNAMESE.test(entry.text)),
    "có câu không phải tiếng Việt",
  );
  const capture = await worker.evaluate(() =>
    chrome.runtime.sendMessage({ target: "offscreen", type: "tab:status" }),
  );
  check(!capture?.active, "đọc lại mà vẫn thu âm thanh thẻ");
  await control.close();
  await page.close();
  return {
    name: "Nghe cả thẻ – lần sau đọc lại theo lời chép đã lưu (không thu âm)",
    failures,
    spoken: done.map((entry) => `${entry.at}s ${entry.text}`),
  };
}
