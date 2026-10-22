// Các phần chạy kèm ngoài phiên lồng tiếng của video: phía trang Google Drive
// (trả lời khung trình phát), nút dịch câu hỏi trắc nghiệm, huy hiệu
// "Đã lồng" trên danh sách video và bộ nhận "nghe âm thanh cả thẻ".
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  LTV.startAddons = function startAddons({ isTop }) {
    if (!isTop) return;
    if (LTV.driveHost?.matches(location)) LTV.driveHost.start();
  };
})(globalThis);
