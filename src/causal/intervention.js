/**
 * ForecastLab Causal Module - Intervention Simulator & External Factors
 * 
 * "What if we changed X?" simulation using distributed-lag impulse responses,
 * plus external factor integration for holidays/promotions/weather effects.
 */

import { detrend, removeSeasonality, ols, stdDev, mean, variance, tTestPValue, fmtNum } from './math.js';
import { parseWideCsv } from './csv-parse.js';

const DEFAULT_MAX_LAG = 12;
const DEFAULT_ALPHA = 0.05;

/** Baseline projection used when no forecaster is supplied: seasonal naive + drift. */
export function naiveBaseline(values, horizon, seasonLength) {
  const n = values.length;
  if (n === 0) return new Array(horizon).fill(0);
  let drift = 0;
  if (n >= 2) {
    const k = Math.min(n - 1, Math.max(3, Math.floor(n / 4)));
    drift = (values[n - 1] - values[n - 1 - k]) / k;
  }
  if (seasonLength && seasonLength >= 2 && n >= 2 * seasonLength) {
    // Seasonal naive plus drift: repeat the last cycle and extend the trend
    // over the span from each phase's last observation to the forecast point.
    return Array.from({ length: horizon }, (_, h) => {
      const phase = h % seasonLength;
      const base = values[n - seasonLength + phase];
      const span = seasonLength - phase + h;
      return base + drift * span;
    });
  }
  return Array.from({ length: horizon }, (_, h) => values[n - 1] + drift * (h + 1));
}

/**
 * Answer "what if we changed X?" using how the target historically responded
 * to that variable. The response is a distributed-lag model (an impulse
 * response), so a change in X is propagated to Y over time instead of being
 * applied as a single unexplained multiplier.
 */
export class InterventionSimulator {
  /**
   * @param {Object<string, number[]>} series named aligned series (at minimum the variable and target)
   * @param {Object} [options]
   * @param {Function} [options.forecaster] async (values, horizon) => { point, lower, upper } for the no-intervention baseline
   */
  constructor(series, options = {}) {
    this.series = series;
    this.forecaster = options.forecaster ?? null;
    this.responses = new Map();
  }

  /**
   * Fit a distributed-lag response of `target` to `variable`.
   *
   * @param {string} variable cause column
   * @param {string} target effect column
   * @param {Object} [options]
   * @param {number} [options.maxLag] how many lagged terms to include (default 12)
   * @param {number} [options.seasonLength] deseasonalize both series first
   * @returns {{ coefficients: number[], lags: number[], sigma: number, r2: number, cumulative: number, n: number }}
   */
  fitResponse(variable, target, options = {}) {
    const key = `${variable}->${target}:${options.maxLag ?? DEFAULT_MAX_LAG}:${options.seasonLength ?? 'none'}`;
    const cached = this.responses.get(key);
    if (cached) return cached;
    const x = removeSeasonality(detrend(this.series[variable] ?? []), options.seasonLength ?? null);
    const y = removeSeasonality(detrend(this.series[target] ?? []), options.seasonLength ?? null);
    const maxLag = Math.max(1, Math.min(options.maxLag ?? DEFAULT_MAX_LAG, Math.floor(Math.min(x.length, y.length) / 5)));
    const start = maxLag;
    const X = [];
    const Y = [];
    for (let t = start; t < y.length; t++) {
      const row = [1];
      for (let L = 0; L <= maxLag; L++) row.push(x[t - L]);
      X.push(row);
      Y.push(y[t]);
    }
    const fit = ols(X, Y);
    const coefficients = fit.beta.slice(1); // drop intercept
    const result = {
      coefficients,
      lags: coefficients.map((_, i) => i),
      sigma: fit.sigma,
      r2: fit.r2,
      cumulative: coefficients.reduce((a, b) => a + b, 0),
      n: Y.length,
      maxLag,
    };
    this.responses.set(key, result);
    return result;
  }

  /**
   * Simulate an intervention: change `variable` by `change` units for
   * `duration` steps starting at `start`, and see what happens to `target`
   * relative to the world where nothing changed.
   *
   * @param {Object} params
   * @param {string} params.variable cause to intervene on
   * @param {string} params.target series that responds
   * @param {number} params.change units to add (negative lowers it)
   * @param {number} [params.start] step index of the change (default: first future step)
   * @param {number} [params.duration] how long the change persists (default: whole horizon)
   * @param {number} [params.horizon] steps to simulate (default: 24)
   * @param {number} [params.maxLag] response lag depth
   * @param {number} [params.seasonLength] for deseasonalizing the response fit
   * @returns {Promise<Object>} simulation result
   */
  async simulate(params) {
    const { variable, target, change } = params;
    if (!this.series[variable]) throw new Error(`Unknown variable "${variable}"`);
    if (!this.series[target]) throw new Error(`Unknown target "${target}"`);
    if (!Number.isFinite(change)) throw new Error('Intervention needs a numeric --change');

    const horizon = Math.max(1, Math.min(params.horizon ?? 24, 500));
    const start = Math.max(0, params.start ?? 0);
    const duration = Math.max(1, params.duration ?? horizon);
    const response = this.fitResponse(variable, target, {
      maxLag: params.maxLag,
      seasonLength: params.seasonLength,
    });
    const history = this.series[target];

    let baseline;
    let band;
    if (this.forecaster) {
      const f = await this.forecaster(history, horizon);
      baseline = f.point;
      band = { lower: f.lower, upper: f.upper, sigma: f.sigma ?? null };
    } else {
      baseline = naiveBaseline(history, horizon, params.seasonLength);
      const s = stdDev(history);
      band = { lower: null, upper: null, sigma: s };
    }

    // Convolve the intervention pulse with the impulse response.
    const counterfactual = baseline.slice();
    const overlap = new Array(horizon).fill(0);
    for (let h = 0; h < horizon; h++) {
      let delta = 0;
      let active = 0;
      for (let L = 0; L < response.coefficients.length; L++) {
        const pulseStep = h - L; // index into the intervention timeline
        if (pulseStep >= start && pulseStep < start + duration) {
          delta += change * response.coefficients[L];
          active++;
        }
      }
      counterfactual[h] += delta;
      overlap[h] = active;
    }

    const sigmaResp = response.sigma;
    const difference = counterfactual.map((v, h) => ({ step: h + 1, delta: v - baseline[h] }));
    let cumulative = 0;
    for (const d of difference) cumulative += d.delta;

    // Uncertainty: baseline band (if any) widened by the response model's
    // residual noise over the number of overlapping impulse terms.
    const lower = new Array(horizon);
    const upper = new Array(horizon);
    for (let h = 0; h < horizon; h++) {
      const extra = sigmaResp * Math.sqrt(Math.max(overlap[h], 1));
      const lo = band.lower ? band.lower[h] : baseline[h] - 1.28 * (band.sigma ?? sigmaResp);
      const hi = band.upper ? band.upper[h] : baseline[h] + 1.28 * (band.sigma ?? sigmaResp);
      lower[h] = lo + (counterfactual[h] - baseline[h]) - extra;
      upper[h] = hi + (counterfactual[h] - baseline[h]) + extra;
    }

    const peak = difference.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a), difference[0]);
    const warnings = [];
    if (response.r2 < 0.3) {
      warnings.push({
        type: 'WEAK_RESPONSE_MODEL',
        message: `The historical response model explains only ${Math.round(response.r2 * 100)}% of the variance in ${target}; treat the magnitude as indicative, not precise.`,
      });
    }
    const xs = this.series[variable];
    const observedRange = Math.max(...xs) - Math.min(...xs);
    if (observedRange > 0 && Math.abs(change) > observedRange) {
      warnings.push({
        type: 'EXTRAPOLATION',
        message: `The requested change (${fmtNum(change)}) is larger than anything observed in ${variable} (range ${fmtNum(observedRange)}); the response is extrapolated beyond experience.`,
      });
    }

    return {
      variable,
      target,
      change,
      lagDepth: response.coefficients.length - 1,
      baseline: baseline.map((v, h) => ({ step: h + 1, value: v })),
      counterfactual: counterfactual.map((v, h) => ({ step: h + 1, value: v })),
      difference,
      cumulativeImpact: cumulative,
      peakImpact: peak.delta,
      peakStep: peak.step,
      multiplier: change !== 0 ? cumulative / change : 0,
      uncertainty: { lower, upper, sigmaResponse: sigmaResp, sigmaBaseline: band.sigma ?? null },
      responseFunction: response.coefficients.map((c, L) => ({ lag: L, coefficient: c })),
      responseFit: { r2: response.r2, n: response.n, cumulative: response.cumulative },
      interpretation: this._interpret(params, cumulative, peak),
      warnings,
    };
  }

  _interpret(params, cumulative, peak) {
    const dir = cumulative >= 0 ? 'higher' : 'lower';
    return `Changing ${params.variable} by ${fmtNum(params.change)} unit(s) for ${params.duration ?? 'the whole'} step(s) ` +
      `leaves ${params.target} ${dir} by ${fmtNum(Math.abs(cumulative))} cumulative units ` +
      `(peak ${fmtNum(Math.abs(peak.delta))} at step ${peak.step}), based on ${this.series[params.target].length} historical observations.`;
  }

  /**
   * Find natural experiments: points in history where `variable` jumped
   * sharply, so the target's following behaviour can be read as an observed
   * response rather than a simulated one.
   *
   * @param {Object} params
   * @param {string} params.variable cause column
   * @param {string} params.target effect column
   * @param {number} [params.window] steps after the event to measure (default 6)
   * @param {number} [params.minMagnitude] multiple of the |diff| MAD that counts as a jump (default 4)
   * @param {number} [options.seasonLength] deseasonalize before detecting jumps
   * @param {number} [params.maxEvents] cap on returned events (default 10)
   * @returns {Object[]} candidate events, most striking first
   */
  findNaturalExperiments(params) {
    const { variable, target } = params;
    if (!this.series[variable] || !this.series[target]) throw new Error('findNaturalExperiments needs both variable and target');
    const window = Math.max(3, Math.min(params.window ?? 6, 60));
    const maxEvents = Math.max(1, params.maxEvents ?? 10);
    const xs = removeSeasonality(detrend(this.series[variable]), params.seasonLength ?? null);
    const ys = removeSeasonality(detrend(this.series[target]), params.seasonLength ?? null);
    const n = Math.min(xs.length, ys.length);
    if (n < 3 * window + 2) return [];

    const diffs = [];
    for (let i = 1; i < n; i++) diffs.push(Math.abs(xs[i] - xs[i - 1]));
    const sorted = [...diffs].sort((a, b) => a - b);
    const mad = sorted[Math.floor(sorted.length / 2)] || 1;
    const minMagnitude = (params.minMagnitude ?? 4) * mad;

    const candidates = [];
    for (let i = window; i < n - window; i++) {
      const jump = xs[i] - xs[i - 1];
      if (Math.abs(jump) < minMagnitude) continue;
      const pre = ys.slice(i - window, i);
      const post = ys.slice(i, i + window);
      const preMean = mean(pre);
      const postMean = mean(post);
      // Least-squares slope over the pre-window: far more stable than the
      // endpoint difference, which a single noisy point can derail.
      let drift = 0;
      if (window >= 3) {
        const xs = pre.map((_, j) => j);
        const mx = mean(xs);
        let sxy = 0;
        let sxx = 0;
        for (let j = 0; j < window; j++) {
          sxy += (xs[j] - mx) * (pre[j] - preMean);
          sxx += (xs[j] - mx) * (xs[j] - mx);
        }
        const slope = sxx > 0 ? sxy / sxx : 0;
        drift = slope * window;
      }
      const expected = preMean + drift;
      const observed = postMean;
      const response = observed - expected;
      const se = Math.sqrt((variance(pre) + variance(post)) / window) || 1e-9;
      const t = response / se;
      const pValue = tTestPValue(t, 2 * window - 2);
      candidates.push({
        index: i,
        changeInX: this.series[variable][i] - this.series[variable][i - 1],
        changeInXDetrended: jump,
        preMean,
        postMean,
        expected,
        observed,
        response,
        responsePerUnit: Math.abs(jump) > 0 ? response / jump : NaN,
        se,
        tStat: t,
        pValue,
        significant: Number.isFinite(pValue) && pValue < 0.05,
      });
    }
    candidates.sort((a, b) => Math.abs(b.tStat) - Math.abs(a.tStat));
    return candidates.slice(0, maxEvents);
  }
}

/**
 * Temporal decay kernels for event effects. Each maps a step index to the
 * fraction of the event's full effect still in force.
 */
export const DECAY_KERNELS = {
  /** Full effect for the event window, then nothing. */
  box: (t, start, duration) => (t >= start && t < start + duration ? 1 : 0),
  /** Sharp onset, exponential decay (tau = duration / 3). */
  exponential: (t, start, duration) => (t >= start ? Math.exp(-(t - start) / Math.max(duration / 3, 0.5)) : 0),
  /** Ramp up to a peak mid-event, then ramp down. */
  triangular: (t, start, duration) => {
    if (t < start || t >= start + duration) return 0;
    const mid = start + duration / 2;
    return t < mid ? (t - start) / Math.max(mid - start, 0.5) : (start + duration - t) / Math.max(t - mid, 0.5);
  },
  /** Symmetric bell around the event centre. */
  gaussian: (t, start, duration) => {
    const sigma = Math.max(duration / 4, 0.5);
    const centre = start + duration / 2;
    return Math.exp(-0.5 * Math.pow((t - centre) / sigma, 2));
  },
  /** Permanent level shift approached smoothly (tau = duration / 3). */
  step: (t, start, duration) => (t >= start ? 1 - Math.exp(-(t - start) / Math.max(duration / 3, 0.5)) : 0),
};
