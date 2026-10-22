// Kịch bản e2e cho giọng AI đám mây. Azure và Google Cloud giả lập trên
// localhost (bản test đọc gốc URL từ storage.local "ltvTestTts"), đi đúng
// đường thật: trang tuỳ chọn → popup → content → service worker → offscreen
// → service worker gọi API → offscreen phát. Thêm một lần gọi Google Cloud
// thật bằng key sai để kiểm tra đường báo lỗi của dịch vụ thật.
import {
  VIETNAMESE,
  checker,
  overlayStatus,
  waitForStatus,
} from "./page-helpers.mjs";
import { TTS_KEYS, ttsRequests } from "./tts-mock.mjs";

const SYNTH_PATHS = /^\/(cognitiveservices\/v1|v1\/text:synthesize)$/;
const VOICE_ERRORS = /Lỗi giọng đọc|tạm dùng|không hợp lệ/;

const extensionId = (worker) => new URL(worker.url()).host;

// Nhập key ở trang tuỳ chọn: Lưu cũng tải danh sách giọng.
async function saveKey(context, worker, { engine, key, region }) {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId(worker)}/options/options.html`,
  );
  await page.fill(`#${engine}-key`, key);
  if (region) await page.selectOption(`#${engine}-select`, region);
  await page.click(`#${engine}-save`);
  await page
    .waitForFunction(
      (id) => /Key hoạt động|Lỗi/.test(document.getElementById(id).textContent),
      `${engine}-result`,
      { timeout: 10000 },
    )
    .catch(() => {});
  const result = await page.locator(`#${engine}-result`).textContent();
  await page.close();
  return result;
}

// Popup liệt kê giọng đã tải; chọn một giọng thì lưu vào cài đặt.
async function chooseInPopup(context, worker, value) {
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const popup = await context.newPage();
  await popup.goto(
    `chrome-extension://${extensionId(worker)}/popup/popup.html?tabId=${tabs[0].id}`,
  );
  await popup
    .waitForSelector(`#voice option[value="${value}"]`, {
      state: "attached",
      timeout: 10000,
    })
    .catch(() => {});
  const values = await popup.$$eval("#voice option", (options) =>
    options.map((option) => option.value),
  );
  if (values.includes(value)) {
    await popup.selectOption("#voice", value);
    await popup.waitForTimeout(700);
  }
  await popup.close();
  return values;
}

// Mở video (giọng đọc thật) và chờ đọc qua vài câu.
async function watch(context, { baseUrl, videoId, engine }) {
  const before = ttsRequests.length;
  const page = await context.newPage();
  await page.goto(`${baseUrl}/watch?v=${videoId}&real=1`);
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  const statuses = new Set();
  let synth = [];
  let time = 0;
  for (let i = 0; i < 100; i += 1) {
    await page.waitForTimeout(300);
    statuses.add(await overlayStatus(page));
    synth = ttsRequests
      .slice(before)
      .filter((r) => r.engine === engine && SYNTH_PATHS.test(r.path));
    time = await page.evaluate(
      () => document.querySelector("video").currentTime,
    );
    if (synth.length >= 3 && time > 10) break;
  }
  await page.close();
  return { synth, statuses: [...statuses].filter(Boolean), time };
}

function checkSpoken(check, run, { engine, voice }) {
  check(
    run.synth.length >= 3,
    `${engine}: chỉ gọi đọc ${run.synth.length} lần`,
  );
  check(
    run.synth.every((r) => r.body.includes(voice)),
    `${engine}: không dùng giọng ${voice}`,
  );
  check(
    run.synth.some((r) => VIETNAMESE.test(r.body)),
    `${engine}: văn bản gửi đọc không phải tiếng Việt`,
  );
  check(run.time > 10, `${engine}: video dừng ở ${run.time.toFixed(1)}s`);
  const errors = run.statuses.filter((status) => VOICE_ERRORS.test(status));
  check(
    errors.length === 0,
    `${engine}: báo lỗi giọng (${errors.join(" | ")})`,
  );
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

async function azureFlow(context, { baseUrl, worker, check }) {
  const result = await saveKey(context, worker, {
    engine: "azure",
    key: TTS_KEYS.azure,
    region: "japaneast",
  });
  check(
    /Key hoạt động: 2 giọng, trong đó 2 giọng tiếng Việt/.test(result),
    `kiểm tra key Azure: "${result}"`,
  );
  const values = await chooseInPopup(
    context,
    worker,
    "azure::vi-VN-NamMinhNeural",
  );
  check(
    values.includes("azure::") && values.includes("azure::vi-VN-NamMinhNeural"),
    `popup thiếu giọng Azure (${values.join(", ")})`,
  );
  const sync = await worker.evaluate(() =>
    chrome.storage.sync.get(["voiceEngine", "azureVoice", "azureRegion"]),
  );
  check(
    sync.voiceEngine === "azure" &&
      sync.azureVoice === "vi-VN-NamMinhNeural" &&
      sync.azureRegion === "japaneast",
    `cài đặt giọng Azure sai: ${JSON.stringify(sync)}`,
  );
  const run = await watch(context, {
    baseUrl,
    videoId: "cloud01",
    engine: "azure",
  });
  checkSpoken(check, run, {
    engine: "azure",
    voice: 'name="vi-VN-NamMinhNeural"',
  });
  return run;
}

async function googleFlow(context, { baseUrl, worker, check }) {
  const result = await saveKey(context, worker, {
    engine: "gcloud",
    key: TTS_KEYS.gcloud,
  });
  check(
    /Key hoạt động: 2 giọng/.test(result),
    `kiểm tra key Google Cloud: "${result}"`,
  );
  // Chưa chọn giọng: lấy giọng WaveNet tiếng Việt trong danh sách đã tải.
  const run = await watch(context, {
    baseUrl,
    videoId: "cloud02",
    engine: "gcloud",
  });
  checkSpoken(check, run, {
    engine: "gcloud",
    voice: '"name":"vi-VN-Wavenet-B"',
  });
  return run;
}

// Key sai: chuyển ngay sang giọng Google và báo trên video.
async function badKeyStatus(context, { baseUrl, videoId }) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/watch?v=${videoId}&real=1`);
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  const status = await waitForStatus(
    page,
    /không hợp lệ.*tạm dùng giọng Google/,
    25000,
  );
  await page.close();
  return status;
}

export async function cloudVoiceScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  const mock = baseUrl.replace("127.0.0.1", "localhost");
  await setStores(worker, {
    local: { ltvTestTts: { azure: `${mock}/azure`, gcloud: `${mock}/gcloud` } },
  });
  const spoken = [];
  try {
    const azure = await azureFlow(context, { baseUrl, worker, check });
    const google = await googleFlow(context, { baseUrl, worker, check });
    spoken.push(
      `Azure: ${azure.synth.length} lần đọc, video tới ${azure.time.toFixed(1)}s`,
      `Google Cloud: ${google.synth.length} lần đọc, video tới ${google.time.toFixed(1)}s`,
    );
    await setStores(worker, {
      sync: { voiceEngine: "azure" },
      local: { azureTtsKey: "bad-key" },
    });
    const azureBad = await badKeyStatus(context, {
      baseUrl,
      videoId: "cloud03",
    });
    check(
      /API key Azure không hợp lệ hoặc sai vùng.*tạm dùng giọng Google/.test(
        azureBad,
      ),
      `key Azure sai không chuyển giọng (status: "${azureBad}")`,
    );
    // Google Cloud thật (không qua máy chủ giả lập) với key sai.
    await setStores(worker, {
      sync: { voiceEngine: "gcloud", gcloudVoice: "" },
      local: {
        ltvTestTts: { azure: `${mock}/azure` },
        gcloudTtsKey: "invalid-e2e-key",
      },
    });
    const googleBad = await badKeyStatus(context, {
      baseUrl,
      videoId: "cloud04",
    });
    check(
      /API key Google Cloud không hợp lệ: API key not valid.*tạm dùng giọng Google/.test(
        googleBad,
      ),
      `Google Cloud thật với key sai: status "${googleBad}"`,
    );
    spoken.push(
      `key Azure sai: ${azureBad}`,
      `Google Cloud thật, key sai: ${googleBad}`,
    );
  } finally {
    await setStores(worker, {
      sync: { voiceEngine: "google", azureVoice: "", gcloudVoice: "" },
      removeLocal: ["azureTtsKey", "gcloudTtsKey", "cloudVoices", "ltvTestTts"],
    });
  }
  return {
    name: "Giọng AI Azure + Google Cloud (giả lập; Google Cloud thật với key sai)",
    failures,
    spoken,
  };
}
