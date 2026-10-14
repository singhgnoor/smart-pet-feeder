// Safe localhost-only integration smoke test for Vite proxy behavior.
// A fake CAM server receives requests; this never contacts a device.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const received = [];
const mockCam = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    received.push({ method: req.method, path: req.url, key: req.headers['x-api-key'], body: Buffer.concat(chunks).toString() });
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('event: telemetry\ndata: {"t":"12:00:00"}\n\n');
      setTimeout(() => res.end(), 50);
      return;
    }
    res.writeHead(req.url === '/api/feed' ? 202 : 200, { 'Content-Type': 'application/json' });
    res.end(req.url === '/api/feed' ? '{"accepted":true}' : '{"link":true}');
  });
});

await new Promise((resolve) => mockCam.listen(0, '127.0.0.1', resolve));
const camPort = mockCam.address().port;
process.env.VITE_ESP32_HOST = '127.0.0.1';
process.env.VITE_ESP32_PORT = String(camPort);
process.env.DEVICE_API_KEY = 'audit-proxy-sentinel';

let vite;
try {
  const { createServer } = await import('vite');
  vite = await createServer({
    configFile: path.join(root, 'vite.config.ts'),
    mode: 'development',
    server: { host: '127.0.0.1', port: 0 },
  });
  await vite.listen();
  const address = vite.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;

  const feed = await fetch(`${base}/api/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"grams":10}',
  });
  assert.equal(feed.status, 202);
  assert.deepEqual(await feed.json(), { accepted: true });
  assert.equal(received.at(-1).key, 'audit-proxy-sentinel');
  assert.equal(received.at(-1).body, '{"grams":10}');

  const status = await fetch(`${base}/api/status`);
  assert.equal(status.status, 200);
  assert.equal(received.at(-1).key, undefined, 'read-only requests must not receive the device key');

  const sse = await fetch(`${base}/events`, { headers: { Accept: 'text/event-stream' } });
  assert.equal(sse.status, 200);
  assert.match(sse.headers.get('content-type') ?? '', /text\/event-stream/i);
  assert.match(await sse.text(), /event: telemetry\ndata: \{"t":"12:00:00"\}/);

  const jsFiles = (await readdir(path.join(root, 'dist', 'assets'))).filter((f) => f.endsWith('.js'));
  const bundle = (await Promise.all(jsFiles.map((f) => readFile(path.join(root, 'dist', 'assets', f), 'utf8')))).join('\n');
  const envText = await readFile(path.join(root, '.env'), 'utf8').catch(() => '');
  const envMatch = envText.match(/^(?:DEVICE_API_KEY|VITE_DEVICE_API_KEY)=(.*)$/m);
  const configuredKey = envMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  assert.equal(configuredKey ? bundle.includes(configuredKey) : false, false, 'configured device key must not appear in browser bundle');

  console.log(JSON.stringify({
    result: 'PASS',
    scope: 'localhost fake-CAM proxy only; no hardware contacted',
    feed_proxy_status: feed.status,
    proxy_injected_server_side_key: true,
    read_only_key_omitted: true,
    sse_content_type_and_frame: 'PASS',
    configured_key_in_production_bundle: false,
  }, null, 2));
} finally {
  if (vite) await vite.close();
  await new Promise((resolve) => mockCam.close(resolve));
}
