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

module.exports = {
  storeReferencePhoto,
  removeReferencePhoto,
  storeAlertSnapshot,
  removeAlertSnapshots,
  UPLOAD_DIR,
};
