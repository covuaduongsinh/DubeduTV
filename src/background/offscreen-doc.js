// Offscreen document dùng chung: phát giọng Google, dịch bằng Chrome trên máy
// và nghe âm thanh cả thẻ. Chrome chỉ cho một tài liệu và cố định lý do
// (reasons) lúc tạo, nên khi cần thu âm mà tài liệu đang mở chưa có USER_MEDIA
// thì đóng và tạo lại. Lý do đã tạo được ghi vào storage.session vì
// getContexts không cho biết.

const OFFSCREEN_PATH = "offscreen/offscreen.html";
const STATE_KEY = "ltv-offscreen";

export function createOffscreenDoc({
  runtime = chrome.runtime,
  offscreen = chrome.offscreen,
  session = chrome.storage.session,
} = {}) {
  let chain = Promise.resolve();

  async function exists() {
    const contexts = await runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    return contexts.length > 0;
  }

  async function hasMedia() {
    try {
      const stored = await session.get(STATE_KEY);
      return Boolean(stored[STATE_KEY]?.media);
    } catch {
      return false;
    }
  }

  async function open(media) {
    await offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: media ? ["AUDIO_PLAYBACK", "USER_MEDIA"] : ["AUDIO_PLAYBACK"],
      justification: media
        ? "Phát giọng đọc và nghe âm thanh của thẻ để lồng tiếng"
        : "Phát giọng đọc lồng tiếng và dịch trên máy",
    });
    await session.set({ [STATE_KEY]: { media } }).catch(() => {});
  }

  async function prepare(media) {
    if (await exists()) {
      if (!media || (await hasMedia())) return;
      await offscreen.closeDocument();
    }
    await open(media);
  }

  // Các lời gọi chạy nối tiếp để không tạo hai tài liệu cùng lúc.
  function ensure({ media = false } = {}) {
    const run = chain.then(() => prepare(media));
    chain = run.catch(() => {});
    return run;
  }

  return { ensure, url: () => runtime.getURL(OFFSCREEN_PATH) };
}
