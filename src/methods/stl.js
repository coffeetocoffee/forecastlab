// STL Decomposition: Seasonal-Trend-Loose decomposition
// Explainable by construction, breaks series into trend + seasonal + remainder
// Additive model: y(t) = Trend(t) + Seasonal(t) + Remainder(t)

/**
 * STL decomposition using simple moving averages
 * @param {number[]} values - Time series data
 * @param {number} seasonLength - Length of seasonal cycle
 * @param {object} options - Tuning parameters
 * @returns {object} Decomposition with trend, seasonal, remainder arrays
 */
export function stlDecompose(values, seasonLength, options = {}) {
  const {
    trendSmooth = 7,      // Odd number, must be >= 3
    robustIterations = 0, // Number of robustness iterations (0 = non-robust)
  } = options;
  
  // Ensure seasonal smoothing is odd (use nearest odd number)
  const seasonalSmooth = seasonLength % 2 === 0 ? seasonLength + 1 : seasonLength;

  if (seasonalSmooth % 2 === 0) {
    throw new Error('Seasonal smoothing window must be odd');
  }
  if (trendSmooth % 2 === 0) {
    throw new Error('Trend smoothing window must be odd');
  }
  if (values.length < seasonLength * 2) {
    throw new Error(`Need at least ${seasonLength * 2} points for STL decomposition, got ${values.length}`);
  }

  const n = values.length;
  
  // Step 1: Initialize with centered moving average (deseasonalized)
  const trend = movingAverage(values, trendSmooth);
  
  // Step 2: Extract preliminary seasonals
  const deseasonalized = values.map((v, i) => v - trend[i]);
  const initialSeasonal = computeInitialSeasonal(deseasonalized, seasonLength);
  
  // Step 3: Deseasonalize
  const deseasonalizedFinal = values.map((v, i) => v - initialSeasonal[i]);
  
  // Step 4: Smooth trend from deseasonalized series
  const finalTrend = movingAverage(deseasonalizedFinal, trendSmooth);
  
  // Step 5: Update seasonal component
  const seasonalRaw = [];
  for (let i = 0; i < n; i++) {
    seasonalRaw.push(deseasonalizedFinal[i] - finalTrend[i]);
  }
  const seasonal = smoothSeasonal(seasonalRaw, seasonLength);
  
  // Step 6: Compute remainder
  const remainder = values.map((v, i) => v - finalTrend[i] - seasonal[i]);
  
  return {
    trend: finalTrend,
    seasonal: seasonal,
    remainder: remainder,
    decomposed: finalTrend,
    summary: {
      trendVariance: variance(finalTrend),
      seasonalVariance: variance(seasonal),
      remainderVariance: variance(remainder),
      totalVariance: variance(values),
      explainedRatio: 1 - variance(remainder) / (variance(values) || 1),
    }
  };
}

/**
 * Moving average smoothing
 */
function movingAverage(series, windowSize) {
  const half = Math.floor(windowSize / 2);
  const result = new Array(series.length).fill(null);
  
  for (let i = half; i < series.length - half; i++) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      sum += series[i - half + j];
    }
    result[i] = sum / windowSize;
  }
  
  // Fill edges with nearest valid value
  for (let i = 0; i < half; i++) {
    result[i] = result[half];
  }
  for (let i = series.length - half; i < series.length; i++) {
    result[i] = result[series.length - half - 1];
  }
  
  return result;
}

/**
 * Compute initial seasonal indices
 */
function computeInitialSeasonal(series, seasonLength) {
  const n = series.length;
  const seasonal = new Array(n).fill(0);
  
  // Group by season position
  for (let s = 0; s < seasonLength; s++) {
    const positions = [];
    for (let i = s; i < n; i += seasonLength) {
      positions.push(series[i]);
    }
    
    if (positions.length > 0) {
      const avg = positions.reduce((s, v) => s + v, 0) / positions.length;
      for (let i = s; i < n; i += seasonLength) {
        seasonal[i] = avg;
      }
    }
  }
  
  return seasonal;
}

/**
 * Smooth seasonal component
 */
function smoothSeasonal(seasonal, seasonLength) {
  const smoothed = new Array(seasonal.length).fill(0);
  const half = Math.floor(seasonLength / 2);
  
  for (let i = 0; i < seasonal.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -half; j <= half; j++) {
      const idx = ((i + j) % seasonLength + seasonLength) % seasonLength + 
                  Math.floor(i / seasonLength) * seasonLength;
      if (idx < seasonal.length) {
        sum += seasonal[idx];
        count++;
      }
    }
    smoothed[i] = count > 0 ? sum / count : seasonal[i];
  }
  
  // Center seasonal component (mean = 0)
  const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  return smoothed.map(v => v - mean);
}

/**
 * Forecast using STL decomposition
 */
export function stlForecast(decomposition, horizon) {
  const { trend, seasonal } = decomposition;
  const lastTrend = trend[trend.length - 1];
  const lastSeasonalIndex = (seasonal.length - 1) % decomposition.params.seasonLength;
  
  const point = [];
  const lower = [];
  const upper = [];
  
  for (let h = 1; h <= horizon; h++) {
    // Extrapolate trend (linear extrapolation from last few points)
    const trendSlope = calculateTrendSlope(trend, 3);
    const projectedTrend = lastTrend + h * trendSlope;
    
    // Wrap around seasonal pattern
    const seasonalIdx = ((lastSeasonalIndex + h) % decomposition.params.seasonLength);
    const projectedSeasonal = seasonal[lastSeasonalIndex + (h - 1) % decomposition.params.seasonLength];
    
    const forecast = projectedTrend + projectedSeasonal;
    point.push(forecast);
    
    // Prediction intervals based on remainder standard deviation
    const sigma = Math.sqrt(decomposition.summary.remainderVariance);
    const z = 1.2816; // 80% confidence
    const halfWidth = z * sigma * Math.sqrt(h);
    
    lower.push(forecast - halfWidth);
    upper.push(forecast + halfWidth);
  }
  
  return { point, lower, upper };
}

/**
 * Calculate trend slope using last k points
 */
function calculateTrendSlope(trend, k) {
  const start = Math.max(0, trend.length - k);
  const slice = trend.slice(start);
  
  if (slice.length < 2) return 0;
  
  // Simple linear regression
  const n = slice.length;
  const xMean = (n - 1) / 2;
  const yMean = slice.reduce((s, v) => s + v, 0) / n;
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = slice[i];
    numerator += (x - xMean) * (y - yMean);
    denominator += (x - xMean) ** 2;
  }
  
  return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Variance calculation
 */
function variance(arr) {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}
