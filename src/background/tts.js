// Điều phối giọng đọc, mỗi lúc chỉ một câu:
//   "system" – chrome.tts (giọng cài trên máy / trình duyệt, chạy offline)
//   "google" – MP3 từ Google Dịch, phát trong offscreen document
//   "azure" | "gcloud" – giọng AI đám mây (tts-cloud.js), cũng phát trong
//   offscreen document; offscreen xin âm thanh từ service worker.
// Mỗi câu nhận đúng một sự kiện kết thúc: end | interrupted | error (kèm
// code, vd. "auth" khi API key giọng AI sai).

const OFFSCREEN_ENGINES = new Set(["google", "azure", "gcloud"]);

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

const TTS_EVENTS = {
  start: "start",
  end: "end",
  interrupted: "interrupted",
  cancelled: "interrupted",
  error: "error",
};

// Đọc bằng chrome.tts; report(event, message) nhận sự kiện của câu này.
function speakSystem({ tts, runtime }, utterance, report) {
  const options = {
    rate: clamp(utterance.rate, 0.1, 10),
    volume: clamp(utterance.volume, 0, 1),
    onEvent: (event) => {
      const mapped = TTS_EVENTS[event.type];
      if (mapped) report(mapped, event.errorMessage);
    },
  };
  if (utterance.voiceName) options.voiceName = utterance.voiceName;
  else if (utterance.lang) options.lang = utterance.lang;
  tts.speak(utterance.text, options, () => {
    const error = runtime.lastError;
    if (error) report("error", error.message);
  });
}

export function createSpeech({
  emit,
  ensureOffscreen,
  tts = chrome.tts,
  runtime = chrome.runtime,
}) {
  let current = null;

  function report(utterance, event, message, code) {
    if (utterance.finished) return;
    if (event !== "start") {
      utterance.finished = true;
      if (current === utterance) current = null;
    }
    emit(utterance.owner, {
      type: "speech",
      uttId: utterance.uttId,
      event,
      message,
      code: code || "",
    });
  }

  async function speakOffscreen(utterance) {
    await ensureOffscreen();
    await runtime.sendMessage({
      target: "offscreen",
      type: "play",
      uttId: utterance.uttId,
      text: utterance.text,
      lang: utterance.lang,
      rate: clamp(utterance.rate, 0.5, 4),
      volume: clamp(utterance.volume, 0, 1),
      engine: utterance.engine,
      voice: utterance.engine === "google" ? "" : utterance.voiceName || "",
    });
  }

  function stop(owner) {
    const utterance = current;
    if (!utterance || (owner !== undefined && utterance.owner !== owner))
      return;
    if (utterance.engine === "system") tts.stop();
    else
      runtime
        .sendMessage({ target: "offscreen", type: "stop" })
        .catch(() => {});
    report(utterance, "interrupted");
  }

  async function speak(request) {
    stop();
    const utterance = {
      ...request,
      engine:
        request.engine === "system" || OFFSCREEN_ENGINES.has(request.engine)
          ? request.engine
          : "google",
    };
    current = utterance;
    try {
      if (utterance.engine === "system") {
        speakSystem({ tts, runtime }, utterance, (event, message) =>
          report(utterance, event, message),
        );
      } else await speakOffscreen(utterance);
    } catch (error) {
      report(utterance, "error", error?.message || String(error));
    }
  }

  // Sự kiện từ offscreen document: { uttId, event, message, code }.
  function handleOffscreenEvent(message) {
    if (current && current.uttId === message.uttId) {
      report(current, message.event, message.message, message.code);
    }
  }

  // Tải trước âm thanh các câu sắp đọc (giọng phát trong offscreen).
  async function prefetch({ texts, lang, engine, voice }) {
    if (!Array.isArray(texts) || texts.length === 0) return;
    if (!OFFSCREEN_ENGINES.has(engine)) return;
    await ensureOffscreen();
    await runtime.sendMessage({
      target: "offscreen",
      type: "prefetch",
      texts,
      lang,
      engine,
      voice: engine === "google" ? "" : String(voice || ""),
    });
  }

  return { speak, stop, prefetch, handleOffscreenEvent };
}
