const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const HttpError = require('../utils/httpError');

const MAX_SIDE = 1024;
const MAX_BYTES = 8 * 1024 * 1024;

/** Accepts a data URL or raw base64; returns a Buffer. */
function base64ToBuffer(input) {
  if (typeof input !== 'string' || !input.length) throw new HttpError(400, 'Photo must be base64');
  const comma = input.startsWith('data:') ? input.indexOf(',') : -1;
  const buf = Buffer.from(comma >= 0 ? input.slice(comma + 1) : input, 'base64');
  if (!buf.length) throw new HttpError(400, 'Photo is empty');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'Photo exceeds 8 MB');
  return buf;
}

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  return null;
}

/** Nearest-neighbour downscale of RGBA pixels so the longest side is <= MAX_SIDE. */
function downscale(data, width, height) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (scale === 1) return { data, width, height };
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const si = (sy * width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Decode JPEG/PNG into { rgb: Uint8Array (HxWx3), gray: Float32Array, width, height, buffer, format }.
 */
function decodeImage(buffer) {
  const format = sniff(buffer);
  let decoded;
  try {
    if (format === 'jpeg') {
      decoded = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 512 });
    } else if (format === 'png') {
      decoded = PNG.sync.read(buffer);
    } else {
      throw new HttpError(415, 'Unsupported image format (use JPEG or PNG)');
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Could not decode image');
  }

  const { data, width, height } = downscale(decoded.data, decoded.width, decoded.height);
  const n = width * height;
  const rgb = new Uint8Array(n * 3);
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { rgb, gray, width, height, buffer, format };
}

/**
 * Image quality inside a box: sharpness = variance of the Laplacian, brightness = mean luma.
 */
function regionQuality(gray, width, height, box) {
  const x0 = Math.max(1, Math.floor(box ? box.x : 0));
  const y0 = Math.max(1, Math.floor(box ? box.y : 0));
  const x1 = Math.min(width - 2, Math.ceil(box ? box.x + box.width : width));
  const y1 = Math.min(height - 2, Math.ceil(box ? box.y + box.height : height));
  let sum = 0;
  let sumSq = 0;
  let lumSum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = y * width + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      lumSum += gray[i];
      n += 1;
    }
  }
  if (!n) return { sharpness: 0, brightness: 0 };
  const mean = sum / n;
  return { sharpness: sumSq / n - mean * mean, brightness: lumSum / n };
}

module.exports = { base64ToBuffer, decodeImage, regionQuality, sniff };
