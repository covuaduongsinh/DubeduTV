// Trang giả lập ba site, phụ đề mẫu và âm thanh im lặng cho kiểm thử e2e.

export const LESSON = [
  [0.5, 3.0, "Welcome to this short chess lesson."],
  [3.2, 6.0, "Today we will learn how the knight moves."],
  [6.3, 9.5, "The knight jumps in an L shape."],
  [9.8, 13.0, "It can jump over other pieces."],
  [13.5, 17.0, "Practice this move every day."],
];

function vttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const pad = (value, size) => String(value).padStart(size, "0");
  return `00:${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`;
}

export function lessonVtt() {
  const cues = LESSON.map(
    ([start, end, text]) => `${vttTime(start)} --> ${vttTime(end)}\n${text}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

// json3 kiểu phụ đề tự động: mỗi sự kiện là một dòng, có thời gian từng từ.
export function lessonJson3() {
  const events = [{ tStartMs: 0, dDurationMs: 30000, id: 1, wpWinPosId: 1 }];
  for (const [start, end, text] of LESSON) {
    const words = text.split(" ");
    const step = ((end - start) * 1000 * 0.8) / words.length;
    events.push({
      tStartMs: Math.round(start * 1000),
      dDurationMs: Math.round((end - start) * 1000),
      segs: words.map((word, i) => ({
        utf8: i === 0 ? word : ` ${word}`,
        tOffsetMs: Math.round(i * step),
      })),
    });
  }
  return JSON.stringify({ wireMagic: "pb3", events });
}

// Âm thanh PCM 16-bit mono: im lặng, hoặc tone 440 Hz (để bộ cắt đoạn thấy "có tiếng").
export function silenceWav(seconds = 40, sampleRate = 8000, tone = false) {
  const dataSize = seconds * sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  if (tone) {
    for (let i = 0; i < seconds * sampleRate; i += 1) {
      const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000;
      buffer.writeInt16LE(Math.round(sample), 44 + i * 2);
    }
  }
  return buffer;
}

const PAGE_STYLE =
  "body{margin:0;background:#222;color:#eee;font-family:sans-serif}";

function page(provider, title, body, script = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="ltv-test-provider" content="${provider}">
<title>${title}</title><style>${PAGE_STYLE}</style></head><body>${body}<script>${script}</script></body></html>`;
}

export function youtubePage() {
  return page(
    "youtube",
    "Knight lesson - YouTube (mock)",
    `<script type="application/json" id="ltv-test-transcript">${JSON.stringify(
      LESSON.map(([start, end, text]) => ({ start, end, text })),
    )}</script>
    <div id="movie_player" style="position:relative;width:854px;height:480px;background:#000">
      <video class="html5-main-video" src="/media/silence.wav" style="width:100%;height:100%"></video>
      <div class="ytp-right-controls" style="position:absolute;right:8px;bottom:8px;display:flex"></div>
    </div>`,
    `const params = new URL(location.href).searchParams;
    if (params.get("real") === "1") document.documentElement.dataset.ltvRealSpeech = "1";
    if (params.get("realasr") === "1") document.documentElement.dataset.ltvRealAsr = "1";
    // nosub=1: video không có phụ đề (phát âm thanh ngắn 19 giây); tone=1: có tiếng tone.
    const noSubtitles = params.get("nosub") === "1";
    if (noSubtitles) {
      document.querySelector("video").src = params.get("tone") === "1" ? "/media/tone.wav" : "/media/short.wav";
    }
    const player = document.getElementById("movie_player");
    const videoId = params.get("v");
    const track = { baseUrl: "/api/timedtext?v=" + videoId + "&lang=en&kind=asr", languageCode: "en", kind: "asr",
      name: { simpleText: "English (auto-generated)" } };
    let currentTrack = {};
    player.getPlayerResponse = () => ({ videoDetails: { videoId, title: "Knight lesson" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: noSubtitles ? [] : [track] } } });
    player.getOption = (module, key) => (key === "tracklist" ? [{ languageCode: "en", kind: "asr" }] : currentTrack);
    player.loadModule = () => {};
    player.unloadModule = () => { window.__captionsUnloaded = true; document.body.dataset.captionsUnloaded = "1"; };
    player.setOption = (module, key, value) => {
      currentTrack = value;
      if (value && value.languageCode) {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/timedtext?v=" + videoId + "&lang=en&kind=asr&fmt=json3&pot=TOKEN");
        xhr.send();
      }
    };`,
  );
}

export function udemyPage(cdnOrigin) {
  return page(
    "udemy",
    "Knight lesson | Udemy (mock)",
    `<div style="position:relative;width:854px;height:480px"><video src="/media/silence.wav" style="width:100%;height:100%"></video></div>`,
    `fetch("/api-2.0/users/me/subscribed-courses/77/lectures/4242/?fields[asset]=captions").then((r) => r.json());
    window.__cdn = ${JSON.stringify(cdnOrigin)};`,
  );
}

export function courseraPage() {
  return page(
    "coursera",
    "Knight lesson | Coursera (mock)",
    `<div style="position:relative;width:854px;height:480px"><video src="/media/silence.wav" style="width:100%;height:100%">
      <track kind="subtitles" srclang="en" label="English" src="/subs/coursera-en.vtt"></video></div>`,
  );
}
