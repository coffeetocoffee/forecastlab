// StreamingEngine: the hybrid batch/streaming orchestrator.
//
// Connectors emit points -> the priority queue schedules work -> each series'
// IncrementalForecaster refreshes only when invalidated -> alerts evaluate ->
// events publish to the hub (SSE, logs, webhooks). Classical methods inside,
// queue + event loop outside.
//
// Hybrid semantics: in 'stream' mode every point is processed as it arrives;
// in 'batch' mode points accumulate and refreshAll() runs the backlog to
// completion. snapshot()/writeSnapshot() export batch-compatible artifacts so
// `report`, `reproduce` and `diff` keep working on stream data. replay()
// re-feeds recorded events to answer "what would have happened".

import { IncrementalForecaster } from './incremental.js';
import { JobQueue } from './queue.js';
import { AlertManager } from './alerts.js';

/** In-process pub/sub with bounded history. Served over SSE by the workbench. */
export class EventHub {
  constructor(options = {}) {
    this.subscribers = new Set();
    this.history = [];
    this.maxHistory = options.maxHistory ?? 1000;
    this.seq = 0;
  }

  publish(type, payload = {}) {
    const event = { seq: this.seq++, type, at: new Date().toISOString(), ...payload };
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    for (const cb of [...this.subscribers]) {
      try {
        cb(event);
      } catch {}
    }
    return event;
  }

  subscribe(cb, replayHistory = 0) {
    this.subscribers.add(cb);
    if (replayHistory > 0) {
      for (const e of this.history.slice(-replayHistory)) {
        try {
          cb(e);
        } catch {}
      }
    }
    return () => this.subscribers.delete(cb);
  }

  get subscriberCount() {
    return this.subscribers.size;
  }
}

export class StreamingEngine {
  constructor(options = {}) {
    this.mode = options.mode ?? 'stream'; // 'stream' | 'batch'
    this.defaults = {
      seasonLength: options.seasonLength ?? null,
      horizon: options.horizon ?? 24,
      interval: options.interval ?? 80,
      method: options.method ?? 'auto',
      methods: options.methods ?? null,
      damped: options.damped ?? false,
      seasonality: options.seasonality ?? 'additive',
      windowSize: options.windowSize ?? 2000,
      minNewPoints: options.minNewPoints ?? 1,
      driftWindow: options.driftWindow ?? 30,
      driftThreshold: options.driftThreshold ?? 3.0,
      reselectEvery: options.reselectEvery ?? 10,
    };
    this.forecasters = new Map();
    this.connectors = [];
    this.queue = new JobQueue(options.queue ?? {});
    this.alerts = new AlertManager({ ...(options.alerts ?? {}), rules: options.rules ?? [] });
    this.hub = new EventHub({ maxHistory: options.maxHistory ?? 1000 });
    this.startedAt = null;
    this.stats = { points: 0, refreshes: 0, recomputed: 0, alerts: 0 };
  }

  forecasterFor(seriesId) {
    if (!this.forecasters.has(seriesId)) {
      this.forecasters.set(seriesId, new IncrementalForecaster({ seriesId, ...this.defaults }));
    }
    return this.forecasters.get(seriesId);
  }

  addConnector(connector) {
    connector.onPoint((point) => this.ingest(point));
    this.connectors.push(connector);
    return connector;
  }

  async start() {
    this.startedAt = new Date().toISOString();
    for (const c of this.connectors) await c.start();
    this.hub.publish('engine', { event: 'started', mode: this.mode });
    return this;
  }

  async stop() {
    for (const c of this.connectors) await c.stop();
    this.hub.publish('engine', { event: 'stopped' });
    return this;
  }

  setMode(mode) {
    if (mode !== 'stream' && mode !== 'batch') throw new Error("mode must be 'stream' or 'batch'");
    this.mode = mode;
    this.hub.publish('engine', { event: 'mode', mode });
    return mode;
  }

  /** Load baseline history silently (no per-point events), then fit once. */
  async seed(seriesId, points) {
    const f = this.forecasterFor(seriesId);
    const added = f.append(points);
    const refreshed = await f.refresh();
    this.stats.refreshes += 1;
    if (refreshed.recomputed) this.stats.recomputed += 1;
    this.hub.publish('seed', {
      seriesId,
      points: added.appended,
      method: refreshed.result?.method ?? null,
      reason: refreshed.reason,
    });
    return refreshed;
  }

  /** Entry point for every observation, from any connector. */
  ingest(point) {
    this.stats.points += 1;
    if (this.mode === 'batch') {
      const f = this.forecasterFor(point.seriesId);
      f.append([point]);
      return null;
    }
    return this.queue.enqueue({
      label: `refresh:${point.seriesId}`,
      priority: point.priority ?? 'normal',
      run: () => this.processPoint(point),
    });
  }

  async processPoint(point) {
    const f = this.forecasterFor(point.seriesId);
    const added = f.append([point]);
    const refreshed = await f.refresh();
    this.stats.refreshes += 1;
    if (refreshed.recomputed) this.stats.recomputed += 1;
    const ctx = {
      seriesId: point.seriesId,
      values: f.values,
      forecast: refreshed.result?.point ?? [],
      drift: refreshed.result?.drift ?? f.lastDrift,
      stats: refreshed.stats,
    };
    const alerts = await this.alerts.evaluate(ctx);
    this.stats.alerts += alerts.length;
    if (refreshed.recomputed && refreshed.result?.drift?.drift && this.defaults.method === 'auto') {
      // Auto-recommission: a shifted distribution re-runs method selection now.
      f.cachedMethod = null;
      await f.refresh();
    }
    const event = this.hub.publish('update', {
      seriesId: point.seriesId,
      point,
      added,
      recomputed: refreshed.recomputed,
      reason: refreshed.reason,
      method: refreshed.result?.method ?? null,
      horizon: refreshed.result?.horizon ?? null,
      forecast: refreshed.result?.point ?? [],
      lower: refreshed.result?.lower ?? [],
      upper: refreshed.result?.upper ?? [],
      alerts: alerts.map((a) => ({ id: a.id, level: a.level, message: a.message })),
    });
    for (const alert of alerts) this.hub.publish('alert', { seriesId: point.seriesId, alert });
    return { event, refreshed, alerts };
  }

  /** Batch mode: run the whole backlog to completion, then report. */
  async refreshAll() {
    const out = [];
    for (const [seriesId, f] of this.forecasters) {
      const refreshed = await f.refresh();
      this.stats.refreshes += 1;
      if (refreshed.recomputed) this.stats.recomputed += 1;
      const alerts = await this.alerts.evaluate({
        seriesId,
        values: f.values,
        forecast: refreshed.result?.point ?? [],
        drift: refreshed.result?.drift ?? f.lastDrift,
        stats: refreshed.stats,
      });
      this.stats.alerts += alerts.length;
      out.push({ seriesId, recomputed: refreshed.recomputed, reason: refreshed.reason, alerts });
    }
    await this.queue.drain();
    return out;
  }

  async drain(timeoutMs) {
    return this.queue.drain(timeoutMs);
  }

  snapshot(seriesId) {
    if (seriesId) {
      const f = this.forecasters.get(seriesId);
      return f ? f.snapshot() : null;
    }
    return [...this.forecasters.values()].map((f) => f.snapshot());
  }

  writeSnapshot(dir, seriesId) {
    const targets = seriesId ? [this.forecasters.get(seriesId)].filter(Boolean) : [...this.forecasters.values()];
    return targets.map((f) => f.writeSnapshot(dir));
  }

  /**
   * Replay recorded events to answer "what would have happened".
   * Resets forecaster state first so history doesn't leak into the replay.
   */
  async replay(events, options = {}) {
    const rows = Array.isArray(events) ? events : [];
    for (const f of this.forecasters.values()) f.reset();
    const results = [];
    for (const e of rows) {
      const point = e.point ?? e;
      if (point.value === undefined || point.t === undefined) continue;
      const out = await this.processPoint({ ...point, seriesId: point.seriesId ?? options.seriesId ?? 'default' });
      results.push(out);
    }
    await this.queue.drain();
    return { processed: results.length, snapshots: this.snapshot() };
  }

  history(n = 50) {
    return this.hub.history.slice(-n);
  }

  status() {
    return {
      mode: this.mode,
      startedAt: this.startedAt,
      series: [...this.forecasters.keys()],
      connectors: this.connectors.map((c) => c.status()),
      queue: this.queue.status(),
      alerts: this.alerts.status(),
      subscribers: this.hub.subscriberCount,
      ...this.stats,
    };
  }
}
