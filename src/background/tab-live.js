// Điều phối "Nghe âm thanh cả thẻ": mỗi lúc một thẻ. Popup xin luồng âm thanh
// của thẻ (chrome.tabCapture chỉ cho từ thao tác của người dùng), service
// worker bảo các khung trong thẻ tạm dừng lồng tiếng riêng, nhờ offscreen
// document thu và chép lời, rồi chuyển lời chép tới trang chính của thẻ để
// dịch và đọc. Trạng thái lưu ở storage.session để vẫn đúng khi service
// worker khởi động lại.

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

export function createTabLive({
  offscreenDoc,
  injectTopFrame,
  readSettings,
  hasWhisperKey,
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

  const toTop = (tabId, message) =>
    tabs.sendMessage(
      tabId,
      { type: "ltv:tabLive", ...message },
      { frameId: 0 },
    );

  async function stop(reason = "") {
    const state = await current();
    if (!state) return;
    await save(null);
    failures = 0;
    runtime
      .sendMessage({ target: "offscreen", type: "tab:stop" })
      .catch(() => {});
    toTop(state.tabId, { event: "stopped", reason }).catch(() => {});
  }

  async function start({ tabId, streamId }) {
    const previous = await current();
    if (previous) await stop("Đã chuyển sang nghe thẻ khác.");
    await ensureTopFrame(tabs, tabId, injectTopFrame);
    // Video trong các khung của thẻ đang tự lồng tiếng thì tạm dừng.
    tabs.sendMessage(tabId, { type: "ltv:pause" }).catch(() => {});
    const { engine, lang } = await speechSetup(readSettings, hasWhisperKey);
    await offscreenDoc.ensure({ media: true });
    const reply = await runtime.sendMessage({
      target: "offscreen",
      type: "tab:start",
      streamId,
      lang,
      engine,
    });
    if (!reply?.ok)
      throw new Error(reply?.error || "Không thu được âm thanh của thẻ");
    const state = { tabId, startedAt: reply.startedAt, lang, engine };
    await save(state);
    failures = 0;
    await toTop(tabId, { event: "started", ...state });
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
      await toTop(state.tabId, event);
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
