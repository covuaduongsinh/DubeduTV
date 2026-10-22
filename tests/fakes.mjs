// Đồng hồ và video giả dùng chung cho test bộ đồng bộ.
export function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const add = (fn, ms, repeat) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + ms, ms, repeat });
    return id;
  };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    // Chạy các timer đến hạn theo thứ tự thời gian.
    advance(ms, onStep) {
      const end = now + ms;
      for (;;) {
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!due || timer.at < due[1].at))
            due = [id, timer];
        }
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        onStep?.(now);
        if (timer.repeat) timer.at += timer.ms;
        else timers.delete(id);
        timer.fn();
      }
      now = end;
      onStep?.(now);
    },
  };
}

export class FakeVideo extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.paused = false;
    this.seeking = false;
    this.ended = false;
    this.playbackRate = 1;
    this._volume = 1;
  }
  get volume() {
    return this._volume;
  }
  set volume(value) {
    this._volume = value;
    this.dispatchEvent(new Event("volumechange"));
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  play() {
    if (!this.paused) return Promise.resolve();
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
}

// Giọng đọc giả: ghi lại các câu, kết thúc khi test gọi finish().
export function fakeSpeech() {
  const calls = [];
  let pending = null;
  return {
    calls,
    stops: 0,
    speak(utterance) {
      return new Promise((resolve) => {
        pending?.resolve({ ok: false, event: "interrupted" });
        pending = { ...utterance, resolve };
        calls.push(utterance);
      });
    },
    stop() {
      this.stops += 1;
      pending?.resolve({ ok: false, event: "interrupted" });
      pending = null;
    },
    prefetch() {},
    async finish(result = { ok: true, event: "end", elapsed: 2 }) {
      const current = pending;
      pending = null;
      current.resolve(result);
      await Promise.resolve();
      await Promise.resolve();
    },
    get speaking() {
      return pending;
    },
  };
}
