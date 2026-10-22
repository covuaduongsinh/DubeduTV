// Offscreen document: tải giọng đọc Google Dịch (MP3) và phát bằng <audio>,
// giữ cao độ khi tăng tốc. Có cache nhỏ để đọc trước các câu sắp tới.
(function () {
  const LTV = globalThis.LTV;
  const TTS_ENDPOINT = "https://translate.google.com/translate_tts";
  const MAX_CHUNK = 180;
  const MAX_CACHE = 40;

  const cache = new Map();
  let playing = null;

  function send(uttId, event, message) {
    chrome.runtime
      .sendMessage({
        target: "background",
        type: "speech",
        uttId,
        event,
        message,
      })
      .catch(() => {});
  }

  async function fetchChunk(text, lang) {
    const params = new URLSearchParams({
      ie: "UTF-8",
      client: "tw-ob",
      tl: lang,
      q: text,
      total: "1",
      idx: "0",
      textlen: String(text.length),
    });
    const response = await fetch(`${TTS_ENDPOINT}?${params}`);
    if (!response.ok)
      throw new Error(`Giọng Google lỗi HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("Giọng Google trả về âm thanh rỗng");
    return blob;
  }

  function load(text, lang) {
    const key = `${lang}|${text}`;
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const chunks = LTV.splitForTts(text, MAX_CHUNK);
    const promise = Promise.all(chunks.map((chunk) => fetchChunk(chunk, lang)));
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return promise;
  }

  function playBlob(session, blob, first) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio();
      const cleanup = () => URL.revokeObjectURL(url);
      audio.preservesPitch = true;
      audio.defaultPlaybackRate = session.rate;
      audio.volume = session.volume;
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error("Không phát được âm thanh giọng đọc"));
      };
      session.abort = () => {
        audio.pause();
        cleanup();
        resolve();
      };
      audio.src = url;
      audio.playbackRate = session.rate;
      audio
        .play()
        .then(() => {
          if (first && !session.cancelled) send(session.uttId, "start");
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });
  }

  function stop() {
    const session = playing;
    if (!session) return;
    playing = null;
    session.cancelled = true;
    if (session.abort) session.abort();
    send(session.uttId, "interrupted");
  }

  async function play({ uttId, text, lang, rate, volume }) {
    stop();
    const session = { uttId, rate, volume, cancelled: false, abort: null };
    playing = session;
    try {
      const blobs = await load(text, lang);
      for (let index = 0; index < blobs.length; index += 1) {
        if (session.cancelled) return;
        await playBlob(session, blobs[index], index === 0);
      }
      if (!session.cancelled) send(uttId, "end");
    } catch (error) {
      if (!session.cancelled)
        send(uttId, "error", error?.message || String(error));
    } finally {
      if (playing === session) playing = null;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target !== "offscreen") return;
    if (message.type === "play") play(message);
    else if (message.type === "stop") stop();
    else if (message.type === "prefetch") {
      for (const text of message.texts || [])
        load(text, message.lang).catch(() => {});
    }
  });
})();
