// Các phần chạy kèm ngoài phiên lồng tiếng của video: phía trang Google Drive
// (trả lời khung trình phát), nút dịch câu hỏi trắc nghiệm, huy hiệu
// "Đã lồng" trên danh sách video và bộ nhận "nghe âm thanh cả thẻ".
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  // Trả về { refresh } để cập nhật khi cài đặt thay đổi.
  LTV.startAddons = function startAddons({
    connection,
    getSettings,
    voice,
    siteId,
    isTop,
  }) {
    const parts = [];
    if (isTop) {
      parts.push(LTV.createTabLiveHost({ connection, getSettings, voice }));
      if (LTV.driveHost?.matches(location)) LTV.driveHost.start();
      if (siteId === "youtube")
        parts.push(LTV.createBadges({ connection, getSettings }));
      if (siteId === "coursera" || siteId === "udemy")
        parts.push(LTV.createQuizTranslator({ connection, getSettings }));
    }
    return { refresh: () => parts.forEach((part) => part.refresh()) };
  };
})(globalThis);
