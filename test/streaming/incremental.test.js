// Tests for the incremental update engine.
import { test, suite } from 'node:test';
import { strict as assert } from 'node:assert';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Welford, IncrementalForecaster } from '../../src/streaming/incremental.js';

function points(n, start = 1700000000000, step = 3600000, base = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ seriesId: 's', t: start + i * step, iso: new Date(start + i * step).toISOString(), value: base + Math.sin(i / 3), source: 'test' });
  }
  return out;
}

suite('Welford', () => {
  test('matches batch mean and variance', () => {
    const w = new Welford();
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    for (const v of values) w.push(v);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    assert.ok(Math.abs(w.mean - mean) < 1e-9);
    assert.ok(Math.abs(w.variance - variance) < 1e-9);
    assert.strictEqual(w.count, values.length);
  });
});

suite('IncrementalForecaster', () => {
  test('appends, dedupes by timestamp, and bounds the window', () => {
    const f = new IncrementalForecaster({ seriesId: 's', method: 'naive', windowSize: 50 });
    const batch = points(40);
    const r1 = f.append(batch);
    assert.strictEqual(r1.appended, 40);
    assert.strictEqual(r1.dropped, 0);
    const r2 = f.append([...batch.slice(0, 10), ...points(20, 1700000000000 + 40 * 3600000)]);
    assert.strictEqual(r2.appended, 20); // the 10 repeats are ignored
    assert.strictEqual(r2.dropped, 10);
    assert.strictEqual(f.values.length, 50);
    assert.ok(f.stats.count === 60); // stats cover full history, O(1) memory
  });

  test('ignores other series', () => {
    const f = new IncrementalForecaster({ seriesId: 's', method: 'naive' });
    f.append([{ seriesId: 'other', t: 1, iso: new Date(1).toISOString(), value: 5, source: 't' }]);
    assert.strictEqual(f.values.length, 0);
  });

  test('refresh computes once, then serves the cache', async () => {
    const f = new IncrementalForecaster({ seriesId: 's', method: 'naive', horizon: 5 });
    f.append(points(30));
    const first = await f.refresh();
    assert.strictEqual(first.recomputed, true);
    assert.strictEqual(first.reason, 'no-fit');
    assert.strictEqual(first.result.point.length, 5);
    const second = await f.refresh();
    assert.strictEqual(second.recomputed, false);
    assert.strictEqual(second.reason, 'clean');
    assert.strictEqual(second.result, first.result);
  });

  test('new points invalidate the cache', async () => {
    const f = new IncrementalForecaster({ seriesId: 's', method: 'mean', horizon: 3, minNewPoints: 2 });
    f.append(points(20));
    await f.refresh();
    f.append(points(1, 1700000000000 + 20 * 3600000));
    const cached = await f.refresh();
    assert.strictEqual(cached.recomputed, false);
    assert.strictEqual(cached.reason, 'below-threshold');
    f.append(points(1, 1700000000000 + 21 * 3600000));
    const fresh = await f.refresh();
    assert.strictEqual(fresh.recomputed, true);
    assert.strictEqual(fresh.reason, 'new-points');
  });

  test('distribution shift forces a refresh with reason drift', async () => {
    const f = new IncrementalForecaster({ seriesId: 's', method: 'naive', horizon: 3, driftWindow: 10, driftThreshold: 1.5 });
    f.append(points(60, 1700000000000, 3600000, 10));
    await f.refresh();
    f.append(points(15, 1700000000000 + 60 * 3600000, 3600000, 100)); // regime jump
    const out = await f.refresh();
    assert.strictEqual(out.recomputed, true);
    assert.strictEqual(out.reason, 'drift');
    assert.ok(out.result.drift.z > 1.5);
  });

  test('auto method selection picks a real method', async () => {
    const f = new IncrementalForecaster({ seriesId: 's', method: 'auto', horizon: 4, seasonLength: 12 });
    f.append(points(60));
    const out = await f.refresh();
    assert.strictEqual(out.recomputed, true);
    assert.ok(typeof out.result.method === 'string' && out.result.method.length > 0);
  });

  test('configure invalidates on change only', () => {
    const f = new IncrementalForecaster({ seriesId: 's', method: 'naive' });
    f.dirty = false;
    assert.strictEqual(f.configure({ horizon: 24 }), false); // same value
    assert.strictEqual(f.dirty, false);
    assert.strictEqual(f.configure({ horizon: 48 }), true);
    assert.strictEqual(f.dirty, true);
  });

  test('writeSnapshot produces batch-compatible artifacts', async () => {
    const dir = join(tmpdir(), `forecastlab-snap-${Date.now()}`);
    const f = new IncrementalForecaster({ seriesId: 'snap', method: 'naive', horizon: 4 });
    f.append(points(25));
    await f.refresh();
    const out = f.writeSnapshot(dir);
    assert.ok(existsSync(out.csvPath));
    assert.ok(existsSync(out.projectPath));
    const project = JSON.parse(readFileSync(out.projectPath, 'utf8'));
    assert.strictEqual(project.data, 'snap.csv');
    assert.strictEqual(project.method, 'naive');
    rmSync(dir, { recursive: true, force: true });
  });
});
