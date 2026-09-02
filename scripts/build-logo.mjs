/**
 * Derive the app's logo assets from the supplied master artwork.
 * Only fully transparent margin is removed — no text is cropped.
 */
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'D:/claude/TotalRenoTech-Social-Agent/brand-input/Logo no bg new fr tif@@1.25x.png';
const PLATE = { r: 11, g: 15, b: 20, alpha: 1 };   // the app's dark surface

const meta = await sharp(SRC).metadata();
console.log(`master: ${meta.width}x${meta.height}`);

// Find the bounding box of every pixel that is not fully transparent.
const SCAN = 1200;
const scale = meta.width / SCAN;
const { data, info } = await sharp(SRC)
  .resize(SCAN, null, { fit: 'inside' })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * info.channels + 3] !== 0) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log(`content box in scan space: ${minX},${minY} -> ${maxX},${maxY} of ${info.width}x${info.height}`);

// Map back to master pixels, with a small safety margin so no glyph edge or
// drop shadow is clipped.
const pad = 8;
const left = Math.max(0, Math.floor(minX * scale) - pad * 4);
const top = Math.max(0, Math.floor(minY * scale) - pad * 4);
const right = Math.min(meta.width, Math.ceil((maxX + 1) * scale) + pad * 4);
const bottom = Math.min(meta.height, Math.ceil((maxY + 1) * scale) + pad * 4);
const box = { left, top, width: right - left, height: bottom - top };
console.log('crop in master pixels:', JSON.stringify(box));
console.log(`removed margin: L${left} T${top} R${meta.width - right} B${meta.height - bottom}`);

const art = sharp(SRC).extract(box);
const artBuf = await art.png().toBuffer();

/** Transparent wordmark, full artwork, for the header. */
await sharp(artBuf).resize({ width: 1600 }).png({ compressionLevel: 9 })
  .toFile('public/brand/trt-logo.png');

/** The same artwork on the dark plate the white type needs for contrast. */
async function plated(size, out, inset) {
  const inner = Math.round(size * inset);
  const fitted = await sharp(artBuf).resize({ width: inner, height: inner, fit: 'inside' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: PLATE } })
    .composite([{ input: fitted, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}
await plated(512, 'public/brand/icon-512.png', 0.86);
await plated(192, 'public/brand/icon-192.png', 0.86);
await plated(180, 'public/brand/apple-touch-icon.png', 0.86);

/** Wide plated lockup — social cards, print headers, the login screen. */
{
  const w = 1200, h = 630;
  const fitted = await sharp(artBuf).resize({ width: Math.round(w * 0.72), height: Math.round(h * 0.72), fit: 'inside' }).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: PLATE } })
    .composite([{ input: fitted, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile('public/brand/trt-logo-plate.png');
}

fs.rmSync('public/brand/trt-logo-raw.png', { force: true });

for (const f of fs.readdirSync('public/brand')) {
  const m = await sharp(`public/brand/${f}`).metadata();
  console.log(`  ${f}  ${m.width}x${m.height}  ${(fs.statSync(`public/brand/${f}`).size / 1024).toFixed(0)}KB`);
}
