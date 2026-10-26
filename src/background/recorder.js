// Điều phối "Quay video lồng tiếng": mỗi lúc một thẻ. Popup xin luồng thẻ
// (chrome.tabCapture chỉ cho từ thao tác của người dùng) và chỉ ra khung đang
// lồng tiếng; service worker bảo khung đó báo vị trí video và từng câu phụ
// đề, nhờ offscreen document quay, rồi mở trang xem/tải bản quay khi dừng
// (bấm dừng, video hết, đóng hoặc rời thẻ). Trạng thái lưu ở storage.session
// để vẫn đúng khi service worker khởi động lại.

const STATE_KEY = "ltv-recording";
const RESULT_PAGE = "recorder/result.html";
const NO_VIDEO =
  "Chưa thấy video đang lồng tiếng trong thẻ này – bật lồng tiếng rồi bấm quay.";

// Khung đang lồng tiếng bắt đầu báo vị trí video; trả vị trí ban đầu.
async function beginInFrame(tabs, tabId, frameId) {
  const begin = await tabs
    .sendMessage(tabId, { type: "ltv:record:begin" }, { frameId })
    .catch(() => null);
  if (!begin?.ok) throw new Error(begin?.error || NO_VIDEO);
  return begin.layout;
}

function showResult(tabs, runtime, id) {
  return tabs
    .create({
      url: runtime.getURL(`${RESULT_PAGE}?id=${encodeURIComponent(id)}`),
    })
    .catch(() => {});
}

// Tin của khung đang quay → lệnh cho offscreen.
function offscreenMessage(message) {
  return message.type === "record:layout"
    ? { type: "rec:layout", layout: message.layout }
    : { type: "rec:line", text: message.text, at: message.at };
}

export function createRecorder({
  offscreenDoc,
  // → true nếu thẻ đang "Nghe âm thanh cả thẻ" (Chrome không cho thu hai lần).
  isTabLive = async () => false,
  tabs = chrome.tabs,
  runtime = chrome.runtime,
  session = chrome.storage.session,
}) {
  async function current() {
    return (await session.get(STATE_KEY))[STATE_KEY] || null;
  }

  const save = (state) =>
    state ? session.set({ [STATE_KEY]: state }) : session.remove(STATE_KEY);

  const toFrame = (state, type) =>
    tabs
      .sendMessage(state.tabId, { type }, { frameId: state.frameId })
      .catch(() => null);

  const toOffscreen = (message) =>
    runtime.sendMessage({ target: "offscreen", ...message });

  const openResult = (id) => showResult(tabs, runtime, id);

  async function start({ tabId, frameId = 0, streamId }) {
    if (await current()) await stop("restart");
    if (await isTabLive(tabId))
      throw new Error(
        "Thẻ này đang “Nghe âm thanh cả thẻ” – dừng nghe trước khi quay video.",
      );
    const layout = await beginInFrame(tabs, tabId, frameId);
    const tab = await tabs.get(tabId).catch(() => null);
    const id = `rec-${Date.now()}`;
    let reply = null;
    try {
      await offscreenDoc.ensure({ media: true });
      reply = await toOffscreen({
        type: "rec:start",
        streamId,
        id,
        title: tab?.title || "",
        layout,
      });
    } catch (error) {
      reply = { ok: false, error: error?.message };
    }
    if (!reply?.ok) {
      await toFrame({ tabId, frameId }, "ltv:record:end");
      throw new Error(reply?.error || "Không quay được thẻ này");
    }
    const state = { tabId, frameId, id, startedAt: reply.startedAt };
    await save(state);
    await toFrame(state, "ltv:record:sync");
    return { ...state, mimeType: reply.mimeType, cropped: reply.cropped };
  }

  // Dừng quay, chốt file rồi mở trang xem/tải.
  async function stop(reason = "user") {
    const state = await current();
    if (!state) return null;
    await save(null);
    await toFrame(state, "ltv:record:end");
    const reply = await toOffscreen({ type: "rec:stop", reason }).catch(
      (error) => ({ ok: false, error: error?.message }),
    );
    if (reply?.ok && reply.id && reason !== "restart")
      await openResult(reply.id);
    return reply;
  }

  return {
    start,
    stop,
    async status(tabId) {
      const state = await current();
      return {
        active: Boolean(state && state.tabId === tabId),
        busy: Boolean(state),
        startedAt: state?.startedAt ?? null,
      };
    },
    async isRecording(tabId) {
      return (await current())?.tabId === tabId;
    },
    // Tin từ khung đang quay: vị trí video, câu phụ đề, video đã hết.
    async fromFrame(ctx, message) {
      const state = await current();
      if (!state || state.tabId !== ctx.tabId || state.frameId !== ctx.frameId)
        return;
      if (message.type === "record:ended") {
        await stop("ended");
        return;
      }
      toOffscreen(offscreenMessage(message)).catch(() => {});
    },
    // Offscreen tự dừng (hình của thẻ mất – đóng thẻ, Chrome dừng thu).
    async fromOffscreen(event) {
      if (event.event !== "finished") return;
      await save(null);
      if (event.id) await openResult(event.id);
    },
    async stopIfTab(tabId, reason = "closed") {
      if ((await current())?.tabId === tabId) await stop(reason);
    },
  };
}
