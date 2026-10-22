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

  const realOpen = LTV.openTabStream;
  LTV.openTabStream = async function openTabStream(streamId) {
    if (!String(streamId).startsWith("test:")) return realOpen(streamId);
    const context = new AudioContext();
    const tone = context.createOscillator();
    const output = context.createMediaStreamDestination();
    tone.connect(output);
    tone.start();
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
