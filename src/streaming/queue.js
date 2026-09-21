// Priority job queue: parallel work with backpressure.
//
// Higher `priority` runs first (critical alerts before routine refreshes);
// FIFO within a priority. Resource limits keep one runaway feed from eating
// the machine: bounded depth, per-job timeouts, bounded concurrency.
// Completion callbacks and optional webhook POSTs notify downstream systems.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const PRIORITIES = { critical: 100, high: 50, normal: 0, low: -50 };

export function toPriority(p) {
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  if (typeof p === 'string' && PRIORITIES[p] !== undefined) return PRIORITIES[p];
  return PRIORITIES.normal;
}

function postJson(url, payload, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return resolve({ ok: false, error: 'Invalid webhook URL' });
    }
    const lib = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const body = JSON.stringify(payload);
    const req = lib(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Webhook timeout')));
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end(body);
  });
}

export class JobQueue {
  constructor(options = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.maxDepth = options.maxDepth ?? 1000;
    this.jobTimeoutMs = options.jobTimeoutMs ?? 30000;
    this.webhookTimeoutMs = options.webhookTimeoutMs ?? 5000;
    this.dropPolicy = options.dropPolicy ?? 'drop-lowest'; // or 'reject'
    this.jobs = []; // { id, priority, seq, run, onComplete, webhook, label, enqueuedAt }
    this.active = 0;
    this.seq = 0;
    this.draining = new Set();
    this.stats = { enqueued: 0, completed: 0, failed: 0, dropped: 0, timedOut: 0 };
  }

  get depth() {
    return this.jobs.length;
  }

  enqueue(job) {
    if (typeof job?.run !== 'function') throw new Error('Job needs a run() function');
    if (this.jobs.length >= this.maxDepth) {
      if (this.dropPolicy === 'reject') {
        throw new Error(`Queue full (${this.maxDepth}); job rejected`);
      }
      // drop-lowest: evict the lowest-priority waiting job to make room
      let victim = 0;
      for (let i = 1; i < this.jobs.length; i++) {
        const a = this.jobs[i];
        const b = this.jobs[victim];
        if (a.priority < b.priority || (a.priority === b.priority && a.seq > b.seq)) victim = i;
      }
      const [dropped] = this.jobs.splice(victim, 1);
      this.stats.dropped += 1;
      this._finish(dropped, { status: 'dropped', error: 'Evicted by higher-priority job' });
    }
    const record = {
      id: job.id ?? `job-${Date.now()}-${this.seq}`,
      priority: toPriority(job.priority),
      seq: this.seq++,
      run: job.run,
      onComplete: job.onComplete ?? null,
      webhook: job.webhook ?? null,
      label: job.label ?? null,
      enqueuedAt: new Date().toISOString(),
    };
    this.jobs.push(record);
    // highest priority first, FIFO within a priority
    this.jobs.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    this.stats.enqueued += 1;
    this._pump();
    return record.id;
  }

  _pump() {
    while (this.active < this.concurrency && this.jobs.length > 0) {
      const job = this.jobs.shift();
      this.active += 1;
      this._execute(job).finally(() => {
        this.active -= 1;
        this._pump();
        this._checkDrain();
      });
    }
    this._checkDrain();
  }

  async _execute(job) {
    const startedAt = Date.now();
    let outcome;
    try {
      const result = await Promise.race([
        job.run(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Job timed out after ${this.jobTimeoutMs}ms`)), this.jobTimeoutMs)),
      ]);
      this.stats.completed += 1;
      outcome = { status: 'completed', result, durationMs: Date.now() - startedAt };
    } catch (e) {
      if (/timed out/.test(e.message)) this.stats.timedOut += 1;
      else this.stats.failed += 1;
      outcome = { status: 'failed', error: e.message, durationMs: Date.now() - startedAt };
    }
    await this._finish(job, outcome);
  }

  async _finish(job, outcome) {
    const record = { jobId: job.id, label: job.label, ...outcome, at: new Date().toISOString() };
    if (typeof job.onComplete === 'function') {
      try {
        await job.onComplete(record);
      } catch {}
    }
    if (job.webhook) {
      await postJson(job.webhook, record, this.webhookTimeoutMs);
    }
  }

  /** Resolve once the queue is empty and nothing is running. */
  drain(timeoutMs = 60000) {
    if (this.jobs.length === 0 && this.active === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.draining.delete(done);
        resolve(false);
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.draining.delete(done);
        resolve(true);
      };
      this.draining.add(done);
    });
  }

  _checkDrain() {
    if (this.jobs.length === 0 && this.active === 0) {
      for (const done of [...this.draining]) done();
    }
  }

  status() {
    return {
      concurrency: this.concurrency,
      maxDepth: this.maxDepth,
      active: this.active,
      depth: this.jobs.length,
      ...this.stats,
    };
  }
}
