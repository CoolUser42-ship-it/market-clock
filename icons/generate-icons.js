// One-off generator for the PWA icons (no image deps available in this env).
// Draws a simple clock-face mark in the Industry design system's accent colors
// and encodes raw RGBA pixels into a PNG by hand (IHDR/IDAT/IEND via zlib).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x1d, 0x2d, 0x3d];      // --color-accent-900
const RING = [0xb5, 0xd9, 0xfd];    // --color-accent-300
const HAND = [0xf2, 0xf2, 0xf3];    // --color-bg
const TICK = [0x59, 0x7e, 0xa3];    // --color-accent-600

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BG);

  const cx = size / 2, cy = size / 2;
  const rOuter = size * 0.36, ringW = size * 0.045;

  // corner registration marks, echoing the .blueprint corner motif
  const cLen = size * 0.09, cOff = size * 0.1, cW = Math.max(1, size * 0.012);
  const corners = [[cOff, cOff, 1, 1], [size - cOff, cOff, -1, 1], [cOff, size - cOff, 1, -1], [size - cOff, size - cOff, -1, -1]];
  corners.forEach(([px0, py0, dx, dy]) => {
    for (let t = 0; t < cLen; t++) {
      for (let w = 0; w < cW; w++) {
        set(Math.round(px0 + dx * t), Math.round(py0 + w * dy) - Math.round(cW / 2) + Math.round(w), TICK);
        set(Math.round(px0 + w * dx) - Math.round(cW / 2) + Math.round(w), Math.round(py0 + dy * t), TICK);
      }
    }
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= rOuter && d >= rOuter - ringW) set(x, y, RING);
    }
  }
  // hour ticks
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
    const r1 = rOuter - ringW * 2.6, r2 = rOuter - ringW * 0.6;
    const steps = Math.ceil(r2 - r1) * 2;
    for (let s = 0; s <= steps; s++) {
      const r = r1 + (r2 - r1) * (s / steps);
      set(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), RING);
    }
  }
  // hands: hour hand toward 10, minute hand toward 2 (a bit past noon)
  const drawHand = (angle, len, w) => {
    const steps = Math.ceil(len) * 2;
    for (let s = 0; s <= steps; s++) {
      const r = len * (s / steps);
      const hx = cx + Math.cos(angle) * r, hy = cy + Math.sin(angle) * r;
      for (let ox = -w; ox <= w; ox++) for (let oy = -w; oy <= w; oy++) {
        if (ox * ox + oy * oy <= w * w) set(Math.round(hx + ox), Math.round(hy + oy), HAND);
      }
    }
  };
  drawHand(-Math.PI / 2 - Math.PI / 3, rOuter * 0.5, Math.max(1, size * 0.018));
  drawHand(-Math.PI / 2 + Math.PI / 3, rOuter * 0.72, Math.max(1, size * 0.014));
  // center pin
  const pinR = Math.max(1.5, size * 0.02);
  for (let y = -pinR; y <= pinR; y++) for (let x = -pinR; x <= pinR; x++) {
    if (x * x + y * y <= pinR * pinR) set(Math.round(cx + x), Math.round(cy + y), RING);
  }

  return px;
}

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(px, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = __dirname;
for (const size of [180, 192, 512]) {
  const px = drawIcon(size);
  const png = encodePNG(px, size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log('wrote icon-' + size + '.png', png.length, 'bytes');
}
