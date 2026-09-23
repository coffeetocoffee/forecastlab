// Phase 4 advanced analytics commands: reconcile, panel, spillover, factors,
// uncertainty, what-if, schedule, update.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv } from '../index.js';
import { HierarchicalReconciler, PanelAnalyzer, VARModel, FactorExtractor } from '../multiSeries.js';
import { MonteCarloSimulator } from '../uncertainty.js';
import { CounterfactualEngine } from '../counterfactual.js';
import { UpdateScheduler, EventTriggerSystem } from '../scheduler.js';

/**
 * Reconcile hierarchical forecasts
 */
export async function cmdReconcile(opts) {
  if (!opts.project) throw new Error('--project required for reconcile');

  const project = JSON.parse(readFileSync(resolve(opts.project), 'utf8'));

  // Load hierarchy configuration
  const hierarchyConfig = opts.hierarchy
    ? JSON.parse(readFileSync(resolve(opts.hierarchy), 'utf8'))
    : defaultHierarchy(project);

  const reconciler = new HierarchicalReconciler(hierarchyConfig);

  // Load forecasts and actual data
  const seriesData = await loadSeriesData(project);
  const bottomForecasts = await reconciler.forecastBottom(seriesData, { method: project.method || 'holt', horizon: project.horizon || 10 });

  const reconciled = reconciler.reconcile(bottomForecasts);

  // Write output
  writeFileSync(
    resolve(opts.out || 'reconciled-forecasts.json'),
    JSON.stringify({ reconciled, methodology: 'optimal_combination' }, null, 2)
  );
  console.log('Reconciliation complete. Results written to reconciled-forecasts.json');
}

function defaultHierarchy(project) {
  // Auto-detect simple hierarchy from project metadata
  return {
    levels: ['region', 'product'],
    series: {},
    constraints: []
  };
}

async function loadSeriesData(project) {
  // Placeholder - would load from project configuration
  return {};
}

/**
 * Panel data analysis
 */
export async function cmdPanel(opts) {
  if (!opts['series-dir']) throw new Error('--series-dir required for panel analysis');

  const seriesDir = resolve(opts['series-dir']);
  const methods = opts.methods ? opts.methods.split(',') : ['holt', 'snaive'];
  const groupBy = opts['group-by'] || 'category';

  // Load all series from directory
  const seriesGroup = [];
  // Implementation would scan directory and parse CSVs

  const analyzer = new PanelAnalyzer(seriesGroup);
  const results = await analyzer.compareMethods(methods, ['RMSE', 'MAE']);

  writeFileSync(
    resolve(opts.out || 'panel-analysis.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('Panel analysis complete.');
}

/**
 * Spillover detection using VAR models
 */
export async function cmdSpillover(opts) {
  if (!opts.series) throw new Error('--series required (comma-separated CSV files)');

  const seriesFiles = opts.series.split(',').map(f => resolve(f.trim()));

  // Load series
  const timeSeriesMatrix = await Promise.all(seriesFiles.map(async f => {
    const csv = readFileSync(f, 'utf8');
    const data = parseCsv(csv);
    return data.values;
  }));

  const varModel = new VARModel(1);
  const result = await varModel.fit(timeSeriesMatrix);

  writeFileSync(
    resolve(opts.out || 'spillover-results.json'),
    JSON.stringify(result, null, 2)
  );
  console.log('Spillover analysis complete.');
}

/**
 * Factor extraction
 */
export async function cmdFactors(opts) {
  if (!opts.data) throw new Error('--data required');

  const matrix = await loadFactorMatrix(opts.data);

  const extractor = new FactorExtractor();
  const k = parseInt(opts.factors) || 5;
  const result = extractor.extractFactors(matrix, k);

  writeFileSync(
    resolve(opts.out || 'factors.json'),
    JSON.stringify(result, null, 2)
  );
  console.log(`Extracted ${k} factors.`);
}

async function loadFactorMatrix(dataPath) {
  // Placeholder - would load multi-series matrix
  return [];
}

/**
 * Advanced uncertainty quantification
 */
export async function cmdUncertainty(opts) {
  if (!opts.project) throw new Error('--project required');

  const project = JSON.parse(readFileSync(resolve(opts.project), 'utf8'));
  const mcSimulator = new MonteCarloSimulator({ nSims: 10000 });

  if (opts.type === 'cumulative') {
    const horizon = parseInt(opts.period) || 30;
    const paths = await mcSimulator.simulatePaths({}, horizon);
    const interval = mcSimulator.computeCumulativeInterval(paths, horizon);

    console.log(JSON.stringify(interval, null, 2));
  } else if (opts.type === 'joint') {
    const horizon = opts.horizon ? parseInt(opts.horizon) : 24;
    const paths = await mcSimulator.simulatePaths({}, horizon);
    const bands = mcSimulator.computeJointBands(paths, 0.95, 'simulation');

    console.log(JSON.stringify(bands, null, 2));
  }
}

/**
 * Counterfactual "what-if" scenarios
 */
export async function cmdWhatIf(opts) {
  if (!opts.project) throw new Error('--project required');

  const model = await loadFittedModel(opts.project);
  const engine = new CounterfactualEngine(model);

  const intervention = parseIntervention(opts);
  const result = engine.simulateCounterfactual(intervention);

  writeFileSync(
    resolve(opts.out || 'counterfactual-result.json'),
    JSON.stringify(result, null, 2)
  );
  console.log(result.interpretation);
}

function parseIntervention(opts) {
  // Parse intervention from command line
  return {
    variable: opts.variable || 'trend',
    newValues: opts.constantValue !== undefined ? [parseFloat(opts.constantValue)] : undefined,
    type: opts.type || 'constant_value',
    factor: opts.factor ? parseFloat(opts.factor) : 1
  };
}

async function loadFittedModel(projectFile) {
  // Placeholder - would load fitted model
  return {
    lastValue: 100,
    trend: 1,
    horizon: 30,
    getCoefficients: () => ({})
  };
}

/**
 * Schedule automatic updates
 */
export async function cmdSchedule(opts) {
  const scheduler = new UpdateScheduler();

  const job = scheduler.registerJob({
    modelId: opts.modelId || 'default',
    schedule: opts.schedule || 'daily',
    action: 'refit',
    options: {}
  });

  writeFileSync(
    resolve(opts.out || 'scheduler-config.json'),
    JSON.stringify({ jobId: job, scheduler }, null, 2)
  );
  console.log(`Scheduled update registered with ID: ${job}`);
}

/**
 * Trigger model updates
 */
export async function cmdUpdate(opts) {
  const scheduler = new UpdateScheduler();
  const eventTrigger = new EventTriggerSystem();

  // Execute scheduled jobs
  const execution = await scheduler.executeJobs();

  console.log(`Executed ${execution.executed.length} jobs at ${execution.timestamp}`);
}
