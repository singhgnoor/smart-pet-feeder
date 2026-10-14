// Exercise the TypeScript REST/SSE client against a deterministic fake transport.
// This does not run CAM firmware or the React UI and cannot prove hardware behavior.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];
let feedStatus = 202;
let malformedAccepted = false;
let abortFetch = false;
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};
globalThis.window = globalThis;
globalThis.window.setInterval = setInterval;
globalThis.window.clearInterval = clearInterval;
globalThis.URL.createObjectURL = () => 'blob:fake-capture';
globalThis.URL.revokeObjectURL = () => {};

class FakeEventSource {
  static instances = [];
  listeners = new Map();
  onopen = null;
  onerror = null;
  closed = false;
  constructor(url) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  emit(name, data) { this.listeners.get(name)?.({ data }); }
  close() { this.closed = true; }
}
globalThis.EventSource = FakeEventSource;

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (abortFetch) throw new DOMException('request timed out', 'AbortError');
  if (String(url).includes('/api/status')) {
    return new Response(JSON.stringify({
      link: true, rssi: -52, state: 'IDLE',
      telem: { t: '12:00:00', w: 0, hop: 80, st: 'IDLE', ir: 0, vis: 0, day: 0, gate: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(url).includes('/api/feed')) {
    const body = feedStatus === 202 ? (malformedAccepted ? '' : '{"accepted":true,"id":12}') : JSON.stringify({ error: feedStatus === 401 ? 'AUTH' : 'LINK_DOWN' });
    return new Response(body, { status: feedStatus, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(url).includes('/api/snapshot.jpg')) {
    return new Response(new Blob(['jpeg-fake']), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }
  if (String(url).includes('/api/unauthorized')) {
    return new Response('{"error":"AUTH"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('{"accepted":true}', { status: 202, headers: { 'Content-Type': 'application/json' } });
};

const { createServer } = await import('vite');
const vite = await createServer({ configFile: path.join(root, 'vite.config.ts'), mode: 'development', server: { middlewareMode: true } });
try {
  const { RestDeviceService } = await vite.ssrLoadModule('/src/services/restDevice.ts');
  const { DeviceError } = await vite.ssrLoadModule('/src/types/device.ts');
  const service = new RestDeviceService();

  const status = await service.getStatus();
  assert.equal(status.link, true);
  assert.equal(status.telemetry, null, 'unverifiable CAM defaults must not become sensor values');
  assert.equal(calls.at(-1).url, '/api/status');

  const ack = await service.feed(50);
  assert.equal(ack.accepted, true);
  assert.equal(ack.stage, 'cam-accepted', '202 is not WROOM acceptance or completion');
  assert.equal(calls.at(-1).init.method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { grams: 50 });
  assert.equal(new Headers(calls.at(-1).init.headers).has('X-API-Key'), false, 'client must not send key; Vite proxy adds it server-side');
  feedStatus = 401;
  await assert.rejects(() => service.feed(50), (err) => err instanceof DeviceError && err.code === 'INVALID');
  feedStatus = 503;
  await assert.rejects(() => service.feed(50), (err) => err instanceof DeviceError && err.code === 'LINK_DOWN');
  feedStatus = 202;
  abortFetch = true;
  await assert.rejects(() => service.feed(50), (err) => err instanceof DeviceError && err.code === 'TIMEOUT');
  abortFetch = false;
  const countBeforeRange = calls.length;
  await assert.rejects(() => service.feed(4), (err) => err instanceof DeviceError && err.code === 'RANGE');
  assert.equal(calls.length, countBeforeRange, 'invalid range must be rejected before transport');

  malformedAccepted = true;
  await assert.rejects(() => service.feed(50), (err) => err instanceof DeviceError && err.code === 'UNKNOWN');
  malformedAccepted = false;

  const unsupported = [
    ['abort', () => service.abort()], ['clear', () => service.clearFault()],
    ['schedule write', () => service.putSchedule([])], ['schedule read', () => service.getSchedule()],
    ['history read', () => service.getLog()], ['tare', () => service.tare()],
    ['calibration', () => service.calibrate(200)],
    ['configuration write', () => service.setConfig({ dailyLimitG: 300, leftoverThresholdG: 30, overshootMarginG: 3, requirePetDetection: false })],
    ['configuration read', () => service.getConfig()],
  ];
  for (const [name, action] of unsupported) {
    const before = calls.length;
    await assert.rejects(action, (err) => err instanceof DeviceError && err.code === 'UNSUPPORTED', `${name} must be blocked without the WROOM handler`);
    assert.equal(calls.length, before, `${name} must not be sent to the CAM`);
  }

  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.url, 'blob:fake-capture');

  const events = [];
  const sseService = new RestDeviceService();
  const unsubscribe = sseService.subscribe((event) => events.push(event));
  const es = FakeEventSource.instances.at(-1);
  assert.equal(es.url, '/events');
  es.onopen();
  es.emit('telemetry', JSON.stringify({ t: '12:00:01', w: 3, hop: 70, st: 'IDLE', ir: 0, vis: 0, day: 0, gate: 0 }));
  es.emit('telemetry', '{invalid');
  assert.ok(events.some((e) => e.type === 'connection' && e.data.state === 'connected'));
  assert.equal(events.some((e) => e.type === 'telemetry'), false, 'unverified CAM telemetry must not update the UI');
  unsubscribe();
  assert.equal(es.closed, true);

  console.log(JSON.stringify({
    result: 'PASS',
    scope: 'RestDeviceService with fake fetch/EventSource; no CAM firmware or hardware',
    checks: ['CAM status connectivity separate from unavailable telemetry', 'feed method/body and CAM-only 202 stage', 'malformed 202 rejected', 'unsupported operations blocked before transport', 'HTTP 401/503 and timeout mapping', 'range rejected before transport', 'no browser API key header', 'snapshot MIME and Blob mapping', 'unverified telemetry suppressed', 'unsubscribe'],
  }, null, 2));
} finally {
  await vite.close();
}
