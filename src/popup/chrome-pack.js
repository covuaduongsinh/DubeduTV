// Popup/Tuỳ chọn: trạng thái gói dịch "Chrome trên máy" cho cặp ngôn ngữ hiện
// tại và nút tải gói (Chrome chỉ cho tải khi người dùng bấm).
import "../shared/defaults.js";
import "../shared/chrome-ai.js";

const LTV = globalThis.LTV;

const TEXT = {
  "no-api": () =>
    "Trình duyệt này chưa có bộ dịch trên máy (cần Google Chrome 138+ trên máy tính) – đang dùng Google Dịch.",
  available: (pair) =>
    `Gói dịch ${pair} đã sẵn sàng – dịch ngay trên máy, không cần mạng.`,
  downloadable: (pair) => `Cần tải gói dịch ${pair} một lần (vài chục MB).`,
  downloading: (pair) => `Gói dịch ${pair} đang tải…`,
  unavailable: (pair) =>
    `Chrome chưa dịch được ${pair} – đang dùng Google Dịch.`,
};

export function initChromePack({ getSettings, getSourceLang, isVisible }) {
  const $ = (id) => document.getElementById(id);
  let busy = false;

  function pair() {
    const sl = getSourceLang();
    const tl = getSettings().targetLang;
    const code = LTV.chromeAI.langCode;
    return { sl, tl, label: `${code(sl)}→${code(tl)}` };
  }

  async function refresh() {
    const box = $("chrome-pack");
    box.hidden = !isVisible();
    if (box.hidden || busy) return;
    const { sl, tl, label } = pair();
    const status = await LTV.chromeAI.pairStatus(sl, tl);
    $("chrome-pack-text").textContent = (TEXT[status] || TEXT.unavailable)(
      label,
    );
    $("chrome-download").hidden = status !== "downloadable";
  }

  function showProgress(loaded) {
    $("chrome-progress-bar").style.width = `${Math.round(loaded * 100)}%`;
  }

  $("chrome-download").addEventListener("click", async () => {
    const { sl, tl, label } = pair();
    busy = true;
    $("chrome-download").disabled = true;
    $("chrome-progress").hidden = false;
    $("chrome-pack-text").textContent = `Đang tải gói dịch ${label}…`;
    let failed = null;
    try {
      await LTV.chromeAI.download({ sl, tl, onProgress: showProgress });
    } catch (error) {
      failed = error;
    }
    busy = false;
    $("chrome-download").disabled = false;
    $("chrome-progress").hidden = true;
    if (failed)
      $("chrome-pack-text").textContent =
        `Không tải được gói dịch: ${failed.message}`;
    else refresh();
  });

  return { refresh };
}
