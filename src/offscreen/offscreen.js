// Offscreen document: tải giọng đọc (MP3 của Google Dịch, hoặc giọng AI
// Azure/Google Cloud do service worker gọi bằng API key) và phát bằng <audio>,
// giữ cao độ khi tăng tốc, có cache nhỏ để đọc trước các câu sắp tới; dịch
// trên máy bằng Translator API của Chrome (LTV.chromeAI); và nghe âm thanh
// cả thẻ (LTV.createTabCapture).
(function () {
  const LTV = globalThis.LTV;
  const TTS_ENDPOINT = "https://translate.google.com/translate_tts";
  const MAX_CHUNK = 180;
  // Giọng AI nhận đoạn dài hơn nhiều; cắt vừa phải để câu dài đọc sớm.
  const MAX_CLOUD_CHUNK = 1000;
  const MAX_CACHE = 40;

  const cache = new Map();
  let playing = null;

  function send(uttId, event, message, code) {
    chrome.runtime
      .sendMessage({
        target: "background",
        type: "speech",
        uttId,
        event,
        message,
        code,
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

  function base64ToBlob(audio, mime) {
    const bytes = Uint8Array.from(atob(audio), (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: mime || "audio/mpeg" });
  }

  // Giọng AI: service worker giữ API key nên gọi dịch vụ thay offscreen.
  async function fetchCloudChunk(text, { lang, engine, voice }) {
    const reply = await chrome.runtime.sendMessage({
      target: "background",
      type: "tts:synthesize",
      engine,
      voice,
      lang,
      text,
    });
    if (!reply?.ok) {
      const error = new Error(reply?.error || "Giọng AI không phản hồi");
      error.code = reply?.code || "";
      throw error;
    }
    return base64ToBlob(reply.audio, reply.mime);
  }

  // source: { lang, engine: "google" | "azure" | "gcloud", voice }.
  function load(text, source) {
    const cloud = source.engine === "azure" || source.engine === "gcloud";
    const key = cloud
      ? `${source.engine}|${source.voice}|${source.lang}|${text}`
      : `google|${source.lang}|${text}`;
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const chunks = LTV.splitForTts(text, cloud ? MAX_CLOUD_CHUNK : MAX_CHUNK);
    const promise = Promise.all(
      chunks.map((chunk) =>
        cloud ? fetchCloudChunk(chunk, source) : fetchChunk(chunk, source.lang),
      ),
    );
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

  async function play({ uttId, text, lang, rate, volume, engine, voice }) {
    stop();
    const session = { uttId, rate, volume, cancelled: false, abort: null };
    playing = session;
    try {
      const blobs = await load(text, { lang, engine, voice });
      for (let index = 0; index < blobs.length; index += 1) {
        if (session.cancelled) return;
        await playBlob(session, blobs[index], index === 0);
      }
      if (!session.cancelled) send(uttId, "end");
    } catch (error) {
      if (!session.cancelled)
        send(uttId, "error", error?.message || String(error), error?.code);
    } finally {
      if (playing === session) playing = null;
    }
  }

  const tabCapture = LTV.createTabCapture({
    send: (event) =>
      chrome.runtime
        .sendMessage({ target: "background", type: "tabLive:event", ...event })
        .catch(() => {}),
    // Whisper chép lời qua service worker (nơi giữ API key).
    connection: {
      request: (message) =>
        chrome.runtime.sendMessage({
          target: "background",
          type: "offscreen:asr",
          message,
        }),
    },
  });

  function tabCommand(message, sendResponse) {
    if (message.type === "tab:start") {
      tabCapture.start(message).then(
        (result) => sendResponse({ ok: true, ...result }),
        (error) => sendResponse({ ok: false, error: error?.message }),
      );
      return true;
    }
    if (message.type === "tab:status") sendResponse(tabCapture.status());
    else if (message.type === "tab:gain") tabCapture.gain(message.value);
    else if (message.type === "tab:stop") tabCapture.stop();
    return false;
  }

  function translate(message, sendResponse) {
    LTV.chromeAI
      .translate(message)
      .then(sendResponse, (error) =>
        sendResponse({ ok: false, code: "error", error: error?.message }),
      );
    return true;
  }

  // Chỉ nhận lệnh từ service worker (không từ content script trong trang).
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "offscreen" || sender.tab) return false;
    if (message.type === "translate") return translate(message, sendResponse);
    if (message.type?.startsWith("tab:"))
      return tabCommand(message, sendResponse);
    if (message.type === "play") play(message);
    else if (message.type === "stop") stop();
    else if (message.type === "prefetch") {
      const { lang, engine, voice } = message;
      for (const text of message.texts || [])
        load(text, { lang, engine, voice }).catch(() => {});
    }
    return false;
  });
})();
