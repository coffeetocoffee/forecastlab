/**
 * Monte Carlo simulation handler.
 */

import { MonteCarloSimulator } from '../../uncertainty.js';
import { runBacktest } from './forecast.js';
import { toOpts, inputFrom } from './params.js';
import { futureTimes, fit } from '../../index.js';

/**
 * Handle /api/simulation endpoint - Monte Carlo simulation for prediction bands.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Promise<Object>}
 */
export async function handleSimulation(searchParams, defaults) {
  const opts = require('./params.js').toOpts(searchParams, defaults);
  const input = inputFrom(searchParams, defaults);
  
  const numPaths = parseInt(opts.paths || '1000', 10);
  const horizon = parseInt(opts.horizon || input.config.horizon || 24, 10);
  const method = opts.method || 'ar1';
  
  const bt = runBacktest(input);
  const methodId = opts.methodChoice || (bt ? bt.best : 'holt');
  const fitted = require('../../index.js').fit(input.values, methodId, {
    horizon: horizon,
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
  });
  
  const volatility = fitted.sigma || 0.3;
  
  const mc = new MonteCarloSimulator({
    method: method,
    horizon: horizon,
    numPaths: numPaths,
    volatility: volatility,
    drift: 0,
  });
  
  try {
    const result = await mc.simulate({
      baseValues: input.values.slice(-fitted.horizon),
      lastObserved: input.values[input.values.length - 1],
    });
    
    // Compute percentiles
    const percentiles = { fifty: [], eighty: [], ninetyFive: [] };
    for (let i = 0; i < horizon; i++) {
      const pathValues = result.paths.map(p => p[i]);
      const sorted = [...pathValues].sort((a, b) => a - b);
      percentiles.fifty.push(sorted[Math.floor(sorted.length * 0.5)]);
      percentiles.eighty.push(sorted[Math.floor(sorted.length * 0.1)]);
      percentiles.ninetyFive.push(sorted[Math.floor(sorted.length * 0.025)]);
    }
    
    const times = futureTimes(input.parsed.points, input.validation.stepMs, horizon);
    
    return {
      config: input.config,
      simulation: { method: method, numPaths, horizon, volatility, paths: result.paths.slice(0, 50) },
      percentiles,
      timestamps: times,
      history: input.values.slice(-Math.min(50, input.values.length)),
    };
  } catch (e) {
    return { error: 'Monte Carlo failed: ' + e.message };
  }
}
