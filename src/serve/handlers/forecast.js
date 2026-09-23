/**
 * HTTP request handlers for forecasting operations.
 */

import {
  summarizeSeries,
  applicableMethods,
  backtest,
  fit,
  futureTimes,
  shortLabel,
  buildChartSvg,
  methodCard,
  allMethodCards,
  describeBacktest,
  describeForecast,
} from '../../index.js';

import { toOpts } from './params.js';

/** Same backtest the report command runs: every applicable method, ranked by RMSE. */
export function runBacktest(input) {
  const ids = applicableMethods(input.values.length, input.config.seasonLength);
  if (ids.length === 0) return null;
  return backtest(input.values, {
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    testSize: input.config.testSize ?? undefined,
    methods: input.config.methods ?? ids,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
  });
}

/**
 * Handle /api/summary endpoint - data quality check and summary statistics.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Object}
 */
export function handleSummary(searchParams, defaults) {
  const { inputFrom } = require('./params.js');
  const input = inputFrom(searchParams, defaults);
  return {
    config: input.config,
    summary: summarizeSeries(input.parsed.points, input.validation),
    issues: input.validation.issues,
    skipped: input.parsed.skipped.length,
    applicable: applicableMethods(input.values.length, input.config.seasonLength),
  };
}

/**
 * Handle /api/compare endpoint - backtest multiple methods.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Object}
 */
export function handleCompare(searchParams, defaults) {
  const { inputFrom } = require('./params.js');
  const input = inputFrom(searchParams, defaults);
  const bt = runBacktest(input);
  return {
    config: input.config,
    backtest: bt,
    reading: bt ? describeBacktest(bt) : null,
  };
}

/**
 * Handle /api/forecast endpoint - generate forecast with chart.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Object}
 */
export function handleForecast(searchParams, defaults) {
  const { inputFrom } = require('./params.js');
  const opts = toOpts(searchParams, defaults);
  const input = inputFrom(searchParams, defaults);
  const wanted = opts.method ?? 'auto';
  let bt = null;
  let methodId;
  if (wanted === 'auto') {
    bt = runBacktest(input);
    if (!bt) throw new Error('No forecasting method applies to this data (too short, or set a season length)');
    methodId = bt.best;
  } else {
    methodId = wanted;
  }
  const f = fit(input.values, methodId, {
    horizon: input.config.horizon,
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
  });
  const times = futureTimes(input.parsed.points, input.validation.stepMs, f.horizon);
  const labels = input.parsed.points.map((p) => shortLabel(p.iso, input.validation.stepMs));
  const chart = buildChartSvg({
    labels,
    values: input.values,
    splitIndex: bt ? bt.splitIndex : null,
    forecast: f.point,
    lower: f.lower,
    upper: f.upper,
    interval: f.interval,
  });
  return {
    config: input.config,
    stepMs: input.validation.stepMs,
    forecast: {
      method: f.method,
      title: f.title,
      horizon: f.horizon,
      interval: f.interval,
      sigma: f.sigma,
      intervalMode: f.intervalMode,
      damped: f.damped,
      seasonality: f.seasonality,
      params: f.params,
      steps: f.point.map((p, k) => ({
        step: k + 1,
        time: times[k] ?? null,
        point: p,
        lower: f.lower[k],
        upper: f.upper[k],
      })),
    },
    chart,
    reading: describeForecast(f),
    card: methodCard(methodId, { damped: input.config.damped, seasonality: input.config.seasonality }),
    autoSelected: wanted === 'auto',
    bestMethod: bt ? bt.best : null,
  };
}
