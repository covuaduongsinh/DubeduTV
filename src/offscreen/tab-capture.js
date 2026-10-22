// Nghe âm thanh cả thẻ (offscreen document): nhận luồng âm thanh của thẻ từ
// chrome.tabCapture, phát lại qua GainNode (Chrome tắt tiếng thẻ khi đang thu;
// giảm mức này khi giọng lồng tiếng đọc) và chép lời bằng bộ nhận dạng của
// Chrome hoặc Whisper. Mốc thời gian tính từ lúc bắt đầu thu; lời chép gửi về
// service worker để chuyển cho trang.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  LTV.openTabStream = function openTabStream(streamId) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
      },
      video: false,
    });
  };

  const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));

  // Âm thanh thẻ → GainNode → loa. AudioContext không chạy được thì báo lỗi
  // ngay (để thẻ không bị câm trong lúc thu).
  LTV.createTabAudioGraph = async function createTabAudioGraph(
    stream,
    AudioContextCtor = root.AudioContext,
  ) {
    const context = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const gain = context.createGain();
    source.connect(gain).connect(context.destination);
    await context.resume?.().catch(() => {});
    if (context.state !== "running") {
      await context.close().catch(() => {});
      throw new Error("Không phát lại được âm thanh của thẻ");
    }
    return {
      setGain(value) {
        gain.gain.setTargetAtTime(clamp(value), context.currentTime, 0.05);
      },
      close: () => context.close().catch(() => {}),
    };
  };

  // "Video" cho bộ nhận dạng: đồng hồ tính từ lúc bắt đầu thu, luôn đang phát.
  class TabClock extends EventTarget {
    constructor(startedAt) {
      super();
      this.startedAt = startedAt;
      this.paused = false;
      this.seeking = false;
      this.playbackRate = 1;
    }

    get currentTime() {
      return (Date.now() - this.startedAt) / 1000;
    }
  }

  function stopTracks(stream) {
    for (const track of stream.getTracks()) track.stop();
  }

  LTV.createTabCapture = function createTabCapture({ send, connection }) {
    let session = null;

    async function stop() {
      if (!session) return;
      const current = session;
      session = null;
      current.recognizer.stop();
      stopTracks(current.stream);
      await current.graph.close();
    }

    function recognizerFor(engine, video) {
      if (engine === "whisper")
        return LTV.createWhisperRecognizer({ connection, video });
      if (!LTV.chromeRecognizerSupported())
        throw new Error(
          "Cần Google Chrome 139+ để tự chép lời (hoặc nhập API key Whisper trong Tuỳ chọn)",
        );
      return LTV.createChromeRecognizer({ video });
    }

    async function start({ streamId, lang, engine }) {
      await stop();
      const stream = await LTV.openTabStream(streamId);
      const track = stream.getAudioTracks()[0];
      let graph = null;
      try {
        if (!track) throw new Error("Thẻ này không có âm thanh");
        graph = await LTV.createTabAudioGraph(stream);
        const startedAt = Date.now();
        const recognizer = recognizerFor(engine, new TabClock(startedAt));
        session = { stream, graph, recognizer, startedAt };
        track.addEventListener("ended", () => {
          send({ event: "ended" });
          stop();
        });
        await recognizer.start({
          track,
          lang,
          onSegment: (segment) => send({ event: "segment", segment }),
          onInterim: (result) => send({ event: "interim", result }),
          onError: (message, fatal) => send({ event: "error", message, fatal }),
        });
        return { startedAt };
      } catch (error) {
        session = null;
        await graph?.close();
        stopTracks(stream);
        throw error;
      }
    }

    return {
      start,
      stop,
      gain: (value) => session?.graph.setGain(value),
      status: () => ({
        active: Boolean(session),
        startedAt: session?.startedAt,
      }),
    };
  };
})(globalThis);
