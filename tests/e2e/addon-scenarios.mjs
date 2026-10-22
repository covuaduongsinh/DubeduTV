// Kịch bản e2e cho phần chạy kèm: nút dịch câu hỏi trắc nghiệm, huy hiệu
// "Đã lồng" trên danh sách video, tự bật "chỉ video đã lồng" và bộ dịch
// Chrome trên máy (Chromium thử nghiệm có thể không có Translator API: khi đó
// phải tự dùng Google Dịch và lưu cache đúng bộ dịch thật).
import {
  VIETNAMESE,
  checker,
  overlayStatus,
  readLog,
} from "./page-helpers.mjs";

async function waitUntil(page, fn, arg, timeout = 10000) {
  return page
    .waitForFunction(fn, arg, { timeout })
    .then(() => true)
    .catch(() => false);
}

async function quizScenario(context, { baseUrl }) {
  const { failures, check } = checker();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/coursera/learn/demo/quiz/q1`);
  const hasButton = await waitUntil(page, () =>
    document.querySelector('[data-ltv="quiz-btn"]'),
  );
  check(hasButton, "không có nút Dịch cạnh nút Submit");
  let lines = [];
  if (hasButton) {
    await page.click('[data-ltv="quiz-btn"]');
    await waitUntil(
      page,
      () => document.querySelectorAll('[data-ltv="quiz-tr"]').length >= 4,
      null,
      20000,
    );
    lines = await page.$$eval('[data-ltv="quiz-tr"]', (nodes) =>
      nodes.map((node) => node.textContent),
    );
    check(
      lines.length === 4,
      `cần 4 dòng dịch (câu hỏi + 3 đáp án), có ${lines.length}`,
    );
    check(
      lines.every((line) => VIETNAMESE.test(line)),
      "bản dịch không phải tiếng Việt",
    );
    check(
      lines.some((line) => /(^|\s)Mã(\s|$|[.,?!])/.test(line)) &&
        lines.some((line) => /(^|\s)Tượng(\s|$|[.,?!])/.test(line)),
      "quiz cờ vua không dùng thuật ngữ Mã/Tượng",
    );
    await page.click('[data-ltv="quiz-btn"]');
    const hidden = await page.$$eval('[data-ltv="quiz-tr"]', (nodes) =>
      nodes.every((node) => node.hidden),
    );
    check(hidden, "bấm lần hai không ẩn bản dịch");
  }
  const submitted = await page.evaluate(() => document.body.dataset.submitted);
  check(!submitted, "bấm Dịch làm nộp bài");
  await page.close();
  return {
    name: "Coursera – nút Dịch câu hỏi trắc nghiệm",
    failures,
    spoken: lines,
  };
}

async function badgesScenario(context, { baseUrl }) {
  const { failures, check } = checker();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/feed`);
  const badge = (id) =>
    page.evaluate(
      (value) =>
        document.querySelector(`a[data-id="${value}"] [data-ltv="badge"]`)
          ?.textContent || "",
      id,
    );
  await waitUntil(
    page,
    () => document.querySelector('a[data-id="nosub02"] [data-ltv="badge"]'),
    null,
    8000,
  );
  const labels = {};
  for (const id of ["knight01", "nosub01", "nosub02", "unknown99"])
    labels[id] = await badge(id);
  check(labels.knight01 === "Đã lồng", `knight01: "${labels.knight01}"`);
  check(Boolean(labels.nosub01), "video đã chép lời không có huy hiệu");
  check(Boolean(labels.nosub02), "video thêm vào sau không có huy hiệu");
  check(!labels.unknown99, "video chưa lồng lại có huy hiệu");
  await page.close();
  return {
    name: "YouTube – huy hiệu “Đã lồng” trên danh sách video",
    failures,
    spoken: Object.entries(labels).map(([id, text]) => `${id}: ${text || "—"}`),
  };
}

async function spokenWithin(page, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await readLog(page)).length > 0) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function openPlaying(context, url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  return page;
}

async function cachedAutoStartScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  await worker.evaluate(() => chrome.storage.sync.set({ autoStart: "cached" }));
  const known = await openPlaying(context, `${baseUrl}/watch?v=knight01`);
  check(await spokenWithin(known, 20000), "video đã lồng không tự bật");
  await known.close();
  const fresh = await openPlaying(context, `${baseUrl}/watch?v=fresh01`);
  check(!(await spokenWithin(fresh, 6000)), "video chưa lồng lại tự bật");
  await fresh.close();
  await worker.evaluate(() => chrome.storage.sync.set({ autoStart: "always" }));
  return { name: "Tự bật “chỉ video đã lồng”", failures, spoken: [] };
}

async function chromeTranslatorScenario(context, { baseUrl, worker }) {
  const { failures, check } = checker();
  const id = new URL(worker.url()).host;
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${id}/options/options.html`);
  const hasApi = await probe.evaluate(() => typeof Translator === "function");
  await probe.close();
  await worker.evaluate(() =>
    chrome.storage.sync.set({ translator: "chrome" }),
  );
  const page = await openPlaying(context, `${baseUrl}/watch?v=chrome01`);
  const statuses = new Set();
  let log = [];
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    statuses.add(await overlayStatus(page));
    log = await readLog(page);
    if (log.filter((entry) => entry.done).length >= 2) break;
    await page.waitForTimeout(250);
  }
  check(
    log.some((entry) => VIETNAMESE.test(entry.text)),
    "không đọc được câu tiếng Việt",
  );
  const keys = await worker.evaluate(async () =>
    Object.keys(await chrome.storage.local.get(null)).filter((key) =>
      key.startsWith("v:youtube:chrome01:"),
    ),
  );
  const warned = [...statuses].some((text) =>
    /tạm dùng Google Dịch/.test(text),
  );
  if (!hasApi) {
    check(warned, "không báo đang tạm dùng Google Dịch");
    check(
      keys.includes("v:youtube:chrome01:en:vi:google"),
      `khoá cache: ${keys.join(", ")}`,
    );
  }
  check(
    !keys.includes("v:youtube:chrome01:en:vi:chrome") || hasApi,
    "lưu bản dịch Google dưới khoá chrome",
  );
  await page.close();
  await worker.evaluate(() =>
    chrome.storage.sync.set({ translator: "google" }),
  );
  return {
    name: `Bộ dịch Chrome trên máy (${hasApi ? "có" : "không có"} Translator API)`,
    failures,
    spoken: [
      ...[...statuses].filter(Boolean).slice(0, 3),
      `cache: ${keys.join(", ")}`,
    ],
  };
}

async function spokenLines(context, url, count) {
  const page = await openPlaying(context, url);
  let log = [];
  for (let i = 0; i < 160; i += 1) {
    log = await readLog(page);
    if (log.filter((entry) => entry.done).length >= count) break;
    await page.waitForTimeout(250);
  }
  await page.close();
  return log.map((entry) => entry.text);
}

// Video cờ vua: Google dịch "knight" thành "hiệp sĩ", từ điển sửa thành Mã;
// truyện có "knight" nhưng không về cờ vua thì giữ nguyên.
async function glossaryScenario(context, { baseUrl }) {
  const { failures, check } = checker();
  const chess = await spokenLines(context, `${baseUrl}/watch?v=glossary01`, 5);
  check(
    chess.some((line) => /(^|\s)Mã(\s|$)/.test(line)),
    "video cờ vua không đọc thuật ngữ Mã",
  );
  check(
    !chess.some((line) => /hiệp sĩ|mảnh/i.test(line)),
    "video cờ vua còn “hiệp sĩ”/“mảnh”",
  );
  const story = await spokenLines(context, `${baseUrl}/watch?v=story01`, 3);
  check(story.length >= 3, `truyện chỉ đọc ${story.length}/3 câu`);
  check(
    !story.some((line) => /(^|\s)Mã(\s|$)/.test(line)),
    "truyện không phải cờ vua bị đổi sang thuật ngữ cờ",
  );
  return {
    name: "Từ điển thuật ngữ cờ vua (tự nhận video cờ vua)",
    failures,
    spoken: [...chess, "—", ...story],
  };
}

export function addonScenarios(context, options) {
  return [
    () => glossaryScenario(context, options),
    () => quizScenario(context, options),
    () => badgesScenario(context, options),
    () => cachedAutoStartScenario(context, options),
    () => chromeTranslatorScenario(context, options),
  ];
}
