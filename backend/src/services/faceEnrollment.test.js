const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const {
  analyzePhoto,
  enrollPhotos,
  scoreQuality,
  averageDescriptors,
} = require('./faceEnrollment');
const { euclidean } = require('./faceMatcher');
const { decodeImage, base64ToBuffer, regionQuality } = require('./imageDecoder');
const { loadFaceModels } = require('../config/faceApi');

const FIXTURES = path.resolve(__dirname, '../../tests/fixtures');
const b64 = (name) => fs.readFileSync(path.join(FIXTURES, name)).toString('base64');

function solidPng(w, h, value) {
  const png = new PNG({ width: w, height: h });
  png.data.fill(value);
  return PNG.sync.write(png);
}

describe('scoreQuality (pure)', () => {
  const good = { detectionScore: 0.99, sharpness: 200, brightness: 120, faceRatio: 0.4 };

  test('good capture scores high with no issues', () => {
    const r = scoreQuality(good);
    expect(r.issues).toEqual([]);
    expect(r.quality).toBeGreaterThan(0.9);
  });

  test.each([
    [{ sharpness: 5 }, 'blurry'],
    [{ brightness: 20 }, 'too_dark'],
    [{ brightness: 250 }, 'too_bright'],
    [{ faceRatio: 0.05 }, 'face_too_small'],
  ])('%o → %s and lower quality', (override, issue) => {
    const r = scoreQuality({ ...good, ...override });
    expect(r.issues).toContain(issue);
    expect(r.quality).toBeLessThan(scoreQuality(good).quality);
  });
});

describe('averageDescriptors (pure)', () => {
  test('averaging identical vectors returns the same vector', () => {
    const v = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 8);
    const avg = averageDescriptors([v, v, v]);
    expect(euclidean(avg, v)).toBeLessThan(1e-9);
  });

  test('empty input returns empty', () => {
    expect(averageDescriptors([])).toEqual([]);
  });
});

describe('imageDecoder', () => {
  test('decodes PNG and data-URL base64', () => {
    const buf = solidPng(40, 30, 100);
    const img = decodeImage(base64ToBuffer(`data:image/png;base64,${buf.toString('base64')}`));
    expect(img).toMatchObject({ width: 40, height: 30, format: 'png' });
    expect(img.rgb).toHaveLength(40 * 30 * 3);
  });

  test('flat image has ~zero sharpness', () => {
    const img = decodeImage(solidPng(50, 50, 128));
    expect(regionQuality(img.gray, img.width, img.height, null).sharpness).toBeLessThan(1e-6);
  });

  test('rejects unsupported formats and empty input', () => {
    expect(() => decodeImage(Buffer.from('GIF89a........'))).toThrow(/Unsupported/);
    expect(() => base64ToBuffer('')).toThrow();
  });

  test('downscales large images to max 1024 px', () => {
    const img = decodeImage(solidPng(2048, 1024, 50));
    expect(img.width).toBe(1024);
    expect(img.height).toBe(512);
  });
});

describe('face pipeline (server-side models)', () => {
  beforeAll(async () => {
    await loadFaceModels();
  }, 120000);

  test('analyzePhoto returns a 128-d descriptor and quality', async () => {
    const r = await analyzePhoto(b64('personA_front.jpg'));
    expect(r.descriptor).toHaveLength(128);
    expect(r.faces).toBe(1);
    expect(r.quality).toBeGreaterThan(0);
    expect(r.quality).toBeLessThanOrEqual(1);
  });

  test('analyzePhoto throws 422 when no face is present', async () => {
    await expect(analyzePhoto(solidPng(200, 200, 200).toString('base64'))).rejects.toMatchObject({
      status: 422,
    });
  });

  test('enrollPhotos averages 3 angles of the same person', async () => {
    const r = await enrollPhotos(['front', 'left', 'right'].map((a) => b64(`personA_${a}.jpg`)));
    expect(r.embedding).toHaveLength(128);
    expect(r.photos).toHaveLength(3);
    const probe = await analyzePhoto(b64('personA_front.jpg'));
    const stranger = await analyzePhoto(b64('personB_front.jpg'));
    expect(euclidean(r.embedding, probe.descriptor)).toBeLessThan(
      euclidean(r.embedding, stranger.descriptor),
    );
  });

  test('enrollPhotos rejects mixed identities and empty input', async () => {
    await expect(
      enrollPhotos([b64('personA_front.jpg'), b64('personB_front.jpg')]),
    ).rejects.toMatchObject({
      status: 422,
    });
    await expect(enrollPhotos([])).rejects.toMatchObject({ status: 400 });
  });
});
