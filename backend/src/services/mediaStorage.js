const fs = require('fs/promises');
const path = require('path');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');
const logger = require('../config/logger');

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

/**
 * Store a driver's reference photo. Cloudinary when configured (production);
 * otherwise backend/uploads/ served at /uploads (local dev). Returns the URL.
 */
async function storeReferencePhoto(driverId, buffer, format) {
  if (isCloudinaryConfigured()) {
    const dataUri = `data:image/${format};base64,${buffer.toString('base64')}`;
    const res = await cloudinary.uploader.upload(dataUri, {
      folder: 'guardian-drive/drivers',
      public_id: driverId,
      overwrite: true,
      resource_type: 'image',
    });
    return res.secure_url;
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const file = `${driverId}.${format === 'png' ? 'png' : 'jpg'}`;
  await fs.writeFile(path.join(UPLOAD_DIR, file), buffer);
  logger.debug({ file }, 'reference photo stored locally (Cloudinary not configured)');
  // Relative URL: clients prefix it with the API origin.
  return `/uploads/${file}`;
}

async function removeReferencePhoto(driverId) {
  if (isCloudinaryConfigured()) {
    await cloudinary.uploader.destroy(`guardian-drive/drivers/${driverId}`).catch(() => {});
    return;
  }
  for (const ext of ['jpg', 'png']) {
    await fs.rm(path.join(UPLOAD_DIR, `${driverId}.${ext}`), { force: true });
  }
}

/**
 * Store the camera frame captured when an alert fired. Grouped per driver so removing a driver
 * removes their snapshots too. Returns the URL (relative /uploads/... in local dev).
 */
async function storeAlertSnapshot(driverId, alertId, buffer, format) {
  if (isCloudinaryConfigured()) {
    const dataUri = `data:image/${format};base64,${buffer.toString('base64')}`;
    const res = await cloudinary.uploader.upload(dataUri, {
      folder: `guardian-drive/alerts/${driverId}`,
      public_id: alertId,
      overwrite: true,
      resource_type: 'image',
    });
    return res.secure_url;
  }

  const dir = path.join(UPLOAD_DIR, 'alerts', driverId);
  await fs.mkdir(dir, { recursive: true });
  const file = `${alertId}.${format === 'png' ? 'png' : 'jpg'}`;
  await fs.writeFile(path.join(dir, file), buffer);
  return `/uploads/alerts/${driverId}/${file}`;
}

async function removeAlertSnapshots(driverId) {
  if (isCloudinaryConfigured()) {
    await cloudinary.api
      .delete_resources_by_prefix(`guardian-drive/alerts/${driverId}/`)
      .catch(() => {});
    return;
  }
  await fs.rm(path.join(UPLOAD_DIR, 'alerts', driverId), { recursive: true, force: true });
}

const ALERT_PREFIX = 'guardian-drive/alerts/';

/** Delete one alert's snapshot (Cloudinary, or backend/uploads in local dev). Never throws. */
async function removeAlertSnapshot(driverId, alertId) {
  if (isCloudinaryConfigured()) {
    await cloudinary.uploader
      .destroy(`${ALERT_PREFIX}${driverId}/${alertId}`, {
        resource_type: 'image',
        invalidate: true,
      })
      .catch(() => {});
    return;
  }
  for (const ext of ['jpg', 'png']) {
    await fs.rm(path.join(UPLOAD_DIR, 'alerts', String(driverId), `${alertId}.${ext}`), {
      force: true,
    });
  }
}

/** Every stored alert snapshot as { driverId, alertId } (for the orphan clean-up). */
async function listAlertSnapshots() {
  const out = [];
  if (isCloudinaryConfigured()) {
    let cursor;
    do {
      const page = await cloudinary.api.resources({
        type: 'upload',
        resource_type: 'image',
        prefix: ALERT_PREFIX,
        max_results: 500,
        ...(cursor && { next_cursor: cursor }),
      });
      for (const r of page.resources || []) {
        const [driverId, alertId] = r.public_id.slice(ALERT_PREFIX.length).split('/');
        if (driverId && alertId) out.push({ driverId, alertId });
      }
      cursor = page.next_cursor;
    } while (cursor);
    return out;
  }
  const root = path.join(UPLOAD_DIR, 'alerts');
  const drivers = await fs.readdir(root).catch(() => []);
  for (const driverId of drivers) {
    const files = await fs.readdir(path.join(root, driverId)).catch(() => []);
    for (const f of files) out.push({ driverId, alertId: f.replace(/\.(jpg|png)$/, '') });
  }
  return out;
}

module.exports = {
  storeReferencePhoto,
  removeReferencePhoto,
  storeAlertSnapshot,
  removeAlertSnapshots,
  removeAlertSnapshot,
  listAlertSnapshots,
  UPLOAD_DIR,
};
