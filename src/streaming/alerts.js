// Real-time alert triggers with escalation.
//
// Rules watch each refresh: threshold violations on values or forecasts,
// anomaly feedback from the core detector, and distribution-drift signals.
// A condition that persists across consecutive evaluations escalates
// info -> warn -> critical; cooldowns keep noisy series from spamming.
// Delivery is a callback plus an optional webhook POST per rule.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { detectAnomalies } from '../utils/features.js';

function postJson(url, payload, timeoutMs = 5000) {
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

export class AlertManager {
  constructor(options = {}) {
    this.rules = new Map(); // id -> rule
    this.state = new Map(); // `${ruleId}\n${seriesId}` -> { hits, level, lastFiredAt, lastAnomalyKey }
    this.cooldownMs = options.cooldownMs ?? 60000;
    this.escalateAfter = options.escalateAfter ?? 3;
    this.onAlert = options.onAlert ?? null;
    this.stats = { evaluated: 0, fired: 0, escalated: 0 };
    for (const rule of options.rules ?? []) this.addRule(rule);
  }

  addRule(rule) {
    if (!rule || !rule.kind) throw new Error('Rule needs a kind: threshold | anomaly | drift');
    const id = rule.id ?? `${rule.kind}-${this.rules.size}`;
    const full = {
      id,
      seriesId: rule.seriesId ?? '*',
      kind: rule.kind,
      level: rule.level ?? 'warn',
      cooldownMs: rule.cooldownMs ?? this.cooldownMs,
      escalateAfter: rule.escalateAfter ?? this.escalateAfter,
      webhook: rule.webhook ?? null,
      message: rule.message ?? null,
      ...rule,
    };
    this.rules.set(id, full);
    return id;
  }

  removeRule(id) {
    return this.rules.delete(id);
  }

  matches(rule, seriesId) {
    return rule.seriesId === '*' || rule.seriesId === seriesId;
  }

  /**
   * Evaluate all matching rules.
   * ctx: { seriesId, values, forecast?, drift?, stats? }
   */
  async evaluate(ctx) {
    const fired = [];
    this.stats.evaluated += 1;
    for (const rule of this.rules.values()) {
      if (!this.matches(rule, ctx.seriesId)) continue;
      const hit = await this._check(rule, ctx);
      if (!hit.triggered) {
        this._reset(rule, ctx.seriesId);
        continue;
      }
      const alert = this._record(rule, ctx, hit);
      if (alert) {
        fired.push(alert);
        this.stats.fired += 1;
        if (alert.escalated) this.stats.escalated += 1;
        await this._deliver(rule, alert);
      }
    }
    return fired;
  }

  async _check(rule, ctx) {
    if (rule.kind === 'threshold') {
      const series = rule.field === 'forecast' ? ctx.forecast ?? [] : ctx.values ?? [];
      if (series.length === 0) return { triggered: false };
      const op = rule.op ?? 'gt';
      const level = Number(rule.level);
      const hitValue = op === 'gt' || op === 'gte'
        ? Math.max(...series)
        : Math.min(...series);
      const triggered = op === 'gt' ? hitValue > level
        : op === 'gte' ? hitValue >= level
        : op === 'lt' ? hitValue < level
        : hitValue <= level;
      return { triggered, detail: { field: rule.field ?? 'value', op, level, observed: hitValue } };
    }
    if (rule.kind === 'anomaly') {
      const window = (ctx.values ?? []).slice(-(rule.window ?? 100));
      if (window.length < 5) return { triggered: false };
      const report = detectAnomalies(window, rule.options ?? {});
      const anomalies = report.detectedAnomalies ?? [];
      if (anomalies.length === 0) return { triggered: false };
      // Feedback loop: only new anomalies fire immediately, but every anomalous
      // window counts so persistent anomalies escalate toward a refit.
      const key = anomalies.map((a) => `${a.index ?? a.position ?? a}`).join(',');
      const state = this._state(rule, ctx.seriesId);
      const isNew = state.lastAnomalyKey !== key;
      state.lastAnomalyKey = key;
      state.anomalyWindows = (state.anomalyWindows ?? 0) + 1;
      if (!isNew && state.anomalyWindows < 2) return { triggered: false };
      return { triggered: true, detail: { anomalies: anomalies.length, window: window.length }, suggestRefit: state.anomalyWindows >= 2 };
    }
    if (rule.kind === 'drift') {
      if (ctx.drift?.drift) return { triggered: true, detail: ctx.drift, suggestRefit: true };
      return { triggered: false };
    }
    return { triggered: false };
  }

  _key(rule, seriesId) {
    return `${rule.id}\n${seriesId}`;
  }

  _state(rule, seriesId) {
    const key = this._key(rule, seriesId);
    if (!this.state.has(key)) {
      this.state.set(key, { hits: 0, level: 'info', lastFiredAt: 0, lastAnomalyKey: null, anomalyWindows: 0 });
    }
    return this.state.get(key);
  }

  _reset(rule, seriesId) {
    const state = this._state(rule, seriesId);
    state.hits = 0;
    state.level = 'info';
    state.anomalyWindows = 0;
  }

  _record(rule, ctx, hit) {
    const state = this._state(rule, ctx.seriesId);
    state.hits += 1;
    const now = Date.now();
    // Escalate stepwise with persistence: warn after `escalateAfter` consecutive
    // hits, critical after twice that. A level transition always fires.
    const target = state.hits >= 2 * rule.escalateAfter
      ? 'critical'
      : state.hits >= rule.escalateAfter ? 'warn' : 'info';
    const escalated = target !== state.level;
    if (escalated) state.level = target;
    if (now - state.lastFiredAt < rule.cooldownMs && !escalated) return null; // cooldown
    state.lastFiredAt = now;
    const base = rule.message ?? `${rule.kind} alert on ${ctx.seriesId}`;
    return {
      id: `${rule.id}-${ctx.seriesId}-${state.hits}`,
      ruleId: rule.id,
      seriesId: ctx.seriesId,
      kind: rule.kind,
      level: state.level,
      message: base,
      detail: hit.detail ?? null,
      suggestRefit: hit.suggestRefit ?? false,
      hits: state.hits,
      escalated,
      at: new Date(now).toISOString(),
    };
  }

  async _deliver(rule, alert) {
    if (typeof this.onAlert === 'function') {
      try {
        await this.onAlert(alert);
      } catch {}
    }
    if (rule.webhook) {
      await postJson(rule.webhook, alert);
    }
  }

  status() {
    return {
      rules: [...this.rules.values()].map((r) => ({ id: r.id, kind: r.kind, seriesId: r.seriesId })),
      tracked: this.state.size,
      ...this.stats,
    };
  }
}
