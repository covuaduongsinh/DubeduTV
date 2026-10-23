// Popup: nút "Nghe âm thanh cả thẻ" cho video trang chặn thu âm (khác nguồn,
// nhúng) hoặc trang chưa hỗ trợ sẵn. Chrome chỉ cho lấy luồng âm thanh của
// thẻ – và xin quyền tuỳ chọn cho trang chứa video nhúng – từ thao tác của
// người dùng trong popup.
const $ = (id) => document.getElementById(id);

const HINT =
  "Thu âm thanh đang phát trong thẻ này rồi tự chép lời, dịch và đọc – dùng được với video nhúng hoặc trang chặn thu âm.";

// Chạy trong trang: origin của khung nhúng lớn hơn mọi video của trang chính.
function largestFrameOrigin() {
  const area = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  };
  const videoArea = Math.max(
    0,
    ...Array.from(document.querySelectorAll("video"), area),
  );
  let best = null;
  for (const frame of document.querySelectorAll("iframe[src]"))
    if (area(frame) > Math.max(videoArea, best ? area(best) : 0)) best = frame;
  try {
    const url = new URL(best?.src || "", location.href);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

// Mẫu quyền cho một origin (mẫu quyền không ghi cổng).
function originPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function initTabLive({ getTab, onChange }) {
  let active = false;
  // { pattern, host, granted } của trang chứa video nhúng; tính một lần.
  let frameAccess = null;

  async function checkFrameAccess(tabId) {
    if (frameAccess) return frameAccess;
    frameAccess = { pattern: null, granted: true };
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: largestFrameOrigin,
      });
      if (!injection?.result) return frameAccess;
      const pattern = originPattern(injection.result);
      frameAccess = {
        pattern,
        host: new URL(injection.result).hostname,
        granted: await chrome.permissions.contains({ origins: [pattern] }),
      };
    } catch {
      // Trang không cho chạy script (chrome://…): không có gì để xin quyền.
    }
    return frameAccess;
  }

  function hintText() {
    if (!frameAccess?.pattern || frameAccess.granted) return HINT;
    return `${HINT} Lần đầu tiện ích xin quyền cho ${frameAccess.host} để dừng/phát video theo giọng đọc, lưu lời chép và hiện phụ đề cả khi toàn màn hình (không cấp thì vẫn đọc song song).`;
  }

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
    if (web) await checkFrameAccess(tab.id);
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
    const hint = $("tab-live-hint").classList;
    if (!hint.contains("warn") && !hint.contains("notice")) {
      $("tab-live-hint").hidden = !useful || active;
      $("tab-live-hint").textContent = hintText();
    }
    return active;
  }

  // Xin quyền trước mọi việc khác: Chrome chỉ cho xin trong lúc người dùng bấm.
  async function requestFrameAccess() {
    if (active || !frameAccess?.pattern || frameAccess.granted) return;
    frameAccess.granted = await chrome.permissions
      .request({ origins: [frameAccess.pattern] })
      .catch(() => false);
  }

  function showReplay() {
    $("tab-live-hint").hidden = false;
    $("tab-live-hint").className = "hint notice";
    $("tab-live-hint").textContent =
      "Video này đã có lời chép từ lần trước – đang lồng tiếng lại khớp thời gian, không cần nghe cả thẻ.";
  }

  $("tab-live").addEventListener("click", async () => {
    const button = $("tab-live");
    button.disabled = true;
    $("tab-live-hint").className = "hint";
    try {
      await requestFrameAccess();
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
        if (reply.replay) showReplay();
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
