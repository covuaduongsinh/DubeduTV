// Lớp phủ trên khung video (shadow DOM để không đụng CSS của trang):
// phụ đề dịch/song ngữ, thông báo trạng thái và nút bật/tắt dạng viên thuốc
// cho trang không có thanh điều khiển riêng. Nút trên thanh điều khiển
// YouTube nằm ở createPlayerButton. Chế độ fixed (nghe cả thẻ) phủ theo vị
// trí trên màn hình của một phần tử (khung video nhúng) hoặc cả cửa sổ.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const STYLE = `
    :host { all: initial; }
    .wrap { position: absolute; inset: 0; font-family: Roboto, "Segoe UI", Arial, sans-serif; }
    .box { position: absolute; left: 6%; right: 6%; bottom: 11%;
      text-align: center; display: flex; flex-direction: column; gap: 4px; align-items: center; }
    .line { background: rgba(8, 10, 14, 0.78); color: #fff; padding: 4px 12px; border-radius: 6px;
      line-height: 1.35; text-shadow: 0 1px 2px rgba(0,0,0,.8); white-space: pre-wrap; }
    .orig { color: #d6d9de; font-size: 0.78em; }
    .status { position: absolute; top: 12px; right: 12px; max-width: 60%; padding: 6px 10px; border-radius: 6px;
      background: rgba(8, 10, 14, 0.82); color: #fff; font-size: 13px; line-height: 1.4; }
    .status.error { background: rgba(160, 32, 32, 0.92); }
    .status.warn { background: rgba(150, 100, 10, 0.92); }
    .pill { position: absolute; top: 12px; left: 12px; pointer-events: auto; cursor: pointer;
      border: 0; border-radius: 999px; padding: 5px 11px; font: 600 12px/1 Roboto, "Segoe UI", Arial, sans-serif;
      color: #fff; background: rgba(8, 10, 14, 0.65); opacity: .7; transition: opacity .15s; }
    .pill:hover { opacity: 1; }
    .pill.on { background: #0f766e; opacity: 1; }
    [hidden] { display: none !important; }
  `;

  function fontSize(base, width) {
    const scale = Math.min(1.6, Math.max(0.6, width / 1000));
    return Math.max(13, Math.round(base * scale));
  }

  // Khung phủ theo phần tử neo (đủ lớn) hoặc cả cửa sổ.
  function anchorRect(anchor) {
    const rect = anchor?.()?.getBoundingClientRect();
    if (rect && rect.width > 80 && rect.height > 60) return rect;
    return { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }

  LTV.createOverlay = function createOverlay(options) {
    const { container, video, fill, fixed, anchor, getSettings, onToggle } =
      options;
    const host = document.createElement("div");
    host.setAttribute("data-ltv", "overlay");
    host.style.cssText = fixed
      ? "position:fixed;pointer-events:none;z-index:2147483646;"
      : "position:absolute;pointer-events:none;z-index:60;inset:auto;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${STYLE}</style>
      <div class="wrap">
        <div class="box" hidden><div class="line main"></div><div class="line orig" hidden></div></div>
        <div class="status" hidden></div>
        <button class="pill" type="button" title="Lồng tiếng Việt (Alt+Shift+D)" hidden>🔊 VI</button>
      </div>`;
    const box = shadow.querySelector(".box");
    const main = shadow.querySelector(".main");
    const orig = shadow.querySelector(".orig");
    const status = shadow.querySelector(".status");
    const pill = shadow.querySelector(".pill");
    let statusTimer = null;
    let lastSentence = null;

    pill.hidden = !options.showPill;
    pill.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle();
    });

    function placeFixed() {
      const rect = anchorRect(anchor);
      host.style.left = `${rect.left}px`;
      host.style.top = `${rect.top}px`;
      host.style.width = `${rect.width}px`;
      host.style.height = `${rect.height}px`;
      return rect.width;
    }

    function position() {
      if (fixed) {
        const width = placeFixed();
        box.style.fontSize = `${fontSize(getSettings().subtitleSize, width)}px`;
        return;
      }
      if (fill) {
        host.style.inset = "0";
      } else {
        host.style.left = `${video.offsetLeft}px`;
        host.style.top = `${video.offsetTop}px`;
        host.style.width = `${video.offsetWidth}px`;
        host.style.height = `${video.offsetHeight}px`;
      }
      const width = (fill ? container.clientWidth : video.offsetWidth) || 1000;
      box.style.fontSize = `${fontSize(getSettings().subtitleSize, width)}px`;
    }

    function render(sentence) {
      const mode = getSettings().subtitleMode;
      const translated = sentence?.tr || "";
      const original = sentence?.text || "";
      const mainText = mode === "original" ? original : translated;
      const showOriginal =
        mode === "bilingual" && original && original !== translated;
      main.textContent = mainText;
      orig.textContent = showOriginal ? original : "";
      orig.hidden = !showOriginal;
      box.hidden = mode === "off" || !mainText;
    }

    const resizeObserver = new ResizeObserver(position);
    if (video) resizeObserver.observe(video);
    if (fill || fixed) resizeObserver.observe(container);
    let frame = 0;
    const reposition = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          position();
        });
    };
    if (fixed) {
      addEventListener("scroll", reposition, { passive: true, capture: true });
      addEventListener("resize", reposition);
    }
    container.appendChild(host);
    position();

    return {
      setLine(sentence) {
        lastSentence = sentence;
        render(sentence);
      },
      refresh() {
        position();
        render(lastSentence);
      },
      setStatus(text, { tone = "info", sticky = false } = {}) {
        clearTimeout(statusTimer);
        status.textContent = text || "";
        status.className = `status ${tone}`;
        status.hidden = !text;
        if (text && !sticky)
          statusTimer = setTimeout(() => (status.hidden = true), 4500);
      },
      setActive(active) {
        pill.classList.toggle("on", active);
        pill.textContent = active ? "🔊 VI: Bật" : "🔊 VI";
      },
      // Hiện nút viên thuốc khi trình phát không có chỗ gắn nút (Shorts…).
      setPill(visible) {
        pill.hidden = !visible;
      },
      isAttached: () => host.isConnected && (!video || video.isConnected),
      destroy() {
        clearTimeout(statusTimer);
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        removeEventListener("scroll", reposition, { capture: true });
        removeEventListener("resize", reposition);
        host.remove();
      },
    };
  };

  LTV.createPlayerButton = function createPlayerButton(bar, onToggle) {
    const button = document.createElement("button");
    button.className = "ytp-button";
    button.setAttribute("data-ltv", "button");
    button.title = "Lồng tiếng Việt (Alt+Shift+D)";
    button.setAttribute("aria-pressed", "false");
    button.style.cssText =
      "width:auto;padding:0 8px;font:700 13px/1 Roboto,Arial,sans-serif;color:#fff;vertical-align:top;opacity:.9;";
    button.textContent = "VI";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle();
    });
    bar.insertBefore(button, bar.firstChild);
    return {
      setActive(active) {
        button.setAttribute("aria-pressed", String(active));
        button.style.color = active ? "#2dd4bf" : "#fff";
        button.style.textDecoration = active ? "underline" : "none";
      },
      isAttached: () => button.isConnected,
      destroy: () => button.remove(),
    };
  };
})(globalThis);
