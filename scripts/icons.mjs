// Vẽ icon tiện ích (loa + sóng âm trên nền bo góc) và mã hoá PNG bằng Node
// thuần, để repo không phải chứa tệp nhị phân.
import { deflateSync } from "node:zlib";

const BACKGROUND_TOP = [20, 148, 136];
const BACKGROUND_BOTTOM = [12, 94, 88];
const FOREGROUND = [255, 255, 255];
const SAMPLES = 4;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    rows.push(
      Buffer.from([0]),
      rgba.subarray(y * size * 4, (y + 1) * size * 4),
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function insideSpeaker(x, y) {
  if (x >= 0.17 && x <= 0.33 && y >= 0.39 && y <= 0.61) return true;
  if (x < 0.33 || x > 0.53) return false;
  const halfHeight = 0.11 + ((x - 0.33) / 0.2) * 0.17;
  return Math.abs(y - 0.5) <= halfHeight;
}

function insideWaves(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  if (dx <= 0 || Math.abs(Math.atan2(dy, dx)) > 0.85) return false;
  const distance = Math.hypot(dx, dy);
  return (
    Math.abs(distance - 0.17) <= 0.035 || Math.abs(distance - 0.3) <= 0.035
  );
}

function pixel(x, y) {
  if (!insideRoundedSquare(x, y, 0.22)) return null;
  if (insideSpeaker(x, y) || insideWaves(x, y)) return FOREGROUND;
  return BACKGROUND_TOP.map((top, i) => top + (BACKGROUND_BOTTOM[i] - top) * y);
}

// Lấy mẫu SAMPLES×SAMPLES điểm trong một pixel để khử răng cưa.
function samplePixel(px, py, size) {
  const sum = [0, 0, 0, 0];
  for (let index = 0; index < SAMPLES * SAMPLES; index += 1) {
    const sx = index % SAMPLES;
    const sy = Math.floor(index / SAMPLES);
    const color = pixel(
      (px + (sx + 0.5) / SAMPLES) / size,
      (py + (sy + 0.5) / SAMPLES) / size,
    );
    if (!color) continue;
    sum[0] += color[0];
    sum[1] += color[1];
    sum[2] += color[2];
    sum[3] += 1;
  }
  return sum;
}

export function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const [red, green, blue, coverage] = samplePixel(px, py, size);
      if (coverage === 0) continue;
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(red / coverage);
      rgba[offset + 1] = Math.round(green / coverage);
      rgba[offset + 2] = Math.round(blue / coverage);
      rgba[offset + 3] = Math.round((255 * coverage) / (SAMPLES * SAMPLES));
    }
  }
  return encodePng(size, rgba);
}
