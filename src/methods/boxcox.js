// Box-Cox Transform: Handle multiplicative seasonality via transformation
// Makes multiplicative seasonality's strict-positivity requirement natural
// Transforms skewed series (energy spikes, river surges) to additive form
// Lambda parameter optimization and inverse transformation

/**
 * Box-Cox transformation wrapper
 * Applies Box-Cox transform, fits model, transforms back
 */
export function transformFitBackTransform(values, lambda, fitFunc, forecastFunc) {
  // Step 1: Check if all values are positive (required for Box-Cox)
  const minVal = Math.min(...values);
  if (minVal <= 0) {
    console.warn('Box-Cox requires strictly positive values. Shifting data by', -minVal + 1);
    const shift = -minVal + 1;
    const shifted = values.map(v => v + shift);
    return transformFitBackTransform(shifted, lambda, fitFunc, forecastFunc, shift);
  }
  
  // Step 2: Apply Box-Cox transform
  const transformed = applyBoxCox(values, lambda);
  
  // Step 3: Fit model on transformed data
  const fitted = fitFunc(transformed);
  
  // Step 4: Transform forecasts back to original scale
  const forecast = {
    point: inverseBoxCox(fitted.point, lambda),
    lower: inverseBoxCox(fitted.lower, lambda),
    upper: inverseBoxCox(fitted.upper, lambda),
  };
  
  return {
    ...fitted,
    transform: {
      type: 'box-cox',
      lambda,
      shift: 0,
    },
    params: {
      ...fitted.params,
      boxCoxLambda: lambda,
    },
    ...forecast,
  };
}

/**
 * Box-Cox transformation: y(λ) = (y^λ - 1) / λ for λ ≠ 0
 * For λ = 0: y(λ) = ln(y) (natural log)
 */
export function applyBoxCox(values, lambda) {
  if (Math.abs(lambda) < 0.0001) {
    // Log transform when λ ≈ 0
    return values.map(v => Math.log(v));
  }
  
  return values.map(v => (Math.pow(v, lambda) - 1) / lambda);
}

/**
 * Inverse Box-Cox transformation
 */
export function inverseBoxCox(values, lambda) {
  if (Math.abs(lambda) < 0.0001) {
    // Exponential for log transform
    return values.map(v => Math.exp(v));
  }
  
  return values.map(v => Math.pow(v * lambda + 1, 1 / lambda));
}

/**
 * Find optimal lambda using maximum likelihood
 */
export function findOptimalLambda(values, lambdaRange = [-2, 2], steps = 41) {
  const minVal = Math.min(...values);
  
  // Shift if needed
  let shift = 0;
  let adjustedValues = [...values];
  if (minVal <= 0) {
    shift = -minVal + 1;
    adjustedValues = values.map(v => v + shift);
  }
  
  let bestLambda = 0; // Default to log
  let bestScore = -Infinity;
  
  for (let i = 0; i < steps; i++) {
    const lambda = lambdaRange[0] + (i / (steps - 1)) * (lambdaRange[1] - lambdaRange[0]);
    const score = boxCoxLikelihood(adjustedValues, lambda);
    
    if (score > bestScore) {
      bestScore = score;
      bestLambda = lambda;
    }
  }
  
  // Adjust for shift
  return {
    lambda: bestLambda,
    shift: shift,
    score: bestScore,
  };
}

/**
 * Compute Box-Cox likelihood for a given lambda
 */
function boxCoxLikelihood(values, lambda) {
  const transformed = applyBoxCox(values, lambda);
  
  // Calculate Jacobian adjustment
  const jacobian = values.reduce((sum, v) => sum + Math.log(v), 0);
  
  // Mean and variance of transformed data
  const mean = transformed.reduce((s, v) => s + v, 0) / transformed.length;
  const variance = transformed.reduce((s, v) => s + (v - mean) ** 2, 0) / transformed.length;
  
  // Log-likelihood (Gaussian assumption)
  const ll = -transformed.length * Math.log(Math.sqrt(variance)) + jacobian;
  
  return ll / transformed.length; // Average per observation
}

/**
 * Auto-detect seasonality type (additive vs multiplicative)
 */
export function detectSeasonalityType(values, seasonLength) {
  if (values.length < seasonLength * 2 || seasonLength < 2) {
    return 'additive';
  }
  
  // Compute coefficient of variation for each season period
  const cofs = [];
  for (let s = 0; s < seasonLength; s++) {
    const seasonData = [];
    for (let i = s; i < values.length; i += seasonLength) {
      seasonData.push(values[i]);
    }
    
    if (seasonData.length < 2) continue;
    
    const mean = seasonData.reduce((s, v) => s + v, 0) / seasonData.length;
    const std = Math.sqrt(seasonData.reduce((s, v) => s + (v - mean) ** 2, 0) / seasonData.length);
    
    if (mean > 0) {
      cofs.push(std / mean);
    }
  }
  
  if (cofs.length === 0) return 'additive';
  
  const avgCof = cofs.reduce((s, v) => s + v, 0) / cofs.length;
  
  // If CV is high (> 0.5), suggests multiplicative pattern
  return avgCof > 0.5 ? 'multiplicative' : 'additive';
}

/**
 * Auto-transform based on data characteristics
 */
export function autoTransformAndForecast(values, options) {
  const {
    seasonLength = null,
    damped = false,
    seasonality = 'auto',
  } = options;
  
  // Determine seasonality type
  let effectiveSeasonality = seasonality;
  if (seasonality === 'auto') {
    effectiveSeasonality = seasonLength 
      ? detectSeasonalityType(values, seasonLength)
      : 'additive';
  }
  
  // Find optimal lambda if multiplicative
  let lambda = 0;
  if (effectiveSeasonality === 'multiplicative') {
    const result = findOptimalLambda(values);
    lambda = result.lambda;
  }
  
  return {
    effectiveSeasonality,
    lambda,
    shouldTransform: effectiveSeasonality === 'multiplicative',
  };
}
