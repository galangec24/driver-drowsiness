const { io: ioClient } = require('socket.io-client');
const {
  API_KEY,
  startStack,
  registerParent,
  createDriver,
  connectSocket,
  waitForEvent,
} = require('./helpers');
const calls = require('../src/services/callSignaling');

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
  while (open.length) open.pop().close();
});

function connectDevice(driverId, key = API_KEY) {
  return new Promise((resolve, reject) => {
    const s = ioClient(stack.url, {
      auth: { deviceKey: key, driverId: String(driverId) },
      transports: ['websocket'],
      reconnection: false,
    });
    open.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
async function parentSocket(token) {
  const s = await connectSocket(stack.url, token);
  open.push(s);
  return s;
}
const emitAck = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));

describe('parent -> in-car device calls', () => {
  test('a device needs the ingest key and a real driver', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    await expect(connectDevice(driver._id, 'wrong-key')).rejects.toThrow(/unauthorized/);
    await expect(connectDevice('000000000000000000000000')).rejects.toThrow(/unauthorized/);
    await expect(connectDevice(driver._id)).resolves.toBeTruthy();
  });

  test('ring, auto-answer, relay the offer / answer / ICE, hang up', async () => {
    const parent = await registerParent(stack.app, { name: 'Maria Galang' });
    const driver = await createDriver(parent.user.id);
    const p = await parentSocket(parent.token);

    // device not connected yet
    expect(await emitAck(p, 'call:start', { driverId: String(driver._id) })).toEqual({
      ok: false,
      error: 'offline',
    });

    const d = await connectDevice(driver._id);
    const incoming = waitForEvent(d, 'call:incoming');
    const started = await emitAck(p, 'call:start', { driverId: String(driver._id) });
    expect(started).toMatchObject({ ok: true, driverName: expect.any(String) });
    expect(started.iceServers[0].urls[0]).toMatch(/^stun:/);
    const ring = await incoming;
    expect(ring).toMatchObject({ callId: started.callId, callerName: 'Maria Galang' });

    // only one call at a time per driver
    expect(await emitAck(p, 'call:start', { driverId: String(driver._id) })).toEqual({
      ok: false,
      error: 'busy',
    });

    const accepted = waitForEvent(p, 'call:accepted');
    d.emit('call:accept', { callId: ring.callId });
    await accepted;

    const atDevice = waitForEvent(d, 'call:signal');
    p.emit('call:signal', { callId: ring.callId, data: { type: 'offer', sdp: 'v=0 parent' } });
    expect((await atDevice).data).toEqual({ type: 'offer', sdp: 'v=0 parent' });
    const atParent = waitForEvent(p, 'call:signal');
    d.emit('call:signal', { callId: ring.callId, data: { type: 'answer', sdp: 'v=0 car' } });
    expect((await atParent).data).toEqual({ type: 'answer', sdp: 'v=0 car' });

    const ended = waitForEvent(d, 'call:ended');
    p.emit('call:end', { callId: ring.callId });
    expect(await ended).toEqual({ callId: ring.callId, reason: 'hangup' });
  });

  test("a parent can't call another family's driver, and a declined call ends for the caller", async () => {
    const ana = await registerParent(stack.app);
    const ben = await registerParent(stack.app);
    const bensDriver = await createDriver(ben.user.id);
    await connectDevice(bensDriver._id);
    const a = await parentSocket(ana.token);
    expect(await emitAck(a, 'call:start', { driverId: String(bensDriver._id) })).toEqual({
      ok: false,
      error: 'not_found',
    });

    const b = await parentSocket(ben.token);
    const d = open[0];
    const ring = waitForEvent(d, 'call:incoming');
    await emitAck(b, 'call:start', { driverId: String(bensDriver._id) });
    const { callId } = await ring;
    const ended = waitForEvent(b, 'call:ended');
    d.emit('call:decline', { callId });
    expect(await ended).toEqual({ callId, reason: 'declined' });
  });

  test('if the device disconnects mid-call, the parent is told', async () => {
    const parent = await registerParent(stack.app);
    const driver = await createDriver(parent.user.id);
    const p = await parentSocket(parent.token);
    const d = await connectDevice(driver._id);
    const ring = waitForEvent(d, 'call:incoming');
    await emitAck(p, 'call:start', { driverId: String(driver._id) });
    const { callId } = await ring;
    const accepted = waitForEvent(p, 'call:accepted');
    d.emit('call:accept', { callId });
    await accepted;
    const ended = waitForEvent(p, 'call:ended');
    d.close();
    expect(await ended).toEqual({ callId, reason: 'disconnected' });
  });
});
