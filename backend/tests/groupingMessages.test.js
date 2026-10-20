const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const Alert = require('../src/models/Alert');
const Message = require('../src/models/Message');
const calls = require('../src/services/callSignaling');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  ingestPayload,
  connectSocket,
  waitForEvent,
  DROWSY_SIGNALS,
  WARNING_SIGNALS,
} = require('./helpers');

let stack;
const open = [];
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack.stop());
beforeEach(async () => {
  calls.resetCalls();
  await stack.reset();
});
afterEach(() => {
  jest.restoreAllMocks();
  while (open.length) open.pop().close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const ingest = (driverId, signals) =>
  request(stack.app)
    .post('/api/ingest')
    .set('x-api-key', API_KEY)
    .send(ingestPayload(driverId, signals));

function connectDevice(driverId) {
  return new Promise((resolve, reject) => {
    const s = ioClient(stack.url, {
      auth: { deviceKey: API_KEY, driverId: String(driverId) },
      transports: ['websocket'],
      reconnection: false,
    });
    open.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

describe('repeated detections are grouped into one alert', () => {
  test('detected again -> same alert, count goes up, moves to the top, escalates, unread again', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const sock = await connectSocket(stack.url, parent.token);
    open.push(sock);
    const t0 = Date.now();
    const at = (ms) => jest.spyOn(Date, 'now').mockReturnValue(t0 + ms);

    at(0);
    const first = await ingest(driver._id, WARNING_SIGNALS).expect(200);
    await request(stack.app)
      .patch(`/api/alerts/${first.body.alertId}/read`)
      .set(auth(parent.token))
      .send({});

    at(60 * 1000); // past the 15 s cooldown, inside the 10-minute group window
    const repeated = waitForEvent(sock, 'alert:repeated');
    const second = await ingest(driver._id, DROWSY_SIGNALS).expect(200);
    expect(second.body).toMatchObject({ alertTriggered: true, alertId: first.body.alertId });
    const ev = await repeated;
    expect(ev).toMatchObject({
      id: first.body.alertId,
      repeatCount: 2,
      escalated: true,
      read: false,
    });

    const stored = await Alert.findById(first.body.alertId);
    expect(stored.type).toMatch(/drowsy|microsleep/); // upgraded from "warning"
    expect(await Alert.countDocuments()).toBe(1);

    // acknowledged -> the next detection is a new incident
    jest.restoreAllMocks();
    await request(stack.app)
      .patch(`/api/alerts/${first.body.alertId}/ack`)
      .set(auth(parent.token))
      .send({});
    at(2 * 60 * 1000);
    const third = await ingest(driver._id, DROWSY_SIGNALS).expect(200);
    expect(third.body.alertId).not.toBe(first.body.alertId);
    expect(await Alert.countDocuments()).toBe(2);
  });

  test('outside the 10-minute window a new alert is created', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const t0 = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    const a = await ingest(driver._id, DROWSY_SIGNALS).expect(200);
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 11 * 60 * 1000);
    const b = await ingest(driver._id, DROWSY_SIGNALS).expect(200);
    expect(b.body.alertId).not.toBe(a.body.alertId);
  });
});

describe('messages from the parent to the car', () => {
  test('delivered at once when the car is online; the parent sees "delivered"', async () => {
    const parent = await registerParent(stack.app, { name: 'Maria Galang' });
    const driver = await createDriver(parent.user.id);
    const sock = await connectSocket(stack.url, parent.token);
    open.push(sock);
    const car = await connectDevice(driver._id);

    const atCar = waitForEvent(car, 'driver:message');
    const sent = await request(stack.app)
      .post(`/api/drivers/${driver._id}/messages`)
      .set(auth(parent.token))
      .send({ text: 'Please take a break at the next stop', kind: 'reminder' })
      .expect(201);
    expect(sent.body).toMatchObject({
      carOnline: true,
      message: { status: 'pending', kind: 'reminder' },
    });
    const m = await atCar;
    expect(m).toMatchObject({
      text: 'Please take a break at the next stop',
      fromName: 'Maria Galang',
    });

    const delivered = waitForEvent(sock, 'message:delivered');
    car.emit('message:delivered', { id: m.id });
    expect(await delivered).toMatchObject({ id: m.id, status: 'delivered' });
    const list = await request(stack.app)
      .get(`/api/drivers/${driver._id}/messages`)
      .set(auth(parent.token));
    expect(list.body.messages[0]).toMatchObject({ status: 'delivered' });
  });

  test('waits while the car is offline and is delivered when it connects; old ones expire', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const old = await Message.create({
      driverId: driver._id,
      parentId: parent.user.id,
      text: 'old',
    });
    await Message.collection.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date(Date.now() - 3 * 3600e3) } },
    );
    const r = await request(stack.app)
      .post(`/api/drivers/${driver._id}/messages`)
      .set(auth(parent.token))
      .send({ text: 'Call me when you arrive' })
      .expect(201);
    expect(r.body.carOnline).toBe(false);

    const carPromise = connectDevice(driver._id);
    const car = await carPromise;
    const m = await waitForEvent(car, 'driver:message');
    expect(m.text).toBe('Call me when you arrive');
    expect((await Message.findById(old._id)).status).toBe('expired');
  });

  test("another family can't message someone else's car", async () => {
    const ana = await registerParent(stack.app);
    const ben = await registerParent(stack.app);
    const bens = await createDriver(ben.user.id);
    await request(stack.app)
      .post(`/api/drivers/${bens._id}/messages`)
      .set(auth(ana.token))
      .send({ text: 'hi' })
      .expect(404);
  });
});
