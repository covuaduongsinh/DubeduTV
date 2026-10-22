// Đóng gói tiện ích: chép src/ → dist/long-tieng-viet/, sinh icon PNG và tạo
// tệp zip sẵn sàng "Load unpacked" hoặc nộp Chrome Web Store.
//   node scripts/build.mjs          bản phát hành
//   node scripts/build.mjs --test   bản kiểm thử e2e (thêm trang 127.0.0.1)
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { crc32, drawIcon } from "./icons.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isTest = process.argv.includes("--test");
const name = isTest ? "long-tieng-viet-test" : "long-tieng-viet";
const outDir = join(root, "dist", name);
const ICON_SIZES = [16, 32, 48, 128];
const TEST_ORIGIN = "http://127.0.0.1/*";
const DOS_DATE = (1 << 5) | 1; // 1980-01-01

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

// Zip tối giản (deflate, không mã hoá) đủ cho Chrome và Windows Explorer.
function createZip(files, baseDir, prefix) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = Buffer.from(
      `${prefix}/${relative(baseDir, file).split(sep).join("/")}`,
      "utf8",
    );
    const data = readFileSync(file);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // tên tệp UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function patchForTests(manifest) {
  manifest.name = `${manifest.name} (test)`;
  // localhost đóng vai CDN khác origin (như udemycdn) để thử đường tải qua service worker.
  manifest.host_permissions.push(TEST_ORIGIN, "http://localhost/*");
  for (const script of manifest.content_scripts) {
    script.matches.push(TEST_ORIGIN);
    if (script.world !== "MAIN") {
      script.js.splice(
        script.js.indexOf("content/main.js"),
        0,
        "test/test-overrides.js",
      );
    }
  }
  return manifest;
}

function build() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(join(root, "src"), outDir, { recursive: true });
  mkdirSync(join(outDir, "icons"), { recursive: true });
  for (const size of ICON_SIZES)
    writeFileSync(join(outDir, "icons", `icon${size}.png`), drawIcon(size));
  const manifestPath = join(outDir, "manifest.json");
  let manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (isTest) {
    mkdirSync(join(outDir, "test"), { recursive: true });
    cpSync(
      join(root, "tests", "e2e", "test-overrides.js"),
      join(outDir, "test", "test-overrides.js"),
    );
    manifest = patchForTests(manifest);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const files = listFiles(outDir).sort();
  const zipPath = join(root, "dist", `${name}-v${manifest.version}.zip`);
  writeFileSync(zipPath, createZip(files, outDir, name));
  console.log(
    `Đã tạo ${relative(root, outDir)} (${files.length} tệp) và ${relative(root, zipPath)}`,
  );
}

build();
