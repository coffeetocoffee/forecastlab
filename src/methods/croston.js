// Croston's Method: For intermittent demand (series with many zeros)
// Handles sporadic demand patterns where MAPE is meaningless near zero
// Original Croston (1972) and Modified Croston (TSB, 2005) variants

/**
 * Croston's method for intermittent demand forecasting
 * @param {number[]} values - Time series with potential zeros
 * @param {object} options - Options including variant selection
 * @returns {object} Point forecasts and parameters
 */
export function crostonMethod(values, options = {}) {
  const {
    horizon = 12,
    variant = 'original', // 'original' or 'tsb' (Teunter-Syntetos-Babai)
  } = options;

  if (values.length < 4) {
    throw new Error('Croston\'s method requires at least 4 data points');
  }

  // Count zeros to determine if appropriate
  const zeroCount = values.filter(v => v === 0).length;
  const zeroRatio = zeroCount / values.length;
  
  if (zeroRatio < 0.3 && variant === 'croston') {
    console.warn('Low zero ratio detected. Consider using standard methods instead.');
  }

  if (variant === 'tsb') {
    return tsbMethod(values, horizon);
  } else {
    return originalCroston(values, horizon);
  }
}

/**
 * Original Croston (1972) method
 */
function originalCroston(values, horizon) {
  let q = values[0]; // Adjusted demand size
  let p = 1;         // Average time between demands
  
  const demandChanges = [];
  const interArrivalChanges = [];
  const point = [];
  
  for (let t = 0; t < values.length; t++) {
    const d = values[t];
    
    if (d > 0) {
      q = 0.5 * d + 0.5 * q;  // Update demand size (alpha = 0.5)
      p = 0.5 * p + 0.5 * 1;  // Reset inter-arrival counter
    } else {
      p = 0.5 * p + 0.5 * 1;  // Increment inter-arrival
    }
    
    demandChanges.push(q);
    interArrivalChanges.push(p);
  }
  
  // Final estimates
  const finalQ = demandChanges[demandChanges.length - 1];
  const finalP = interArrivalChanges[interArrivalChanges.length - 1];
  
  // Forecast: Q/p (demand per period divided by average interval)
  const forecast = finalQ / finalP;
  
  // Generate horizon forecasts (constant for intermittent demand)
  for (let h = 1; h <= horizon; h++) {
    point.push(forecast);
  }
  
  // Prediction intervals: wider due to high uncertainty
  const sigma = estimateCrostonError(values);
  const intervals = addIntervals(point, sigma * 2.0); // Wider intervals
  
  return {
    method: 'croston',
    title: 'Croston\'s method (intermittent)',
    summary: `Handles sparse/intermittent demand with many zeros. MAPE meaningless near zero.`,
    math: `Forecast = adjusted_demand / avg_interval_between_demands`,
    params: {
      variant: 'original',
      initialDemand: finalQ,
      avgInterval: finalP,
      zeroRatio: values.filter(v => v === 0).length / values.length,
    },
    point,
    lower: intervals.lower,
    upper: intervals.upper,
    sigma: sigma * 2.0,
    horizon,
  };
}

/**
 * Modified Croston (TSB - Teunter Syntonos Babai, 2005)
 * Updates probability of demand occurrence separately from size
 */
function tsbMethod(values, horizon) {
  let p = 0.5;        // Probability of demand occurrence
  let q = values[0];  // Demand size
  let i = 1;          // Counter for time since last demand
  
  const demandProbHistory = [p];
  const demandSizeHistory = [q];
  
  for (let t = 0; t < values.length; t++) {
    const d = values[t];
    
    // Update time counter
    i++;
    
    if (d > 0) {
      // Update demand probability and size
      p = 0.2 * d > 0 ? 0.2 * 1 + (1 - 0.2) * p : p; // Alpha = 0.2
      q = 0.2 * d + (1 - 0.2) * q;
      i = 1; // Reset counter
    } else {
      // Only update probability
      p = 0.2 * 0 + (1 - 0.2) * p;
    }
    
    demandProbHistory.push(p);
    demandSizeHistory.push(q);
  }
  
  // Final estimates
  const finalP = demandProbHistory[demandProbHistory.length - 1];
  const finalQ = demandSizeHistory[demandSizeHistory.length - 1];
  
  // Forecast: p * q (probability times size)
  const forecast = finalP * finalQ;
  
  // Generate horizon forecasts (constant)
  const point = new Array(horizon).fill(forecast);
  
  // Wider intervals for intermittent demand
  const sigma = estimateCrostonError(values) * 1.5;
  const intervals = addIntervals(point, sigma);
  
  return {
    method: 'croston',
    title: "TsB (modified Croston)",
    summary: `Modified Croston updates demand probability separately from size. Better for sparse data.`,
    math: `Forecast = probability_of_demand * mean_demand_size_if_nonzero`,
    params: {
      variant: 'tsb',
      demandProbability: finalP,
      demandSize: finalQ,
      alphaP: 0.2,
      alphaQ: 0.2,
      zeroRatio: values.filter(v => v === 0).length / values.length,
    },
    point,
    lower: intervals.lower,
    upper: intervals.upper,
    sigma: sigma,
    horizon,
  };
}

/**
 * Estimate error for prediction intervals
 */
function estimateCrostonError(values) {
  // Simplified error estimation based on variance
  const nonZeros = values.filter(v => v > 0);
  if (nonZeros.length < 2) return 1.0;
  
  const mean = nonZeros.reduce((s, v) => s + v, 0) / nonZeros.length;
  const variance = nonZeros.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZeros.length;
  
  return Math.sqrt(variance);
}

/**
 * Add prediction intervals
 */
function addIntervals(points, sigma) {
  const lower = [];
  const upper = [];
  
  for (let h = 1; h <= points.length; h++) {
    // Wider intervals for intermittent demand
    const halfWidth = sigma * Math.sqrt(h * 2); // Doubled width
    lower.push(Math.max(0, points[h - 1] - halfWidth)); // No negative forecasts
    upper.push(points[h - 1] + halfWidth);
  }
  
  return { lower, upper };
}
