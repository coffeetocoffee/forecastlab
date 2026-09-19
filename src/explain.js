// Plain-language teaching layer: what each method assumes, when it works,
// and how to read the results. Shown by `methods` and embedded in reports.

import { METHODS, METHOD_IDS, methodTitle } from './models.js';

const GUIDANCE = {
  naive: {
    useWhen: 'Any series, as a baseline. If nothing beats naive, the data may be a random walk.',
    pitfalls: 'Ignores trend and seasons; lags turning points by definition.',
  },
  snaive: {
    useWhen: 'Strong repeating seasons with little trend (e.g. stable daily cycle).',
    pitfalls: 'Copies last year’s noise too; cannot extrapolate growth.',
  },
  mean: {
    useWhen: 'Stable series hovering around a constant level.',
    pitfalls: 'Disastrous with trends or seasons; slow to react to level shifts.',
  },
  drift: {
    useWhen: 'Roughly straight-line growth or decline.',
    pitfalls: 'Only looks at the endpoints, so one odd first/last value skews everything.',
  },
  linear: {
    useWhen: 'Steady linear trend; uses all history, so it is sturdier than drift.',
    pitfalls: 'Straight lines cannot bend: it misses curves, saturation, and seasons.',
  },
  holt: {
    useWhen: 'Trend whose slope itself changes over time.',
    pitfalls: 'Can chase noise after shocks; wide intervals are honest, not a bug.',
  },
  hw: {
    useWhen: 'Trend plus a repeating seasonal shape (energy, retail, river levels).',
    pitfalls: 'Needs two full seasons minimum; assumes seasons add rather than multiply.',
  },
};

/** Forecast formula for a method variant (only built when a variant changes it). */
function methodMath(id, damped, multiplicative) {
  const trend = damped ? '(phi + phi^2 + ... + phi^h)*b(T)' : 'h*b(T)';
  if (id === 'holt') return `yhat(T+h) = l(T) + ${trend}`;
  if (id === 'hw') {
    return multiplicative
      ? `yhat(T+h) = (l(T) + ${trend}) * s(T+h-m)`
      : `yhat(T+h) = l(T) + ${trend} + s(T+h-m)`;
  }
  return METHODS[id].math;
}

/**
 * Full teaching card for one method. Variants (damped, multiplicative
 * seasonality) adjust the title, the formula, and the guidance so the report
 * explains the model that actually ran.
 */
export function methodCard(id, variant = {}) {
  if (!METHODS[id]) throw new Error(`Unknown method "${id}"`);
  const card = { id, ...METHODS[id], ...GUIDANCE[id] };
  const damped = variant.damped && (id === 'holt' || id === 'hw');
  const multiplicative = id === 'hw' && variant.seasonality === 'multiplicative';
  if (damped) {
    card.title = methodTitle(id, { damped: true, seasonality: variant.seasonality });
    card.summary = `${card.summary} A damping factor phi shrinks the slope with every step, so the forecast flattens instead of extrapolating growth forever.`;
    card.useWhen = 'Trend you trust in the short run but not indefinitely — the safer default at long horizons.';
    card.pitfalls = 'Damping flattens the long-run forecast by construction: it assumes growth decays, which is a guess, not a finding.';
  }
  if (multiplicative) {
    card.title = methodTitle(id, { damped, seasonality: 'multiplicative' });
    card.summary = 'Holt plus a repeating seasonal pattern that multiplies level and trend, so seasonal swings scale with the level of the series.';
    card.useWhen = 'Seasonal amplitude proportional to the level (demand, sales, traffic) — peaks double when the series doubles.';
    card.pitfalls = 'Needs strictly positive data — ratios of negative values are meaningless. Additive is the safer default unless amplitude clearly grows with the level.';
  }
  if (damped || multiplicative) card.math = methodMath(id, damped, multiplicative);
  return card;
}

export function allMethodCards() {
  return METHOD_IDS.map(methodCard);
}

/** One-paragraph reading guide for a backtest table. */
export function describeBacktest(backtest) {
  const best = backtest.results[0];
  const worst = backtest.results[backtest.results.length - 1];
  return (
    `Held out the last ${backtest.testSize} point(s) and forecast them without peeking. ` +
    `${best.title} won with RMSE ${fmt(best.rmse)}; ${worst.title} was worst at ${fmt(worst.rmse)}. ` +
    `RMSE punishes big misses hardest. MASE below 1 means the method beat a naive baseline; ` +
    `MAPE is a percentage error but meaningless near zero values.`
  );
}

/** One-paragraph reading guide for a forecast. */
export function describeForecast(result) {
  const noise = result.intervalMode === 'multiplicative'
    ? `Relative residual noise (sigma) is ${(100 * result.sigma).toFixed(1)}% of the forecast level, so bands scale with it`
    : `Residual noise (sigma) is ${fmt(result.sigma)} in the data's own units`;
  return (
    `${result.title} projects ${result.horizon} step(s) ahead. ` +
    `The shaded band is an approximate ${result.interval}% prediction interval: ` +
    `if the future behaves like the past, about ${result.interval}% of outcomes fall inside. ` +
    `Bands widen with horizon because uncertainty compounds. ` +
    `${noise}.`
  );
}

function fmt(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

export { fmt as fmtNum };
