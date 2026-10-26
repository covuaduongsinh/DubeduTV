// Kịch bản e2e "Quay video lồng tiếng": trang YouTube giả lập đang lồng
// tiếng bằng giọng AI Azure giả lập (giọng phát thật trong offscreen), luồng
// thẻ giả "test:tone" (tiếng tone + hình canvas – headless không bấm được
// biểu tượng tiện ích để lấy luồng thật). Kiểm tra đường popup → service
// worker → khung video → offscreen quay → IndexedDB → trang xem/tải: file có
// hình đúng tỉ lệ vùng video, giọng đọc vào file, phụ đề .srt theo giờ quay,
// thanh điều khiển bị ẩn khi quay, "Nghe cả thẻ" bị chặn khi đang quay.
import "../../src/content/lib/util.js";
import { LESSON } from "./fixtures.mjs";
import { VIETNAMESE, checker, tabIdOf } from "./page-helpers.mjs";
import { TTS_KEYS } from "./tts-mock.mjs";

const RECORD_SECONDS = 10;
const CACHE_KEY = "v:youtube:rec01:en:vi:google";
const LESSON_VI = [
  "Chào mừng đến với bài học cờ vua ngắn này.",
  "Hôm nay chúng ta sẽ học cách quân Mã di chuyển.",
  "Quân Mã nhảy theo hình chữ L.",
  "Nó có thể nhảy qua các quân khác.",
  "Hãy luyện nước đi này mỗi ngày.",
];

// Bản dịch nạp sẵn vào cache: kịch bản này kiểm tra phần quay, không phụ
// thuộc Google Dịch có đang chặn môi trường thử hay không.
function seededTranslations() {
  const hash = globalThis.LTV.util.hashText;
  return {
    ts: Date.now(),
    items: Object.fromEntries(
      LESSON.map(([, , text], index) => [hash(text), LESSON_VI[index]]),
    ),
  };
}

async function setStores(worker, { sync, local, removeLocal }) {
  await worker.evaluate(
    async ({ sync: s, local: l, removeLocal: r }) => {
      if (s) await chrome.storage.sync.set(s);
      if (l) await chrome.storage.local.set(l);
      if (r) await chrome.storage.local.remove(r);
    },
    { sync, local, removeLocal },
  );
}

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

// Mở video, phát và đợi giọng Việt bắt đầu đọc.
async function openDubbing(context, baseUrl) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/watch?v=rec01&real=1`);
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  await page
    .waitForFunction(
      () =>
        /Đang lồng tiếng/.test(
          document
            .querySelector('[data-ltv="overlay"]')
            ?.shadowRoot?.querySelector(".status")?.textContent || "",
        ) || document.querySelector("video").currentTime > 2,
      null,
      { timeout: 20000 },
    )
    .catch(() => {});
  return page;
}

// Thẻ kết quả mở sau khi dừng: đọc bản quay qua trang đó.
async function readResult(context) {
  const page = await context
    .waitForEvent("page", {
      predicate: (item) => item.url().includes("recorder/result.html?id="),
      timeout: 20000,
    })
    .catch(() => null);
  if (!page) return null;
  await page.waitForLoadState();
  await page
    .waitForFunction(() => !document.getElementById("current").hidden, null, {
      timeout: 15000,
    })
    .catch(() => {});
  const result = await page.evaluate(async () => {
    const id = new URL(location.href).searchParams.get("id");
    const meta = await globalThis.LTV.createRecordingsDb().get(id);
    const player = document.getElementById("player");
    if (player.readyState < 1)
      await new Promise((resolve) => {
        player.onloadedmetadata = resolve;
        player.onerror = resolve;
        setTimeout(resolve, 8000);
      });
    return {
      meta: meta && { ...meta, srt: meta.srt || "" },
      width: player.videoWidth,
      height: player.videoHeight,
      download: document.getElementById("download-video").textContent,
      srtButton: !document.getElementById("download-srt").hidden,
    };
  });
  await page.close();
  return result;
}

function checkResult(check, result, aspect) {
  check(Boolean(result), "không mở trang bản quay sau khi dừng");
  if (!result) return;
  const { meta } = result;
  check(meta?.status === "done", `bản quay chưa chốt: ${meta?.status}`);
  check(meta?.bytes > 20000, `file quay quá nhỏ: ${meta?.bytes} byte`);
  check(
    meta?.duration >= RECORD_SECONDS - 1,
    `thời lượng ${meta?.duration}s < ${RECORD_SECONDS - 1}s`,
  );
  check(/^video\/(mp4|webm)/.test(meta?.mimeType || ""), meta?.mimeType);
  check(
    result.width > 0 && Math.abs(result.width / result.height - aspect) < 0.05,
    `hình ${result.width}×${result.height} không theo tỉ lệ vùng video ${aspect.toFixed(2)}`,
  );
  check(
    new RegExp(`\\.${meta?.extension}\\)`).test(result.download),
    `nút tải: "${result.download}"`,
  );
  const cues = meta?.srt.split("\n\n").filter(Boolean) || [];
  check(cues.length >= 2, `phụ đề .srt chỉ có ${cues.length} câu`);
  check(
    cues.every((cue) => /^\d+\n\d\d:\d\d:\d\d,\d{3} --> /.test(cue)),
    "phụ đề .srt sai định dạng",
  );
  check(VIETNAMESE.test(meta?.srt), "phụ đề .srt không có tiếng Việt");
  check(result.srtButton, "không có nút tải phụ đề");
}

async function whileRecording(page, control, tabId, check) {
  const status = await control.send({ type: "ltv:record:status", tabId });
  check(status?.active === true, "service worker không ghi đang quay");
  const hidden = await page.evaluate(() =>
    Boolean(document.getElementById("ltv-recording-style")),
  );
  check(hidden, "không ẩn thanh điều khiển trình phát khi quay");
  const live = await control.send({
    type: "ltv:tabLive:start",
    tabId,
    streamId: "test:tone",
  });
  check(
    live?.ok === false && /đang quay video/.test(live.error || ""),
    `"Nghe cả thẻ" không bị chặn khi đang quay (${JSON.stringify(live)})`,
  );
}

function summary(result, stopped) {
  const meta = result?.meta || {};
  return [
    `${meta.mimeType}, ${result?.width}×${result?.height}, ${Math.round(meta.duration || 0)}s, ${Math.round((meta.bytes || 0) / 1024)} KB, ${stopped?.voices} câu giọng đọc`,
    ...(meta.srt || "").split("\n\n").slice(0, 3),
  ];
}

export async function recordScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  const mock = baseUrl.replace("127.0.0.1", "localhost");
  await setStores(worker, {
    sync: {
      voiceEngine: "azure",
      azureVoice: "vi-VN-HoaiMyNeural",
      glossaryMode: "off",
    },
    local: {
      ltvTestTts: { azure: `${mock}/azure` },
      azureTtsKey: TTS_KEYS.azure,
      [CACHE_KEY]: seededTranslations(),
    },
  });
  const spoken = [];
  try {
    const page = await openDubbing(context, baseUrl);
    const tabId = await tabIdOf(worker, "/watch?v=rec01");
    const aspect = await page.evaluate(() => {
      const rect = document.querySelector("video").getBoundingClientRect();
      return rect.width / rect.height;
    });
    const control = await controller(context, worker);
    const started = await control.send({
      type: "ltv:record:start",
      tabId,
      frameId: 0,
      streamId: "test:tone",
    });
    check(started?.ok, `không bắt đầu quay: ${started?.error}`);
    check(started?.cropped === true, "không cắt hình theo vùng video");
    await page.waitForTimeout((RECORD_SECONDS / 2) * 1000);
    await whileRecording(page, control, tabId, check);
    await page.waitForTimeout((RECORD_SECONDS / 2) * 1000);
    const resultPage = readResult(context);
    const stopped = await control.send({ type: "ltv:record:stop" });
    check(stopped?.ok, `dừng quay lỗi: ${stopped?.error}`);
    check(
      stopped?.voices >= 2,
      `chỉ ${stopped?.voices} câu giọng Việt vào file`,
    );
    const result = await resultPage;
    checkResult(check, result, aspect);
    check(
      !(await page.evaluate(() =>
        Boolean(document.getElementById("ltv-recording-style")),
      )),
      "dừng quay mà thanh điều khiển vẫn bị ẩn",
    );
    spoken.push(...summary(result, stopped));
    await control.close();
    await page.close();
  } finally {
    await setStores(worker, {
      sync: { voiceEngine: "google", azureVoice: "", glossaryMode: "auto" },
      removeLocal: ["azureTtsKey", "cloudVoices", "ltvTestTts", CACHE_KEY],
    });
  }
  return {
    name: "Quay video lồng tiếng → file video + phụ đề .srt (luồng thẻ giả)",
    failures,
    spoken,
  };
}
