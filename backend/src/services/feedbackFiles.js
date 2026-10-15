/**
 * Attachments sent with feedback (screenshots, PDFs, logs). The file content decides the type
 * (never the name the client claims), so nothing executable or disguised gets stored.
 */
const fs = require('fs/promises');
const path = require('path');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');
const { UPLOAD_DIR } = require('./mediaStorage');
const HttpError = require('../utils/httpError');

const MAX_FILES = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** Detect the real type from the first bytes. Returns {mime, ext, image} or null. */
function detectType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg', image: true };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', ext: 'png', image: true };
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp', image: true };
  }
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) {
    return { mime: 'image/gif', ext: 'gif', image: true };
  }
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf', image: false };
  }
  // Plain text (logs, .txt, .csv, .json): valid UTF-8 without binary control bytes.
  const binary = buf.some((b) => b < 0x09 || (b > 0x0d && b < 0x20));
  if (!binary && !buf.toString('utf8').includes('�')) {
    return { mime: 'text/plain', ext: 'txt', image: false };
  }
  return null;
}

function safeName(name, ext) {
  const base =
    String(name || 'file')
      .replace(/\.[^.]*$/, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^[-.]+/, '')
      .slice(0, 60) || 'file';
  return `${base}.${ext}`;
}

/** base64 / data URL → Buffer. */
function decode(data) {
  const b64 = String(data).replace(/^data:[^;,]+;base64,/, '');
  return Buffer.from(b64, 'base64');
}

/**
 * Validate every attachment first (all-or-nothing), then store them.
 * @param {{name:string, data:string}[]} files
 * @returns {Promise<{url, name, mime, size}[]>}
 */
async function storeFeedbackFiles(feedbackId, files = []) {
  if (files.length > MAX_FILES) throw new HttpError(400, `At most ${MAX_FILES} attachments`);
  const decoded = files.map((f, i) => {
    const buf = decode(f.data);
    if (!buf.length) throw new HttpError(400, `Attachment ${i + 1} is empty`);
    if (buf.length > MAX_FILE_BYTES)
      throw new HttpError(413, `Attachment ${i + 1} is larger than 5 MB`);
    const type = detectType(buf);
    if (!type) {
      throw new HttpError(
        415,
        `Attachment ${i + 1}: only images (PNG, JPG, WebP, GIF), PDF or text files`,
      );
    }
    return { buf, type, name: safeName(f.name, type.ext) };
  });
  const total = decoded.reduce((n, d) => n + d.buf.length, 0);
  if (total > MAX_TOTAL_BYTES)
    throw new HttpError(413, 'Attachments are larger than 10 MB in total');

  const stored = [];
  for (const [i, d] of decoded.entries()) {
    const id = `${i + 1}-${d.name}`;
    let url;
    if (isCloudinaryConfigured()) {
      const res = await cloudinary.uploader.upload(
        `data:${d.type.mime};base64,${d.buf.toString('base64')}`,
        {
          folder: `guardian-drive/feedback/${feedbackId}`,
          public_id: d.type.image ? id.replace(/\.[^.]+$/, '') : id,
          resource_type: d.type.image ? 'image' : 'raw',
          overwrite: true,
        },
      );
      url = res.secure_url;
    } else {
      const dir = path.join(UPLOAD_DIR, 'feedback', String(feedbackId));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, id), d.buf);
      url = `/uploads/feedback/${feedbackId}/${id}`;
    }
    stored.push({ url, name: d.name, mime: d.type.mime, size: d.buf.length });
  }
  return stored;
}

module.exports = { storeFeedbackFiles, detectType, MAX_FILES, MAX_FILE_BYTES };
