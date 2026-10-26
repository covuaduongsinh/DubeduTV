// Popup: nút "Quay video lồng tiếng". Chrome chỉ cho lấy luồng của thẻ (hình
// và tiếng) từ thao tác của người dùng trong popup. Đang quay thì nút thành
// "Dừng & lưu video" kèm đồng hồ; dừng xong tiện ích mở trang tải bản quay.
const $ = (id) => document.getElementById(id);

const HINT =
  "Quay vùng video kèm giọng Việt và phụ đề đang hiện, lưu thành file video. Quay trong lúc phát nên mất thời gian bằng đoạn quay; nên bật toàn màn hình và để chuột ra ngoài video.";
const RECORDING_HINT =
  "Đang quay – cứ để video phát. Bấm dừng (hoặc để video tự hết) để lưu; đóng popup không ảnh hưởng.";

function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (value) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const rest = `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  return hours ? `${hours}:${rest}` : rest;
}

export function initRecord({ getTab, getFrameId, onChange }) {
  let active = false;
  let startedAt = 0;

  function render(canRecord) {
    const button = $("record");
    button.hidden = !(active || canRecord);
    button.classList.toggle("recording", active);
    button.textContent = active
      ? `⏹ Dừng & lưu video (${clock((Date.now() - startedAt) / 1000)})`
      : "⏺ Quay video lồng tiếng";
    const hint = $("record-hint");
    if (!hint.classList.contains("warn")) {
      hint.hidden = button.hidden;
      hint.textContent = active ? RECORDING_HINT : HINT;
    }
  }

  function showError(error) {
    $("record-hint").hidden = false;
    $("record-hint").className = "hint warn";
    $("record-hint").textContent = `Không quay được: ${error.message}`;
  }

  // Trả về true nếu thẻ này đang quay.
  async function refresh(status) {
    const tab = getTab();
    if (tab?.id === undefined) return false;
    const reply = await chrome.runtime
      .sendMessage({ type: "ltv:record:status", tabId: tab.id })
      .catch(() => null);
    active = Boolean(reply?.active);
    startedAt = reply?.startedAt || 0;
    render(Boolean(status?.onVideo && status.active));
    return active;
  }

  $("record").addEventListener("click", async () => {
    const button = $("record");
    button.disabled = true;
    $("record-hint").className = "hint";
    try {
      if (active) {
        await chrome.runtime.sendMessage({ type: "ltv:record:stop" });
      } else {
        const tabId = getTab().id;
        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tabId,
        });
        const reply = await chrome.runtime.sendMessage({
          type: "ltv:record:start",
          tabId,
          frameId: getFrameId(),
          streamId,
        });
        if (!reply?.ok) throw new Error(reply?.error || "lỗi không rõ");
      }
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
      onChange();
    }
  });

  $("recordings").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("recorder/result.html") });
  });

  return { refresh };
}
