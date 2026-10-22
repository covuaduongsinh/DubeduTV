// Kịch bản e2e cho video KHÔNG có phụ đề: chép lời (giả lập theo kịch bản,
// vì Chromium thử nghiệm không có dịch vụ nhận dạng của Google) → dịch thật →
// đọc theo hai chế độ → lưu lời chép → xem lại khớp thời gian; cùng các đường
// lỗi thật của bộ nhận dạng Chrome và Whisper.
import { LESSON, LONG_LESSON } from "./fixtures.mjs";
import {
  VIETNAMESE,
  checker,
  overlayStatus,
  readLog,
  waitForStatus,
} from "./page-helpers.mjs";

async function openVideo(context, url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector("video", { state: "attached" });
  await page.evaluate(() => document.querySelector("video").play());
  return page;
}

async function waitForSpoken(page, count, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const statuses = new Set();
  let log = [];
  while (Date.now() < deadline) {
    log = await readLog(page);
    statuses.add(await overlayStatus(page));
    if (log.filter((entry) => entry.done).length >= count) break;
    await page.waitForTimeout(250);
  }
  return { log, done: log.filter((e) => e.done && !e.interrupted), statuses };
}

async function savedTranscript(worker, key) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const entry = await worker.evaluate(
      async (name) => (await chrome.storage.local.get(name))[name] || null,
      `t:${key}`,
    );
    if (entry?.cues?.length >= LESSON.length) return entry;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function describe(done) {
  return done.map(
    (entry) =>
      `${entry.at.toFixed(2)}s ×${entry.rate}${entry.pausedAtStart ? " (video dừng)" : ""} ${entry.text}`,
  );
}

export async function liveScenario(
  context,
  { baseUrl, worker, videoId, liveMode },
) {
  await worker.evaluate(
    (mode) => chrome.storage.sync.set({ liveMode: mode, asrEngine: "chrome" }),
    liveMode,
  );
  const page = await openVideo(
    context,
    `${baseUrl}/watch?v=${videoId}&nosub=1`,
  );
  const { failures, check } = checker();
  const { done, statuses } = await waitForSpoken(page, LESSON.length, 70000);
  check(
    done.length >= LESSON.length,
    `chỉ đọc xong ${done.length}/${LESSON.length} câu`,
  );
  check(
    done.every((entry) => VIETNAMESE.test(entry.text)),
    "có câu không phải tiếng Việt",
  );
  done.forEach((entry, i) => {
    // Lần xem đầu: chỉ đọc được sau khi người nói nói xong câu.
    if (LESSON[i])
      check(entry.at >= LESSON[i][1], `câu ${i + 1} đọc trước khi nói xong`);
  });
  check(
    [...statuses].some((s) => /Đang nghe|chép lời/.test(s)),
    "không báo đang chép lời",
  );
  if (liveMode === "consecutive") {
    check(
      done.every((entry) => entry.pausedAtStart),
      "chế độ nối tiếp không tạm dừng video khi đọc",
    );
    await page.waitForTimeout(3500);
    const resumed = await page.evaluate(() => {
      const video = document.querySelector("video");
      return !video.paused || video.ended;
    });
    check(resumed, "đọc xong không phát tiếp video");
  } else {
    check(
      done.every((entry) => !entry.pausedAtStart),
      "chế độ song song lại dừng video",
    );
    const ducked = done.filter((entry) => entry.volumeDuring !== undefined);
    check(
      ducked.every((entry) => entry.volumeDuring <= 0.2),
      "không giảm tiếng gốc khi đọc song song",
    );
  }
  const transcript = await savedTranscript(worker, `youtube:${videoId}`);
  check(Boolean(transcript), "không lưu lời chép");
  await page.close();
  const name =
    liveMode === "consecutive"
      ? "Video không phụ đề – dịch nối tiếp (tự dừng video)"
      : "Video không phụ đề – đọc song song";
  return { name, failures, spoken: describe(done) };
}

// Xem lại video đã chép lời: dùng lời chép như phụ đề, đọc khớp thời gian.
// Song song + kết quả tạm: đọc từng cụm ngắn ngay khi nghe, không chờ hết câu.
export async function interimScenario(context, { baseUrl, worker }) {
  await worker.evaluate(() =>
    chrome.storage.sync.set({ liveMode: "parallel", asrEngine: "chrome" }),
  );
  const page = await openVideo(
    context,
    `${baseUrl}/watch?v=nosub03&nosub=1&interim=1`,
  );
  const { failures, check } = checker();
  const { done } = await waitForSpoken(page, 5, 40000);
  check(done.length >= 4, `chỉ đọc ${done.length} cụm (cần ≥ 4 từ 2 câu)`);
  check(
    done.length > 0 && done[0].at < LONG_LESSON[0][1],
    `cụm đầu đọc lúc ${done[0]?.at}s, không sớm hơn lúc nói xong câu (${LONG_LESSON[0][1]}s)`,
  );
  check(
    done.every((entry) => VIETNAMESE.test(entry.text)),
    "có cụm không phải tiếng Việt",
  );
  check(
    done.every((entry, i) => i === 0 || entry.at >= done[i - 1].at),
    "thứ tự đọc không tăng dần",
  );
  await page.close();
  return {
    name: "Nghe trực tiếp song song – đọc từng cụm ngay khi nghe",
    failures,
    spoken: describe(done),
  };
}

export async function replayScenario(context, { baseUrl, videoId }) {
  const page = await openVideo(
    context,
    `${baseUrl}/watch?v=${videoId}&nosub=1`,
  );
  const { failures, check } = checker();
  const { done, statuses } = await waitForSpoken(page, LESSON.length, 40000);
  check(
    done.length >= LESSON.length,
    `chỉ đọc xong ${done.length}/${LESSON.length} câu`,
  );
  done.forEach((entry, i) => {
    if (!LESSON[i]) return;
    const [start, end] = LESSON[i];
    check(
      entry.at >= start - 0.2 && entry.at < end,
      `câu ${i + 1} không khớp thời gian (${entry.at}s)`,
    );
  });
  check(
    done.every((entry) => !entry.pausedAtStart),
    "xem lại mà vẫn dừng video",
  );
  check(
    [...statuses].some((s) => /lời chép tự động đã lưu/.test(s)),
    "không dùng lời chép đã lưu",
  );
  await page.close();
  return {
    name: "Xem lại video đã chép lời – lồng tiếng khớp thời gian",
    failures,
    spoken: describe(done),
  };
}

// Whisper thật: thu âm + MediaRecorder + gửi service worker; host api.groq.com
// bị chặn ở môi trường kiểm thử nên kỳ vọng báo lỗi rõ ràng.
export async function whisperErrorScenario(context, { baseUrl, worker }) {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ whisperApiKey: "test-key" });
    await chrome.storage.sync.set({
      asrEngine: "whisper",
      liveMode: "consecutive",
    });
  });
  const page = await openVideo(
    context,
    `${baseUrl}/watch?v=whisper01&nosub=1&tone=1`,
  );
  await page.waitForTimeout(6500);
  await page.evaluate(() => document.querySelector("video").pause());
  const status = await waitForStatus(page, /Lỗi chép lời/, 30000);
  await page.close();
  await worker.evaluate(async () => {
    await chrome.storage.local.remove("whisperApiKey");
    await chrome.storage.sync.set({ asrEngine: "chrome" });
  });
  const failures = /Lỗi chép lời/.test(status)
    ? []
    : [`không báo lỗi chép lời Whisper (status: "${status}")`];
  return {
    name: "Whisper thật: thu âm → gửi chép lời (đường lỗi mạng)",
    failures,
    spoken: [`status: ${status}`],
  };
}

// Bộ nhận dạng thật của Chromium: không có dịch vụ Google → báo lỗi, không treo.
export async function chromeAsrErrorScenario(context, { baseUrl }) {
  const page = await openVideo(
    context,
    `${baseUrl}/watch?v=chrome01&nosub=1&realasr=1`,
  );
  const status = await waitForStatus(page, /nhận dạng giọng nói/, 30000);
  await page.close();
  const failures = /Không kết nối được dịch vụ nhận dạng giọng nói/.test(status)
    ? []
    : [`không báo lỗi nhận dạng Chrome (status: "${status}")`];
  return {
    name: "Nhận dạng giọng Chrome thật (đường lỗi mạng)",
    failures,
    spoken: [`status: ${status}`],
  };
}
