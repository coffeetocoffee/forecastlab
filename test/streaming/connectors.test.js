// Tests for live data feed connectors.
import { test, suite } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  normalizePoint,
  FileWatchConnector,
  WebhookConnector,
  WebSocketFeedConnector,
  PollingConnector,
} from '../../src/streaming/connectors.js';

function tmpDir(name) {
  const dir = join(tmpdir(), `forecastlab-stream-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function waitFor(cond, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve(true);
      if (Date.now() - start > timeoutMs) return reject(new Error('Timed out waiting for condition'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

suite('normalizePoint', () => {
  test('accepts numbers, objects, and epoch seconds', () => {
    const a = normalizePoint({ value: 3, t: 1700000000000 }, 's', 'test');
    assert.strictEqual(a.value, 3);
    assert.strictEqual(a.t, 1700000000000);
    const b = normalizePoint({ value: '4.5', time: '2024-01-02T00:00:00Z' }, 's', 'test');
    assert.strictEqual(b.value, 4.5);
    const c = normalizePoint({ value: 1, t: 1700000000 }, 's', 'test'); // epoch seconds
    assert.strictEqual(c.t, 1700000000000);
  });

  test('rejects invalid values and timestamps', () => {
    assert.throws(() => normalizePoint({ value: 'abc' }, 's', 'test'));
    assert.throws(() => normalizePoint({ value: 1, t: 'not-a-date' }, 's', 'test'));
    assert.throws(() => normalizePoint(null, 's', 'test'));
  });
});

suite('FileWatchConnector', () => {
  test('emits existing rows with fromStart and tails appended rows', async () => {
    const dir = tmpDir('file');
    const path = join(dir, 'data.csv');
    writeFileSync(path, 'timestamp,value\n2024-01-01T00:00:00Z,10\n2024-01-01T01:00:00Z,11\n');
    const conn = new FileWatchConnector({ path, seriesId: 's1', fromStart: true });
    const seen = [];
    conn.onPoint((p) => seen.push(p));
    await conn.start();
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(seen[1].value, 11);
    appendFileSync(path, '2024-01-01T02:00:00Z,12\n');
    await waitFor(() => seen.length >= 3);
    assert.strictEqual(seen[2].value, 12);
    await conn.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test('ignores duplicate and older rows', async () => {
    const dir = tmpDir('filedup');
    const path = join(dir, 'data.csv');
    writeFileSync(path, 'timestamp,value\n2024-01-01T00:00:00Z,10\n');
    const conn = new FileWatchConnector({ path, seriesId: 's1' });
    const seen = [];
    conn.onPoint((p) => seen.push(p));
    await conn.start();
    assert.strictEqual(seen.length, 0); // not fromStart: baseline only
    appendFileSync(path, '2024-01-01T00:00:00Z,10\n2024-01-01T01:00:00Z,11\n');
    await waitFor(() => seen.length >= 1);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].value, 11);
    await conn.stop();
    rmSync(dir, { recursive: true, force: true });
  });
});

suite('WebhookConnector', () => {
  test('accepts single and batch posts, rejects garbage', async () => {
    const conn = new WebhookConnector({ port: 0, seriesId: 'web' });
    const seen = [];
    conn.onPoint((p) => seen.push(p));
    await conn.start();
    const base = `http://127.0.0.1:${conn.port}`;
    const post = async (body) => {
      const res = await fetch(`${base}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      return { status: res.status, json: await res.json() };
    };
    const r1 = await post(JSON.stringify({ value: 5, t: 1700000000000 }));
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.json.accepted, 1);
    const r2 = await post(JSON.stringify([{ value: 6 }, { value: 'bad' }]));
    assert.strictEqual(r2.json.accepted, 1);
    assert.strictEqual(r2.json.rejected, 1);
    const r3 = await post('not json');
    assert.strictEqual(r3.status, 400);
    const health = await (await fetch(`${base}/health`)).json();
    assert.strictEqual(health.ok, true);
    assert.ok(seen.length >= 2);
    await conn.stop();
  });

  test('enforces token when configured', async () => {
    const conn = new WebhookConnector({ port: 0, token: 'secret' });
    await conn.start();
    const base = `http://127.0.0.1:${conn.port}`;
    const denied = await fetch(`${base}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(denied.status, 403);
    const allowed = await fetch(`${base}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body: JSON.stringify({ value: 1 }) });
    assert.strictEqual(allowed.status, 200);
    await conn.stop();
  });
});

suite('WebSocketFeedConnector', () => {
  test('parses messages from an injected socket', async () => {
    const seen = [];
    let handlers = {};
    const fake = { onmessage: null, onopen: null, onclose: null, onerror: null, close() {} };
    const conn = new WebSocketFeedConnector({
      url: 'ws://example.invalid/feed',
      socketFactory: () => {
        handlers = fake;
        return fake;
      },
    });
    conn.onPoint((p) => seen.push(p));
    await conn.start();
    fake.onopen();
    fake.onmessage({ data: JSON.stringify({ value: 7, t: 1700000000000 }) });
    fake.onmessage({ data: JSON.stringify([{ value: 8 }, 'garbage']) });
    assert.strictEqual(seen.length, 2);
    assert.strictEqual(seen[1].value, 8);
    await conn.stop();
  });

  test('talks to a real minimal websocket server', async () => {
    const { createServer } = await import('node:http');
    const { createHash } = await import('node:crypto');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    let serverSocket = null;
    server.on('upgrade', (req, socket) => {
      serverSocket = socket;
      socket.on('error', () => {});
      const key = req.headers['sec-websocket-key'];
      const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      const payload = Buffer.from(JSON.stringify({ value: 42, t: 1700000000000 }));
      socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
    });
    const conn = new WebSocketFeedConnector({ url: `ws://127.0.0.1:${port}/feed`, maxRetries: 0 });
    const seen = [];
    conn.onPoint((p) => seen.push(p));
    await conn.start();
    await waitFor(() => seen.length >= 1);
    assert.strictEqual(seen[0].value, 42);
    await conn.stop();
    if (serverSocket) serverSocket.destroy(); // upgraded sockets are untracked: close our side
    await new Promise((resolve) => server.close(resolve));
  });
});

suite('PollingConnector', () => {
  test('advances a cursor and maps rows', async () => {
    const rows = [
      { id: 1, v: 10, ts: 1700000001000 },
      { id: 2, v: 11, ts: 1700000002000 },
    ];
    let calls = 0;
    const conn = new PollingConnector({
      seriesId: 'db',
      intervalMs: 30,
      initialCursor: 1700000000000,
      fetchSince: async (cursor) => {
        calls += 1;
        return rows.filter((r) => r.ts > cursor);
      },
      mapRow: (r) => ({ value: r.v, t: r.ts }),
    });
    const seen = [];
    conn.onPoint((p) => seen.push(p));
    await conn.start();
    await waitFor(() => seen.length >= 2);
    assert.strictEqual(seen[1].value, 11);
    assert.strictEqual(conn.cursor, 1700000002000);
    assert.ok(calls >= 1);
    await conn.stop();
  });

  test('requires a fetch function', () => {
    assert.throws(() => new PollingConnector({}), /fetchSince/);
  });
});
