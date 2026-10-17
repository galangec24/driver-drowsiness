const request = require('supertest');
const Alert = require('../src/models/Alert');
const { API_KEY, startStack, registerParent, createDriver, ingestPayload } = require('./helpers');

let stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => stack.reset());

const ingest = (body) =>
  request(stack.app).post('/api/ingest').set('x-api-key', API_KEY).send(body);
const AWAKE = { ear: 0.3, perclos: 0.03, heartRate: 72 };

describe('distraction (eyes off the road / restless movement)', () => {
  test('repeated episodes alert the parent once, then respect the cooldown', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    await ingest(ingestPayload(driver._id, { ...AWAKE, distractionCount: 1 })).expect(200);
    expect(await Alert.countDocuments()).toBe(0); // one glance away is not an alert

    const r = await ingest(ingestPayload(driver._id, { ...AWAKE, distractionCount: 2 })).expect(
      200,
    );
    expect(r.body.alertTriggered).toBe(true);
    expect((await Alert.findById(r.body.alertId)).type).toBe('distraction');

    await ingest(ingestPayload(driver._id, { ...AWAKE, distractionCount: 3 })).expect(200);
    expect(await Alert.countDocuments({ type: 'distraction' })).toBe(1); // 2-minute cooldown
  });

  test('drowsiness wins over distraction', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const r = await ingest(
      ingestPayload(driver._id, { ear: 0.08, perclos: 0.85, heartRate: 50, distractionCount: 4 }),
    ).expect(200);
    expect(['drowsy', 'microsleep']).toContain((await Alert.findById(r.body.alertId)).type);
  });
});

describe('observed alerts (nodding / yawning / distraction) are not repeated without new events', () => {
  afterEach(() => jest.restoreAllMocks());

  test('the same 2 nods alert once; only a new nod alerts again; confidence is the nod evidence', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const t0 = Date.now();
    const at = (ms) => jest.spyOn(Date, 'now').mockReturnValue(t0 + ms);

    at(0);
    const first = await ingest(ingestPayload(driver._id, { ...AWAKE, nodCount: 2 })).expect(200);
    const alert = await Alert.findById(first.body.alertId);
    expect(alert.type).toBe('nodding');
    expect(alert.confidence).toBe(1); // 2 nods = full evidence, not the 30% fused score

    at(2 * 60 * 1000); // past the cooldown, but still the same 2 nods in the 5-minute window
    const again = await ingest(ingestPayload(driver._id, { ...AWAKE, nodCount: 2 })).expect(200);
    expect(again.body.alertTriggered).toBe(false);

    at(2 * 60 * 1000 + 1000); // a third nod
    const more = await ingest(ingestPayload(driver._id, { ...AWAKE, nodCount: 3 })).expect(200);
    expect(more.body.alertTriggered).toBe(true);
    expect(await Alert.countDocuments({ type: 'nodding' })).toBe(2);
  });
});
