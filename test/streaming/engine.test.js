// Tests for the streaming engine: hybrid modes, snapshots, replay.
import { test, suite } from 'node:test';
import { strict as assert } from 'node:assert';
import { StreamingEngine, EventHub } from '../../src/streaming/engine.js';
import { PollingConnector } from '../../src/streaming/connectors.js';

function point(seriesId, t, value, extra = {}) {
  return { seriesId, t, iso: new Date(t).toISOString(), value, source: 'test', ...extra };
}

function series(n, start = 1700000000000, step = 3600000, base = 10) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(point('s', start + i * step, base + Math.sin(i / 3)));
  return out;
}

suite('EventHub', () => {
  test('publishes, replays history, and unsubscribes', () => {
    const hub = new EventHub({ maxHistory: 3 });
    const seen = [];
    const unsub = hub.subscribe((e) => seen.push(e));
    hub.publish('a', { n: 1 });
    hub.publish('b', { n: 2 });
    assert.strictEqual(seen.length, 2);
    unsub();
    hub.publish('c', { n: 3 });
    assert.strictEqual(seen.length, 2);
    const late = [];
    hub.subscribe((e) => late.push(e), 2);
    assert.deepStrictEqual(late.map((e) => e.type), ['b', 'c']);
    for (let i = 0; i < 5; i++) hub.publish('x', {});
    assert.strictEqual(hub.history.length, 3); // bounded
  });
});

suite('StreamingEngine stream mode', () => {
  test('ingest -> forecast -> hub event', async () => {
    const engine = new StreamingEngine({ method: 'naive', horizon: 3, minNewPoints: 1000 });
    await engine.start();
    const events = [];
    engine.hub.subscribe((e) => { if (e.type === 'update') events.push(e); });
    for (const p of series(30)) engine.ingest(p);
    await engine.drain();
    assert.ok(events.length > 0);
    assert.ok(events.some((e) => e.recomputed)); // fit happened once data sufficed
    const last = events[events.length - 1];
    assert.strictEqual(last.recomputed, false); // rest served from cache (minNewPoints)
    assert.strictEqual(last.method, 'naive');
    assert.ok(Array.isArray(last.forecast) && last.forecast.length === 3);
    await engine.stop();
  });

  test('priority points jump the queue', async () => {
    const engine = new StreamingEngine({ method: 'naive', queue: { concurrency: 1 } });
    await engine.start();
    const order = [];
    engine.hub.subscribe((e) => { if (e.type === 'update') order.push(e.point.value); });
    // Occupy the worker, then queue normal before critical.
    engine.queue.enqueue({ label: 'block', run: async () => { await new Promise((r) => setTimeout(r, 60)); } });
    await new Promise((r) => setTimeout(r, 5));
    engine.ingest(point('s', 1, 111));
    engine.ingest(point('s', 2, 999, { priority: 'critical' }));
    engine.ingest(point('s', 3, 222));
    await engine.drain();
    assert.deepStrictEqual(order, [999, 111, 222]);
    await engine.stop();
  });

  test('threshold alerts flow to the hub', async () => {
    const engine = new StreamingEngine({
      method: 'naive',
      rules: [{ id: 'hi', kind: 'threshold', field: 'value', op: 'gt', level: 50 }],
    });
    await engine.start();
    const alerts = [];
    engine.hub.subscribe((e) => { if (e.type === 'alert') alerts.push(e.alert); });
    for (const p of series(15)) engine.ingest(p);
    engine.ingest(point('s', 1700000000000 + 15 * 3600000, 500));
    await engine.drain();
    assert.ok(alerts.length >= 1);
    assert.strictEqual(alerts[0].ruleId, 'hi');
    await engine.stop();
  });
});

suite('StreamingEngine batch mode', () => {
  test('points accumulate and refreshAll runs them to completion', async () => {
    const engine = new StreamingEngine({ method: 'mean', horizon: 2, mode: 'batch' });
    await engine.start();
    for (const p of series(25)) engine.ingest(p);
    assert.strictEqual(engine.forecasters.get('s').values.length, 25);
    assert.strictEqual(engine.forecasters.get('s').result, null); // nothing computed yet
    const out = await engine.refreshAll();
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].recomputed, true);
    assert.ok(engine.forecasters.get('s').result.point.length === 2);
    engine.setMode('stream');
    assert.strictEqual(engine.mode, 'stream');
    await engine.stop();
  });
});

suite('snapshots and replay', () => {
  test('snapshot captures state and replay reproduces it', async () => {
    const engine = new StreamingEngine({ method: 'naive', horizon: 3 });
    await engine.start();
    for (const p of series(25)) engine.ingest(p);
    await engine.drain();
    const before = engine.snapshot('s');
    assert.strictEqual(before.points, 25);
    assert.ok(before.result);

    // Record the event stream, then replay into a fresh engine.
    const recorded = engine.history(1000).filter((e) => e.type === 'update').map((e) => e.point);
    assert.ok(recorded.length > 0);
    const engine2 = new StreamingEngine({ method: 'naive', horizon: 3 });
    await engine2.start();
    const out = await engine2.replay(recorded);
    assert.strictEqual(out.processed, recorded.length);
    const after = engine2.snapshot('s');
    assert.strictEqual(after.points, before.points);
    assert.deepStrictEqual(after.result.point, before.result.point);
    await engine.stop();
    await engine2.stop();
  });

  test('writeSnapshot produces batch-readable files', async () => {
    const { mkdirSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const engine = new StreamingEngine({ method: 'naive' });
    await engine.start();
    for (const p of series(20)) engine.ingest(p);
    await engine.drain();
    const dir = join(tmpdir(), `forecastlab-eng-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const written = engine.writeSnapshot(dir);
    assert.strictEqual(written.length, 1);
    assert.ok(existsSync(written[0].csvPath));
    assert.ok(existsSync(written[0].projectPath));
    rmSync(dir, { recursive: true, force: true });
    await engine.stop();
  });

  test('polling connector feeds the engine (DB change-tracking path)', async () => {
    const rows = series(12).map((p, i) => ({ id: i + 1, v: p.value, ts: p.t }));
    const engine = new StreamingEngine({ method: 'naive', horizon: 2 });
    const polling = new PollingConnector({
      seriesId: 'db',
      intervalMs: 20,
      initialCursor: 0,
      fetchSince: async (cursor) => rows.filter((r) => r.ts > cursor),
      mapRow: (r) => ({ value: r.v, t: r.ts }),
    });
    engine.addConnector(polling);
    await engine.start();
    await engine.drain(10000);
    const snap = engine.snapshot('db');
    assert.ok(snap && snap.points === 12);
    await engine.stop();
  });
});
