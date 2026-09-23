import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForecastingPipeline, quickPipeline } from '../../../src/data-quality/pipeline/pipeline.js';
import { WebhookManager } from '../../../src/data-quality/webhooks/webhook-manager.js';
import { SnapshotStore } from '../../../src/data-quality/snapshots/snapshot-store.js';

const DAY = 24 * 60 * 60 * 1000;

function makeData(n, startDate = '2026-01-01') {
  const start = new Date(startDate).getTime();
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * DAY).toISOString().slice(0, 10),
    value: 100 + 5 * Math.sin((2 * Math.PI * i) / 7) + i * 0.01
  }));
}

describe('ForecastingPipeline', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fl-pipeline-'));
  });

  it('runs the full workflow on clean data and passes gates', async () => {
    const pipeline = new ForecastingPipeline({
      snapshotStore: mkStore(tmpDir),
      minHealthScore: 50
    });

    const result = await pipeline.run(makeData(90), { seriesName: 'clean' });

    assert.equal(result.success, true);
    assert.ok(result.job_id.startsWith('job_'));
    assert.ok(result.quality_report.summary);
    assert.ok(Array.isArray(result.phases_completed));
    assert.ok(Array.isArray(result.next_steps));
    assert.equal(pipeline.getHistory().at(-1).status, 'completed');
  });

  it('snapshots the data before and after the run', async () => {
    const store = mkStore(tmpDir);
    const pipeline = new ForecastingPipeline({ snapshotStore: store, minHealthScore: 50 });
    await pipeline.run(makeData(60), { seriesName: 'snapped' });

    const pre = store.listSnapshots('snapped');
    assert.ok(pre.length >= 1, 'expected a pre-pipeline snapshot');
    assert.ok(store.listSnapshots('snapped_final').length >= 1);
  });

  it('auto-imputes missing values when autoFix is enabled', async () => {
    const store = mkStore(tmpDir);
    const pipeline = new ForecastingPipeline({ snapshotStore: store, minHealthScore: 50 });
    const data = makeData(90);
    data[20].value = null;

    const result = await pipeline.run(data, { seriesName: 'gappy' });

    assert.equal(result.success, true);
    assert.equal(result.quality_report.imputed, true);
    assert.equal(result.quality_report.imputationDetails.count, 1);
  });

  it('fails quality gates when critical issues exceed the limit', async () => {
    const store = mkStore(tmpDir);
    const pipeline = new ForecastingPipeline({
      snapshotStore: store,
      maxCriticalIssues: 0,
      minHealthScore: 0,
      maxMissingPercent: 100
    });

    const data = makeData(120, '2026-01-01');
    // Inject a structural break so summary.critical >= 1
    for (let i = 60; i < 120; i++) data[i].value += 80;

    const result = await pipeline.run(data, { seriesName: 'broken' });

    assert.equal(result.success, false);
    assert.equal(result.phase, 'quality_gates');
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some(e => e.includes('critical_issues')));
  });

  it('validates gate thresholds against a report', () => {
    const pipeline = new ForecastingPipeline({ snapshotStore: mkStore(tmpDir) });
    const report = {
      summary: { overallHealth: 90, critical: 0 },
      missingData: { coveragePercent: '99.00' }
    };

    const gates = pipeline.validateGates(report);
    assert.equal(gates.passed, true);
    assert.deepEqual(gates.reasons, []);

    const bad = pipeline.validateGates({
      summary: { overallHealth: 10, critical: 5 },
      missingData: { coveragePercent: '80.00' }
    });
    assert.equal(bad.passed, false);
    assert.equal(bad.reasons.length, 3);
  });

  it('executes queued jobs to completion and collects outcomes', async () => {
    const store = mkStore(tmpDir);
    const pipeline = new ForecastingPipeline({ snapshotStore: store });

    const jobs = Array.from({ length: 5 }, (_, i) => ({
      id: `job-${i}`,
      data: makeData(40),
      options: { seriesName: `q${i}` }
    }));

    const results = await pipeline.queueExecution(jobs);

    assert.equal(results.size, 5);
    for (const outcome of results.values()) {
      assert.equal(outcome.success, true);
    }
  });

  it('exports pipeline state', async () => {
    const pipeline = new ForecastingPipeline({ snapshotStore: mkStore(tmpDir), minHealthScore: 50 });
    await pipeline.run(makeData(90), { seriesName: 'state' });

    const state = pipeline.exportState();
    assert.equal(state.version, '2.0');
    assert.equal(state.history_count, 1);
    assert.ok(state.webhook_health);
    assert.ok(state.snapshot_stats.total_snapshots >= 1);
  });
});

describe('quickPipeline helper', () => {
  it('runs with lenient defaults', async () => {
    const result = await quickPipeline(makeData(60));
    assert.equal(result.success, true);
    assert.ok(result.quality_report);
  });
});

describe('WebhookManager (unit)', () => {
  it('registers, filters by event, and unregisters webhooks', async () => {
    const manager = new WebhookManager();
    const hook = manager.registerWebhook({
      url: 'http://localhost:1/nowhere',
      events: ['quality_check']
    });

    assert.ok(hook.id);
    assert.equal(manager.webhooks.length, 1);

    // No matching event → nothing triggered, no request attempted
    const miss = await manager.trigger('other_event', {});
    assert.equal(miss.triggeredCount, 0);

    // Matching event → delivery attempted (fails to unreachable host, recorded)
    const hit = await manager.trigger('quality_check', { foo: 1 }, { severity: 'info' });
    assert.equal(hit.triggeredCount, 0); // delivery failed, still resolves

    const gone = manager.unregisterWebhook(hook.id);
    assert.deepEqual(gone, { success: true });
    assert.equal(manager.webhooks.length, 0);
    assert.throws(() => manager.unregisterWebhook(hook.id), /Webhook not found/);
  });

  it('skips triggers entirely when disabled', async () => {
    const manager = new WebhookManager();
    manager.enabled = false;
    const result = await manager.trigger('quality_check', {});
    assert.equal(result.success, false);
    assert.equal(result.message, 'Webhooks disabled');
  });

  it('reports health', () => {
    const manager = new WebhookManager();
    const health = manager.healthCheck();
    assert.ok(typeof health === 'object');
  });
});

function mkStore(tmpDir) {
  return new SnapshotStore({ path: tmpDir + '/' });
}
