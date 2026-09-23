/**
 * Advanced endpoints: simulation, scenarios, and hierarchical reconciliation.
 */

import { MonteCarloSimulator } from '../../uncertainty.js';
import { HierarchicalReconciler } from '../../multiSeries.js';
import * as scenariosModule from '../../scenarios/index.js';
import { runBacktest } from './forecast.js';
import { toOpts, inputFrom } from './params.js';

/**
 * Run Monte Carlo simulation for prediction bands.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Promise<Object>}
 */
export async function handleSimulation(searchParams, defaults) {
  const opts = toOpts(searchParams, defaults);
  const input = inputFrom(searchParams, defaults);
  
  const numPaths = parseInt(opts.paths || '1000', 10);
  const horizon = parseInt(opts.horizon || input.config.horizon || 24, 10);
  const method = opts.method || 'ar1';
  
  const bt = runBacktest(input);
  const methodId = opts.methodChoice || (bt ? bt.best : 'holt');
  const fitted = fit(input.values, methodId, {
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

/**
 * Generate scenarios using scenario templates.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Promise<Object>}
 */
export async function handleScenarios(searchParams, defaults) {
  const opts = toOpts(searchParams, defaults);
  const input = inputFrom(searchParams, defaults);
  
  const scenarioTypes = opts.types ? opts.types.split(',') : ['promotion', 'price'];
  const baseline = input.values.slice(-input.config.horizon || 24);
  const generatedScenarios = {};
  
  try {
    if (scenarioTypes.includes('promotion')) {
      const promoGen = new scenariosModule.PromotionLiftScenarios({ defaultLift: 0.25 });
      const sc = await promoGen.generateScenarios({
        history: input.values,
        seasonLength: input.config.seasonLength,
        periodDays: 30,
      });
      generatedScenarios.promotion = sc;
    }
  } catch (e) { console.warn('Promo failed:', e.message); }
  
  try {
    if (scenarioTypes.includes('price')) {
      const priceGen = new scenariosModule.PriceElasticityScenarios({
        categories: ['general'],
        basePrice: 100,
        elasticityByCategory: { general: -1.2 },
      });
      const sc = await priceGen.generateScenarios({ forecast: baseline, elasticity: -1.2, products: {} });
      generatedScenarios.price = sc;
    }
  } catch (e) { console.warn('Price failed:', e.message); }
  
  return { config: input.config, baseline, scenarios: generatedScenarios };
}

/**
 * Handle hierarchical reconciliation endpoint.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Promise<Object>}
 */
export async function handleHierarchy(searchParams, defaults) {
  const opts = toOpts(searchParams, defaults);
  const input = inputFrom(searchParams, defaults);
  
  if (!opts.hierarchy) {
    return { error: 'Hierarchical mode not enabled. Specify hierarchy parameter.', supported: false };
  }
  
  const hierarchyConfig = JSON.parse(decodeURIComponent(opts.hierarchy));
  const reconciler = new HierarchicalReconciler(hierarchyConfig);
  const matrix = reconciler.buildAggregationMatrix();
  
  const forecasts = {};
  for (const node of reconciler.hierarchy.nodes) {
    if (reconciler._isBaseLevel(node.id)) {
      forecasts[node.id] = { points: Array(opts.horizon || 24).fill(null), lower: [], upper: [] };
    }
  }
  
  const weights = reconciler.computeWeights(forecasts);
  
  return {
    config: input.config,
    hierarchy: { levels: reconciler.hierarchy.levels, nodes: reconciler.hierarchy.nodes, edges: reconciler.hierarchy.edges, seriesMap: reconciler.hierarchy.seriesMap },
    matrix, weights, forecasts,
  };
}
