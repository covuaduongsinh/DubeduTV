# Lồng Tiếng Việt – tiện ích Chrome lồng tiếng video

Tiện ích Chrome (Manifest V3) đọc lồng tiếng Việt ngay trên trang video **YouTube (cả Shorts, bản di động và
video nhúng), Udemy, Coursera, Google Drive, X/Twitter**: lấy phụ đề sẵn có của video (phụ đề thủ công hoặc tự
động) – hoặc **tự nghe và chép lời khi video không có phụ đề** – dịch sang tiếng Việt, rồi đọc từng câu, đồng
thời giảm tiếng gốc khi đang đọc. Mã viết mới hoàn toàn bởi Công ty CP Cờ vua Dương Sinh. Bản 1.3 thêm
**từ điển thuật ngữ cờ vua**, **giọng AI tự nhiên (Azure, Google Cloud)** và **điều khiển video nhúng khi nghe
cả thẻ**.

## Tính năng

- **Lồng tiếng tự động** theo thời gian phát: tự tăng tốc độ đọc khi câu dài, tự bắt kịp khi bị trễ,
  dừng khi tạm dừng/tua, tạm ngưng khi YouTube chạy quảng cáo.
- **Giảm tiếng gốc** khi đang đọc (mặc định còn 15%), trả lại mức người dùng đã chọn khi đọc xong.
- **Phụ đề trên video**: chỉ bản dịch, song ngữ, phụ đề gốc hoặc tắt; chỉnh cỡ chữ; chạy được khi toàn màn hình.
- **Ba bộ dịch**: Google Dịch (miễn phí, không cần tài khoản), **Chrome trên máy** (miễn phí, không cần mạng,
  phụ đề không rời khỏi máy – Chrome 138+ trên máy tính) hoặc **Claude AI** (tự nhiên, đúng thuật ngữ hơn – cần
  API key). Bộ dịch được chọn lỗi thì tự chuyển về Google cho đoạn đó và báo lý do.
- **Từ điển thuật ngữ**: video cờ vua được tự nhận ra, Google Dịch và Chrome dịch đúng thuật ngữ (knight →
  Mã, bishop → Tượng, castling → nhập thành, endgame → tàn cuộc…) thay vì “hiệp sĩ”, “giám mục”. Thêm thuật
  ngữ riêng trong Tuỳ chọn.
- **Bốn loại giọng**: Google (trực tuyến, có sẵn), giọng cài trên máy (offline), và **giọng AI tự nhiên** của
  **Azure** (HoaiMy, NamMinh) hoặc **Google Cloud** (WaveNet, Neural2, Chirp3-HD) bằng API key riêng. Giọng AI
  lỗi hoặc key sai thì tự chuyển sang giọng Google; giọng Google không phản hồi thì chuyển sang giọng máy.
- **Video không có phụ đề**: tự nghe âm thanh của video, chép lời (miễn phí bằng nhận dạng giọng của Google
  Chrome, hoặc Whisper nếu nhập API key), dịch và đọc ngay. Hai chế độ: **nối tiếp** (tự dừng video sau mỗi
  câu) và **song song** (video chạy liên tục; đọc **từng cụm ngắn ngay khi nghe được**, không chờ hết câu).
  Lời chép được lưu để lần xem sau lồng tiếng khớp thời gian như video có phụ đề.
- **Nghe âm thanh cả thẻ**: video trang chặn thu âm (video nhúng khác nguồn, trang chưa hỗ trợ) vẫn lồng tiếng
  được – bấm biểu tượng tiện ích → **Nghe âm thanh cả thẻ**. Cho phép tiện ích chạy trên trang chứa video nhúng
  (hỏi một lần) thì tiện ích **dừng/phát được video thật** (chế độ nối tiếp), **phụ đề nằm trong khung video kể
  cả khi toàn màn hình**, và **lưu lời chép** để lần sau lồng tiếng khớp thời gian mà không cần nghe lại.
- **YouTube bền hơn**: dùng lại token phụ đề mà trình phát đã tải cho track cần dịch (không phải bật CC), chờ
  hết quảng cáo; hỗ trợ **Shorts**, **m.youtube.com** và **video YouTube nhúng** trong blog, LMS, trang bất kỳ.
- **Google Drive**: video xem trên drive.google.com (trang Drive tự tải phụ đề bằng phiên đăng nhập của người dùng).
- **X/Twitter**: video có phụ đề (CC) trong bài đăng.
- **Nút “Dịch” câu hỏi trắc nghiệm** trên Coursera/Udemy: dịch câu hỏi và từng đáp án ngay dưới dòng gốc.
- **Huy hiệu “Đã lồng”** trên ảnh video YouTube đã có bản dịch/lời chép trên máy, và chế độ tự bật
  **“Chỉ video đã lồng trước đây”**.
- Video đã có phụ đề tiếng Việt thủ công thì đọc thẳng, không cần dịch.
- **Bộ nhớ đệm** bản dịch theo video (150 video gần nhất): xem lại không phải dịch lại.
- Nút **VI** trên thanh điều khiển YouTube, nút nổi trên video Udemy/Coursera/Shorts/X, phím tắt
  **Alt+Shift+D** (chọn đúng video, kể cả video nhúng).
- Nút **“Thử lồng tiếng video trên trang này”** cho trang khác có video HTML5 kèm phụ đề `<track>`.
- Đích lồng tiếng chọn được: Tiếng Việt (mặc định), English, 中文, 日本語, 한국어, Français, Deutsch…

## Cài đặt (chưa lên Chrome Web Store)

Tải tệp zip của bản mới nhất ở mục **Releases** của repo (hoặc tự build theo mục _Dành cho nhà phát triển_).

1. Giải nén tệp `long-tieng-viet-v1.3.2.zip` → được thư mục `long-tieng-viet`. (Cập nhật từ bản cũ: chép đè
   thư mục rồi bấm biểu tượng tải lại ↻ của tiện ích trong `chrome://extensions`.)
2. Mở Chrome, vào `chrome://extensions`, bật **Chế độ dành cho nhà phát triển** (góc phải trên).
3. Bấm **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục `long-tieng-viet`.
4. Ghim biểu tượng loa xanh lên thanh công cụ.

Dùng được trên Chrome 116+ và Microsoft Edge (cài tương tự ở `edge://extensions`).

## Sử dụng

1. Mở một video YouTube (trang `watch`, Shorts hoặc video nhúng), bài giảng Udemy/Coursera, video trên Google
   Drive hoặc bài đăng có video trên X.
2. Bấm nút **VI** trên trình phát (hoặc biểu tượng tiện ích → **Bật lồng tiếng**, hoặc **Alt+Shift+D**).
3. Sau vài giây (lấy phụ đề và dịch đoạn đầu), giọng Việt bắt đầu đọc. Tiện ích chỉ dịch trước khoảng 200 câu
   tính từ chỗ đang xem và dịch tiếp theo video, nên video dài hàng giờ không gửi dồn hàng trăm yêu cầu dịch.

Tự bật khi mở video (popup → **Tự bật khi mở video**): _Không_, _Chỉ video đã lồng trước đây_ (video đã có bản
dịch hoặc lời chép trên máy) hoặc _Mọi video_. Video nhúng trong trang khác chỉ tự bật khi được phát có tiếng.

### Bộ dịch Chrome trên máy

1. Popup → **Bộ dịch** → **Chrome trên máy (miễn phí, Chrome 138+)**.
2. Lần đầu với mỗi cặp ngôn ngữ (ví dụ en→vi), popup báo **Cần tải gói dịch** → bấm **Tải gói dịch** (Chrome
   chỉ cho tải khi người dùng bấm; trang Tuỳ chọn cũng có nút này).
3. Từ đó dịch ngay trên máy, không cần mạng. Chưa có gói hoặc trình duyệt không hỗ trợ thì tiện ích tạm dùng
   Google Dịch và ghi rõ lý do trên video.

### Nghe âm thanh cả thẻ

Dùng khi video báo _“chặn thu âm thanh”_, video nằm trong khung nhúng của trang khác, hoặc trang chưa được hỗ
trợ: bấm biểu tượng tiện ích → **Nghe âm thanh cả thẻ**. Tiện ích nghe âm thanh đang phát trong thẻ, chép lời
(Chrome hoặc Whisper), dịch và đọc. Bấm **Dừng nghe cả thẻ** (hoặc Alt+Shift+D, hay đóng/chuyển trang) để
dừng. Mỗi lúc chỉ nghe một thẻ.

- **Lần đầu trên một trang có video nhúng**, Chrome hỏi _cho phép tiện ích đọc và thay đổi dữ liệu trên_ trang
  chứa video (ví dụ `player.vimeo.com`). Đây là quyền tuỳ chọn, chỉ cho đúng trang đó; thu hồi được trong
  `chrome://extensions` → Chi tiết → Quyền truy cập trang web. Đồng ý thì tiện ích chạy ngay trong khung video:
  chế độ **nối tiếp** dừng/phát video thật, phụ đề nằm cạnh video (vẫn thấy khi bấm toàn màn hình), lời chép
  được lưu theo video. (Nếu popup đóng lại khi hộp thoại hiện, hãy bấm nút thêm lần nữa.)
- **Không đồng ý** (hoặc trang không cho chạy tiện ích): vẫn đọc **song song**, phụ đề phủ lên khung video lớn
  nhất như trước.
- **Lần sau** mở lại video đã có lời chép đủ dài, bấm **Nghe âm thanh cả thẻ** sẽ lồng tiếng lại khớp thời
  gian theo lời chép đã lưu – không cần thu âm thanh nữa.

### Dịch câu hỏi trắc nghiệm

Trên trang làm bài của Coursera/Udemy, cạnh nút **Submit/Check/Nộp** có thêm nút **Dịch**: bấm để hiện bản dịch
nghiêng dưới câu hỏi và từng đáp án, bấm lại để ẩn. Nút không nộp bài. Tắt trong popup → **Tiện ích thêm**.

### Từ điển thuật ngữ

Popup → **Thuật ngữ**: _Tự nhận video cờ vua_ (mặc định – nhận theo tiêu đề có “chess/cờ vua…” hoặc phụ đề có
từ 3 thuật ngữ cờ vua khác nhau), _Luôn dùng thuật ngữ cờ vua_, hoặc _Tắt_. Khi áp dụng, các cách dịch sai đã
biết của Google/Chrome được sửa thành thuật ngữ đúng – chỉ khi câu gốc có từ tiếng Anh tương ứng, nên câu
chuyện “the knight saved the princess” trong video thường vẫn là “hiệp sĩ”. Claude được đưa thẳng danh sách
thuật ngữ trong lời dặn.

Từ điển riêng (Tuỳ chọn → **Từ điển thuật ngữ**), mỗi dòng `tiếng Anh = tiếng Việt`, thêm `| cách sai 1; cách
sai 2` nếu biết bộ dịch hay dịch sai thế nào; tối đa 100 dòng. Dòng không khai cách sai thì thuật ngữ được giữ
nguyên khi dịch. Đổi từ điển thì bản dịch cũ trong bộ nhớ đệm không bị dùng lẫn.

### Giọng đọc tiếng Việt

- **Google (trực tuyến)** – mặc định, có trên mọi máy, cần mạng.
- **Giọng máy** – offline, không giới hạn. Windows: Cài đặt → Thời gian & ngôn ngữ → Giọng nói → thêm giọng
  Tiếng Việt (Microsoft An). macOS: Cài đặt hệ thống → Trợ năng → Nội dung đọc → thêm giọng Linh.
- **Microsoft Edge** có sẵn giọng tự nhiên **HoaiMy** và **NamMinh** miễn phí: cài tiện ích trên Edge rồi chọn
  trong mục Giọng.
- **Giọng AI Azure** (HoaiMy, NamMinh – trên mọi trình duyệt): tạo tài nguyên **Speech** tại
  <https://portal.azure.com> (gói F0 miễn phí hoặc S0) → mục _Keys and Endpoint_ chép **KEY 1** và
  **Location/Region** → Tuỳ chọn → **Giọng AI tự nhiên** → dán key, chọn vùng → **Lưu** (tiện ích tải luôn danh
  sách giọng) → popup → **Giọng** → chọn giọng trong nhóm _Giọng AI Azure_.
- **Giọng AI Google Cloud**: trong <https://console.cloud.google.com> bật **Cloud Text-to-Speech API** → APIs &
  Services → Credentials → **Create credentials → API key** (nên giới hạn key chỉ dùng Text-to-Speech API) →
  dán vào Tuỳ chọn → **Lưu** → chọn giọng trong nhóm _Giọng AI Google Cloud_ (để _Mặc định_ thì tiện ích chọn
  giọng Neural2/WaveNet tiếng Việt).

Chi phí giọng AI **ước tính** (hãy đối chiếu bảng giá chính thức trước khi dùng nhiều): Azure gói F0 miễn phí
0,5 triệu ký tự/tháng; Google Cloud miễn phí 1 triệu ký tự/tháng cho giọng WaveNet/Neural2, sau đó khoảng
16 USD/1 triệu ký tự. Một bài giảng 10 phút cần khoảng 8–10 nghìn ký tự. Gói F0 của Azure giới hạn số yêu cầu
mỗi phút – nếu giọng hay bị ngắt, chuyển sang S0.

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

Claude dịch tự nhiên và nhận danh sách thuật ngữ (cờ vua và từ điển riêng) ngay trong lời dặn. Chi phí **ước tính** cho một
video 20 phút: khoảng 0,2 USD với Opus 5.5, dưới 0,01 USD với Haiku 5.5 (chưa đo thực tế). Key chỉ lưu trên
máy và chỉ gửi tới `api.anthropic.com`.

## Giới hạn hiện tại

- Chép lời: bộ nhận dạng Chrome không trả mốc thời gian nên mốc câu là ước lượng; cần Google Chrome 139+
  (Chromium, Cốc Cốc có thể không có dịch vụ này – khi đó dùng Whisper). Video khác nguồn hoặc có bảo vệ bản
  quyền (DRM) chặn thu âm thanh trong trang → dùng **Nghe âm thanh cả thẻ**.
- Nghe âm thanh cả thẻ: điều khiển video thật cần quyền cho trang chứa video; khung lồng nhiều lớp, trình phát
  vẽ video bằng canvas/shadow DOM kín, hoặc chặn `pause()` từ script thì quay về đọc song song. Mốc lời chép
  được quy đổi từ thời gian thu sang thời gian video (ước lượng theo các lần phát/dừng/tua).
- Google Drive và X: dựa trên cách trang hiện tại tải phụ đề; trang đổi cấu trúc thì có thể phải cập nhật.
  X chỉ lồng được video có phụ đề CC (không có thì tự chép lời).
- Giọng AI cần API key và tính phí theo ký tự; chưa có giọng AI tiếng Việt chạy hẳn trên máy (các mô hình
  mở hiện có giấy phép phi thương mại hoặc chưa rõ).
- Từ điển thuật ngữ sửa theo danh sách cách dịch sai đã biết; cách dịch sai mới thì thêm vào từ điển riêng.
- Udemy: nếu chưa lấy được phụ đề, hãy bật CC trong trình phát rồi bấm lồng tiếng lại.
- Giọng Google và Google Dịch dùng endpoint công khai không chính thức, có thể bị giới hạn khi dùng rất nhiều.
  Mạng nhà/4G nhiều người dùng chung một IP đôi khi bị Google tạm chặn (trang xác minh “Sorry”): tiện ích tự
  thử 5 cách gọi Google Dịch (POST/GET, có và không kèm cookie Google của trình duyệt) và nhớ cách qua được.
  Nếu mọi cách đều bị chặn, tiện ích ngừng gọi Google 1 phút, dịch bằng **Chrome trên máy** nếu máy đã tải gói
  dịch, và báo rõ lý do trên video. Tuỳ chọn → **Kiểm tra kết nối Google Dịch** cho biết từng cách gọi đang qua
  được hay bị chặn.
- Không có đăng nhập/máy chủ đồng bộ bản dịch: mọi thứ chạy trên máy người dùng.

## Quyền riêng tư

Tiện ích không có máy chủ riêng. Nội dung phụ đề được gửi tới Google Dịch hoặc Claude (tuỳ lựa chọn) để dịch
– bộ dịch **Chrome trên máy** dịch ngay trên máy, không gửi đi đâu – và câu cần đọc được gửi tới Google khi
dùng giọng Google, tới Azure hoặc Google Cloud khi dùng giọng AI tương ứng. Huy hiệu “Đã lồng” chỉ tra bộ nhớ trên máy. Quyền `tabCapture` chỉ dùng khi người dùng bấm
**Nghe âm thanh cả thẻ**; âm thanh của thẻ được chép lời giống như khi tự chép lời video. Quyền chạy trên
trang chứa video nhúng là quyền tuỳ chọn: chỉ hỏi khi bấm **Nghe âm thanh cả thẻ**, chỉ cho trang đó, dùng để
nạp tiện ích vào khung video (dừng/phát video, hiện phụ đề, đọc khoá video để lưu lời chép). Khi tự chép lời, âm thanh của video được gửi tới
dịch vụ nhận dạng của Google Chrome (hoặc nhận dạng ngay trên máy nếu Chrome có sẵn gói ngôn ngữ), hoặc tới
Groq/OpenAI khi dùng Whisper. Cài đặt lưu trong `chrome.storage`; API key Claude/Whisper/Azure/Google Cloud
chỉ lưu cục bộ (`storage.local`), không đồng bộ, và chỉ service worker gửi chúng tới đúng dịch vụ.

## Dành cho nhà phát triển

Tiện ích chạy không cần thư viện; công cụ phát triển cần Node.js 22+.

```bash
npm ci              # cài oxlint, oxfmt, playwright-core (chỉ dùng khi phát triển)
npm test            # 120 unit test (node --test)
npm run check       # lint + kiểm định dạng + unit test (CI chạy lệnh này)
npm run build       # → dist/long-tieng-viet/ và dist/long-tieng-viet-v1.3.2.zip
npm run e2e         # build bản --test và chạy Chromium thật trên trang giả lập (cần Chromium – đặt
                    # CHROMIUM_PATH nếu không ở /opt/pw-browsers/chromium – và mạng tới translate.googleapis.com)
LTV_E2E_GROUPS=frames,live npm run e2e   # chỉ chạy một số nhóm: base, youtube, frames, addons, voices, live
```

CI (GitHub Actions) chạy `npm run check` và `npm run build` trên Node 22 và 24, đính kèm tệp zip vào mỗi lần
chạy. E2E chạy tay vì cần mạng tới Google Dịch (dễ bị giới hạn lượt khi chạy dày).

Cấu trúc:

```
src/
  manifest.json
  background/   service worker: chọn bộ dịch (Google/Chrome/Claude) kèm từ điển thuật ngữ, chép lời Whisper,
                giọng đọc (tts.js) và giọng AI Azure/Google Cloud (tts-cloud.js), cache bản dịch theo bộ
                dịch thật và lời chép, tra cứu "đã lồng", điều phối nghe cả thẻ (tab-live.js) và tìm khung
                có video (media-link.js)
  offscreen/    phát giọng Google/giọng AI, dịch trên máy (Translator API), nghe âm thanh cả thẻ
  shared/       cài đặt, từ điển thuật ngữ (glossary.js), giọng AI theo ngôn ngữ, bộ dịch Chrome trên máy,
                chọn khung (trang chính / video nhúng)
  content/
    page-hook.js   (MAIN world) bắt phụ đề/playlist trình phát tải về (fetch, XHR, Resource Timing),
                   gọi API trình phát YouTube
    providers/     youtube, udemy, coursera, drive, x, html5 (dự phòng chung)
    sites/         drive-host (trang Drive trả lời khung trình phát)
    lib/           đọc VTT/json3/XML/HLS, ghép câu, cắt cụm sớm, tính tốc độ, hàng đợi dịch, lớp phủ…
    dubber.js      đồng bộ giọng đọc theo thời gian video, giảm/trả âm lượng
    asr/           chép lời: Chrome (Web Speech API nhận audio track) và Whisper (ghi âm theo đoạn)
    live-*.js      video không phụ đề: thu âm → chép lời → dịch → đọc nối tiếp/song song
    tab-live.js    nghe cả thẻ – phía trang; tab-linked.js – khi có video thật trong khung
    quiz.js, badges.js, addons.js – phần chạy kèm
    main.js        điều phối theo tab/khung, điều hướng SPA, tự bật
  popup/, options/ giao diện
scripts/build.mjs  đóng gói + sinh icon PNG (không lưu tệp nhị phân trong repo)
tests/             unit test; tests/e2e/ trang giả lập + kịch bản Playwright
```

Kiểm thử e2e dùng trang **giả lập** cơ chế của từng site (YouTube đòi PO token cho timedtext, token chỉ thấy
qua Resource Timing, Shorts, bố cục di động, video nhúng khác nguồn, Drive cần cookie trang cha, playlist HLS
của X, API bài giảng Udemy + VTT khác origin, thẻ `<track>` của Coursera, câu hỏi trắc nghiệm, video không phụ
đề) với giọng đọc và bộ chép lời giả lập ghi nhật ký; bản dịch là Google Dịch thật; Translator API của
Chromium được gọi thật (gói en→vi chưa tải nên kiểm đường dự phòng). Nghe cả thẻ được kiểm bằng luồng âm
thanh giả trong offscreen vì headless không bấm được biểu tượng tiện ích; khung trình phát trên origin có
quyền (nạp script, nối tiếp, toàn màn hình, lưu và đọc lại lời chép) và origin không có quyền (đọc song song);
hộp thoại xin quyền của popup chưa kiểm được trong headless. Giọng AI được kiểm bằng máy chủ giả lập Azure/
Google Cloud, cộng một lần gọi Google Cloud thật với key sai; chưa đọc thử bằng key thật, Azure thật không
truy cập được từ môi trường kiểm thử. Chưa kiểm thử trên các site thật,
chưa nghe giọng Google thật, chưa thử tải gói dịch Chrome, chưa đo chất lượng/độ trễ chép lời thật của Chrome
và Whisper, chưa thử `tabCapture` + nhận dạng giọng trong offscreen trên Chrome thật – cần thử trên Google
Chrome máy thật.

## Giấy phép

Bản quyền © 2026 Công ty Cổ phần Cờ vua Dương Sinh. Bảo lưu mọi quyền – mã nguồn công khai để xem và tham
khảo; sao chép, sửa đổi, phân phối hay dùng thương mại cần văn bản cho phép. Xem [LICENSE](LICENSE).
