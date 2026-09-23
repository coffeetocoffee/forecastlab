/**
 * ForecastLab Causal Module - External Factor Integrator & Holiday Calendar
 * 
 * Import known external events (holidays, promotions, weather readings) and
 * measure their effect on a target series with an explicit, inspectable
 * regression rather than a trained black box.
 */

import { mean, stdDev, ols } from './math.js';
import { parseWideCsv } from './csv-parse.js';
import { DECAY_KERNELS } from './intervention.js';

const DEFAULT_ALPHA = 0.05;

/**
 * Import known external events (holidays, promotions, weather readings) and
 * measure their effect on a target series with an explicit, inspectable
 * regression rather than a trained black box.
 */
export class ExternalFactorIntegrator {
  /**
   * @param {number[]} [times] observation timestamps in ms; enables date -> index mapping for events
   */
  constructor(times) {
    this.times = times && Array.isArray(times) ? times : null;
    this.factors = new Map();
    this.lastFit = null;
  }

  /** Look up the step index of a timestamp. Returns null when the date falls before the observations. */
  timeToIndex(when) {
    if (typeof when === 'number' && Number.isInteger(when)) return when;
    if (!this.times) throw new Error('This integrator was built without timestamps; pass a step index instead of a date');
    const ms = typeof when === 'string' ? Date.parse(when) : when;
    if (!Number.isFinite(ms)) throw new Error(`Cannot parse date "${when}"`);
    if (ms < this.times[0]) return null; // before the first observation: no effect to estimate
    let lo = 0;
    let hi = this.times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Register an event factor (a holiday, a promotion, a storm).
   *
   * @param {string} name factor label
   * @param {Object} params
   * @param {number|string} params.start step index or date when the event begins
   * @param {number} [params.duration] steps the event spans (default 1)
   * @param {string} [params.decay] kernel: box | exponential | triangular | gaussian | step (default box)
   * @param {number} [params.effect] expected effect size; used as a prior scale, the regression still estimates its own coefficient
   */
  addEventFactor(name, params) {
    const start = this.timeToIndex(params.start);
    const duration = Math.max(1, params.duration ?? 1);
    const decay = DECAY_KERNELS[params.decay] ? params.decay : 'box';
    this.factors.set(name, {
      name,
      type: 'event',
      start: start ?? 0,
      outOfRange: start === null,
      duration,
      decay,
      effect: Number.isFinite(params.effect) ? params.effect : null,
      // Out-of-range events build an all-zero column on purpose, so the fit
      // reports them as unidentifiable instead of silently clamping them onto
      // the first observation.
      build: start === null
        ? (n) => new Array(n).fill(0)
        : (n) => Array.from({ length: n }, (_, t) => DECAY_KERNELS[decay](t, start, duration)),
    });
    return this;
  }

  /**
   * Register a numeric covariate aligned to the target (a weather series, a
   * price series). Shorter series are padded with their mean; longer ones
   * are truncated.
   */
  addSeriesFactor(name, values, options = {}) {
    if (!Array.isArray(values)) throw new Error(`Series factor "${name}" needs a numeric array`);
    this.factors.set(name, {
      name,
      type: 'series',
      build: (n) => {
        const v = values.slice(0, n);
        const m = mean(v.filter(Number.isFinite));
        const out = v.map((x) => (Number.isFinite(x) ? x : m));
        while (out.length < n) out.push(m);
        return out;
      },
    });
    return this;
  }

  /** Import many event factors at once: [{ name, start, duration, decay, effect }]. */
  importEvents(events) {
    if (!Array.isArray(events)) throw new Error('importEvents needs an array of event descriptors');
    for (const e of events) {
      if (!e.name) throw new Error('Every event needs a name');
      this.addEventFactor(e.name, e);
    }
    return this;
  }

  /** Import event factors from a JSON file's parsed contents ({ events: [...] } or [...]). */
  importEventsJson(parsed) {
    const list = Array.isArray(parsed) ? parsed : parsed?.events;
    if (!Array.isArray(list)) throw new Error('Expected an array or { events: [...] }');
    return this.importEvents(list);
  }

  /**
   * Import series factors from a wide CSV (timestamp plus one column per
   * factor). Factors are aligned to the target by row order.
   */
  importCsv(text, options = {}) {
    const parsed = parseWideCsv(text, options);
    for (const col of parsed.valueColumns) this.addSeriesFactor(col, parsed.columns[col]);
    return this;
  }

  /** Names of all registered factors. */
  factorNames() {
    return Array.from(this.factors.keys());
  }

  /**
   * Build the design matrix for the first n steps. When a season length is
   * given, Fourier terms of the daily cycle enter as controls, so event
   * effects are measured against a seasonal baseline instead of raw noise.
   */
  designMatrix(n, options = {}) {
    const cols = [];
    const names = [];
    cols.push(new Array(n).fill(1)); // intercept
    names.push('(intercept)');
    if (options.trend !== false) {
      cols.push(Array.from({ length: n }, (_, t) => t));
      names.push('(trend)');
    }
    const seasonLength = options.seasonLength ?? null;
    const harmonics = Math.max(1, Math.min(options.harmonics ?? 3, 6));
    if (seasonLength && seasonLength >= 2) {
      for (let k = 1; k <= harmonics; k++) {
        cols.push(Array.from({ length: n }, (_, t) => Math.sin((2 * Math.PI * k * t) / seasonLength)));
        names.push(`(fourier sin k=${k})`);
        cols.push(Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * k * t) / seasonLength)));
        names.push(`(fourier cos k=${k})`);
      }
    }
    for (const factor of this.factors.values()) {
      cols.push(factor.build(n));
      names.push(factor.name);
    }
    return { X: Array.from({ length: n }, (_, i) => cols.map((c) => c[i])), names };
  }

  /**
   * Fit the factor model to a target series and keep the result for
   * importance ranking and projection.
   *
   * @param {number[]} targetValues series to explain
   * @param {Object} [options]
   * @param {boolean} [options.trend=true] include a linear trend term
   * @param {number} [options.seasonLength] season length; Fourier controls for the cycle are added so events are measured against a seasonal baseline
   * @param {number} [options.harmonics=3] number of Fourier harmonics
   * @returns {Object} fit summary with per-factor statistics
   */
  fit(targetValues, options = {}) {
    const n = targetValues.length;
    let { X, names } = this.designMatrix(n, options);

    // A factor that never varies (e.g. a holiday outside the observation
    // window) has an unidentifiable coefficient and makes the whole system
    // singular. Drop those and say so, rather than emitting silence.
    const dropped = [];
    const keep = names.map((name, j) => {
      if (name.startsWith('(')) return true;
      const col = X.map((row) => row[j]);
      const sd = stdDev(col);
      if (!Number.isFinite(sd) || sd < 1e-12) {
        dropped.push(name);
        return false;
      }
      return true;
    });
    if (dropped.length > 0) {
      X = X.map((row) => row.filter((_, j) => keep[j]));
      names = names.filter((_, j) => keep[j]);
    }

    const result = ols(X, targetValues.slice(0, n));
    const controlSet = new Set(names.filter((name) => name.startsWith('(')));
    const perFactor = names.map((name, j) => {
      const col = X.map((row) => row[j]);
      const sd = stdDev(col);
      return {
        name,
        coefficient: result.beta[j],
        stdError: result.se[j],
        tStat: result.t[j],
        pValue: result.p[j],
        significant: Number.isFinite(result.p[j]) && result.p[j] < (options.alpha ?? DEFAULT_ALPHA),
        // Impact magnitude: how much the factor moves the target across its
        // own typical range. This is the importance ranking quantity.
        impact: Number.isFinite(sd) ? Math.abs(result.beta[j] * sd) : 0,
        type: controlSet.has(name) ? 'control' : (this.factors.has(name) ? this.factors.get(name).type : 'control'),
      };
    });
    this.lastFit = {
      names,
      coefficients: result.beta,
      r2: result.r2,
      sigma: result.sigma,
      df: result.df,
      n,
      regularized: result.regularized,
      dropped,
      seasonLength: options.seasonLength ?? null,
      factors: perFactor,
    };
    return this.lastFit;
  }

  /**
   * Rank factors by impact magnitude (absolute effect on the target across
   * the factor's observed range), with significance alongside.
   */
  rankFactors() {
    if (!this.lastFit) throw new Error('Call fit(targetValues) before ranking factors');
    return this.lastFit.factors
      .filter((f) => f.type !== 'control')
      .slice()
      .sort((a, b) => b.impact - a.impact);
  }

  /** Predict the target from the fitted model over the first n steps. */
  predict(n) {
    if (!this.lastFit) throw new Error('Call fit(targetValues) before predicting');
    const { X } = this.designMatrix(n, {
      trend: this.lastFit.names.includes('(trend)'),
      seasonLength: this.lastFit.seasonLength,
    });
    return X.map((row) => row.reduce((s, v, j) => {
      const idx = this.lastFit.names[j];
      return s + (idx !== undefined ? v * this.lastFit.coefficients[j] : 0);
    }, 0));
  }

  /**
   * Apply a factor's fitted effect to a baseline path (e.g. a forecast),
   * honouring its decay kernel. Useful for "add next week's promotion to the
   * forecast" without refitting anything.
   */
  applyFactor(baseline, name, start, duration = 1, decay = 'box') {
    if (!this.lastFit) throw new Error('Call fit(targetValues) before applying factor effects');
    const factor = this.lastFit.factors.find((f) => f.name === name);
    const coef = factor ? factor.coefficient : 0;
    const kernel = DECAY_KERNELS[decay] ?? DECAY_KERNELS.box;
    const n = baseline.length;
    const out = baseline.slice();
    for (let t = 0; t < n; t++) out[t] += coef * kernel(t, start, duration);
    return out;
  }
}

/**
 * A small local holiday calendar. Fixed arithmetic only - no network, no
 * timezone assumptions beyond UTC, and no claim of completeness. Use it as a
 * starting set and add your own events with importEvents.
 */
export function holidayCalendar(options = {}) {
  const from = options.from ?? new Date().getUTCFullYear();
  const to = options.to ?? from;
  if (to < from) throw new Error('holidayCalendar: "to" must be >= "from"');
  const events = [];

  // Fixed-date holidays.
  const fixed = [
    ['new-year', '01-01', 1, 'box'],
    ['valentines', '02-14', 3, 'gaussian'],
    ['easter-monday', null, 2, 'gaussian'],
    ['juneteenth', '06-19', 1, 'box'],
    ['us-independence', '07-04', 1, 'box'],
    ['halloween', '10-31', 3, 'triangular'],
    ['christmas', '12-25', 3, 'box'],
    ['new-years-eve', '12-31', 2, 'triangular'],
  ];
  // US floating holidays (nth weekday of a month).
  const nthWeekday = (year, month, weekday, n) => {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, month, d));
      if (dt.getUTCMonth() !== month) break;
      if (dt.getUTCDay() === weekday) {
        count++;
        if (count === n) return dt;
      }
    }
    return null;
  };
  // Anonymous (Gregorian) Easter via Meeus/Jones/Butcher.
  const easter = (year) => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month, day));
  };

  for (let year = from; year <= to; year++) {
    for (const [name, mmdd, duration, decay] of fixed) {
      if (!mmdd) continue;
      events.push({ name: `${name}-${year}`, start: `${year}-${mmdd}`, duration, decay });
    }
    const em = easter(year);
    if (em) events.push({ name: `easter-monday-${year}`, start: em.toISOString().slice(0, 10), duration: 2, decay: 'gaussian' });
    const mlk = nthWeekday(year, 0, 1, 3);
    const presidents = nthWeekday(year, 1, 1, 3);
    const memorial = nthWeekday(year, 4, 1, -1);
    const labor = nthWeekday(year, 8, 1, 1);
    const columbus = nthWeekday(year, 9, 1, 2);
    const veterans = nthWeekday(year, 10, 1, 4);
    const thanks = nthWeekday(year, 10, 4, 4);
    const fridayAfter = thanks ? new Date(thanks.getTime() + 86400000) : null;
    const cyber = fridayAfter ? new Date(fridayAfter.getTime() + 86400000) : null;
    for (const [name, dt, duration, decay] of [
      ['mlk-day', mlk, 1, 'box'],
      ['presidents-day', presidents, 1, 'box'],
      ['memorial-day', memorial, 1, 'box'],
      ['labor-day', labor, 1, 'box'],
      ['columbus-day', columbus, 1, 'box'],
      ['veterans-day', veterans, 1, 'box'],
      ['thanksgiving', thanks, 2, 'triangular'],
      ['black-friday', fridayAfter, 3, 'triangular'],
      ['cyber-monday', cyber, 4, 'exponential'],
    ]) {
      if (dt) events.push({ name: `${name}-${year}`, start: dt.toISOString().slice(0, 10), duration, decay });
    }
  }
  return events;
}
