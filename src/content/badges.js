// Huy hiệu "Đã lồng" trên ảnh video YouTube (trang chủ, tìm kiếm, gợi ý):
// đánh dấu video đã có bản dịch (hoặc lời chép) lưu trên máy cho ngôn ngữ
// đích hiện tại, để biết video nào mở ra là lồng tiếng được ngay. Chỉ tra
// cứu bộ nhớ trên máy, không gửi gì ra ngoài.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const SCAN_DELAY_MS = 1000;
  const MAX_LOOKUP = 100;
  const RECHECK_MS = 60000;
  const STYLE =
    "position:absolute;top:6px;left:6px;z-index:5;pointer-events:none;padding:2px 7px;border-radius:4px;font:600 12px/18px Roboto,Arial,sans-serif;color:#fff;background:rgba(43,57,144,.92);";
  const LABELS = { dubbed: "Đã lồng", transcribed: "Đã chép lời" };

  const validId = (id) => (id && /^[\w-]{6,20}$/.test(id) ? id : null);

  LTV.videoIdFromHref = function videoIdFromHref(href) {
    try {
      const url = new URL(href, location.href);
      if (url.pathname === "/watch") return validId(url.searchParams.get("v"));
      return validId(/^\/shorts\/([\w-]+)/.exec(url.pathname)?.[1]);
    } catch {
      return null;
    }
  };

  function thumbnails() {
    return Array.from(
      document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]'),
    ).filter(
      (anchor) =>
        anchor.querySelector("img") && !anchor.closest(".html5-video-player"),
    );
  }

  // Gắn/bỏ huy hiệu; chỉ sửa DOM khi thật sự đổi (tránh tự kích hoạt quét).
  function paint(anchor, state) {
    let badge = anchor.querySelector(':scope > [data-ltv="badge"]');
    if (!state) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute("data-ltv", "badge");
      badge.style.cssText = STYLE;
      if (getComputedStyle(anchor).position === "static")
        anchor.style.position = "relative";
      anchor.appendChild(badge);
    }
    if (badge.textContent !== LABELS[state]) badge.textContent = LABELS[state];
  }

  LTV.createBadges = function createBadges({ connection, getSettings }) {
    const known = new Map();
    let lang = null;
    let timer = null;

    async function lookup(ids) {
      const now = Date.now();
      for (let i = 0; i < ids.length; i += MAX_LOOKUP) {
        const sessions = ids
          .slice(i, i + MAX_LOOKUP)
          .map((id) => `youtube:${id}`);
        const response = await connection
          .request(
            { type: "library:lookup", sessions, tl: getSettings().targetLang },
            10000,
          )
          .catch(() => null);
        if (!response) return;
        for (const session of sessions) {
          const state = response.cached?.includes(session)
            ? "dubbed"
            : response.transcripts?.includes(session)
              ? "transcribed"
              : null;
          known.set(session.slice("youtube:".length), { state, at: now });
        }
      }
    }

    async function scan() {
      timer = null;
      const settings = getSettings();
      if (!settings.showBadges) {
        for (const badge of document.querySelectorAll('[data-ltv="badge"]'))
          badge.remove();
        return;
      }
      if (lang !== settings.targetLang) {
        known.clear();
        lang = settings.targetLang;
      }
      const items = thumbnails()
        .map((anchor) => ({ anchor, id: LTV.videoIdFromHref(anchor.href) }))
        .filter((item) => item.id);
      const stale = (id) =>
        !known.has(id) || Date.now() - known.get(id).at > RECHECK_MS;
      const fresh = [...new Set(items.map((item) => item.id).filter(stale))];
      if (fresh.length > 0) await lookup(fresh);
      for (const { anchor, id } of items)
        paint(anchor, known.get(id)?.state || null);
    }

    const schedule = () => {
      if (!timer) timer = setTimeout(scan, SCAN_DELAY_MS);
    };
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    schedule();

    return {
      refresh() {
        known.clear();
        schedule();
      },
    };
  };
})(globalThis);
