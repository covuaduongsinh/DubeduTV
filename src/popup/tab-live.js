// Popup: nút "Nghe âm thanh cả thẻ" cho video trang chặn thu âm (khác nguồn,
// nhúng) hoặc trang chưa hỗ trợ sẵn. Chrome chỉ cho lấy luồng âm thanh của
// thẻ từ thao tác của người dùng trong popup.
const $ = (id) => document.getElementById(id);

const HINT =
  "Thu âm thanh đang phát trong thẻ này rồi tự chép lời, dịch và đọc song song – dùng được với video nhúng hoặc trang chặn thu âm.";

export function initTabLive({ getTab, onChange }) {
  let active = false;

  function showError(error) {
    $("tab-live-hint").hidden = false;
    $("tab-live-hint").className = "hint warn";
    $("tab-live-hint").textContent =
      `Không nghe được âm thanh của thẻ: ${error.message}`;
  }

  // Trả về true nếu thẻ này đang được nghe cả thẻ.
  async function refresh(status) {
    const tab = getTab();
    if (tab?.id === undefined) return false;
    const reply = await chrome.runtime
      .sendMessage({ type: "ltv:tabLive:status", tabId: tab.id })
      .catch(() => null);
    active = Boolean(reply?.active);
    const web = /^https?:/.test(tab.url || "");
    const useful =
      web &&
      (active ||
        !status ||
        !status.onVideo ||
        Boolean(status.status?.captureBlocked));
    $("tab-live").hidden = !useful;
    $("tab-live").textContent = active
      ? "Dừng nghe cả thẻ"
      : "Nghe âm thanh cả thẻ";
    if (!$("tab-live-hint").classList.contains("warn")) {
      $("tab-live-hint").hidden = !useful || active;
      $("tab-live-hint").textContent = HINT;
    }
    return active;
  }

  $("tab-live").addEventListener("click", async () => {
    const button = $("tab-live");
    button.disabled = true;
    $("tab-live-hint").className = "hint";
    try {
      if (active) {
        await chrome.runtime.sendMessage({ type: "ltv:tabLive:stop" });
      } else {
        const tabId = getTab().id;
        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tabId,
        });
        const reply = await chrome.runtime.sendMessage({
          type: "ltv:tabLive:start",
          tabId,
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

  return { refresh };
}
