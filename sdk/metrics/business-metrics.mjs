/**
 * Custom Metrics for ForecastLab v3.0
 * 
 * Business-specific evaluation metrics beyond standard RMSE/MAE
 */

import { registerMetric } from '../core.mjs';

/**
 * Weighted MAPE - Penalizes errors more on high-value periods
 * Useful when accuracy matters more during peak demand
 */
export function weightedMAPE(actuals, forecasts, params = {}) {
  let weightedError = 0;
  let weightTotal = 0;
  const weightScale = params.weightScale || 1;
  
  for (let i = 0; i < actuals.length; i++) {
    const weight = Math.pow(actuals[i], weightScale);
    weightedError += weight * Math.abs(actuals[i] - forecasts[i]);
    weightTotal += weight;
  }
  
  return (weightedError / weightTotal) * 100;
}

registerMetric('weighted-mape', weightedMAPE);

/**
 * MASE (Mean Absolute Scaled Error) - Scale-independent error measure
 * Compares forecast to naive benchmark
 */
export function mase(actuals, forecasts, params = {}) {
  const seasonalPeriod = params.seasonalPeriod || 24;
  
  // Calculate naive forecast errors for scaling
  const naiveErrors = [];
  for (let i = seasonalPeriod; i < actuals.length; i++) {
    naiveErrors.push(Math.abs(actuals[i] - actuals[i - seasonalPeriod]));
  }
  
  const naiveMAE = naiveErrors.reduce((a, b) => a + b, 0) / naiveErrors.length;
  
  if (naiveMAE === 0) return 0;
  
  const forecastMAE = forecasts.reduce((sum, pred, i) => sum + Math.abs(actuals[i] - pred), 0) / forecasts.length;
  
  return forecastMAE / naiveMAE;
}

registerMetric('mase', mase);

/**
 * Service Level Achievement - Measures how often forecasts meet targets
 * Useful for inventory and capacity planning
 */
export function serviceLevelAchievement(actuals, forecasts, threshold = 0.95) {
  let successes = 0;
  
  for (let i = 0; i < actuals.length; i++) {
    const relativeError = Math.abs(actuals[i] - forecasts[i]) / (actuals[i] || 1);
    if (relativeError <= (1 - threshold)) {
      successes++;
    }
  }
  
  return (successes / actuals.length) * 100;
}

registerMetric('sla-achievement', serviceLevelAchievement);

/**
 * Peak Accuracy Score - Focuses on critical high-demand periods
 */
export function peakAccuracy(actuals, forecasts, params = {}) {
  const topPct = params.topPct || 0.1; // Top 10% highest values
  const threshold = actuals.reduce((a, b) => a + b, 0) * topPct / actuals.length;
  
  const peakActuals = [];
  const peakForecasts = [];
  
  for (let i = 0; i < actuals.length; i++) {
    if (actuals[i] >= threshold) {
      peakActuals.push(actuals[i]);
      peakForecasts.push(forecasts[i]);
    }
  }
  
  if (peakActuals.length === 0) return null; // No peaks detected
  
  const errors = peakActuals.map((a, i) => Math.abs(a - peakForecasts[i]));
  return errors.reduce((a, b) => a + b, 0) / errors.length;
}

registerMetric('peak-mae', peakAccuracy);

/**
 * Direction Accuracy - How often did we predict the right direction?
 */
export function directionAccuracy(actuals, forecasts) {
  let correctDirections = 0;
  
  for (let i = 1; i < actuals.length; i++) {
    const actualDirection = actuals[i] > actuals[i-1] ? 1 : -1;
    const predictedDirection = forecasts[i] > forecasts[i-1] ? 1 : -1;
    
    if (actualDirection === predictedDirection) {
      correctDirections++;
    }
  }
  
  return (correctDirections / (actuals.length - 1)) * 100;
}

registerMetric('direction-accuracy', directionAccuracy);

/**
 * Cost-Sensitive Error - Weights over/under forecasts differently
 * Perfect for inventory where overstock vs stockout have different costs
 */
export function costSensitiveError(actuals, forecasts, params = {}) {
  const overageCost = params.overageCost || 1;
  const underageCost = params.underageCost || 2;
  let totalCost = 0;
  
  for (let i = 0; i < actuals.length; i++) {
    const error = forecasts[i] - actuals[i];
    
    if (error > 0) {
      // Over-forecast: cost proportional to overage
      totalCost += overageCost * error;
    } else {
      // Under-forecast: cost proportional to shortage
      totalCost += underageCost * Math.abs(error);
    }
  }
  
  return totalCost / actuals.length;
}

registerMetric('cost-sensitive', costSensitiveError);
