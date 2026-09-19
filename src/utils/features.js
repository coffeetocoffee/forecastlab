// Feature generation utilities for Phase 1: Exogenous Regressors & Features
// Still classical statistics (GLM), NOT machine learning.

import { fourierFeatures, fourierForecast, autoFourier } from './fourier.js';

/**
 * Parse Fourier configuration from project file.
 * Expected format:
 * {
 *   "fourier": {
 *     "harmonics": [2, 3],  // optional, default [1] for each seasonality
 *     "seasonLengths": [24, 168],  // daily + weekly for hourly data
 *     "autoDetect": true  // if true, detect seasonality automatically
 *   },
 *   "holidays": "./holidays.json",  // optional, path to holiday calendar
 *   "external": ["weather.csv"]  // optional, paths to external regressor files
 * }
 */
export function parseFeatureConfig(config) {
  const features = {};
  
  // Fourier terms
  if (config.fourier) {
    const { harmonics = null, seasonLengths = null, autoDetect = false } = config.fourier;
    
    if (autoDetect) {
      // Will be filled in with actual values when generating features
      features.autoFourier = true;
    } else if (seasonLengths && Array.isArray(seasonLengths)) {
      features.seasonLengths = seasonLengths;
      features.harmonics = harmonics || seasonLengths.length > 0 ? [1] : [];
      features.manual = true;
    }
  }
  
  // Holiday calendar (will load later)
  if (config.holidays) {
    features.holidaysPath = config.holidays;
  }
  
  // External regressors
  if (config.external && Array.isArray(config.external)) {
    features.externalPaths = config.external;
  }
  
  return features;
}

/**
 * Generate Fourier features based on parsed configuration and data.
 * @param {Object} input - Input object with values, validation, config
 * @returns {Object} Features matrix ready for GLM or error message
 */
export function generateFeatures(input) {
  const { values, validation, config } = input;
  const featureConfig = config.features || config.fourier;
  
  if (!featureConfig) {
    return {
      valid: false,
      usesFeatures: false,
      message: 'No features configured',
    };
  }
  
  // Auto-detect mode
  if (featureConfig.autoFourier) {
    const result = autoFourier({ values }, { maxLag: 500, K: 2 });
    return {
      ...result,
      usesFeatures: true,
      valid: true,
    };
  }
  
  // Manual configuration
  if (featureConfig.manual && featureConfig.seasonLengths) {
    const harmonics = featureConfig.harmonics?.[0] || 1;
    const features = fourierFeatures(
      values,
      featureConfig.seasonLengths,
      { K: harmonics }
    );
    
    return {
      ...features,
      usesFeatures: true,
      valid: true,
    };
  }
  
  if (featureConfig.seasonLength && featureConfig.harmonics !== undefined) {
    // Single season length (backward compatibility)
    const features = fourierFeatures(values, featureConfig.seasonLength, {
      K: featureConfig.harmonics,
    });
    
    return {
      ...features,
      seasonLengths: [featureConfig.seasonLength],
      usesFeatures: true,
      valid: true,
    };
  }
  
  return {
    valid: false,
    usesFeatures: false,
    message: 'Invalid or incomplete feature configuration',
  };
}

/**
 * Prepare future feature matrix for forecast horizon.
 * Used by GLM forecasting once model is fitted.
 */
export function prepareFutureFeatures(features, lastObsT, horizon) {
  if (!features.usesFeatures || !features.matrix) {
    return null;
  }
  
  return fourierForecast(
    { t: lastObsT, n: features.matrix.length },
    features.seasonLengths,
    horizon,
    { K: features.harmonics || 1 }
  );
}

/**
 * Create Fourier term configuration object for project file.
 * @param {number|number[]} seasonLengths - Single season length or array
 * @param {number} K - Number of harmonics per seasonality
 * @returns {Object} Configuration suitable for project file
 */
export function createFourierConfig(seasonLengths, K = 1) {
  const lengths = Array.isArray(seasonLengths) ? seasonLengths : [seasonLengths];
  
  return {
    type: 'fourier',
    seasonLengths: lengths,
    harmonics: Array.isArray(K) ? K : new Array(lengths.length).fill(K),
    manual: true,
  };
}

/**
 * Example: Weekend/weekday dummy variables for hourly energy data.
 * This would typically be loaded from an external source or generated programmatically.
 */
export function dayOfWeekDummies(nPoints, stepMs) {
  const dummies = new Array(nPoints);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const msPerDay = 24 * 60 * 60 * 1000;
  
  for (let i = 0; i < nPoints; i++) {
    const timeSinceStart = i * stepMs;
    const dayOfWeek = Math.floor((timeSinceStart % msPerWeek) / msPerDay);
    // Encode as 7 binary dummies (Sunday=0, ..., Saturday=6)
    dummies[i] = new Array(7).fill(0);
    dummies[i][dayOfWeek] = 1;
  }
  
  return dummies;
}

/**
 * Simple indicator for weekend vs weekday.
 */
export function weekendIndicator(nPoints, stepMs) {
  const indicators = new Array(nPoints);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const msPerDay = 24 * 60 * 60 * 1000;
  
  for (let i = 0; i < nPoints; i++) {
    const timeSinceStart = i * stepMs;
    const dayOfWeek = Math.floor((timeSinceStart % msPerWeek) / msPerDay);
    // 1 if weekend (Saturday=5 or Sunday=6), 0 otherwise
    indicators[i] = (dayOfWeek >= 5) ? 1 : 0;
  }
  
  return indicators;
}
