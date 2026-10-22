// Nạp các script dạng globalThis.LTV theo đúng thứ tự như manifest.
import "../src/shared/defaults.js";
import "../src/shared/tts-split.js";
import "../src/content/lib/util.js";
import "../src/content/lib/captions-parse.js";
import "../src/content/lib/segment.js";
import "../src/content/lib/timing.js";
import "../src/content/lib/tracks.js";
import "../src/content/dubber.js";
import "../src/content/lib/audio-chunker.js";
import "../src/content/providers/html5.js";
import "../src/content/asr/chrome-recognizer.js";
import "../src/content/live-dubber.js";

export const LTV = globalThis.LTV;
