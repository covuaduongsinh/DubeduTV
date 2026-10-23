// Điều phối "Nghe âm thanh cả thẻ": mỗi lúc một thẻ. Popup xin luồng âm thanh
// của thẻ (chrome.tabCapture chỉ cho từ thao tác của người dùng), service
// worker tìm khung chứa video mà tiện ích với tới được (media-link.js), bảo
// các khung tạm dừng lồng tiếng riêng, nhờ offscreen document thu và chép
// lời, rồi chuyển lời chép tới khung có video (hoặc trang chính khi không
// với tới video) để dịch và đọc. Video đã có lời chép đủ phủ thì lồng tiếng
// lại theo lời chép ngay trong khung, không cần thu âm thanh. Trạng thái lưu
// ở storage.session để vẫn đúng khi service worker khởi động lại.

const STATE_KEY = "ltv-tab-live";
const PING_ATTEMPTS = 10;
const PING_DELAY_MS = 200;
const MAX_DELIVERY_FAILURES = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Trang chính của thẻ phải có content script (trang chưa hỗ trợ thì nạp vào).
async function ensureTopFrame(tabs, tabId, injectTopFrame) {
  for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
    const reply = await tabs
      .sendMessage(tabId, { type: "ltv:ping" }, { frameId: 0 })
      .catch(() => null);
    if (reply?.ok) return;
    if (attempt === 0) await injectTopFrame(tabId);
    await sleep(PING_DELAY_MS);
  }
  throw new Error("Không nạp được tiện ích vào trang này");
}

// Bộ chép lời: Whisper khi đã chọn và có key, không thì Chrome.
async function speechSetup(readSettings, hasWhisperKey) {
  const settings = await readSettings();
  const engine =
    settings.asrEngine === "whisper" && (await hasWhisperKey())
      ? "whisper"
      : "chrome";
  const lang =
    settings.asrLang === "auto" && engine === "chrome"
      ? "en-US"
      : settings.asrLang;
  return { engine, lang };
}

// Offscreen thu âm thanh thẻ và chép lời; trả về bộ chép lời và lúc bắt đầu.
async function startCapture(deps, streamId) {
  const { engine, lang } = await speechSetup(
    deps.readSettings,
    deps.hasWhisperKey,
  );
  await deps.offscreenDoc.ensure({ media: true });
  const reply = await deps.runtime.sendMessage({
    target: "offscreen",
    type: "tab:start",
    streamId,
    lang,
    engine,
  });
  if (!reply?.ok)
    throw new Error(reply?.error || "Không thu được âm thanh của thẻ");
  return { engine, lang, startedAt: reply.startedAt };
}

// Đã có lời chép: bật lồng tiếng thường trong khung video (đọc khớp thời
// gian như video có phụ đề), không cần thu âm thanh thẻ.
async function replayInFrame(tabs, tabId, media) {
  await tabs.sendMessage(
    tabId,
    { type: "ltv:toggle", force: true },
    { frameId: media.frameId },
  );
  return { tabId, replay: true };
}

export function createTabLive({
  offscreenDoc,
  injectTopFrame,
  readSettings,
  hasWhisperKey,
  // → { frameId, key } của khung có video, hoặc null.
  findMedia = async () => null,
  // → true nếu video có lời chép đủ phủ để đọc lại.
  hasTranscript = async () => false,
  tabs = chrome.tabs,
  runtime = chrome.runtime,
  session = chrome.storage.session,
}) {
  let failures = 0;

  async function current() {
    return (await session.get(STATE_KEY))[STATE_KEY] || null;
  }

  const save = (state) =>
    state ? session.set({ [STATE_KEY]: state }) : session.remove(STATE_KEY);

  // Khung nhận lời chép: khung có video, hoặc trang chính.
  const toFrame = (state, message) =>
    tabs.sendMessage(
      state.tabId,
      { type: "ltv:tabLive", ...message },
      { frameId: state.frameId ?? 0 },
    );

  async function stop(reason = "") {
    const state = await current();
    if (!state) return;
    await save(null);
    failures = 0;
    runtime
      .sendMessage({ target: "offscreen", type: "tab:stop" })
      .catch(() => {});
    toFrame(state, { event: "stopped", reason }).catch(() => {});
  }

  async function start({ tabId, streamId }) {
    const previous = await current();
    if (previous) await stop("Đã chuyển sang nghe thẻ khác.");
    await ensureTopFrame(tabs, tabId, injectTopFrame);
    const media = await findMedia(tabId);
    // Video trong các khung của thẻ đang tự lồng tiếng thì tạm dừng.
    tabs.sendMessage(tabId, { type: "ltv:pause" }).catch(() => {});
    if (media && (await hasTranscript(media.key)))
      return replayInFrame(tabs, tabId, media);
    const { engine, lang, startedAt } = await startCapture(
      { offscreenDoc, runtime, readSettings, hasWhisperKey },
      streamId,
    );
    const state = {
      tabId,
      startedAt,
      lang,
      engine,
      frameId: media?.frameId ?? 0,
      linked: Boolean(media),
      key: media?.key || "",
    };
    await save(state);
    failures = 0;
    await toFrame(state, { event: "started", ...state });
    return state;
  }

  // Sự kiện từ offscreen: lời chép, kết quả tạm, lỗi, hết âm thanh.
  async function relay({ target: _target, type: _type, ...event }) {
    const state = await current();
    if (!state) return;
    if (event.event === "ended") {
      await stop("Âm thanh của thẻ đã dừng.");
      return;
    }
    try {
      await toFrame(state, event);
      failures = 0;
    } catch {
      failures += 1;
      if (failures >= MAX_DELIVERY_FAILURES) await stop();
    }
  }

  return {
    start,
    stop,
    relay,
    status: async (tabId) => {
      const state = await current();
      return {
        active: Boolean(state && state.tabId === tabId),
        tabId: state?.tabId ?? null,
      };
    },
    // Giảm/trả âm lượng tiếng gốc – chỉ thẻ đang được nghe mới điều khiển được.
    async gain(tabId, value) {
      const state = await current();
      if (state?.tabId === tabId)
        runtime
          .sendMessage({ target: "offscreen", type: "tab:gain", value })
          .catch(() => {});
    },
    async stopIfTab(tabId, reason) {
      const state = await current();
      if (state?.tabId === tabId) await stop(reason);
    },
  };
}
