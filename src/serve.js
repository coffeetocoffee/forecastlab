// Local-first browser workbench over the same engine as the CLI: start it,
// open the page, and every knob re-runs the real engine against your files.
// node:http only — no dependencies, no outbound calls, no files written.

import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveInput,
  summarizeSeries,
  applicableMethods,
  backtest,
  fit,
  futureTimes,
  shortLabel,
  buildChartSvg,
  methodCard,
  allMethodCards,
  describeBacktest,
  describeForecast,
} from './index.js';
import { MonteCarloSimulation } from './uncertainty.js';
import { HierarchicalReconciler } from './multiSeries.js';
import * as scenarios from './scenarios/index.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(HERE, '..', 'examples');
const BOOL_PARAMS = new Set(['resample', 'damped']);
const PROTECTED = new Set(['summary', 'compare', 'forecast']);

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  send(res, status, 'application/json; charset=utf-8', body);
}

/**
 * Query params become engine options. The server's CLI defaults (e.g.
 * `serve --project x.forecast.json`) apply where the client sends nothing, so
 * a bare request reproduces the settings the server started with. Flags are
 * sent explicitly by the page: 'false' overrides a project file's setting.
 */
function toOpts(searchParams, defaults) {
  const opts = {};
  for (const [key, value] of searchParams) {
    if (key === 'token' || value === '') continue;
    if (BOOL_PARAMS.has(key)) {
      if (value === 'true' || value === '1') opts[key] = true;
      else if (value === 'false' || value === '0') opts[key] = false;
    } else {
      opts[key] = value;
    }
  }
  return { ...defaults, ...opts };
}

function inputFrom(searchParams, defaults) {
  return resolveInput(toOpts(searchParams, defaults));
}

/** Same backtest the report command runs: every applicable method, ranked by RMSE. */
function runBacktest(input) {
  const ids = applicableMethods(input.values.length, input.config.seasonLength);
  if (ids.length === 0) return null;
  return backtest(input.values, {
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    testSize: input.config.testSize ?? undefined,
    methods: input.config.methods ?? ids,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
  });
}

function handleSummary(searchParams, defaults) {
  const input = inputFrom(searchParams, defaults);
  return {
    config: input.config,
    summary: summarizeSeries(input.parsed.points, input.validation),
    issues: input.validation.issues,
    skipped: input.parsed.skipped.length,
    applicable: applicableMethods(input.values.length, input.config.seasonLength),
  };
}

function handleCompare(searchParams, defaults) {
  const input = inputFrom(searchParams, defaults);
  const bt = runBacktest(input);
  return {
    config: input.config,
    backtest: bt,
    reading: bt ? describeBacktest(bt) : null,
  };
}

function handleForecast(searchParams, defaults) {
  const opts = toOpts(searchParams, defaults);
  const input = resolveInput(opts);
  const wanted = opts.method ?? 'auto';
  let bt = null;
  let methodId;
  if (wanted === 'auto') {
    bt = runBacktest(input);
    if (!bt) throw new Error('No forecasting method applies to this data (too short, or set a season length)');
    methodId = bt.best;
  } else {
    methodId = wanted;
  }
  const f = fit(input.values, methodId, {
    horizon: input.config.horizon,
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
  });
  const times = futureTimes(input.parsed.points, input.validation.stepMs, f.horizon);
  const labels = input.parsed.points.map((p) => shortLabel(p.iso, input.validation.stepMs));
  const chart = buildChartSvg({
    labels,
    values: input.values,
    splitIndex: bt ? bt.splitIndex : null,
    forecast: f.point,
    lower: f.lower,
    upper: f.upper,
    interval: f.interval,
  });
  return {
    config: input.config,
    stepMs: input.validation.stepMs,
    forecast: {
      method: f.method,
      title: f.title,
      horizon: f.horizon,
      interval: f.interval,
      sigma: f.sigma,
      intervalMode: f.intervalMode,
      damped: f.damped,
      seasonality: f.seasonality,
      params: f.params,
      steps: f.point.map((p, k) => ({
        step: k + 1,
        time: times[k] ?? null,
        point: p,
        lower: f.lower[k],
        upper: f.upper[k],
      })),
    },
    chart,
    reading: describeForecast(f),
    card: methodCard(methodId, { damped: input.config.damped, seasonality: input.config.seasonality }),
    autoSelected: wanted === 'auto',
    bestMethod: bt ? bt.best : null,
  };
}

/** Run Monte Carlo simulation for prediction bands */
async function handleSimulation(searchParams, defaults) {
  const opts = toOpts(searchParams, defaults);
  const input = resolveInput(opts);
  
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
  
  const mc = new MonteCarloSimulation({
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

/** Generate scenarios using scenario templates */
async function handleScenarios(searchParams, defaults) {
  const opts = toOpts(searchParams, defaults);
  const input = resolveInput(opts);
  
  const scenarioTypes = opts.types ? opts.types.split(',') : ['promotion', 'price'];
  const baseline = input.values.slice(-input.config.horizon || 24);
  const generatedScenarios = {};
  
  try {
    if (scenarioTypes.includes('promotion')) {
      const promoGen = new scenarios.PromotionLiftScenarios({ defaultLift: 0.25 });
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
      const priceGen = new scenarios.PriceElasticityScenarios({
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

/** Hierarchical reconciliation endpoint */
async function handleHierarchy(searchParams, defaults) {
  const opts = toOpts(searchParams, defaults);
  const input = resolveInput(opts);
  
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

/** Built-in examples, offered in the page as one-click starting points. */
function listExamples() {
  let files;
  try {
    files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.forecast.json')).sort();
  } catch {
    return [];
  }
  return files.map((f) => {
    const project = join(EXAMPLES_DIR, f);
    let name = basename(f, '.forecast.json');
    try {
      name = JSON.parse(readFileSync(project, 'utf8')).name ?? name;
    } catch {
      // keep the file stem if the project file is unreadable
    }
    return { id: basename(f, '.forecast.json'), name, project };
  });
}

function clientScript() {
  return `
const BOOT = BOOTSTRAP;
const $ = (id) => document.getElementById(id);
const num = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
};
const shortLabel = (iso, stepMs) => {
  if (!iso) return '';
  if (stepMs && stepMs < 12 * 3600 * 1000) return iso.slice(0, 13).replace('T', ' ') + ':00';
  return iso.slice(0, 10);
};
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};

// File upload handler for CSV parsing (client-side, no server round-trip)
async function handleFileUpload(file) {
  if (!file) return;
  $('project').value = '';
  $('data').value = file.name;
  
  try {
    const text = await file.text();
    // Parse CSV to get columns
    const lines = text.trim().split('\\n');
    if (lines.length < 2) throw new Error('CSV must have at least a header and one row');
    
    const headers = lines[0].split(',').map(h => h.trim());
    const valuesLine = lines[1].split(',');
    
    // Auto-detect columns
    let timeCol = headers.find(h => /time|date|ts|t/i.test(h)) || headers[0];
    let valueCol = headers.find((h, i) => i !== headers.indexOf(timeCol) && /value|val|v/i.test(h)) || 
                   headers.find((h, i) => i !== headers.indexOf(timeCol)) || headers[1];
    
    $('time').value = timeCol;
    $('value').value = valueCol;
    $('name').value = file.name.replace(/\\.csv$/i, '');
    
    alert('Loaded ' + file.name + '. Columns auto-detected. Click "Run all" to analyze.');
  } catch (e) {
    showError('Error reading CSV: ' + e.message);
  }
}

function table(headers, rows, rowClass) {
  const t = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of headers) headRow.appendChild(el('th', h));
  thead.appendChild(headRow);
  const tbody = el('tbody');
  rows.forEach((r, i) => {
    const tr = el('tr');
    if (rowClass && rowClass(r, i)) tr.className = 'best';
    for (const c of r) tr.appendChild(el('td', c));
    tbody.appendChild(tr);
  });
  t.append(thead, tbody);
  const wrap = el('div');
  wrap.className = 'scroll';
  wrap.appendChild(t);
  return wrap;
}
function params(pristine) {
  const o = {};
  const set = (k, v) => { v = String(v).trim(); if (v !== '') o[k] = v; };
  set('data', $('data').value); set('project', $('project').value);
  set('name', $('name').value); set('unit', $('unit').value);
  set('time', $('time').value); set('value', $('value').value);
  set('season', $('season').value); set('horizon', $('horizon').value);
  set('interval', $('interval').value); set('testSize', $('testSize').value);
  set('method', $('method').value); set('seasonality', $('seasonality').value);
  set('agg', $('agg').value); set('step', $('step').value);
  // A pristine load lets the project file's own flags win; after that the
  // checkboxes are the user's explicit choice and override the file.
  if (!pristine) {
    o.damped = $('damped').checked ? 'true' : 'false';
    o.resample = $('resample').checked ? 'true' : 'false';
  }
  return o;
}
async function api(name, pristine) {
  const url = new URL('api/' + name, location.href);
  for (const [k, v] of Object.entries(params(pristine))) url.searchParams.set(k, v);
  url.searchParams.set('token', BOOT.token);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  let body;
  try { body = await res.json(); } catch { body = { error: 'Bad response from the server' }; }
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
}
const buttons = () => document.querySelectorAll('.actions button');
function busy(on) { buttons().forEach((b) => { b.disabled = on; }); }
function clearError() { $('err').hidden = true; $('err').textContent = ''; }
function showError(msg) { $('err').textContent = msg; $('err').hidden = false; }
function show(id) { $(id).hidden = false; }

// URL State Management - Shareable view state via URL hash
function getState() {
  const state = {};
  const inputs = ['project', 'data', 'name', 'unit', 'time', 'value', 'season', 'horizon', 
                  'interval', 'testSize', 'method', 'seasonality', 'agg', 'step'];
  inputs.forEach(id => {
    const val = $(id).value;
    if (val !== '') state[id] = val;
  });
  if ($('damped').checked) state.damped = true;
  if ($('resample').checked) state.resample = true;
  return state;
}

function setState(state) {
  Object.entries(state).forEach(([key, value]) => {
    if (key === 'damped' || key === 'resample') {
      $(key).checked = value === true || value === 'true';
    } else {
      $(key).value = value;
    }
  });
}

function loadStateFromHash() {
  if (!location.hash) return;
  try {
    const encoded = decodeURIComponent(location.hash.slice(1));
    const state = JSON.parse(encoded);
    if (state && typeof state === 'object') {
      setState(state);
      console.log('Loaded state from URL hash');
    }
  } catch (e) {
    console.warn('Failed to parse URL state:', e);
  }
}

function saveStateToHash() {
  const state = getState();
  if (Object.keys(state).length === 0) {
    history.replaceState(null, '', location.pathname);
  } else {
    const encoded = encodeURIComponent(JSON.stringify(state));
    history.replaceState(null, '', '#' + encoded);
  }
}

// Download project file as JSON
function downloadProjectFile() {
  const project = {
    name: $('name').value || 'Unnamed',
    description: '',
    data: $('data').value,
    timeColumn: $('time').value || null,
    valueColumn: $('value').value || null,
    unit: $('unit').value || null,
    seasonLength: $('season').value ? parseInt($('season').value, 10) : null,
    horizon: $('horizon').value ? parseInt($('horizon').value, 10) : 24,
    interval: parseInt($('interval').value, 10),
    testSize: $('testSize').value ? parseInt($('testSize').value, 10) : null,
    resample: $('resample').checked,
    agg: $('agg').value,
    step: $('step').value ? parseInt($('step').value, 10) : null,
    damped: $('damped').checked,
    seasonality: $('seasonality').value,
    requiresVersion: '0.1.0',
  };
  
  const blob = new Blob([JSON.stringify(project, null, 2) + '\\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = project.name + '.forecast.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert('Project file downloaded: ' + project.name + '.forecast.json');
}

// Update state on any change
function updateStateOnChange() {
  saveStateToHash();
}

// Add change listeners to all inputs
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const inputs = ['project', 'data', 'name', 'unit', 'time', 'value', 'season', 'horizon',
                    'interval', 'testSize', 'method', 'seasonality', 'agg', 'step'];
    inputs.forEach(id => {
      $(id).addEventListener('input', updateStateOnChange);
    });
    $('damped').addEventListener('change', updateStateOnChange);
    $('resample').addEventListener('change', updateStateOnChange);
    
    // Load initial state from URL hash
    loadStateFromHash();
  }, 0);
});

function renderSummary(d, apply) {
  const cfg = d.config, s = d.summary;
  if (apply) applyConfig(cfg);
  const box = $('quality');
  box.innerHTML = '';
  box.appendChild(el('p', cfg.name + ': ' + s.count + ' points, ' + (s.start ?? '?') + ' to ' + (s.end ?? '?')));
  const cols = 'Columns: time="' + cfg.timeColumn + '", value="' + cfg.valueColumn + '"'
    + (cfg.unit ? ', unit: ' + cfg.unit : '')
    + (cfg.resampled ? ' · resampled to a ' + cfg.resampled.stepMs + ' ms grid (' + cfg.resampled.agg + ')' : '');
  box.appendChild(el('p', cols)).className = 'muted';
  box.appendChild(el('p', 'Regular grid: ' + (s.regular ? 'yes (' + s.stepMs + ' ms)' : 'no — check timestamps or resample')
    + ' · applicable methods: ' + (d.applicable.join(', ') || 'none'))).className = 'muted';
  if (d.issues.length === 0) {
    box.appendChild(el('p', 'Clean — no duplicates, gaps, outliers, or missing values.'));
  } else {
    box.appendChild(el('p', d.issues.length + ' quality note(s):'));
    box.appendChild(table(
      ['#', 'Type', 'Detail'],
      d.issues.slice(0, 50).map((iss, i) => [i + 1, iss.type, iss.message]),
    ));
    if (d.issues.length > 50) box.appendChild(el('p', 'Showing 50 of ' + d.issues.length + ' notes.')).className = 'muted';
  }
  show('card-quality');
}

function renderCompare(d) {
  const box = $('compare');
  box.innerHTML = '';
  if (!d.backtest) {
    box.appendChild(el('p', 'No method applies to this data (too short, or set a season length).')).className = 'muted';
    show('card-compare');
    return;
  }
  const bt = d.backtest;
  box.appendChild(el('p', d.reading));
  box.appendChild(table(
    ['Method', 'RMSE', 'MAE', 'MAPE %', 'sMAPE %', 'MASE'],
    bt.results.map((r) => [r.title, num(r.rmse), num(r.mae), num(r.mape), num(r.smape), num(r.mase)]),
    (r, i) => i === 0,
  ));
  const note = box.appendChild(el('p', 'Held out the last ' + bt.testSize + ' points and forecast them blind. Lowest RMSE wins; MASE below 1 beats a naive baseline.'));
  note.className = 'muted';
  show('card-compare');
}
function renderForecast(d) {
  const f = d.forecast;
  const box = $('forecast');
  box.innerHTML = '';
  const head = el('p');
  head.textContent = d.reading;
  if (d.autoSelected) {
    const tag = el('span', ' · method: ' + f.title + ' (auto-selected by backtest)');
    head.appendChild(tag);
  }
  box.appendChild(head);
  
  // Interactive chart with hover and toggles
  const chartContainer = el('div');
  chartContainer.className = 'chart interactive';
  chartContainer.id = 'interactive-chart';
  
  // Method comparison toggle overlay
  const overlay = el('div');
  overlay.className = 'chart-overlay';
  overlay.id = 'method-overlay';
  overlay.hidden = true;
  
  const overlayTitle = el('h3', 'Compare Methods');
  overlay.appendChild(overlayTitle);
  
  const compareTable = table(
    ['Method', 'RMSE', 'MAE', 'Status'],
    d.backtest?.results.map((r) => [
      r.title, 
      num(r.rmse),
      d.backtest.best === r.method ? '<strong>Winner</strong>' : '✗'
    ])
  );
  overlay.appendChild(compareTable);
  
  const closeOverlay = el('button', 'Close');
  closeOverlay.onclick = () => { overlay.hidden = true; };
  overlay.appendChild(closeOverlay);
  
  chartContainer.appendChild(overlay);
  chartContainer.innerHTML = d.chart;
  box.appendChild(chartContainer);
  
  // Make chart interactive with hover tooltips
  makeChartInteractive(chartContainer, d.stepMs, f.steps);
  
  const showRows = f.steps.slice(0, 100);
  box.appendChild(table(
    ['Step', 'Time', 'Forecast', 'Lower ' + f.interval + '%', 'Upper ' + f.interval + '%'],
    showRows.map((s) => [s.step, s.time ? shortLabel(s.time, d.stepMs) : '+' + s.step, num(s.point), num(s.lower), num(s.upper)]),
  ));
  if (f.steps.length > showRows.length) {
    const more = box.appendChild(el('p', 'Showing first ' + showRows.length + ' of ' + f.steps.length + ' steps.'));
    more.className = 'muted';
  }
  show('card-forecast');

  const c = d.card;
  $('method-title').textContent = 'Method: ' + c.title;
  const m = $('method-card');
  m.innerHTML = '';
  m.appendChild(el('p', c.summary));
  const math = el('p');
  math.className = 'math';
  math.textContent = c.math;
  m.appendChild(math);
  const useWhen = el('p');
  useWhen.appendChild(el('b', 'Use when: '));
  useWhen.appendChild(document.createTextNode(c.useWhen));
  m.appendChild(useWhen);
  const watch = el('p');
  watch.appendChild(el('b', 'Watch out: '));
  watch.appendChild(document.createTextNode(c.pitfalls));
  m.appendChild(watch);
  show('card-method');
  
  // Add download button if we have data
  if ($('data').value) {
    const downloadBtn = $('forecast').appendChild(el('button', 'Download Project File'));
    downloadBtn.className = 'primary';
    downloadBtn.style.marginTop = '16px';
    downloadBtn.onclick = downloadProjectFile;
  }
}

// Make SVG chart interactive with hover tooltips and method comparison toggle
function makeChartInteractive(container, stepMs, forecastSteps) {
  const svg = container.querySelector('svg');
  if (!svg) return;
  
  // Get dimensions
  const rect = svg.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 300;
  
  // Create tooltip
  const tooltip = el('div');
  tooltip.className = 'chart-tooltip';
  tooltip.style.cssText = 'position:absolute;background:#1f2937;color:white;padding:8px 12px;border-radius:6px;font-size:12px;display:none;z-index:1000;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
  document.body.appendChild(tooltip);
  
  // Add hover functionality
  svg.addEventListener('mousemove', (e) => {
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Find closest data point
    const timePoints = svg.querySelectorAll('.time-point');
    let closest = null;
    let minDist = Infinity;
    
    timePoints.forEach((tp) => {
      const tpX = parseFloat(tp.getAttribute('cx'));
      const dist = Math.abs(x - tpX);
      if (dist < minDist && dist < 30) {
        minDist = dist;
        closest = tp;
      }
    });
    
    if (closest) {
      const dataIndex = parseInt(closest.getAttribute('data-index'), 10);
      const pointVal = closest.getAttribute('data-value');
      const timeISO = closest.getAttribute('data-time');
      
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 10) + 'px';
      tooltip.style.top = (e.clientY - 10) + 'px';
       const timeText = timeISO ? shortLabel(timeISO, stepMs) : 'n/a';
       tooltip.innerHTML = '&lt;strong&gt;Time:&lt;/strong&gt; ' + timeText + '&lt;br&gt;' + '&lt;strong&gt;Value:&lt;/strong&gt; ' + num(pointVal);
    } else {
      tooltip.style.display = 'none';
    }
  });
  
  svg.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
  
  // Add legend with method toggles
  const legend = el('div');
  legend.className = 'chart-legend';
  legend.style.cssText = 'margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;';
  
  const leftSide = el('div');
  leftSide.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;';
  
  const methods = [
    { key: 'history', label: 'Historical Data', color: '#3b82f6' },
    { key: 'forecast', label: 'Forecast', color: '#10b981' },
    { key: 'lower', label: 'Lower Bound', color: '#fbbf24' },
    { key: 'upper', label: 'Upper Bound', color: '#fbbf24' },
  ];
  
  methods.forEach(m => {
    const item = el('label');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;';
    
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.visible = m.key;
    checkbox.onchange = () => toggleChartSeries(svg, m.key, checkbox.checked);
    
    const swatch = el('span');
    swatch.style.cssText = 'width:12px;height:12px;border-radius:2px;background:' + m.color;
    
    item.appendChild(swatch);
    item.appendChild(checkbox);
    item.appendChild(document.createTextNode(m.label));
    leftSide.appendChild(item);
  });
  
  const rightSide = el('div');
  rightSide.style.cssText = 'display:flex;gap:8px;';
  
  const compareBtn = el('button');
  compareBtn.textContent = 'Compare Methods';
  compareBtn.onclick = () => {
    overlay.hidden = !overlay.hidden;
  };
  rightSide.appendChild(compareBtn);
  
  legend.appendChild(leftSide);
  legend.appendChild(rightSide);
  container.parentNode.appendChild(legend);
}

function toggleChartSeries(svg, seriesKey, visible) {
  const selector = '.' + seriesKey;
  svg.querySelectorAll(selector).forEach(el => {
    el.style.display = visible ? 'block' : 'none';
  });
}

function applyConfig(cfg) {
  const set = (id, v) => {
    if (v !== null && v !== undefined && String(v) !== '') $(id).value = v;
  };
  set('name', cfg.name); set('unit', cfg.unit);
  set('time', cfg.timeColumn); set('value', cfg.valueColumn);
  set('season', cfg.seasonLength); set('horizon', cfg.horizon);
  set('interval', cfg.interval); set('testSize', cfg.testSize);
  set('seasonality', cfg.seasonality); set('agg', cfg.agg); set('step', cfg.step);
  $('damped').checked = !!cfg.damped;
  $('resample').checked = !!cfg.resample;
}

async function action(name, fn) {
  clearError();
  busy(true);
  try { fn(await api(name, false)); } catch (e) { showError(e.message); }
  finally { busy(false); }
}

async function runAll(apply) {
  clearError();
  busy(true);
  try {
    const s = await api('summary', apply); renderSummary(s, apply);
    const c = await api('compare', false); renderCompare(c);
    const f = await api('forecast', false); renderForecast(f);
  } catch (e) { showError(e.message); }
  finally { busy(false); }
}

async function loadExamples() {
  let body;
  try {
    const res = await fetch(new URL('api/examples', location.href), { headers: { accept: 'application/json' } });
    body = await res.json();
  } catch { return; }
  const sel = $('examples');
  for (const ex of body.examples) {
    const o = el('option', ex.name);
    o.value = ex.project;
    sel.appendChild(o);
  }
  sel.disabled = body.examples.length === 0;
}

function prefill() {
  const d = BOOT.defaults;
  const set = (id, v) => { if (v !== undefined && v !== null && String(v) !== '') $(id).value = v; };
  set('data', d.data); set('project', d.project);
  set('name', d.name); set('unit', d.unit);
  set('time', d.time); set('value', d.value);
  set('season', d.season); set('horizon', d.horizon);
  set('interval', d.interval); set('testSize', d.testSize);
  set('method', d.method); set('seasonality', d.seasonality);
  set('agg', d.agg); set('step', d.step);
  $('damped').checked = d.damped === true || d.damped === 'true';
  $('resample').checked = d.resample === true || d.resample === 'true';
}

$('btn-check').onclick = () => action('summary', (d) => renderSummary(d, false));
$('btn-compare').onclick = () => action('compare', renderCompare);
$('btn-forecast').onclick = () => action('forecast', renderForecast);
$('btn-all').onclick = () => runAll(false);
// Phase 5 Visualizations
$('btn-simulation').onclick = async () => { try { const u=new URL('api/simulation',location.href);u.searchParams.set('token',BOOT.token);const r=await fetch(u,{headers:{accept:'application/json'}});const d=await r.json();$('card-simulation').hidden=false;const c=$('simulation-viz');c.innerHTML='';if(d.error){c.appendChild(el('p','Error:'+d.error));return} if(!d.simulation){c.appendChild(el('p','No data'));return} c.appendChild(el('p',d.simulation.numPaths+' paths')).style.marginTop='12px'; }; catch(e) { showError(e.message) } };

$('btn-scenarios').onclick = async () => { try { const u=new URL('api/scenarios',location.href);u.searchParams.set('token',BOOT.token);const r=await fetch(u,{headers:{accept:'application/json'}});const d=await r.json();$('card-scenarios').hidden=false;const c=$('scenarios-viz');c.innerHTML='';if(d.error){c.appendChild(el('p','Error:'+d.error));return} const s=d.scenarios||{};if(Object.keys(s).length===0){c.appendChild(el('p','No templates'));}else{Object.entries(s).forEach(([t,n])=>{c.appendChild(el('p',t+':'+(Array.isArray(n)?n.length:'?')))});}}catch(e){showError(e.message)} };
$('examples').onchange = (e) => {
  const project = e.target.value;
  if (!project) return;
  $('project').value = project;
  $('data').value = '';
  runAll(true);
};

$('project').onchange = () => {
  $('csv-upload').value = '';
  $('data').value = '';
};

$('serverinfo').textContent = 'Listening on ' + location.host + ' · forecastlab ' + BOOT.version + ' · re-reads your file on every request';
prefill();
loadExamples();
if (BOOT.defaults.data || BOOT.defaults.project) runAll(true);
`;
}

export function workbenchHtml({ token, defaults }) {
  const bootstrap = JSON.stringify({ token, version: VERSION, defaults })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>ForecastLab workbench</title>
<script src="https://d3js.org/d3.v7.min.js"><\/script>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:1040px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb}
header{background:#111827;color:#f9fafb;border-radius:12px;padding:24px;margin-bottom:24px}
header h1{margin:0 0 8px;font-size:28px}header p{margin:4px 0;color:#d1d5db}
header .muted{color:#9ca3af;font-size:13px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:20px}
.card[hidden]{display:none}
h2{margin-top:0;font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#374151}
label.check{flex-direction:row;align-items:center;gap:8px;min-height:38px}
input,select{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;background:#fff;color:#111827;width:100%}
button{padding:8px 16px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#111827;font-size:14px;cursor:pointer}
button.primary{background:#111827;color:#f9fafb;border-color:#111827}
button:disabled{opacity:.6;cursor:wait}
.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.examples{margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:13px;color:#374151;display:flex;gap:8px;align-items:center}
.examples select{width:auto;min-width:220px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
th{background:#f3f4f6}
tr.best td{background:#ecfdf5;font-weight:600}
.scroll{overflow-x:auto}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}
.math{background:#f3f4f6;border-radius:8px;padding:12px 16px;font-family:ui-monospace,monospace;white-space:pre-wrap}
.muted{color:#6b7280;font-size:13px}
.chart{margin:8px 0;position:relative}
.chart.interactive svg{cursor:pointer}
.chart-overlay{position:absolute;top:10px;right:10px;background:white;border:2px solid #374151;border-radius:8px;padding:12px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:300px}
.chart-overlay h3{margin:0 0 8px;font-size:14px}
.chart-overlay table{font-size:12px}
.chart-tooltip{position:fixed;padding:8px 12px;background:#1f2937;color:white;border-radius:6px;font-size:12px;display:none;z-index:1000;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.15)}
.chart-legend{margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between}
#err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:12px;padding:16px 20px;margin-bottom:20px}
#err[hidden]{display:none}
footer{color:#6b7280;font-size:13px;text-align:center;padding:16px}
</style>
</head>
<body>
<header>
  <h1>ForecastLab workbench</h1>
  <p>Local-first forecasting in your browser — the same engine as the CLI, no data leaves this machine.</p>
  <p class="muted" id="serverinfo"></p>
</header>
<main>
  <div id="err" hidden></div>
  <section class="card">
    <h2>Data &amp; settings</h2>
    <form id="form" onsubmit="return false">
      <div class="grid">
        <label>Project file (.forecast.json)<input id="project" placeholder="examples/energy.forecast.json"></label>
        <label>CSV file 
          <input type="file" id="csv-upload" accept=".csv" style="display:none" onchange="handleFileUpload(this.files[0])">
          <button type="button" onclick="$('csv-upload').click()" style="margin-top:2px;">📤 Upload CSV</button>
        </label>
        <input type="hidden" id="data">
        <label>Dataset name<input id="name" placeholder="auto from filename"></label>
        <label>Unit<input id="unit" placeholder="kWh"></label>
        <label>Time column<input id="time" placeholder="auto-detected"></label>
        <label>Value column<input id="value" placeholder="auto-detected"></label>
        <label>Season length (steps)<input id="season" type="number" min="2" placeholder="e.g. 24"></label>
        <label>Horizon (steps)<input id="horizon" type="number" min="1" value="24"></label>
        <label>Interval
          <select id="interval"><option>80</option><option>90</option><option>95</option></select>
        </label>
        <label>Test size<input id="testSize" type="number" min="1" placeholder="auto (~20%)"></label>
        <label>Method
          <select id="method">
            <option value="auto">auto (backtest winner)</option>
            <option value="naive">naive</option>
            <option value="snaive">seasonal naive</option>
            <option value="mean">mean</option>
            <option value="drift">drift</option>
            <option value="linear">linear trend</option>
            <option value="holt">Holt</option>
            <option value="hw">Holt-Winters</option>
          </select>
        </label>
        <label>HW seasonality
          <select id="seasonality"><option value="additive">additive</option><option value="multiplicative">multiplicative</option></select>
        </label>
        <label class="check"><input type="checkbox" id="damped"> Damped trend (holt/hw)</label>
        <label class="check"><input type="checkbox" id="resample"> Resample to fixed grid</label>
        <label>Resample aggregation
          <select id="agg"><option>mean</option><option>sum</option><option>first</option><option>last</option><option>min</option><option>max</option></select>
        </label>
        <label>Grid step (ms)<input id="step" type="number" min="1" placeholder="auto"></label>
      </div>
      <div class="actions">
        <button type="button" id="btn-check">Check quality</button>
        <button type="button" id="btn-compare">Compare methods</button>
        <button type="button" id="btn-forecast">Forecast</button>
        <button type="button" id="btn-all" class="primary">Run all</button>
        <hr style="width:100%;border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
        <button type="button" id="btn-simulation">Monte Carlo Simulation</button>
        <button type="button" id="btn-scenarios">Scenario Analysis</button>
      </div>
      <div class="examples">
        <span>Load a built-in example:</span>
        <select id="examples" disabled><option value="">(none found)</option></select>
      </div>
    </form>
  </section>
  <section class="card" id="card-quality" hidden><h2>Data quality</h2><div id="quality"></div></section>
  <section class="card" id="card-compare" hidden><h2>Method comparison (backtest)</h2><div id="compare"></div></section>
  <section class="card" id="card-forecast" hidden><h2>Forecast</h2><div id="forecast"></div></section>
  <section class="card" id="card-method" hidden><h2 id="method-title">Method</h2><div id="method-card"></div></section>
  
  <!-- Phase 5 Visualizations -->
  <section class="card" id="card-simulation" hidden><h2>Monte Carlo Simulation</h2><div id="simulation-viz"></div></section>
  <section class="card" id="card-scenarios" hidden><h2>Scenario Analysis</h2><div id="scenarios-viz"></div></section>
</main>
<footer>Built locally with ForecastLab · the page re-reads your file on every request · nothing is uploaded</footer>
<script>
const BOOTSTRAP = ${bootstrap};
${clientScript()}
</script>
</body>
</html>`;
}

/**
 * HTTP server for the workbench. Every request re-reads the data file and
 * re-runs the engine, so the page always reflects the CSV on disk. Routes
 * under /api that read user data require a token (issued per server start) so
 * a web page on another origin cannot drive this server without it.
 * options: { token, defaults }.
 */
export function createServer(options = {}) {
  const token = options.token ?? randomUUID();
  const defaults = options.defaults ?? {};
  const server = createHttpServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'Malformed request' });
    }
    const path = url.pathname;
    try {
      if (path === '/') {
        return send(res, 200, 'text/html; charset=utf-8', workbenchHtml({ token, defaults }));
      }
      if (path === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION });
      if (path === '/api/methods') return sendJson(res, 200, { methods: allMethodCards() });
      if (path === '/api/examples') return sendJson(res, 200, { examples: listExamples() });
      if (!path.startsWith('/api/')) return sendJson(res, 404, { error: `Not found: ${path}` });
      const name = path.slice('/api/'.length);
      if (PROTECTED.has(name) && url.searchParams.get('token') !== token) {
        if (req.headers.authorization !== `Bearer ${token}`) {
          return sendJson(res, 403, { error: 'Missing or invalid token' });
        }
      }
      if (name === 'summary') return sendJson(res, 200, handleSummary(url.searchParams, defaults));
      if (name === 'compare') return sendJson(res, 200, handleCompare(url.searchParams, defaults));
      if (name === 'forecast') return sendJson(res, 200, handleForecast(url.searchParams, defaults));
      if (name === 'simulation') { handleSimulation(url.searchParams, defaults).then(r => sendJson(res, 200, r)).catch(e => sendJson(res, 400, { error: e.message })); return; }
      if (name === 'scenarios') { handleScenarios(url.searchParams, defaults).then(r => sendJson(res, 200, r)).catch(e => sendJson(res, 400, { error: e.message })); return; }
      if (name === 'hierarchy') { handleHierarchy(url.searchParams, defaults).then(r => sendJson(res, 200, r)).catch(e => sendJson(res, 400, { error: e.message })); return; }
      return sendJson(res, 404, { error: `Not found: ${path}` });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });
  return server;
}

/** Best-effort "open the URL in the default browser"; never fails the server. */
export function openBrowser(url) {
  try {
    const arg = process.platform === 'win32' ? `"${url}"` : url;
    const [cmd, args] = process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', arg]]
      : process.platform === 'darwin'
        ? ['open', [arg]]
        : ['xdg-open', [arg]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // the printed URL is enough
  }
}

