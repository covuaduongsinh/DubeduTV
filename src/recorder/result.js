// Trang xem và tải bản quay: ghép các mẩu video trong IndexedDB thành file,
// cho xem thử, tải video (MP4/WebM) và phụ đề .srt, xoá bản quay.
(function () {
  const LTV = globalThis.LTV;
  const $ = (id) => document.getElementById(id);
  const db = LTV.createRecordingsDb();

  function size(bytes) {
    const mb = (Number(bytes) || 0) / (1024 * 1024);
    return `${mb.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
  }

  function duration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const pad = (value) => String(value).padStart(2, "0");
    const hours = Math.floor(total / 3600);
    const rest = `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
    return hours ? `${hours}:${rest}` : rest;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function show(id) {
    const meta = await db.get(id);
    if (!meta) {
      $("message").textContent =
        "Không tìm thấy bản quay này (có thể đã bị xoá).";
      return;
    }
    if (meta.status !== "done")
      $("message").textContent =
        "Bản quay chưa được chốt đầy đủ (trình duyệt đóng giữa chừng) – phần đã ghi vẫn tải được.";
    const blob = await db.blob(id, meta.mimeType);
    const fileName = LTV.recordFileName(meta.title, meta.extension);
    $("current").hidden = false;
    $("title").textContent = meta.title || "Video lồng tiếng";
    $("info").textContent = [
      duration(meta.duration),
      size(blob.size),
      (meta.extension || "").toUpperCase(),
      new Date(meta.createdAt).toLocaleString("vi-VN"),
    ]
      .filter(Boolean)
      .join(" · ");
    $("player").src = URL.createObjectURL(blob);
    $("download-video").textContent = `Tải video (.${meta.extension})`;
    $("download-video").addEventListener("click", () =>
      download(blob, fileName),
    );
    $("download-srt").hidden = !meta.srt;
    $("download-srt").addEventListener("click", () =>
      download(
        new Blob([`﻿${meta.srt}`], { type: "application/x-subrip" }),
        fileName.replace(/\.\w+$/, ".srt"),
      ),
    );
    $("delete").addEventListener("click", async () => {
      if (!confirm("Xoá bản quay này khỏi máy?")) return;
      await db.remove(id);
      location.replace("result.html");
    });
  }

  async function listRecent(currentId) {
    const list = (await db.list()).sort((a, b) => b.createdAt - a.createdAt);
    $("recent").replaceChildren(
      ...list.map((meta) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `result.html?id=${encodeURIComponent(meta.id)}`;
        link.textContent = meta.title || "Video lồng tiếng";
        if (meta.id === currentId) link.style.fontWeight = "600";
        item.append(
          link,
          ` – ${duration(meta.duration)}, ${new Date(meta.createdAt).toLocaleString("vi-VN")}`,
        );
        return item;
      }),
    );
    if (list.length === 0)
      $("recent").replaceChildren(
        Object.assign(document.createElement("li"), {
          textContent: "Chưa có bản quay nào.",
        }),
      );
  }

  const id = new URL(location.href).searchParams.get("id");
  Promise.all([id ? show(id) : null, listRecent(id)]).catch((error) => {
    $("message").textContent = `Không đọc được bản quay: ${error.message}`;
  });
})();
