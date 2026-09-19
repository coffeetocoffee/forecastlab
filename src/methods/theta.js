// Theta Method: Competition-winning forecasting method
// Simple but effective, often outperforms complex models
// Two theta lines: one with negative curvature, one with positive
// Combine forecasts using optimal weights

/**
 * Theta method forecast
 * @param {number[]} values - Time series data
 * @param {object} options - Forecast options
 * @returns {object} Point forecasts, intervals, and parameters
 */
export function thetaMethod(values, options = {}) {
  const {
    horizon = 12,
    damped = false,
    seasonLength = null,
  } = options;

  if (values.length < 3) {
    throw new Error('Theta method requires at least 3 data points');
  }

  // Detect seasonality
  let hasSeasonality = false;
  if (seasonLength && values.length >= seasonLength * 2) {
    hasSeasonality = checkSeasonality(values, seasonLength);
  }

  // Step 1: Calculate level and trend from simple linear regression
  const [level, slope] = calculateLinearTrend(values);

  // Step 2: Compute two theta lines
  // Theta line 1: Negative curvature (theta1 = -0.5, effectively flattening)
  const theta1Forecast = computeThetaLine(values, -0.5, horizon);
  
  // Theta line 2: Positive curvature (theta2 = original slope, potentially extrapolated)
  const theta2Forecast = computeThetaLine(values, 1.0, horizon, damped);

  // Step 3: Combine forecasts (optimal weights ~0.5 each in practice)
  const combinedPoint = theta1Forecast.point.map((v, i) => 
    0.5 * v + 0.5 * theta2Forecast.point[i]
  );

  // Step 4: Compute prediction intervals based on residuals
  const allFitted = [];
  for (let t = 2; t < values.length; t++) {
    const f1 = computeThetaLine(values.slice(0, t), -0.5, 1).point[0];
    const f2 = computeThetaLine(values.slice(0, t), 1.0, 1, damped).point[0];
    const combined = 0.5 * f1 + 0.5 * f2;
    allFitted.push(combined);
  }
  
  const errors = values.slice(2).map((v, i) => v - allFitted[i]);
  const sigma = rootMeanSquare(errors);

  // Step 5: Add intervals
  const intervals = addIntervals(combinedPoint, sigma, 1.2816);

  return {
    method: 'theta',
    title: damped ? 'Theta (damped)' : 'Theta',
    summary: `Competition-winning method combining two theta lines with different curvatures.`,
    math: `yhat(h) = 0.5*theta1(h) + 0.5*theta2(h), where theta1=-0.5, theta2=original`,
    params: {
      theta1Curvature: -0.5,
      theta2Curvature: 1.0,
      level,
      slope,
      errorStdDev: sigma,
    },
    point: combinedPoint,
    lower: intervals.lower,
    upper: intervals.upper,
    sigma,
    horizon,
  };
}

/**
 * Compute single theta line forecast
 */
function computeThetaLine(values, theta, horizon, damped = false) {
  const n = values.length;
  const lastVal = values[n - 1];
  const secondLastVal = values[n - 2];
  const initialSlope = secondLastVal - lastVal; // Simplified

  // Fit linear trend for theta2
  const [_, trendSlope] = calculateLinearTrend(values);

  const point = [];
  
  for (let h = 1; h <= horizon; h++) {
    let projectedTrend;
    
    if (damped) {
      // Damped trend: phi^h * trend
      const phi = 0.9; // Damping factor
      projectedTrend = lastVal + (phi ** h) * trendSlope * h;
    } else {
      // Standard projection
      projectedTrend = lastVal + theta * trendSlope * h;
    }
    
    point.push(projectedTrend);
  }

  return { point };
}

/**
 * Check for seasonality using autocorrelation
 */
function checkSeasonality(values, seasonLength) {
  if (values.length < seasonLength * 2) return false;

  // Compute seasonal autocorrelation
  let sumProduct = 0;
  let sumSq = 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  
  for (let i = seasonLength; i < values.length; i++) {
    const diff = values[i] - mean;
    const prevDiff = values[i - seasonLength] - mean;
    sumProduct += diff * prevDiff;
    sumSq += diff ** 2;
  }
  
  const acf = sumProduct / (sumSq || 1);
  return acf > 0.3; // Threshold for meaningful seasonality
}

/**
 * Linear regression: y = a + b*t
 */
function calculateLinearTrend(values) {
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;
  
  return [intercept, slope];
}

/**
 * Root mean square of errors
 */
function rootMeanSquare(errors) {
  if (errors.length === 0) return 0;
  const sum = errors.reduce((s, e) => s + e * e, 0);
  return Math.sqrt(sum / errors.length);
}

/**
 * Add prediction intervals
 */
function addIntervals(points, sigma, z) {
  const lower = [];
  const upper = [];
  
  for (let h = 1; h <= points.length; h++) {
    const halfWidth = z * sigma * Math.sqrt(h);
    lower.push(points[h - 1] - halfWidth);
    upper.push(points[h - 1] + halfWidth);
  }
  
  return { lower, upper };
}
