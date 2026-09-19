// Explainable classical forecasting methods. No ML, no network, no dependencies.
// Each fit returns point forecasts plus prediction intervals that widen with horizon.
//
// New Tier-1 features (evaluate.js):
// - rollingOriginBacktest(): K-fold expanding-window backtesting
// - dieboldMarianoTest(): Statistical significance testing between methods
// - ljungBoxTest(): Residual autocorrelation diagnostics
// - normCdf(): Standard normal CDF for p-value computation
//
// New Tier-2 Features Implemented:
// 1. STL Decomposition - Seasonal-Trend-Loose decomposition with visualizations
// 2. Theta Method - Competition-winning method with standard/damped variants
// 3. Croston's Method - For intermittent demand handling zeros/sparcity
// 4. Box-Cox Transform - Handle multiplicative seasonality via transformation
//
// Phase 1 Features:
// 5. Exogenous Regressors & Fourier Terms - GLM-based forecasting with external features
//    (Still classical statistics, NOT machine learning)

import { stlDecompose, stlForecast } from './methods/stl.js';
import { thetaMethod } from './methods/theta.js';
import { crostonMethod } from './methods/croston.js';
import { transformFitBackTransform, findOptimalLambda } from './methods/boxcox.js';
import { fourierFeatures, fourierForecast, validateFourierFeatures } from './utils/fourier.js';

export const INTERVAL_Z = { 80: 1.2816, 90: 1.6449, 95: 1.96 };

export const METHODS = {
  naive: {
    title: 'Naive',
    summary: 'Tomorrow equals today. The simplest possible baseline every other method must beat.',
    math: 'yhat(T+h) = y(T)',
  },
  snaive: {
    title: 'Seasonal naive',
    summary: 'Same season, last cycle. Copies the observation from one full season ago.',
    math: 'yhat(T+h) = y(T+h-m),  m = season length',
    needsSeason: true,
  },
  mean: {
    title: 'Mean',
    summary: 'The historical average, extended flat into the future. Strong when data has no trend.',
    math: 'yhat(T+h) = mean(y)',
  },
  drift: {
    title: 'Drift',
    summary: 'Naive plus a steady slope: the line through the first and last observation.',
    math: 'yhat(T+h) = y(T) + h * (y(T)-y(1)) / (T-1)',
  },
  linear: {
    title: 'Linear trend',
    summary: 'Least-squares straight line through all history. Uses every point, not just the ends.',
    math: 'yhat(T+h) = a + b*(T+h),  a,b minimise sum of squared errors',
  },
  holt: {
    title: "Holt's linear trend",
    summary: 'Exponential smoothing with a level and a trend that adapt to recent changes.',
    math: 'l(t) = a*y(t) + (1-a)*(l(t-1)+b(t-1));  b(t) = c*(l(t)-l(t-1)) + (1-c)*b(t-1)',
  },
  hw: {
    title: 'Holt-Winters additive',
    summary: 'Holt plus a repeating seasonal pattern added on top. Best for data with trend and seasons.',
    math: 'yhat(T+h) = l(T) + h*b(T) + s(T+h-m)',
    needsSeason: true,
  },
  // Tier-2 Methods
  stl: {
    title: 'STL Decomposition',
    summary: 'Decomposes series into trend + seasonal + remainder components using robust local regression.',
    math: 'y(t) = T(t) + S(t) + R(t)',
    needsSeason: true,
    minPointsFactor: 2,
  },
  theta: {
    title: 'Theta Method',
    summary: 'Competition-winning method splitting series into two "theta lines" combined equally.',
    math: 'yhat = 0.5 × θ₁(flat) + 0.5 × θ₂(curved)',
    minPoints: 3,
  },
  croston: {
    title: "Croston's Method",
    summary: 'Models intermittent demand by separating size and interval estimation.',
    math: 'forecast = z̄/p̄ where z̄=smoothed size, p̄=smoothed interval',
    minPoints: 4,
  },
  boxcox: {
    title: 'Box-Cox Transformed',
    summary: "Applies optimal power transformation then fits model, back-transforms forecast.",
    math: 'y(λ) = (y^λ-1)/λ for λ≠0, or ln(y) for λ=0',
    minPoints: 10,
  },
  // Phase 1: Exogenous Regression with Fourier Terms
  glm: {
    title: 'GLM with Exogenous Features',
    summary: 'Linear regression with user-specified features (Fourier terms, dummies, external regressors). Most flexible classical approach.',
    math: 'y(t) = β₀ + β₁·X₁(t) + β₂·X₂(t) + ... + ε(t)',
    minPoints: 10,
    requiresFeatures: true,
  },
};

export const METHOD_IDS = Object.keys(METHODS);

/** Display title for a method, including the damped/multiplicative variant. */
export function methodTitle(id, { damped = false, seasonality = 'additive' } = {}) {
  if (id === 'holt') return damped ? "Holt's damped trend" : "Holt's linear trend";
  if (id === 'hw') {
    const s = seasonality === 'multiplicative' ? 'multiplicative' : 'additive';
    return damped ? `Holt-Winters ${s} (damped)` : `Holt-Winters ${s}`;
  }
  return METHODS[id].title;
}

/** Minimum history length a method needs (seasonal ones depend on m). */
export function minPointsFor(methodId, seasonLength) {
  switch (methodId) {
    case 'naive': return 2;
    case 'mean': return 2;
    case 'drift': return 2;
    case 'linear': return 3;
    case 'holt': return 4;
    case 'snaive': return (seasonLength ?? 0) + 1;
    case 'hw': return 2 * (seasonLength ?? 0);
    // Tier-2 Methods
    case 'stl': 
      if (!seasonLength) throw new Error('STL decomposition requires --season parameter');
      return 2 * (seasonLength ?? 0); // At least 2 full cycles
    case 'theta': return 3;
    case 'croston': return 4;
    case 'boxcox': return 10;
    // Phase 1: GLM with features needs at least as many observations as parameters
    case 'glm': return 10; // Minimum reasonable sample size
    default: throw new Error(`Unknown method "${methodId}". Known: ${METHOD_IDS.join(', ')}`);
  }
}

export function applicableMethods(count, seasonLength) {
  return METHOD_IDS.filter((id) => {
    if (METHODS[id].needsSeason && !seasonLength) return false;
    return count >= minPointsFor(id, seasonLength);
  });
}

function checkFitInput(values, methodId, { horizon, seasonLength, interval, damped, seasonality, lambda, features }) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('No data to forecast');
  if (!METHODS[methodId]) throw new Error(`Unknown method "${methodId}". Known: ${METHOD_IDS.join(', ')}`);
  if (!Number.isInteger(horizon) || horizon < 1) throw new Error('--horizon must be a positive integer');
  if (horizon > 10000) throw new Error('--horizon is capped at 10000 steps');
  if (!INTERVAL_Z[interval]) throw new Error('--interval must be one of 80, 90, 95');
  if (seasonality !== undefined && !['additive', 'multiplicative'].includes(seasonality)) {
    throw new Error('--seasonality must be additive or multiplicative');
  }
  if (seasonality === 'multiplicative' && methodId === 'hw') {
    const smallest = values.reduce((m, v) => Math.min(m, v), Infinity);
    if (!(smallest > 0)) {
      throw new Error(`Multiplicative seasonality needs strictly positive values; the smallest value is ${smallest}`);
    }
  }
  if (METHODS[methodId].needsSeason) {
    if (!Number.isInteger(seasonLength) || seasonLength < 2) {
      throw new Error(`Method "${methodId}" needs --season <length>=2 (e.g. 24 for hourly data with a daily cycle)`);
    }
  }
  
  // Box-Cox specific validation
  if (methodId === 'boxcox') {
    const minVal = values.reduce((m, v) => Math.min(m, v), Infinity);
    if (minVal <= 0 && lambda !== 0) {
      throw new Error(`Box-Cox with λ=${lambda} requires strictly positive values; minimum is ${minVal}. Use λ=0 (log transform) only with positive data.`);
    }
  }
  
  // GLM-specific validation: requires features
  if (methodId === 'glm') {
    if (!features || !features.matrix || !Array.isArray(features.matrix) || features.matrix.length === 0) {
      throw new Error('GLM method requires features matrix. Use fourierFeatures() or similar to generate features.');
    }
    const validation = validateFourierFeatures(features);
    if (!validation.valid) {
      throw new Error(`Invalid features for GLM: ${validation.errors.join(', ')}`);
    }
  }
  
  const need = minPointsFor(methodId, seasonLength);
  if (values.length < need) {
    throw new Error(`Method "${methodId}" needs at least ${need} points, got ${values.length}`);
  }
}

function rootMeanSquare(errors, nParams) {
  const denom = Math.max(errors.length - nParams, 1);
  return Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / denom);
}

function withIntervals(points, sigma, z) {
  const point = [];
  const lower = [];
  const upper = [];
  for (let h = 1; h <= points.length; h++) {
    const half = z * sigma * Math.sqrt(h); // uncertainty grows with horizon
    point.push(points[h - 1]);
    lower.push(points[h - 1] - half);
    upper.push(points[h - 1] + half);
  }
  return { point, lower, upper };
}

/**
 * Multiplicative counterpart: sigma is a unitless relative error, so the band
 * is a fraction of the point forecast and scales with the level. A
 * multiplicative model cannot forecast below zero, so the lower bound is
 * clamped there instead of crossing it.
 */
function withMultiplicativeIntervals(points, sigma, z) {
  const point = [];
  const lower = [];
  const upper = [];
  for (let h = 1; h <= points.length; h++) {
    const half = z * sigma * Math.sqrt(h);
    point.push(points[h - 1]);
    lower.push(Math.max(0, points[h - 1] * (1 - half)));
    upper.push(points[h - 1] * (1 + half));
  }
  return { point, lower, upper };
}

function fitNaive(values) {
  const errors = [];
  for (let t = 1; t < values.length; t++) errors.push(values[t] - values[t - 1]);
  return { oneStep: (t) => values[t - 1], errors, nParams: 0, params: {} };
}

function fitSeasonalNaive(values, m) {
  const errors = [];
  for (let t = m; t < values.length; t++) errors.push(values[t] - values[t - m]);
  return { oneStep: (t) => values[t - m], errors, nParams: 0, params: { seasonLength: m } };
}

function fitMean(values) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { oneStep: () => mean, errors: values.map((v) => v - mean), nParams: 1, params: { mean } };
}

function fitDrift(values) {
  const n = values.length;
  const slope = (values[n - 1] - values[0]) / (n - 1);
  return {
    oneStep: (t) => values[0] + slope * t,
    errors: values.map((v, t) => v - (values[0] + slope * t)),
    nParams: 1,
    params: { slope, first: values[0], last: values[n - 1] },
  };
}

function fitLinear(values) {
  const n = values.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let t = 0; t < n; t++) {
    sx += t; sy += values[t]; sxx += t * t; sxy += t * values[t];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) throw new Error('Linear trend needs varying time indices');
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return {
    oneStep: (t) => intercept + slope * t,
    errors: values.map((v, t) => v - (intercept + slope * t)),
    nParams: 2,
    params: { intercept, slope },
  };
}

const GRID_FINE = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const GRID_COARSE = [0.1, 0.3, 0.5, 0.7, 0.9];
const GRID_DAMP = [0.3, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98];

/** phi + phi^2 + ... + phi^h: the total trend a damped model extrapolates. */
function geomSum(phi, h) {
  if (phi >= 1) return h;
  return (phi * (1 - phi ** h)) / (1 - phi);
}

function runHolt(values, alpha, beta) {
  let level = values[0];
  let trend = values[1] - values[0];
  const errors = [];
  for (let t = 1; t < values.length; t++) {
    const f = level + trend;
    errors.push(values[t] - f);
    const prevLevel = level;
    level = alpha * values[t] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const sse = errors.reduce((s, e) => s + e * e, 0);
  return { sse, errors, level, trend };
}

function fitHolt(values) {
  let best = null;
  for (const alpha of GRID_FINE) {
    for (const beta of GRID_FINE) {
      const r = runHolt(values, alpha, beta);
      if (!best || r.sse < best.sse) best = { alpha, beta, ...r };
    }
  }
  return {
    oneStep: null,
    errors: best.errors,
    nParams: 2,
    params: { alpha: best.alpha, beta: best.beta, level: best.level, trend: best.trend },
    forecast: (h) => best.level + h * best.trend,
  };
}

/** Damped variant: each step multiplies the carried slope by phi (ETS(A,Ad,N)). */
function runHoltDamped(values, alpha, beta, phi) {
  let level = values[0];
  let trend = values[1] - values[0];
  const errors = [];
  for (let t = 1; t < values.length; t++) {
    const f = level + phi * trend;
    errors.push(values[t] - f);
    const prevLevel = level;
    level = alpha * values[t] + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }
  const sse = errors.reduce((s, e) => s + e * e, 0);
  return { sse, errors, level, trend };
}

function fitHoltDamped(values) {
  let best = null;
  for (const alpha of GRID_FINE) {
    for (const beta of GRID_FINE) {
      for (const phi of GRID_DAMP) {
        const r = runHoltDamped(values, alpha, beta, phi);
        if (!best || r.sse < best.sse) best = { alpha, beta, phi, ...r };
      }
    }
  }
  return {
    oneStep: null,
    errors: best.errors,
    nParams: 3,
    params: { alpha: best.alpha, beta: best.beta, phi: best.phi, level: best.level, trend: best.trend },
    forecast: (h) => best.level + geomSum(best.phi, h) * best.trend,
  };
}

function runHwAdditive(values, m, alpha, beta, gamma) {
  const n = values.length;
  const avg1 = values.slice(0, m).reduce((s, v) => s + v, 0) / m;
  const avg2 = values.slice(m, 2 * m).reduce((s, v) => s + v, 0) / m;
  let level = avg1;
  let trend = (avg2 - avg1) / m;
  const seasonal = new Array(n).fill(0);
  for (let i = 0; i < m; i++) seasonal[i] = values[i] - avg1;
  const errors = [];
  for (let t = m; t < n; t++) {
    const f = level + trend + seasonal[t - m];
    errors.push(values[t] - f);
    const prevLevel = level;
    level = alpha * (values[t] - seasonal[t - m]) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[t] = gamma * (values[t] - level) + (1 - gamma) * seasonal[t - m];
  }
  const sse = errors.reduce((s, e) => s + e * e, 0);
  return { sse, errors, level, trend, seasonal };
}

function fitHwAdditive(values, m) {
  let best = null;
  for (const alpha of GRID_COARSE) {
    for (const beta of GRID_COARSE) {
      for (const gamma of GRID_COARSE) {
        const r = runHwAdditive(values, m, alpha, beta, gamma);
        if (!best || r.sse < best.sse) best = { alpha, beta, gamma, ...r };
      }
    }
  }
  const n = values.length;
  return {
    oneStep: null,
    errors: best.errors,
    nParams: 3,
    params: { alpha: best.alpha, beta: best.beta, gamma: best.gamma, seasonLength: m },
    forecast: (h) => best.level + h * best.trend + best.seasonal[n - m + ((h - 1) % m)],
  };
}

/** Damped additive Holt-Winters (ETS(A,Ad,A)): the trend decays, the seasons add. */
function runHwAdditiveDamped(values, m, alpha, beta, gamma, phi) {
  const n = values.length;
  const avg1 = values.slice(0, m).reduce((s, v) => s + v, 0) / m;
  const avg2 = values.slice(m, 2 * m).reduce((s, v) => s + v, 0) / m;
  let level = avg1;
  let trend = (avg2 - avg1) / m;
  const seasonal = new Array(n).fill(0);
  for (let i = 0; i < m; i++) seasonal[i] = values[i] - avg1;
  const errors = [];
  for (let t = m; t < n; t++) {
    const f = level + phi * trend + seasonal[t - m];
    errors.push(values[t] - f);
    const prevLevel = level;
    level = alpha * (values[t] - seasonal[t - m]) + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
    seasonal[t] = gamma * (values[t] - level) + (1 - gamma) * seasonal[t - m];
  }
  const sse = errors.reduce((s, e) => s + e * e, 0);
  return { sse, errors, level, trend, seasonal };
}

function fitHwAdditiveDamped(values, m) {
  let best = null;
  for (const alpha of GRID_COARSE) {
    for (const beta of GRID_COARSE) {
      for (const gamma of GRID_COARSE) {
        for (const phi of GRID_DAMP) {
          const r = runHwAdditiveDamped(values, m, alpha, beta, gamma, phi);
          if (!best || r.sse < best.sse) best = { alpha, beta, gamma, phi, ...r };
        }
      }
    }
  }
  const n = values.length;
  return {
    oneStep: null,
    errors: best.errors,
    nParams: 4,
    params: { alpha: best.alpha, beta: best.beta, gamma: best.gamma, phi: best.phi, seasonLength: m },
    forecast: (h) => best.level + geomSum(best.phi, h) * best.trend + best.seasonal[n - m + ((h - 1) % m)],
  };
}

/**
 * Multiplicative Holt-Winters (ETS(A,A,M)): seasonal indices are ratios, so
 * swings grow with the level. Residuals are recorded relative to the one-step
 * forecast, which makes sigma unitless and the intervals scale with it.
 */
function runHwMultiplicative(values, m, alpha, beta, gamma, phi) {
  const n = values.length;
  const avg1 = values.slice(0, m).reduce((s, v) => s + v, 0) / m;
  const avg2 = values.slice(m, 2 * m).reduce((s, v) => s + v, 0) / m;
  let level = avg1;
  let trend = (avg2 - avg1) / m;
  const seasonal = new Array(n).fill(1);
  for (let i = 0; i < m; i++) seasonal[i] = values[i] / avg1;
  const errors = [];
  for (let t = m; t < n; t++) {
    const f = (level + phi * trend) * seasonal[t - m];
    errors.push((values[t] - f) / f);
    const prevLevel = level;
    level = alpha * (values[t] / seasonal[t - m]) + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
    seasonal[t] = gamma * (values[t] / level) + (1 - gamma) * seasonal[t - m];
  }
  const sse = errors.reduce((s, e) => s + e * e, 0);
  return { sse, errors, level, trend, seasonal };
}

function fitHwMultiplicative(values, m, damped) {
  let best = null;
  const phis = damped ? GRID_DAMP : [1];
  for (const alpha of GRID_COARSE) {
    for (const beta of GRID_COARSE) {
      for (const gamma of GRID_COARSE) {
        for (const phi of phis) {
          const r = runHwMultiplicative(values, m, alpha, beta, gamma, phi);
          if (!best || r.sse < best.sse) best = { alpha, beta, gamma, phi, ...r };
        }
      }
    }
  }
  const n = values.length;
  return {
    oneStep: null,
    errors: best.errors,
    nParams: damped ? 4 : 3,
    relative: true,
    params: { alpha: best.alpha, beta: best.beta, gamma: best.gamma, phi: best.phi, seasonLength: m },
    forecast: (h) => (best.level + geomSum(best.phi, h) * best.trend) * best.seasonal[n - m + ((h - 1) % m)],
  };
}

/**
 * Fit a method on ordered values and forecast `horizon` steps ahead.
 * Options: { horizon, seasonLength, interval, damped, seasonality }.
 * Damping (holt, hw) shrinks the trend with horizon; multiplicative seasonality
 * (hw) scales seasons with the level. Both are ignored where they do not apply,
 * so a backtest can pass them to every candidate method.
 * Returns { method, title, horizon, interval, z, sigma, params, point, lower, upper,
 *           damped, seasonality, intervalMode }.
 */
export function fit(values, methodId, options = {}) {
  const { horizon = 12, seasonLength = null, interval = 80, damped = false, seasonality = 'additive', lambda, features = null } = options;
  checkFitInput(values, methodId, { horizon, seasonLength, interval, damped, seasonality, lambda, features });
  const n = values.length;
  const T = n - 1;

  const useDamped = damped && (methodId === 'holt' || methodId === 'hw');
  const useMult = methodId === 'hw' && seasonality === 'multiplicative';
  const effectiveSeasonality = methodId === 'hw' ? (useMult ? 'multiplicative' : 'additive') : null;

  let fitted;

  switch (methodId) {
    case 'naive': fitted = fitNaive(values); break;
    case 'snaive': fitted = fitSeasonalNaive(values, seasonLength); break;
    case 'mean': fitted = fitMean(values); break;
    case 'drift': fitted = fitDrift(values); break;
    case 'linear': fitted = fitLinear(values); break;
    case 'holt': fitted = useDamped ? fitHoltDamped(values) : fitHolt(values); break;
    case 'hw':
      fitted = useMult
        ? fitHwMultiplicative(values, seasonLength, useDamped)
        : useDamped
          ? fitHwAdditiveDamped(values, seasonLength)
          : fitHwAdditive(values, seasonLength);
      break;
    
    // Tier-2 Methods
    case 'stl':
      const stlDecomp = stlDecompose(values, seasonLength);
      const stlPred = stlForecast({ ...stlDecomp, params: { seasonLength } }, horizon);
      fitted = {
        oneStep: null,
        errors: values.map((v, i) => v - (stlDecomp.trend[i] + stlDecomp.seasonal[i])),
        nParams: 3,
        params: { 
          seasonLength,
          decompositionSummary: stlDecomp.summary,
        },
        point: stlPred.point,
        lower: stlPred.lower,
        upper: stlPred.upper,
        sigma: Math.sqrt(stlDecomp.summary.remainderVariance),
      };
      break;
      
    case 'theta':
      const thetaResult = thetaMethod(values, { horizon, damped });
      fitted = {
        oneStep: null,
        errors: [], // Computed during fitting
        nParams: 2,
        params: thetaResult.params,
        point: thetaResult.point,
        lower: thetaResult.lower,
        upper: thetaResult.upper,
        sigma: thetaResult.sigma,
        methodSpecific: { type: 'theta' },
      };
      break;
      
    case 'croston':
      const crostonResult = crostonMethod(values, {});
      fitted = {
        oneStep: null,
        errors: [],
        nParams: 2,
        params: crostonResult.params,
        point: crostonResult.point,
        lower: crostonResult.lower,
        upper: crostonResult.upper,
        sigma: crostonResult.sigma,
        methodSpecific: { type: 'croston' },
      };
      break;
      
    case 'boxcox':
      const optimalLambda = findOptimalLambda(values);
      const boxcoxResult = transformFitBackTransform(
        values,
        optimalLambda.lambda,
        fitHolt,
        null // Not needed for simple pass-through
      );
      fitted = {
        oneStep: null,
        errors: values.map((v, i) => v - boxcoxResult.point?.[i] || v),
        nParams: 2,
        params: boxcoxResult.params,
        point: boxcoxResult.point,
        lower: boxcoxResult.lower,
        upper: boxcoxResult.upper,
        sigma: boxcoxResult.sigma,
        transform: boxcoxResult.transform,
      };
      break;
      
    // Phase 1: GLM with exogenous features
    case 'glm':
      if (!options.features || !options.features.matrix) {
        throw new Error('GLM method requires --features option with Fourier/exogenous features');
      }
      fitted = fitGLMForecast(values, options.features, horizon, {
        interval,
        featureNames: options.featureNames || null,
      });
      break;
    default: throw new Error(`Unknown method "${methodId}"`);
  }

  let points;
  if (fitted.forecast) {
    points = [];
    for (let h = 1; h <= horizon; h++) points.push(fitted.forecast(h));
  } else if (methodId === 'naive') {
    points = new Array(horizon).fill(values[T]);
  } else if (methodId === 'snaive') {
    points = [];
    // Wrap around the last observed season so any horizon is covered.
    for (let h = 1; h <= horizon; h++) points.push(values[T - seasonLength + 1 + ((h - 1) % seasonLength)]);
  } else if (methodId === 'mean') {
    points = new Array(horizon).fill(fitted.params.mean);
  } else if (methodId === 'drift') {
    points = [];
    for (let h = 1; h <= horizon; h++) points.push(values[T] + h * fitted.params.slope);
  } else if (methodId === 'linear') {
    points = [];
    for (let h = 1; h <= horizon; h++) points.push(fitted.params.intercept + fitted.params.slope * (T + h));
  }

  // For Tier-2 methods that already provide points, use them directly
  if (fitted.point && fitted.lower && fitted.upper) {
    const z = INTERVAL_Z[interval];
    const sigma = fitted.sigma || rootMeanSquare(fitted.errors, fitted.nParams);
    
    return {
      method: methodId,
      title: fitted.title || methodTitle(methodId, { damped: useDamped, seasonality: effectiveSeasonality }),
      horizon,
      interval,
      z,
      sigma,
      params: fitted.params,
      damped: useDamped,
      seasonality: effectiveSeasonality,
      point: fitted.point,
      lower: fitted.lower,
      upper: fitted.upper,
      summary: fitted.summary,
      math: fitted.math,
    };
  }

  const sigma = rootMeanSquare(fitted.errors, fitted.nParams);
  const z = INTERVAL_Z[interval];
  const bands = fitted.relative
    ? withMultiplicativeIntervals(points, sigma, z)
    : withIntervals(points, sigma, z);
  return {
    method: methodId,
    title: methodTitle(methodId, { damped: useDamped, seasonality: effectiveSeasonality }),
    horizon,
    interval,
    z,
    sigma,
    params: fitted.params,
    damped: useDamped,
    seasonality: effectiveSeasonality,
    intervalMode: useMult ? 'multiplicative' : 'additive',
    ...bands,
  };
}

// ===========================================================================
// Phase 1: GLM (Generalized Linear Model) with Exogenous Features
// ===========================================================================

/**
 * Ordinary Least Squares regression for forecasting with exogenous features.
 * Uses closed-form solution: β = (X'X)^(-1) X'y
 */
function fitGLM(featuresMatrix, values, options = {}) {
  const n = values.length;
  const p = featuresMatrix[0].length + 1; // +1 for intercept
  
  // Build design matrix X with intercept column
  const X = new Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = new Float64Array(p);
    X[i][0] = 1; // intercept
    for (let j = 0; j < featuresMatrix[i].length; j++) {
      X[i][j + 1] = featuresMatrix[i][j];
    }
  }
  
  // Compute X'X (p × p matrix)
  const XtX = new Array(p).fill(0).map(() => new Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < p; r++) {
      for (let c = 0; c < p; c++) {
        XtX[r][c] += X[i][r] * X[i][c];
      }
    }
  }
  
  // Compute X'y (p-vector)
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < p; r++) {
      Xty[r] += X[i][r] * values[i];
    }
  }
  
  // Solve (X'X)β = X'y using Cholesky decomposition or Gaussian elimination
  const beta = solveNormalEquations(XtX, Xty);
  
  if (!beta) {
    throw new Error('GLM: Singular design matrix - features may be collinear');
  }
  
  // Compute fitted values and residuals
  const residuals = [];
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = beta.reduce((sum, b, j) => sum + b * X[i][j], 0);
    residuals.push(values[i] - pred);
    sse += residuals[residuals.length - 1] ** 2;
  }
  
  // Estimate error variance (unbiased)
  const sigma2 = sse / Math.max(n - p, 1);
  
  return {
    beta,
    residuals,
    sigma2,
    nParams: p,
    featureNames: options.featureNames || null,
  };
}

/**
 * Solve normal equations (X'X)β = X'y using Cholesky decomposition.
 * Returns null if matrix is singular.
 */
function solveNormalEquations(A, b) {
  const n = A.length;
  
  // Check if symmetric positive definite, compute Cholesky
  const L = new Array(n).fill(0).map(() => new Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) {
        sum -= L[i][k] * L[j][k];
      }
      
      if (i === j) {
        if (sum <= 1e-12) return null; // Singular or nearly singular
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  
  // Forward substitution: Ly = b
  const y = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let j = 0; j < i; j++) {
      sum -= L[i][j] * y[j];
    }
    y[i] = sum / L[i][i];
  }
  
  // Backward substitution: L'β = y
  const beta = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let j = i + 1; j < n; j++) {
      sum -= L[j][i] * beta[j];
    }
    beta[i] = sum / L[i][i];
  }
  
  return beta;
}

/**
 * Fit GLM model with Fourier/exogenous features and forecast horizon steps ahead.
 * @param {Array<number>} values - Historical values
 * @param {Object} features - Feature matrix info
 * @param {number} horizon - Forecast horizon
 * @param {Object} options - Additional options (interval, etc.)
 * @returns {Object} Forecast result with intervals
 */
export function fitGLMForecast(values, features, horizon, options = {}) {
  const { interval = 80, featureNames = null } = options;
  
  const n = values.length;
  if (n < 10) throw new Error('GLM requires at least 10 observations');
  
  // Validate features
  const validation = validateFourierFeatures(features);
  if (!validation.valid) {
    throw new Error(`Invalid features: ${validation.errors.join(', ')}`);
  }
  
  // Fit model
  const fitted = fitGLM(features.matrix, values, { featureNames });
  
  // Generate future features
  const futureFeatures = fourierForecast(
    { t: n - 1, n },
    features.seasonLengths,
    horizon,
    { K: features.harmonics || 1 }
  );
  
  // Compute forecasts
  const points = [];
  const lower = [];
  const upper = [];
  const z = INTERVAL_Z[interval];
  
  for (let h = 1; h <= horizon; h++) {
    const x = new Float64Array(fitted.beta.length);
    x[0] = 1; // intercept
    for (let j = 0; j < futureFeatures.matrix[h - 1].length; j++) {
      x[j + 1] = futureFeatures.matrix[h - 1][j];
    }
    
    const point = fitted.beta.reduce((sum, b, i) => sum + b * x[i], 0);
    points.push(point);
    
    // Prediction interval widens with horizon due to uncertainty in both mean and individual errors
    const se = z * Math.sqrt(fitted.sigma2 * (1 + h * (1 / n)));
    lower.push(point - se);
    upper.push(point + se);
  }
  
  // One-step residuals for RMSE-like metric
  const oneStepErrors = fitted.residuals;
  const sigma = Math.sqrt(fitted.sigma2);
  
  return {
    method: 'glm',
    title: 'GLM with Fourier Features',
    horizon,
    interval,
    z,
    sigma,
    params: {
      coefficients: fitted.beta,
      featureCount: fitted.beta.length - 1, // exclude intercept
      seasonLengths: features.seasonLengths,
      harmonics: features.harmonics || 1,
    },
    point: points,
    lower,
    upper,
    summary: `Fitted on ${n} points with ${fitted.beta.length - 1} features`,
    math: 'y(t) = β₀ + Σ βᵢ·Xᵢ(t)',
    residualStdError: sigma,
  };
}

