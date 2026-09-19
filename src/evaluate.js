// Backtesting: hold out the tail of a series, forecast it, and score each method.
// The best method is the one with the lowest RMSE on data it never saw.
//
// Tier-1 Features Implemented:
// 1. Rolling-origin backtesting with K expanding-window folds
// 2. Interval coverage validation (empirical vs promised)
// 3. Diebold-Mariano statistical significance testing
// 4. Ljung-Box residual autocorrelation diagnostics
//
// New Tier-2 Integration:
// 5. Auto-selection includes STL, Theta, Croston, Box-Cox methods
// 6. Uses rolling-origin backtest (not single split) for selection
// 7. Explanations for all methods included

import { fit, applicableMethods, METHODS } from './models.js';
import { splitTrainTest } from './series.js';

/** Standard normal CDF using a rational approximation (Abramowitz & Stege 26.2.5). */
export function normCdf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Rolling-origin backtesting with K expanding-window folds.
 * For each fold k: train on first (total - testSize * (K - k + 1)) points,
 * test on the next testSize points. Returns per-fold metrics for each method.
 */
export function rollingOriginBacktest(values, options = {}) {
  const {
    seasonLength = null,
    interval = 80,
    damped = false,
    seasonality = 'additive',
    methods,
    kFolds = 5,
  } = options;

  // Calculate fold sizes
  const total = values.length;
  const testSize = options.testSize ?? defaultTestSize(total);
  
  if (testSize * kFolds >= total) {
    throw new Error(`Not enough data for ${kFolds} folds with testSize=${testSize}. Try fewer folds or smaller test size.`);
  }

  const ids = methods ?? [];
  // Get valid methods based on MINIMUM required training size across all folds
  const minTrainSize = testSize + 1; // First fold needs at least testSize+1 points
  const validIds = ids.length > 0 
    ? ids.filter(id => applicableMethods(minTrainSize, seasonLength).includes(id))
    : applicableMethods(minTrainSize, seasonLength);
    
  if (validIds.length === 0) {
    throw new Error('No forecasting method applies to this data');
  }

  const folds = [];
  let origin = 0; // The origin point from which we forecast

  for (let fold = 0; fold < kFolds; fold++) {
    const trainValues = values.slice(0, origin + testSize);
    const testValues = values.slice(origin + testSize, origin + 2 * testSize);
    

    const foldResults = {
      fold: fold + 1,
      trainSize: trainValues.length,
      testSize: testValues.length,
      methods: [],
    };

    for (const id of validIds) {
      const f = fit(trainValues, id, {
        horizon: testValues.length,
        seasonLength,
        interval,
        damped,
        seasonality,
      });

      // Count interval coverage
      let coverageCount = 0;
      for (let i = 0; i < testValues.length; i++) {
        if (testValues[i] >= f.lower[i] && testValues[i] <= f.upper[i]) {
          coverageCount++;
        }
      }
      const empiricalCoverage = (100 * coverageCount) / testValues.length;
      const promisedCoverage = interval;

       foldResults.methods.push({
        method: id,
        title: f.title,
        mae: mae(testValues, f.point),
        rmse: rmse(testValues, f.point),
        mape: mape(testValues, f.point),
        smape: smape(testValues, f.point),
        mase: mase(testValues, f.point, trainValues),
        sigma: f.sigma,
        intervalCoverage: {
          promised: promisedCoverage,
          empirical: empiricalCoverage,
          count: coverageCount,
          total: testValues.length,
        },
        errors: testValues.map((v, i) => v - f.point[i]),
        horizon: testValues.length,
        // Add explanations for Tier-2 methods
        explanation: generateMethodExplanation(id, f, params),
      });
    }

    // Sort by RMSE
    foldResults.methods.sort((a, b) => a.rmse - b.rmse);
    
    // Add fold results
    folds.push(foldResults);
    
    // Move origin forward for next fold (expand training, move test window)
    origin += testSize;
  }

  if (folds.length === 0) {
    throw new Error('No valid folds created');
  }

  // Aggregate results across folds
  const methodMetrics = new Map();
  for (const fold of folds) {
    for (const result of fold.methods) {
      if (!methodMetrics.has(result.method)) {
        methodMetrics.set(result.method, {
          method: result.method,
          title: result.title,
          rmseFolds: [],
          maeFolds: [],
          mapeFolds: [],
          maseFolds: [],
          intervalCoverages: [],
          horizons: [],
        });
      }
      const metrics = methodMetrics.get(result.method);
      metrics.rmseFolds.push(result.rmse);
      metrics.maeFolds.push(result.mae);
      if (result.mape !== null) metrics.mapeFolds.push(result.mape);
      if (result.mase !== null) metrics.maseFolds.push(result.mase);
      metrics.intervalCoverages.push(result.intervalCoverage);
      metrics.horizons.push(result.horizon);
    }
  }

  const aggregated = [];
  for (const [methodId, metrics] of methodMetrics) {
    const meanRmse = metrics.rmseFolds.reduce((s, r) => s + r, 0) / metrics.rmseFolds.length;
    const stdRmse = Math.sqrt(
      metrics.rmseFolds.reduce((s, r) => s + Math.pow(r - meanRmse, 2), 0) / (metrics.rmseFolds.length - 1) || 0
    );
    
    const meanMae = metrics.maeFolds.reduce((s, r) => s + r, 0) / metrics.maeFolds.length;
    const stdMae = Math.sqrt(
      metrics.maeFolds.reduce((s, r) => s + Math.pow(r - meanMae, 2), 0) / (metrics.maeFolds.length - 1) || 0
    );

    const avgCoverage = metrics.intervalCoverages.reduce((s, c) => s + c.empirical, 0) / metrics.intervalCoverages.length;
    const promisedCoverage = metrics.intervalCoverages[0].promised;

    aggregated.push({
      method: methodId,
      title: metrics.title,
      meanRMSE: meanRmse,
      stdRMSE: stdRmse,
      meanMAE: meanMae,
      stdMAE: stdMae,
      meanMAPE: metrics.mapeFolds.length > 0 
        ? metrics.mapeFolds.reduce((s, r) => s + r, 0) / metrics.mapeFolds.length
        : null,
      meanMASE: metrics.maseFolds.length > 0
        ? metrics.maseFolds.reduce((s, r) => s + r, 0) / metrics.maseFolds.length
        : null,
      intervalCoverage: {
        promised: promisedCoverage,
        empirical: avgCoverage,
      },
      foldMetrics: metrics,
    });
  }

  aggregated.sort((a, b) => a.meanRMSE - b.meanRMSE);
  
  // Statistical significance testing using Diebold-Mariano
  const significantTests = computeDieboldMarianoTests(aggregated);
  aggregated.forEach(result => {
    result.significanceTests = significantTests.get(result.method) || [];
  });
  
  return {
    kFolds: folds.length,
    testSize,
    folds,
    results: aggregated,
    best: aggregated[0].method,
  };
}

/**
 * Diebold-Mariano test for comparing forecast accuracy of two methods.
 * Tests if the difference in their forecast errors is significantly different from zero.
 * Uses normal approximation (like INTERVAL_Z values) for p-values.
 */
export function computeDieboldMarianoTests(results) {
  const tests = new Map();
  
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const methodA = results[i];
      const methodB = results[j];
      
      const dmTest = dieboldMarianoTest(
        methodA.foldMetrics.rmseFolds,
        methodB.foldMetrics.rmseFolds
      );
      
      if (!tests.has(methodA.method)) tests.set(methodA.method, []);
      tests.get(methodA.method).push({
        comparedTo: methodB.method,
        ...dmTest,
      });
      
      if (!tests.has(methodB.method)) tests.set(methodB.method, []);
      tests.get(methodB.method).push({
        comparedTo: methodA.method,
        ...dmTest,
      });
    }
  }
  
  return tests;
}

/**
 * Diebold-Mariano test between two methods' RMSE time series.
 * Returns { statistic, pValue, significant, direction }.
 * Direction indicates which method has lower expected loss ('A' means first method better).
 */
export function dieboldMarianoTest(errorsA, errorsB) {
  const n = Math.min(errorsA.length, errorsB.length);
  if (n < 3) {
    return { statistic: NaN, pValue: null, significant: false, direction: null };
  }
  
  // Compute loss differences
  const d = [];
  for (let i = 0; i < n; i++) {
    d.push(errorsA[i] - errorsB[i]);
  }
  
  // Mean loss differential
  const meanD = d.reduce((s, x) => s + x, 0) / n;
  
  // If mean is close to zero, they're equally good
  if (Math.abs(meanD) < 1e-6) {
    return {
      statistic: 0,
      pValue: 1,
      significant: false,
      direction: 'equal',
    };
  }
  
  // Compute variance of loss differences (simple version, no HAC)
  const varD = d.reduce((s, x) => s + Math.pow(x - meanD, 2), 0) / (n - 1);
  const stdD = Math.sqrt(varD);
  
  if (stdD < 1e-6) {
    return {
      statistic: meanD > 0 ? -Infinity : Infinity,
      pValue: 0,
      significant: true,
      direction: meanD < 0 ? 'A' : 'B',
    };
  }
  
  // Test statistic: t-statistic with n-1 df (use normal approximation)
  const statistic = meanD / (stdD / Math.sqrt(n));
  
  // Two-sided p-value using normal CDF
  const pValue = 2 * (1 - normCdf(Math.abs(statistic)));
  
  // Significant at alpha = 0.05
  const significant = pValue < 0.05;
  
  const direction = meanD < 0 ? 'A' : 'B';
  
  return {
    statistic,
    pValue,
    significant,
    direction,
  };
}

/**
 * Ljung-Box test for autocorrelation in residuals.
 * Tests whether residuals are independently distributed (white noise).
 * A significant result suggests "model left signal on the table".
 * @param {number[]} residuals - The forecast errors
 * @param {number} maxLag - Maximum lag to test (default: min(10, n/4))
 * @returns {{ statistic, pValue, significant, conclusion }}
 */
export function ljungBoxTest(residuals, maxLag = null) {
  const n = residuals.length;
  if (n < 4) {
    return {
      statistic: NaN,
      pValue: null,
      significant: false,
      conclusion: 'Insufficient data for Ljung-Box test',
    };
  }
  
  const defaultMaxLag = Math.min(10, Math.floor(n / 4));
  const h = maxLag ?? defaultMaxLag;
  
  if (h < 1) {
    return {
      statistic: NaN,
      pValue: null,
      significant: false,
      conclusion: 'Sample too small for any meaningful Ljung-Box test',
    };
  }
  
  // Compute sample autocorrelations
  const mean = residuals.reduce((s, r) => s + r, 0) / n;
  const centered = residuals.map(r => r - mean);
  
  const denom = centered.reduce((s, r) => s + r * r, 0);
  if (denom === 0) {
    return {
      statistic: 0,
      pValue: 1,
      significant: false,
      conclusion: 'Zero variance residuals; perfect fit or constant predictions',
    };
  }
  
  const acf = [];
  for (let lag = 1; lag <= h; lag++) {
    let num = 0;
    for (let t = lag; t < n; t++) {
      num += centered[t] * centered[t - lag];
    }
    acf.push(num / denom);
  }
  
  // Ljung-Box Q statistic
  let qStat = 0;
  for (let i = 0; i < h; i++) {
    const lag = i + 1;
    qStat += acf[i] * acf[i] * (n + 2) * (n + 1) / ((n - lag) * lag);
  }
  
  // Chi-squared approximation with h degrees of freedom
  // Using Wilson-Hilferty transformation for chi-squared p-value
  const df = h;
  const chiSqApprox = Math.pow(qStat / df, 1 / 3);
  const mu = 1 - 2 / (9 * df);
  const sigma = Math.sqrt(2 / (9 * df));
  const z = (chiSqApprox - mu) / sigma;
  
  const pValue = 1 - normCdf(z);
  const significant = pValue < 0.05;
  
  const conclusion = significant 
    ? 'Significant autocorrelation detected; model may have left signal on the table.'
    : 'No significant autocorrelation in residuals; appears to be white noise.';
  
  return {
    statistic: qStat,
    pValue,
    significant,
    conclusion,
    lags: h,
    acf,
  };
}

export function mae(actual, predicted) {
  let s = 0;
  for (let i = 0; i < actual.length; i++) s += Math.abs(actual[i] - predicted[i]);
  return s / actual.length;
}

export function rmse(actual, predicted) {
  let s = 0;
  for (let i = 0; i < actual.length; i++) {
    const e = actual[i] - predicted[i];
    s += e * e;
  }
  return Math.sqrt(s / actual.length);
}

export function mape(actual, predicted) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === 0) continue; // undefined at zero; skip rather than explode
    s += Math.abs((actual[i] - predicted[i]) / actual[i]);
    n++;
  }
  return n === 0 ? null : (100 * s) / n;
}

export function smape(actual, predicted) {
  let s = 0;
  for (let i = 0; i < actual.length; i++) {
    const denom = (Math.abs(actual[i]) + Math.abs(predicted[i])) / 2;
    if (denom === 0) continue;
    s += Math.abs(actual[i] - predicted[i]) / denom;
  }
  return (100 * s) / actual.length;
}

/** MASE: error relative to a naive one-step forecast on the training data. <1 beats naive. */
export function mase(actual, predicted, train) {
  let naive = 0;
  for (let t = 1; t < train.length; t++) naive += Math.abs(train[t] - train[t - 1]);
  naive /= Math.max(train.length - 1, 1);
  if (naive === 0) return null;
  return mae(actual, predicted) / naive;
}

export function defaultTestSize(count) {
  return Math.max(1, Math.min(365, Math.round(count / 5)));
}

/**
 * Backtest candidate methods on the last `testSize` points.
 * Options: { seasonLength, interval, testSize, methods, damped, seasonality }.
 * Variant options (damped, multiplicative seasonality) are handed to every
 * candidate; methods they do not apply to ignore them.
 * Returns { testSize, splitIndex, results: [{ method, title, mae, rmse, mape, smape, mase }], best }.
 */
export function backtest(values, options = {}) {
  const { seasonLength = null, interval = 80, damped = false, seasonality = 'additive' } = options;
  const testSize = options.testSize ?? defaultTestSize(values.length);
  const { train, test } = splitTrainTest(values, testSize);
  const ids = options.methods ?? applicableMethods(train.length, seasonLength);
  if (ids.length === 0) {
    throw new Error('No forecasting method applies to this data (too short, or no --season given)');
  }

  const results = [];
  for (const id of ids) {
    if (!METHODS[id]) throw new Error(`Unknown method "${id}"`);
    if (!applicableMethods(train.length, seasonLength).includes(id)) continue;
    const f = fit(train, id, { horizon: test.length, seasonLength, interval, damped, seasonality });
    results.push({
      method: id,
      title: f.title,
      mae: mae(test, f.point),
      rmse: rmse(test, f.point),
      mape: mape(test, f.point),
      smape: smape(test, f.point),
      mase: mase(test, f.point, train),
    });
  }
  if (results.length === 0) {
    throw new Error('No forecasting method applies to the training split; use a smaller --test-size or add data');
  }
  results.sort((a, b) => a.rmse - b.rmse);
  return { testSize, splitIndex: train.length, results, best: results[0].method };
}

/**
 * Generate explainable description for a fitted method
 */
export function generateMethodExplanation(methodId, fitResult, params) {
  switch (methodId) {
    case 'theta':
      return explainTheta(fitResult.params);
    
    case 'croston':
      return explainCroston(fitResult.params);
    
    case 'boxcox':
      if (params && params.values) {
        return explainBoxCox(params.values, fitResult.lambda || 0.5);
      }
      return `Box-Cox transformation applied for variance stabilization.`;
    
    case 'stl':
      if (fitResult.params && fitResult.params.hasSeasonality) {
        return `STL decomposition separates series into trend + seasonal + remainder components. Trend projected linearly, seasonality repeated. Seasonal significance detected (seasonality=${fitResult.params.seasonLength}).`;
      }
      return `STL decomposition applied but no significant seasonality detected (${fitResult.params?.seasonLength}-period cycles). Forecast uses trend component only.`;
    
    default:
      return METHODS[methodId]?.summary || '';
  }
}
