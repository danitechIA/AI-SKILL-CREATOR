import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'build');
const ICO_FILE = path.join(OUT_DIR, 'icon.ico');
const PNG_FILE = path.join(OUT_DIR, 'icon.png');

const PRIMARY = [79, 110, 247];
const ACCENT = [139, 92, 246];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function roundedSquare(px, py, size, radius) {
  const cx = px - size / 2;
  const cy = py - size / 2;
  const half = size / 2 - radius;
  if (Math.abs(cx) > half && Math.abs(cy) > half) {
    const dx = Math.abs(cx) - half;
    const dy = Math.abs(cy) - half;
    return dx * dx + dy * dy <= radius * radius;
  }
  return true;
}

function getPixel(x, y, size) {
  if (!roundedSquare(x, y, size, size * 0.22)) {
    return [0, 0, 0, 0];
  }

  const gradient = (x + y) / (size * 2);
  const r = lerp(PRIMARY[0], ACCENT[0], gradient);
  const g = lerp(PRIMARY[1], ACCENT[1], gradient);
  const b = lerp(PRIMARY[2], ACCENT[2], gradient);

  const cx = x - size / 2;
  const cy = y - size / 2;
  const dist = Math.sqrt(cx * cx + cy * cy);
  const centerR = size * 0.15;
  const spokeR = size * 0.35;

  if (dist < centerR) return [255, 255, 255, 255];

  const dotSize = size * 0.04;
  const angles = [0, 1.047, 2.094, 3.142, 4.189, 5.236];
  for (const angle of angles) {
    const sx = Math.cos(angle) * spokeR;
    const sy = Math.sin(angle) * spokeR;
    const dx = cx - sx;
    const dy = cy - sy;
    if (Math.sqrt(dx * dx + dy * dy) < dotSize) return [255, 255, 255, 255];
    const distToLine = Math.abs((sy * cx - sx * cy) / Math.sqrt(sx * sx + sy * sy));
    if (distToLine < 0.03 * size && dist < spokeR + centerR) return [255, 255, 255, 180];
  }

  return [b, g, r, 255];
}

function createBMPData(size) {
  const rowBytes = size * 4;
  const pixelData = Buffer.alloc(size * rowBytes, 0);
  for (let y = 0; y < size; y++) {
    const vy = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const [b, g, r, a] = getPixel(x, vy, size);
      const off = y * rowBytes + x * 4;
      pixelData[off] = b;
      pixelData[off + 1] = g;
      pixelData[off + 2] = r;
      pixelData[off + 3] = a;
    }
  }

  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeUInt32LE(size, 4);
  info.writeUInt32LE(size * 2, 8);
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(32, 14);
  info.writeUInt32LE(0, 16);
  info.writeUInt32LE(size * rowBytes, 20);
  info.writeInt32LE(0, 24);
  info.writeInt32LE(0, 28);
  info.writeUInt32LE(0, 32);
  info.writeUInt32LE(0, 36);

  return Buffer.concat([info, pixelData]);
}

function createPNGData(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1), 0);
  for (let y = 0; y < size; y++) {
    const rowOff = y * (size * 4 + 1);
    raw[rowOff] = 0;
    for (let x = 0; x < size; x++) {
      const [b, g, r, a] = getPixel(x, y, size);
      const off = rowOff + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const deflated = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = createIHDR(size);
  const idat = createChunk('IDAT', deflated);
  const iend = createChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function createIHDR(size) {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(size, 0);
  buf.writeUInt32BE(size, 4);
  buf[8] = 8;
  buf[9] = 6;
  buf[10] = 0;
  buf[11] = 0;
  buf[12] = 0;
  return createChunk('IHDR', buf);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcD = Buffer.concat([typeB, data]);
  const crc = crc32(crcD);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = [
    { w: 16, h: 16, data: createBMPData(16) },
    { w: 24, h: 24, data: createBMPData(24) },
    { w: 32, h: 32, data: createBMPData(32) },
    { w: 48, h: 48, data: createBMPData(48) },
    { w: 256, h: 256, data: createPNGData(256) },
  ];

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dirs = entries.map((e) => {
    const d = Buffer.alloc(16);
    d[0] = e.w >= 256 ? 0 : e.w;
    d[1] = e.h >= 256 ? 0 : e.h;
    d[2] = 0;
    d[3] = 0;
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.data.length;
    return d;
  });

  const ico = Buffer.concat([header, ...dirs, ...entries.map(e => e.data)]);
  fs.writeFileSync(ICO_FILE, ico);
  console.log(`ICO generated: ${ICO_FILE} (${ico.length}, ${entries.length} resolutions)`);

  const pngData = createPNGData(512);
  fs.writeFileSync(PNG_FILE, pngData);
  console.log(`PNG generated: ${PNG_FILE} (${pngData.length})`);
}

main();
