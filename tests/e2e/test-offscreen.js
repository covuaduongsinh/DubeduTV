// Chỉ có trong bản build --test, nạp vào offscreen document: luồng "test:*"
// thay cho luồng tabCapture thật (headless không bấm được biểu tượng tiện
// ích) bằng âm thanh tone, và bộ chép lời giả theo kịch bản (Chromium thử
// nghiệm không có dịch vụ nhận dạng giọng nói).
(function () {
  const LTV = globalThis.LTV;
  const SCRIPT = [
    [0.5, 3.0, "Welcome to this short chess lesson."],
    [3.2, 6.0, "Today we will learn how the knight moves."],
    [6.3, 9.5, "The knight jumps in an L shape."],
    [9.8, 13.0, "It can jump over other pieces."],
  ];

  // Hình giả khi quay video: "trang" 1280×720 đổi màu liên tục, ô video
  // 640×360 ở (320, 180) có khung trắng để thấy vùng cắt.
  function fakeVideoTrack() {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    let tick = 0;
    setInterval(() => {
      tick += 1;
      context.fillStyle = "#222";
      context.fillRect(0, 0, 1280, 720);
      context.fillStyle = `hsl(${(tick * 12) % 360}, 70%, 45%)`;
      context.fillRect(320, 180, 640, 360);
      context.strokeStyle = "#fff";
      context.strokeRect(321, 181, 638, 358);
    }, 33);
    return canvas.captureStream(30).getVideoTracks()[0];
  }

  const realOpen = LTV.openTabStream;
  LTV.openTabStream = async function openTabStream(streamId, options = {}) {
    if (!String(streamId).startsWith("test:"))
      return realOpen(streamId, options);
    const context = new AudioContext();
    const tone = context.createOscillator();
    const output = context.createMediaStreamDestination();
    tone.connect(output);
    tone.start();
    if (options.video) output.stream.addTrack(fakeVideoTrack());
    return output.stream;
  };

  LTV.chromeRecognizerSupported = () => true;
  LTV.createChromeRecognizer = function createChromeRecognizer({ video }) {
    const pending = SCRIPT.map(([start, end, text]) => ({ start, end, text }));
    let timer = null;
    return {
      engine: "chrome",
      async start({ onSegment }) {
        timer = setInterval(() => {
          while (
            pending.length > 0 &&
            pending[0].end + 0.4 <= video.currentTime
          )
            onSegment(pending.shift());
        }, 100);
      },
      stop: () => clearInterval(timer),
    };
  };
})();
