// Chép lời bằng Whisper (Groq/OpenAI, cần API key): ghi âm audio track của
// video thành từng đoạn webm/opus, cắt theo khoảng lặng, gửi service worker
// chép lời rồi đổi mốc thời gian của đoạn về thời gian video. Kết quả phát ra
// đúng thứ tự đoạn dù các yêu cầu hoàn thành lệch nhau.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const FRAME_MS = 100;
  const MIME = "audio/webm;codecs=opus";
  const MIN_UPLOAD_BYTES = 1000;
  const UPLOAD_TIMEOUT_MS = 90000;

  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  // Đo âm lượng track để cắt đoạn ở khoảng lặng; null khi trình duyệt chưa cho
  // AudioContext chạy (chưa có thao tác của người dùng).
  function openLevelMeter(track) {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context
        .createMediaStreamSource(new MediaStream([track]))
        .connect(analyser);
      context.resume().catch(() => {});
      const buffer = new Float32Array(analyser.fftSize);
      return {
        level() {
          if (context.state !== "running") return null;
          analyser.getFloatTimeDomainData(buffer);
          return LTV.rms(buffer);
        },
        resume: () => context.resume().catch(() => {}),
        close: () => context.close().catch(() => {}),
      };
    } catch {
      return { level: () => null, resume() {}, close() {} };
    }
  }

  // Gửi từng đoạn đi chép lời, đổi mốc về thời gian video và phát kết quả
  // theo đúng thứ tự số đoạn. Câu cuối của đoạn trước làm "prompt" cho đoạn sau.
  function createUploader({ connection, lang, onSegment, onError }) {
    const ready = new Map();
    let next = 1;
    let lastText = "";

    function complete(seq, segments) {
      ready.set(seq, segments);
      while (ready.has(next)) {
        for (const segment of ready.get(next)) onSegment(segment);
        ready.delete(next);
        next += 1;
      }
    }

    async function transcribe(meta, blob) {
      const response = await connection.request(
        {
          type: "asr:whisper",
          audio: await blobToBase64(blob),
          mime: MIME,
          lang,
          prompt: lastText,
        },
        UPLOAD_TIMEOUT_MS,
      );
      if (!response.ok) {
        onError(`Lỗi chép lời: ${response.error}`, response.code === "auth");
        return [];
      }
      const segments = response.segments.map((segment) => ({
        start: meta.start + segment.start * meta.rate,
        end: meta.start + segment.end * meta.rate,
        text: segment.text,
      }));
      if (segments.length > 0) lastText = segments[segments.length - 1].text;
      return segments;
    }

    return async function upload(meta, blob) {
      if (!meta.hasSpeech || blob.size < MIN_UPLOAD_BYTES) {
        complete(meta.seq, []);
        return;
      }
      try {
        complete(meta.seq, await transcribe(meta, blob));
      } catch (error) {
        onError(`Lỗi chép lời: ${error.message}`, false);
        complete(meta.seq, []);
      }
    };
  }

  LTV.createWhisperRecognizer = function createWhisperRecognizer({
    connection,
    video,
  }) {
    const planner = LTV.createChunkPlanner();
    let stream = null;
    let meter = null;
    let upload = null;
    let recorder = null;
    let chunk = null;
    let timer = null;
    let sequence = 0;
    let running = false;

    function beginChunk() {
      if (!running || recorder || video.paused) return;
      const parts = [];
      recorder = new MediaRecorder(stream, {
        mimeType: MIME,
        audioBitsPerSecond: 32000,
      });
      recorder.ondataavailable = (event) => parts.push(event.data);
      chunk = {
        start: video.currentTime,
        rate: video.playbackRate || 1,
        parts,
      };
      planner.reset();
      recorder.start();
    }

    function cut(restart) {
      if (!recorder) return;
      sequence += 1;
      const meta = {
        seq: sequence,
        start: chunk.start,
        rate: chunk.rate,
        hasSpeech: planner.hasSpeech(),
      };
      const { parts } = chunk;
      recorder.onstop = () => upload(meta, new Blob(parts, { type: MIME }));
      recorder.stop();
      recorder = null;
      chunk = null;
      if (restart) beginChunk();
    }

    function sample() {
      if (!recorder) return;
      const rms = meter.level();
      const seconds = (FRAME_MS / 1000) * (video.playbackRate || 1);
      const shouldCut =
        rms === null ? planner.pushBlind(seconds) : planner.push(rms, seconds);
      if (shouldCut) cut(true);
    }

    const onStop = () => cut(false);
    const onPlay = () => {
      meter?.resume();
      beginChunk();
    };
    const listeners = {
      pause: onStop,
      seeking: onStop,
      play: onPlay,
      seeked: onPlay,
    };

    return {
      engine: "whisper",
      async start({ track, lang, onSegment, onError }) {
        if (!MediaRecorder.isTypeSupported(MIME)) {
          onError("Trình duyệt không ghi được âm thanh để chép lời.", true);
          return;
        }
        upload = createUploader({ connection, lang, onSegment, onError });
        stream = new MediaStream([track]);
        meter = openLevelMeter(track);
        running = true;
        for (const [name, fn] of Object.entries(listeners))
          video.addEventListener(name, fn);
        timer = setInterval(sample, FRAME_MS);
        beginChunk();
      },
      stop() {
        if (!running) return;
        cut(false);
        running = false;
        clearInterval(timer);
        for (const [name, fn] of Object.entries(listeners))
          video.removeEventListener(name, fn);
        meter.close();
      },
    };
  };
})(globalThis);
