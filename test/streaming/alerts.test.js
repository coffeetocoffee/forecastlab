// Tests for real-time alert triggers and escalation.
import { test, suite } from 'node:test';
import { strict as assert } from 'node:assert';
import { AlertManager } from '../../src/streaming/alerts.js';

function values(n, base = 10, spikeAt = -1, spikeValue = 100) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i === spikeAt ? spikeValue : base + (i % 3));
  return out;
}

suite('threshold rules', () => {
  test('fires when a value crosses the level', async () => {
    const fired = [];
    const mgr = new AlertManager({ onAlert: async (a) => fired.push(a), cooldownMs: 0 });
    mgr.addRule({ id: 'high', kind: 'threshold', field: 'value', op: 'gt', level: 50 });
    const alerts = await mgr.evaluate({ seriesId: 's', values: values(20, 10, 5, 100) });
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].ruleId, 'high');
    assert.strictEqual(fired.length, 1);
  });

  test('stays quiet below the level and respects series scope', async () => {
    const mgr = new AlertManager({ cooldownMs: 0 });
    mgr.addRule({ id: 'high', kind: 'threshold', field: 'value', op: 'gt', level: 50, seriesId: 'other' });
    const alerts = await mgr.evaluate({ seriesId: 's', values: values(20) });
    assert.strictEqual(alerts.length, 0);
  });

  test('cooldown suppresses repeats but escalation still fires', async () => {
    const fired = [];
    const mgr = new AlertManager({ onAlert: async (a) => fired.push(a), cooldownMs: 60000, escalateAfter: 2 });
    mgr.addRule({ id: 'high', kind: 'threshold', field: 'value', op: 'gt', level: 50 });
    const ctx = { seriesId: 's', values: values(20, 10, 5, 100) };
    await mgr.evaluate(ctx); // hits=1, fires (no previous cooldown)
    await mgr.evaluate(ctx); // hits=2, escalates -> fires despite cooldown
    await mgr.evaluate(ctx); // hits=3, cooldown, no escalation -> quiet
    assert.strictEqual(fired.length, 2);
    assert.strictEqual(fired[1].escalated, true);
    assert.strictEqual(fired[1].level, 'warn');
    assert.strictEqual(mgr.stats.escalated, 1);
  });

  test('a clearing condition resets the escalation counter', async () => {
    const fired = [];
    const mgr = new AlertManager({ onAlert: async (a) => fired.push(a), cooldownMs: 0, escalateAfter: 2 });
    mgr.addRule({ id: 'high', kind: 'threshold', field: 'value', op: 'gt', level: 50 });
    await mgr.evaluate({ seriesId: 's', values: values(20, 10, 5, 100) });
    await mgr.evaluate({ seriesId: 's', values: values(20) }); // clears
    await mgr.evaluate({ seriesId: 's', values: values(20, 10, 5, 100) });
    assert.ok(fired.every((a) => a.escalated === false));
  });
});

suite('anomaly rules', () => {
  test('fires on new anomalies and asks for a refit when they persist', async () => {
    const fired = [];
    const mgr = new AlertManager({ onAlert: async (a) => fired.push(a), cooldownMs: 0 });
    mgr.addRule({ id: 'anom', kind: 'anomaly', window: 30 });
    const bad = values(30, 10, 15, 1000);
    const first = await mgr.evaluate({ seriesId: 's', values: bad });
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].suggestRefit, false);
    const second = await mgr.evaluate({ seriesId: 's', values: bad });
    assert.strictEqual(second.length, 1);
    assert.strictEqual(second[0].suggestRefit, true); // persistent -> feedback loop
    const clean = await mgr.evaluate({ seriesId: 's', values: values(30) });
    assert.strictEqual(clean.length, 0);
  });
});

suite('drift rules', () => {
  test('fires when the forecaster reports a shift', async () => {
    const mgr = new AlertManager({ cooldownMs: 0 });
    mgr.addRule({ id: 'drift', kind: 'drift' });
    const quiet = await mgr.evaluate({ seriesId: 's', values: values(20), drift: { drift: false } });
    assert.strictEqual(quiet.length, 0);
    const loud = await mgr.evaluate({ seriesId: 's', values: values(20), drift: { drift: true, z: 5 } });
    assert.strictEqual(loud.length, 1);
    assert.strictEqual(loud[0].suggestRefit, true);
  });
});

suite('delivery', () => {
  test('posts alerts to a rule webhook', async () => {
    const { createServer } = await import('node:http');
    const received = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const mgr = new AlertManager({ cooldownMs: 0 });
    mgr.addRule({ id: 'high', kind: 'threshold', field: 'value', op: 'gt', level: 50, webhook: `http://127.0.0.1:${server.address().port}/alerts` });
    await mgr.evaluate({ seriesId: 's', values: values(20, 10, 5, 100) });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].ruleId, 'high');
    await new Promise((resolve) => server.close(resolve));
  });
});
