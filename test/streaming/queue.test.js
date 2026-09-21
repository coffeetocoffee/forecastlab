// Tests for the priority job queue.
import { test, suite } from 'node:test';
import { strict as assert } from 'node:assert';
import { JobQueue, toPriority } from '../../src/streaming/queue.js';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

suite('toPriority', () => {
  test('maps names and passes numbers through', () => {
    assert.ok(toPriority('critical') > toPriority('high'));
    assert.ok(toPriority('high') > toPriority('normal'));
    assert.ok(toPriority('normal') > toPriority('low'));
    assert.strictEqual(toPriority(7), 7);
    assert.strictEqual(toPriority('bogus'), 0);
  });
});

suite('JobQueue ordering', () => {
  test('critical jobs run before normal ones', async () => {
    const q = new JobQueue({ concurrency: 1 });
    const order = [];
    // Block the single worker first so everything queues up.
    q.enqueue({ label: 'blocker', run: async () => { await tick(50); } });
    await tick(5);
    q.enqueue({ label: 'low', priority: 'low', run: async () => { order.push('low'); } });
    q.enqueue({ label: 'normal', run: async () => { order.push('normal'); } });
    q.enqueue({ label: 'critical', priority: 'critical', run: async () => { order.push('critical'); } });
    await q.drain();
    assert.deepStrictEqual(order, ['critical', 'normal', 'low']);
  });

  test('FIFO within a priority', async () => {
    const q = new JobQueue({ concurrency: 1 });
    const order = [];
    q.enqueue({ label: 'blocker', run: async () => { await tick(30); } });
    await tick(5);
    for (const n of ['a', 'b', 'c']) q.enqueue({ label: n, run: async () => { order.push(n); } });
    await q.drain();
    assert.deepStrictEqual(order, ['a', 'b', 'c']);
  });
});

suite('JobQueue limits', () => {
  test('respects concurrency', async () => {
    const q = new JobQueue({ concurrency: 2 });
    let live = 0;
    let peak = 0;
    const jobs = Array.from({ length: 6 }, (_, i) => q.enqueue({
      label: `j${i}`,
      run: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await tick(20);
        live -= 1;
      },
    }));
    assert.strictEqual(jobs.length, 6);
    await q.drain();
    assert.ok(peak <= 2);
    assert.ok(peak >= 2);
  });

  test('times out stuck jobs without stalling the queue', async () => {
    const q = new JobQueue({ concurrency: 1, jobTimeoutMs: 50 });
    let second = false;
    q.enqueue({ label: 'stuck', run: () => new Promise(() => {}) });
    q.enqueue({ label: 'next', run: async () => { second = true; } });
    await q.drain();
    assert.strictEqual(second, true);
    assert.strictEqual(q.stats.timedOut, 1);
  });

  test('drop-lowest evicts the least important waiting job', async () => {
    const q = new JobQueue({ concurrency: 1, maxDepth: 2, dropPolicy: 'drop-lowest' });
    const ran = [];
    q.enqueue({ label: 'blocker', run: async () => { await tick(40); } });
    await tick(5);
    q.enqueue({ label: 'keep-high', priority: 'high', run: async () => { ran.push('keep-high'); } });
    q.enqueue({ label: 'keep-normal', run: async () => { ran.push('keep-normal'); } });
    q.enqueue({ label: 'evicts-normal', run: async () => { ran.push('evicts-normal'); } }); // depth full: drops 'keep-normal'
    await q.drain();
    assert.deepStrictEqual(ran, ['keep-high', 'evicts-normal']);
    assert.strictEqual(q.stats.dropped, 1);
  });

  test('reject policy throws instead of queueing', async () => {
    const q = new JobQueue({ concurrency: 1, maxDepth: 1, dropPolicy: 'reject' });
    q.enqueue({ label: 'blocker', run: async () => { await tick(30); } });
    await tick(5);
    q.enqueue({ label: 'fills', run: async () => {} });
    assert.throws(() => q.enqueue({ label: 'overflow', run: async () => {} }), /Queue full/);
    await q.drain();
  });
});

suite('JobQueue callbacks', () => {
  test('onComplete receives the outcome and failures are recorded', async () => {
    const q = new JobQueue({ concurrency: 2 });
    const seen = [];
    q.enqueue({ label: 'ok', run: async () => 42, onComplete: async (r) => seen.push(r) });
    q.enqueue({ label: 'bad', run: async () => { throw new Error('boom'); }, onComplete: async (r) => seen.push(r) });
    await q.drain();
    const ok = seen.find((r) => r.label === 'ok');
    const bad = seen.find((r) => r.label === 'bad');
    assert.strictEqual(ok.status, 'completed');
    assert.strictEqual(ok.result, 42);
    assert.strictEqual(bad.status, 'failed');
    assert.strictEqual(bad.error, 'boom');
    assert.strictEqual(q.stats.completed, 1);
    assert.strictEqual(q.stats.failed, 1);
  });

  test('posts job completions to a webhook', async () => {
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
    const q = new JobQueue({ concurrency: 1 });
    q.enqueue({ label: 'hooked', run: async () => 'done', webhook: `http://127.0.0.1:${server.address().port}/hook` });
    await q.drain();
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].status, 'completed');
    assert.strictEqual(received[0].result, 'done');
    await new Promise((resolve) => server.close(resolve));
  });
});
