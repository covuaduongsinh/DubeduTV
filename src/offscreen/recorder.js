// Quay video lồng tiếng (offscreen document). Luồng thẻ từ chrome.tabCapture
// có cả hình lẫn tiếng:
//   - tiếng thẻ phát lại ra loa (Chrome tắt tiếng thẻ khi đang thu) và cùng
//     giọng đọc (offscreen.js gắn từng câu qua attachVoice) vào điểm trộn;
//   - hình cắt đúng vùng video theo toạ độ trang gửi về, vẽ lên khung kích
//     thước cố định (giữ tỉ lệ, viền đen) để file không đổi kích thước giữa
//     chừng; trình duyệt thiếu API cắt hình thì ghi cả thẻ;
//   - MediaRecorder ghi mỗi giây một mẩu vào IndexedDB; phụ đề .srt dựng từ
//     các mốc câu trang báo, theo giờ của file quay.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const VIDEO_BITS = 4_000_000;
  const AUDIO_BITS = 160_000;
  const SLICE_MS = 1000;
  const KEEP_RECORDINGS = 3;

  function stopTracks(stream) {
    for (const track of stream.getTracks()) track.stop();
  }

  // Hình: khung hình thu → cắt → khung cố định → track mới cho MediaRecorder.
  function createCropper(track, layout) {
    if (
      typeof root.MediaStreamTrackProcessor !== "function" ||
      typeof root.MediaStreamTrackGenerator !== "function"
    )
      return { track, cropped: false, close() {} };
    const reader = new root.MediaStreamTrackProcessor({
      track,
    }).readable.getReader();
    const generator = new root.MediaStreamTrackGenerator({ kind: "video" });
    const writer = generator.writable.getWriter();
    let canvas = null;
    let context = null;
    let stopped = false;

    function draw(frame) {
      const size = { width: frame.displayWidth, height: frame.displayHeight };
      const crop = LTV.cropRect(layout.rect, layout.viewport, size) || {
        x: 0,
        y: 0,
        ...size,
      };
      if (!canvas) {
        const out = LTV.outputSize(crop, size);
        canvas = new OffscreenCanvas(out.width, out.height);
        context = canvas.getContext("2d");
      }
      const place = LTV.fitRect(crop, canvas);
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        frame,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        place.x,
        place.y,
        place.width,
        place.height,
      );
      return new VideoFrame(canvas, { timestamp: frame.timestamp });
    }

    (async () => {
      while (!stopped) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        let out = null;
        try {
          out = draw(frame);
        } catch {
          // Bỏ khung hình lỗi.
        } finally {
          frame.close();
        }
        if (out) await writer.write(out).catch(() => out.close());
      }
    })().catch(() => {});

    return {
      track: generator,
      cropped: true,
      close() {
        stopped = true;
        reader.cancel().catch(() => {});
        writer.close().catch(() => {});
        generator.stop();
      },
    };
  }

  // Tiếng: tiếng thẻ ra loa và vào điểm trộn (giọng đọc gắn sau).
  async function openAudio(stream) {
    const audio = new AudioContext();
    const mix = audio.createMediaStreamDestination();
    if (stream.getAudioTracks().length > 0) {
      const tab = audio.createMediaStreamSource(stream);
      tab.connect(audio.destination);
      tab.connect(mix);
    }
    await audio.resume?.().catch(() => {});
    if (audio.state !== "running") {
      await audio.close().catch(() => {});
      throw new Error("Không phát lại được âm thanh của thẻ");
    }
    return { audio, mix };
  }

  // Mở một phiên quay trên luồng thẻ: tiếng, hình đã cắt, MediaRecorder ghi
  // từng mẩu vào kho.
  async function openSession({ stream, id, title, layout, db, now }) {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("Không thu được hình của thẻ");
    const type = LTV.pickRecordType((value) =>
      MediaRecorder.isTypeSupported(value),
    );
    const graph = await openAudio(stream);
    const current = { layout: { ...layout } };
    const cropper = createCropper(videoTrack, current.layout);
    try {
      const recorder = new MediaRecorder(
        new MediaStream([cropper.track, ...graph.mix.stream.getAudioTracks()]),
        {
          ...(type ? { mimeType: type } : {}),
          videoBitsPerSecond: VIDEO_BITS,
          audioBitsPerSecond: AUDIO_BITS,
        },
      );
      await db.prune(KEEP_RECORDINGS - 1).catch(() => {});
      const mimeType = recorder.mimeType || type || "video/webm";
      const startedAt = now();
      await db.create({
        id,
        title: title || "",
        createdAt: startedAt,
        mimeType,
        extension: LTV.recordExtension(mimeType),
        status: "recording",
      });
      Object.assign(current, {
        id,
        stream,
        videoTrack,
        cropper,
        recorder,
        mimeType,
        startedAt,
        audio: graph.audio,
        mix: graph.mix,
        lines: [],
        voices: 0,
        bytes: 0,
        seq: 0,
        writes: Promise.resolve(),
      });
      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        const seq = current.seq++;
        current.bytes += event.data.size;
        current.writes = current.writes.then(() =>
          db.addChunk(id, seq, event.data).catch(() => {}),
        );
      };
      recorder.start(SLICE_MS);
      return current;
    } catch (error) {
      cropper.close();
      await graph.audio.close().catch(() => {});
      throw error;
    }
  }

  // Dừng MediaRecorder, đợi ghi hết các mẩu, đóng luồng, chốt phụ đề.
  async function closeSession(current, { db, now, reason }) {
    const stopped = new Promise((resolve) => {
      current.recorder.onstop = resolve;
    });
    if (current.recorder.state !== "inactive") current.recorder.stop();
    await stopped;
    await current.writes;
    const endedAt = now();
    current.cropper.close();
    stopTracks(current.stream);
    await current.audio.close().catch(() => {});
    const result = {
      id: current.id,
      bytes: current.bytes,
      duration: (endedAt - current.startedAt) / 1000,
      voices: current.voices,
      lines: current.lines.filter((line) => line.text).length,
      reason,
    };
    await db.update(current.id, {
      status: "done",
      bytes: result.bytes,
      duration: result.duration,
      srt: LTV.buildSrt(current.lines, {
        startedAt: current.startedAt,
        endedAt,
      }),
    });
    return result;
  }

  LTV.createRecorder = function createRecorder({
    send,
    db = LTV.createRecordingsDb(),
    now = Date.now,
  }) {
    let session = null;

    // Giọng đọc của một câu: phát qua AudioContext của bản quay để vào file.
    function attachVoice(audio) {
      if (!session) return;
      try {
        const source = session.audio.createMediaElementSource(audio);
        source.connect(session.audio.destination);
        source.connect(session.mix);
        session.voices += 1;
      } catch {
        // Phần tử đã gắn trước đó – vẫn phát bình thường.
      }
    }

    // Dừng và chốt file. Trả thông tin bản quay (null nếu không quay).
    async function stop(reason = "user") {
      const current = session;
      if (!current) return null;
      session = null;
      return closeSession(current, { db, now, reason });
    }

    async function start({ streamId, id, title, layout }) {
      if (session) await stop("restart");
      const stream = await LTV.openTabStream(streamId, { video: true });
      let current;
      try {
        current = await openSession({ stream, id, title, layout, db, now });
      } catch (error) {
        stopTracks(stream);
        throw error;
      }
      // Hình của thẻ mất (đóng thẻ, Chrome dừng thu): tự chốt file.
      current.videoTrack.addEventListener("ended", () => {
        if (session === current)
          stop("ended").then((result) =>
            send({ event: "finished", ...result }),
          );
      });
      session = current;
      return {
        startedAt: current.startedAt,
        mimeType: current.mimeType,
        cropped: current.cropper.cropped,
      };
    }

    return {
      start,
      stop,
      attachVoice,
      layout(layout) {
        if (session && layout) Object.assign(session.layout, layout);
      },
      line({ text, at }) {
        session?.lines.push({ text: text || null, at: Number(at) || now() });
      },
      status: () => ({
        active: Boolean(session),
        id: session?.id,
        startedAt: session?.startedAt,
        bytes: session?.bytes || 0,
        voices: session?.voices || 0,
      }),
    };
  };
})(globalThis);
