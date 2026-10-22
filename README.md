# Lồng Tiếng Việt – tiện ích Chrome lồng tiếng video

Tiện ích Chrome (Manifest V3) đọc lồng tiếng Việt ngay trên trang video **YouTube, Udemy, Coursera**:
lấy phụ đề sẵn có của video (phụ đề thủ công hoặc tự động) – hoặc **tự nghe và chép lời khi video không có
phụ đề** – dịch sang tiếng Việt, rồi đọc từng câu, đồng thời giảm tiếng gốc khi đang đọc. Mã viết mới hoàn toàn bởi Công ty CP Cờ vua Dương Sinh.

## Tính năng

- **Lồng tiếng tự động** theo thời gian phát: tự tăng tốc độ đọc khi câu dài, tự bắt kịp khi bị trễ,
  dừng khi tạm dừng/tua, tạm ngưng khi YouTube chạy quảng cáo.
- **Giảm tiếng gốc** khi đang đọc (mặc định còn 15%), trả lại mức người dùng đã chọn khi đọc xong.
- **Phụ đề trên video**: chỉ bản dịch, song ngữ, phụ đề gốc hoặc tắt; chỉnh cỡ chữ; chạy được khi toàn màn hình.
- **Hai bộ dịch**: Google Dịch (miễn phí, không cần tài khoản) hoặc **Claude AI** (tự nhiên, đúng thuật ngữ
  hơn – cần API key). Claude lỗi thì tự chuyển về Google cho đoạn đó.
- **Hai loại giọng**: Google (trực tuyến, có sẵn) hoặc giọng cài trên máy (offline). Giọng Google không phản
  hồi thì tự chuyển sang giọng máy nếu máy có giọng tiếng Việt.
- **Video không có phụ đề**: tự nghe âm thanh của video, chép lời (miễn phí bằng nhận dạng giọng của Google
  Chrome, hoặc Whisper nếu nhập API key), dịch và đọc ngay. Hai chế độ: **nối tiếp** (tự dừng video sau mỗi
  câu) và **song song** (video chạy liên tục, giọng Việt trễ vài giây). Lời chép được lưu để lần xem sau
  lồng tiếng khớp thời gian như video có phụ đề.
- Video đã có phụ đề tiếng Việt thủ công thì đọc thẳng, không cần dịch.
- **Bộ nhớ đệm** bản dịch theo video (150 video gần nhất): xem lại không phải dịch lại.
- Nút **VI** trên thanh điều khiển YouTube, nút nổi trên video Udemy/Coursera, phím tắt **Alt+Shift+D**.
- Nút **“Thử lồng tiếng video trên trang này”** cho trang khác có video HTML5 kèm phụ đề `<track>`.
- Đích lồng tiếng chọn được: Tiếng Việt (mặc định), English, 中文, 日本語, 한국어, Français, Deutsch…

## Cài đặt (chưa lên Chrome Web Store)

1. Giải nén tệp `long-tieng-viet-v1.1.0.zip` → được thư mục `long-tieng-viet`.
2. Mở Chrome, vào `chrome://extensions`, bật **Chế độ dành cho nhà phát triển** (góc phải trên).
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục `long-tieng-viet`.
4. Ghim biểu tượng loa xanh lên thanh công cụ.

Dùng được trên Chrome 116+ và Microsoft Edge (cài tương tự ở `edge://extensions`).

## Sử dụng

1. Mở một video YouTube (trang `watch`), bài giảng Udemy hoặc Coursera.
2. Bấm nút **VI** trên trình phát (hoặc biểu tượng tiện ích → **Bật lồng tiếng**, hoặc **Alt+Shift+D**).
3. Sau vài giây (lấy phụ đề và dịch đoạn đầu), giọng Việt bắt đầu đọc. Phần còn lại dịch dần phía sau.

Muốn mọi video tự lồng tiếng: bật **“Tự bật lồng tiếng khi mở video”** trong popup.

### Giọng đọc tiếng Việt

- **Google (trực tuyến)** – mặc định, có trên mọi máy, cần mạng.
- **Giọng máy** – offline, không giới hạn. Windows: Cài đặt → Thời gian & ngôn ngữ → Giọng nói → thêm giọng
  Tiếng Việt (Microsoft An). macOS: Cài đặt hệ thống → Trợ năng → Nội dung đọc → thêm giọng Linh.
- **Microsoft Edge** có sẵn giọng tự nhiên **HoaiMy** và **NamMinh**: cài tiện ích trên Edge rồi chọn trong mục Giọng.

### Video không có phụ đề

Không cần làm gì thêm: khi video không có phụ đề, tiện ích tự chuyển sang **nghe và chép lời**. Trong popup,
mục **“Video không có phụ đề”**:

- **Ngôn ngữ nói** – ngôn ngữ người nói trong video (mặc định English). Chọn đúng thì chép lời chính xác hơn.
- **Chép lời bằng** – _Chrome (miễn phí)_: dùng nhận dạng giọng nói có sẵn của **Google Chrome 139+**, không
  cần micro, không cần key. _Whisper_: chính xác hơn, khớp thời gian tốt hơn, chạy được cả trên Cốc Cốc/Edge;
  cần API key Groq (khoảng 0,04 USD cho 1 giờ video, lấy tại <https://console.groq.com/keys>) hoặc OpenAI,
  nhập trong **Tuỳ chọn nâng cao**.
- **Cách đồng bộ** – _Nối tiếp_: hết mỗi câu video tạm dừng, giọng Việt đọc xong thì video chạy tiếp (nghe đủ ý,
  không chồng tiếng). _Song song_: video chạy liên tục, giọng Việt chậm hơn người nói vài giây.

Lần xem đầu, giọng Việt chỉ đọc được **sau khi** người nói nói xong mỗi câu. Lời đã chép được lưu (60 video
gần nhất); xem lại video đó, tiện ích lồng tiếng khớp thời gian ngay từ đầu câu như video có phụ đề.

### Dịch bằng Claude AI

1. Tạo API key tại <https://console.anthropic.com/settings/keys>.
2. Biểu tượng tiện ích → **Tuỳ chọn nâng cao** → dán key → **Lưu** → **Kiểm tra key**.
3. Chọn model: **Opus 5.5** (mặc định, dịch hay nhất), Sonnet 5.5 (cân bằng) hoặc Haiku 5.5 (nhanh, rẻ nhất).

Claude được dặn dùng đúng thuật ngữ chuyên ngành (ví dụ cờ vua: knight → Mã, bishop → Tượng, castling →
nhập thành), trong khi Google Dịch thường dịch máy móc (“knight” → “hiệp sĩ”). Chi phí **ước tính** cho một
video 20 phút: khoảng 0,2 USD với Opus 5.5, dưới 0,01 USD với Haiku 5.5 (chưa đo thực tế). Key chỉ lưu trên
máy và chỉ gửi tới `api.anthropic.com`.

## Giới hạn hiện tại

- Chép lời: bộ nhận dạng Chrome không trả mốc thời gian nên mốc câu là ước lượng; cần Google Chrome 139+
  (Chromium, Cốc Cốc có thể không có dịch vụ này – khi đó dùng Whisper). Video khác nguồn hoặc có bảo vệ bản
  quyền (DRM) chặn thu âm thanh thì không tự chép lời được.
- YouTube: hỗ trợ trang `watch`/`live`; chưa hỗ trợ Shorts và video nhúng trong trang khác.
- Udemy: nếu chưa lấy được phụ đề, hãy bật CC trong trình phát rồi bấm lồng tiếng lại.
- Giọng Google và Google Dịch dùng endpoint công khai không chính thức, có thể bị giới hạn khi dùng rất nhiều.
- Chưa có đăng nhập/máy chủ đồng bộ bản dịch: mọi thứ chạy trên máy người dùng.

## Quyền riêng tư

Tiện ích không có máy chủ riêng. Nội dung phụ đề được gửi tới Google Dịch hoặc Claude (tuỳ lựa chọn) để dịch,
và câu cần đọc được gửi tới Google khi dùng giọng Google. Khi tự chép lời, âm thanh của video được gửi tới
dịch vụ nhận dạng của Google Chrome (hoặc nhận dạng ngay trên máy nếu Chrome có sẵn gói ngôn ngữ), hoặc tới
Groq/OpenAI khi dùng Whisper. Cài đặt lưu trong `chrome.storage`; API key Claude/Whisper chỉ lưu cục bộ
(`storage.local`), không đồng bộ.

## Dành cho nhà phát triển

Không cần cài thư viện; Node.js 20+.

```bash
cd long-tieng-viet
npm test            # 50 unit test (node --test)
npm run build       # → dist/long-tieng-viet/ và dist/long-tieng-viet-v1.1.0.zip
npm run e2e         # build bản --test và chạy Chromium thật trên trang giả lập (cần playwright-core
                    # từ node_modules của repo gốc và mạng tới translate.googleapis.com)
```

Cấu trúc:

```
src/
  manifest.json
  background/   service worker: dịch (Google/Claude), chép lời Whisper, giọng đọc, cache bản dịch và
                lời chép, tải phụ đề chéo nguồn
  offscreen/    phát MP3 giọng Google (giữ cao độ khi tăng tốc)
  content/
    page-hook.js   (MAIN world) bắt phụ đề trình phát tải về, gọi API trình phát YouTube
    providers/     youtube, udemy, coursera, html5 (dự phòng chung)
    lib/           đọc VTT/json3/XML, ghép câu, tính tốc độ, hàng đợi dịch, lớp phủ…
    dubber.js      đồng bộ giọng đọc theo thời gian video, giảm/trả âm lượng
    asr/           chép lời: Chrome (Web Speech API nhận audio track) và Whisper (ghi âm theo đoạn)
    live-session.js, live-dubber.js   video không phụ đề: thu âm → chép lời → dịch → đọc nối tiếp/song song
    main.js        điều phối theo tab, điều hướng SPA
  popup/, options/ giao diện
scripts/build.mjs  đóng gói + sinh icon PNG (không lưu tệp nhị phân trong repo)
tests/             unit test; tests/e2e/ trang giả lập + kịch bản Playwright
```

Kiểm thử e2e dùng trang **giả lập** cơ chế của từng site (YouTube đòi PO token cho timedtext, API bài giảng
Udemy + VTT khác origin, thẻ `<track>` của Coursera, video không phụ đề) với giọng đọc và bộ chép lời giả lập
ghi nhật ký; bản dịch là Google Dịch thật; thu âm `captureStream` + MediaRecorder là thật. Chưa kiểm thử trên
YouTube/Udemy/Coursera thật, chưa nghe giọng Google thật, chưa đo chất lượng/độ trễ chép lời thật của Chrome và
Whisper (các dịch vụ này bị chặn mạng trong môi trường phát triển) – cần thử trên Google Chrome máy thật.
