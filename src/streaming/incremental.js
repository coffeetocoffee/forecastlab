// Incremental update engine: refresh forecasts without full re-computation.
//
// The forecaster keeps a bounded window of recent points for fitting (memory
// stays flat no matter how long the stream runs) plus O(1) Welford aggregates
// over the full history for drift detection. The expensive core (fit/backtest)
// runs only when the cache is invalidated: first run, enough new points, a
// detected distribution shift, or an explicit config change.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fit, applicableMethods } from '../models.js';
import { backtest, defaultTestSize } from '../evaluate.js';
import { SlidingWindow } from '../scheduler.js';

/** O(1)-memory mean/variance over an unbounded stream (Welford's algorithm). */
export class Welford {
  constructor() {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
  }

  push(x) {
    this.count += 1;
    const delta = x - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (x - this.mean);
  }

  get variance() {
    return this.count > 1 ? this.m2 / (this.count - 1) : 0;
  }

  get std() {
    return Math.sqrt(this.variance);
  }

  snapshot() {
    return { count: this.count, mean: this.mean, variance: this.variance, std: this.std };
  }
}

/**
 * One incrementally-updated series. Classical methods inside, streaming outside.
 */
export class IncrementalForecaster {
  constructor(options = {}) {
    this.seriesId = options.seriesId ?? 'default';
    this.seasonLength = options.seasonLength ?? null;
    this.horizon = options.horizon ?? 24;
    this.interval = options.interval ?? 80;
    this.method = options.method ?? 'auto';
    this.methods = options.methods ?? null;
    this.damped = options.damped ?? false;
    this.seasonality = options.seasonality ?? 'additive';
    this.features = options.features ?? null;
    this.testSize = options.testSize ?? null;

    this.windowSize = options.windowSize ?? 2000;
    this.minNewPoints = options.minNewPoints ?? 1;
    this.driftWindow = options.driftWindow ?? 30;
    this.driftThreshold = options.driftThreshold ?? 3.0;
    this.reselectEvery = options.reselectEvery ?? 10;

    this.values = [];
    this.times = [];
    this.seen = new Set(); // timestamp dedupe
    this.stats = new Welford(); // full-history aggregates, O(1) memory
    this.recent = []; // bounded ring for drift checks
    this.sliding = new SlidingWindow();

    this.result = null; // last { method, title, point, lower, upper, sigma, ... }
    this.cachedMethod = null;
    this.refreshCount = 0;
    this.newSinceFit = 0;
    this.lastDrift = null;
    this.dirty = true;
  }

  /** Append normalized points. Returns what changed. */
  append(points) {
    const rows = Array.isArray(points) ? points : [points];
    let appended = 0;
    for (const p of rows) {
      if (p.seriesId !== undefined && p.seriesId !== this.seriesId) continue;
      if (this.seen.has(p.t)) continue;
      this.seen.add(p.t);
      this.values.push(p.value);
      this.times.push(p.t);
      this.stats.push(p.value);
      this.recent.push(p.value);
      if (this.recent.length > this.driftWindow * 2) {
        this.recent.splice(0, this.recent.length - this.driftWindow * 2);
      }
      appended += 1;
      this.newSinceFit += 1;
    }
    let dropped = 0;
    if (this.values.length > this.windowSize) {
      dropped = this.values.length - this.windowSize;
      const droppedTimes = this.times.slice(0, dropped);
      this.values.splice(0, dropped);
      this.times.splice(0, dropped);
      for (const t of droppedTimes) this.seen.delete(t);
    }
    if (appended > 0) this.dirty = true;
    return { appended, dropped, total: this.values.length };
  }

  /** Distribution-shift check: recent-window mean vs full-history baseline. */
  checkDrift() {
    if (this.recent.length < 10 || this.stats.count < 20 || this.stats.std <= 0) {
      return { drift: false, reason: 'insufficient-history' };
    }
    const tail = this.recent.slice(-this.driftWindow);
    const recentMean = tail.reduce((s, v) => s + v, 0) / tail.length;
    const z = Math.abs(recentMean - this.stats.mean) / this.stats.std;
    const drift = z > this.driftThreshold;
    const info = { drift, z: round3(z), recentMean: round3(recentMean), baselineMean: round3(this.stats.mean) };
    this.lastDrift = info;
    return info;
  }

  /** Should the cached forecast be recomputed? */
  needsRefresh() {
    if (!this.result) return { refresh: true, reason: 'no-fit' };
    if (!this.dirty) return { refresh: false, reason: 'clean' };
    if (this.newSinceFit >= this.minNewPoints) {
      const drift = this.checkDrift();
      if (drift.drift) return { refresh: true, reason: 'drift', drift };
      return { refresh: true, reason: 'new-points' };
    }
    return { refresh: false, reason: 'below-threshold' };
  }

  /** Recompute only when invalidated; otherwise return the cache. */
  async refresh() {
    const decision = this.needsRefresh();
    if (!decision.refresh) {
      return { result: this.result, recomputed: false, reason: decision.reason, stats: this.stats.snapshot() };
    }
    if (this.values.length < 10) {
      return { result: null, recomputed: false, reason: 'insufficient-data', stats: this.stats.snapshot() };
    }
    const windowed = this.sliding.getWindow(this.values, this.windowSize);
    let method = this.method;
    if (method === 'auto') {
      const reselect = !this.cachedMethod
        || decision.reason === 'drift'
        || this.refreshCount % this.reselectEvery === 0;
      if (reselect) {
        const bt = backtest(windowed, {
          seasonLength: this.seasonLength,
          interval: this.interval,
          testSize: this.testSize ?? defaultTestSize(windowed.length),
          methods: this.methods ?? applicableMethods(windowed.length, this.seasonLength),
          damped: this.damped,
          seasonality: this.seasonality,
          features: this.features,
        });
        method = bt.best;
        this.lastBacktest = { best: bt.best, testSize: bt.testSize, results: bt.results.map((r) => ({ method: r.method, rmse: r.rmse })) };
      } else {
        method = this.cachedMethod;
      }
    }
    const fitted = fit(windowed, method, {
      horizon: this.horizon,
      seasonLength: this.seasonLength,
      interval: this.interval,
      damped: this.damped,
      seasonality: this.seasonality,
      features: this.features,
    });
    this.cachedMethod = method;
    this.refreshCount += 1;
    this.newSinceFit = 0;
    this.dirty = false;
    const lastT = this.times[this.times.length - 1];
    this.result = {
      ...fitted,
      seriesId: this.seriesId,
      fittedAt: new Date().toISOString(),
      fittedPoints: windowed.length,
      lastPointT: lastT,
      drift: this.lastDrift,
    };
    return { result: this.result, recomputed: true, reason: decision.reason, stats: this.stats.snapshot() };
  }

  configure(patch = {}) {
    const keys = ['seasonLength', 'horizon', 'interval', 'method', 'methods', 'damped', 'seasonality', 'features', 'testSize', 'windowSize', 'minNewPoints', 'driftWindow', 'driftThreshold', 'reselectEvery'];
    let changed = false;
    for (const k of keys) {
      if (patch[k] !== undefined && patch[k] !== this[k]) {
        this[k] = patch[k];
        changed = true;
      }
    }
    if (changed) this.dirty = true;
    return changed;
  }

  reset() {
    this.values = [];
    this.times = [];
    this.seen = new Set();
    this.stats = new Welford();
    this.recent = [];
    this.result = null;
    this.cachedMethod = null;
    this.refreshCount = 0;
    this.newSinceFit = 0;
    this.lastDrift = null;
    this.dirty = true;
  }

  snapshot() {
    return {
      seriesId: this.seriesId,
      points: this.values.length,
      firstT: this.times[0] ?? null,
      lastT: this.times[this.times.length - 1] ?? null,
      values: [...this.values],
      times: [...this.times],
      result: this.result,
      cachedMethod: this.cachedMethod,
      refreshCount: this.refreshCount,
      stats: this.stats.snapshot(),
      drift: this.lastDrift,
    };
  }

  /**
   * Hybrid bridge: write a CSV + project file the batch CLI can consume, so
   * legacy reports keep working on a historical snapshot of the stream.
   */
  writeSnapshot(dir) {
    mkdirSync(dir, { recursive: true });
    const lines = ['timestamp,value'];
    for (let i = 0; i < this.values.length; i++) {
      lines.push(`${new Date(this.times[i]).toISOString()},${this.values[i]}`);
    }
    const csvPath = join(dir, `${this.seriesId}.csv`);
    writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
    const project = {
      name: `${this.seriesId}-snapshot`,
      description: `Streaming snapshot written ${new Date().toISOString()}`,
      data: `${this.seriesId}.csv`,
      timeColumn: 'timestamp',
      valueColumn: 'value',
      seasonLength: this.seasonLength,
      horizon: this.horizon,
      interval: this.interval,
      method: this.cachedMethod ?? this.method,
      createdWith: 'forecastlab stream snapshot',
    };
    const projectPath = join(dir, `${this.seriesId}.forecast.json`);
    writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    return { csvPath, projectPath, points: this.values.length };
  }
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
