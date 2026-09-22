/**
 * Render aset ikon FlowBoard dari satu sumber SVG.
 *
 * Sebelum ini, tiap ukuran ikon adalah file terpisah dan bisa (serta sudah)
 * berbeda isinya. Sumber tunggal berarti favicon, ikon PWA, dan logo header
 * tidak mungkin lagi menyimpang satu sama lain.
 *
 * Pakai:
 *   node scripts/build-icons.mjs
 *   node scripts/build-icons.mjs --check   (gagal kalau ada aset yang basi)
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const SRC = join(app, "public", "icon.svg");

// Ukuran yang dibutuhkan:
//  16/32  favicon tab browser
//  48     shortcut Windows
//  180    apple-touch-icon (iOS)
//  192/512 PWA manifest
//  256    di dalam .ico
const PNG_TARGETS = [
  { file: ["public", "icon-192.png"], size: 192 },
  { file: ["public", "icon-512.png"], size: 512 },
  { file: ["public", "apple-touch-icon.png"], size: 180 },
  { file: ["public", "icon-48.png"], size: 48 },
];

const ICO_TARGETS = [
  { file: ["public", "favicon.ico"], sizes: [16, 32, 48, 256] },
  { file: ["src", "app", "favicon.ico"], sizes: [16, 32, 48, 256] },
];

/** Bungkus beberapa PNG menjadi satu file .ico. */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = ikon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + count * 16;
  const blobs = [];
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 berarti 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palet
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit depth
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

async function render(svg, size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const check = process.argv.includes("--check");
const svg = await readFile(SRC);
const stale = [];

for (const t of PNG_TARGETS) {
  const p = join(app, ...t.file);
  const buf = await render(svg, t.size);
  if (check) {
    try {
      const cur = await readFile(p);
      if (!cur.equals(buf)) stale.push(t.file.join("/"));
    } catch {
      stale.push(t.file.join("/") + " (hilang)");
    }
  } else {
    await writeFile(p, buf);
    console.log(`  ${t.file.join("/")}  ${t.size}x${t.size}  ${buf.length} bytes`);
  }
}

for (const t of ICO_TARGETS) {
  const p = join(app, ...t.file);
  const parts = [];
  for (const s of t.sizes) parts.push({ size: s, buf: await render(svg, s) });
  const ico = buildIco(parts);
  if (check) {
    try {
      const cur = await readFile(p);
      if (!cur.equals(ico)) stale.push(t.file.join("/"));
    } catch {
      stale.push(t.file.join("/") + " (hilang)");
    }
  } else {
    await writeFile(p, ico);
    console.log(`  ${t.file.join("/")}  ${t.sizes.join("/")}  ${ico.length} bytes`);
  }
}

if (check) {
  if (stale.length) {
    console.error("Aset ikon basi (jalankan: node scripts/build-icons.mjs):");
    for (const s of stale) console.error("  " + s);
    process.exit(1);
  }
  console.log("OK: semua aset ikon sesuai dengan public/icon.svg");
}
