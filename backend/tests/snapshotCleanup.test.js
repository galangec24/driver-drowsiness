/**
 * Alert photos are deleted with their alert: removing an alert in the apps deletes its photo, and
 * the clean-up deletes photos whose alert is gone (e.g. deleted in the database). Local storage
 * (backend/uploads) here; Cloudinary uses the same functions in production.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const Alert = require('../src/models/Alert');
const media = require('../src/services/mediaStorage');
const { cleanupOrphanSnapshots } = require('../src/services/snapshotCleanup');
const { startStack, registerParent, createDriver } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const photoPath = (driverId, alertId) =>
  path.join(media.UPLOAD_DIR, 'alerts', String(driverId), `${alertId}.jpg`);

async function alertWithPhoto(driver) {
  const alert = await Alert.create({
    driverId: driver._id,
    parentId: driver.parentId,
    type: 'drowsy',
    confidence: 0.9,
  });
  alert.snapshotUrl = await media.storeAlertSnapshot(
    String(driver._id),
    String(alert._id),
    JPEG,
    'jpeg',
  );
  await alert.save();
  return alert;
}

afterEach(() => {
  fs.rmSync(path.join(media.UPLOAD_DIR, 'alerts'), { recursive: true, force: true });
});

test('removing an alert in the app deletes its photo (the hidden record stays)', async () => {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id);
  const keep = await alertWithPhoto(driver);
  const gone = await alertWithPhoto(driver);
  expect(fs.existsSync(photoPath(driver._id, gone._id))).toBe(true);

  await request(stack.app).delete(`/api/alerts/${gone._id}`).set(auth(parent.token)).expect(200);

  await new Promise((r) => setTimeout(r, 200)); // deleted in the background
  expect(fs.existsSync(photoPath(driver._id, gone._id))).toBe(false);
  const hidden = await Alert.findById(gone._id).lean();
  expect(hidden.removedAt).toBeInstanceOf(Date);
  expect(hidden.snapshotUrl).toBeUndefined();
  expect(fs.existsSync(photoPath(driver._id, keep._id))).toBe(true);
});

test('the clean-up deletes photos whose alert was deleted or removed, and keeps the rest', async () => {
  const parent = await registerParent(stack.app);
  const driver = await createDriver(parent.user.id);
  const live = await alertWithPhoto(driver);
  const deleted = await alertWithPhoto(driver);
  const removed = await alertWithPhoto(driver);
  await Alert.deleteOne({ _id: deleted._id }); // like deleting alerts straight in the database
  await Alert.updateOne({ _id: removed._id }, { removedAt: new Date() });

  expect(await cleanupOrphanSnapshots()).toBe(2);
  expect(fs.existsSync(photoPath(driver._id, live._id))).toBe(true);
  expect(fs.existsSync(photoPath(driver._id, deleted._id))).toBe(false);
  expect(fs.existsSync(photoPath(driver._id, removed._id))).toBe(false);
  expect(await cleanupOrphanSnapshots()).toBe(0); // nothing left to do
});
