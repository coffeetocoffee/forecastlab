// Golden-file tests for ForecastLab Tier-3 reproducibility
// Run: node --test test/golden.test.mjs
// These tests pin expected outputs for deterministic example datasets

import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'child_process';

const root = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(root, '..');
const EXAMPLES_DIR = resolve(PROJECT_ROOT, 'examples');
const TEST_OUTPUT = resolve(PROJECT_ROOT, 'test-output');

// Expected golden values (deterministic from seed)
const GOLDEN = {
  energy: {
    dataHash: '7d3629fdd6d6713728c5a687ef949b6474b8e7ae0dba5c7d4f90a9bae8a378c9',
    backtest: {
      best: 'hw',
      testSize: 72,
      methods: [
        { method: 'hw', rmse: 0.43348174547161256 },
        { method: 'snaive', rmse: 0.8964149662219315 },
        { method: 'linear', rmse: 1.2778367440031397 },
        { method: 'mean', rmse: 1.3246734609346704 },
        { method: 'drift', rmse: 2.140314290060794 },
        { method: 'naive', rmse: 2.1644326206755538 },
        { method: 'holt', rmse: 15.820305624070079 },
      ],
    },
    forecast: {
      method: 'hw',
      horizon: 48,
      firstPoint: 3.298825392957138,
      firstLower: 2.890231087021979,
      firstUpper: 3.7074196988922967,
    },
  },
  river: {
    dataHash: 'to-be-computed',
    backtest: {
      best: 'expected-hw-or-snaive',
      testSize: 30,
    },
    forecast: {
      method: 'expected-auto-winner',
      horizon: 14,
    },
  },
  temp: {
    dataHash: 'to-be-computed',
    backtest: {
      best: 'expected-hw',
      testSize: 21,
    },
    forecast: {
      method: 'expected-auto-winner',
      horizon: 14,
    },
  },
};

function runForecastlab(args) {
  const cmd = `node "${resolve(PROJECT_ROOT, 'src', 'cli.js')}" ${args.join(' ')}`;
  try {
    return execSync(cmd, { cwd: EXAMPLES_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    // Some commands may exit non-zero but still produce output
    if (e.stdout) return e.stdout;
    throw e;
  }
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// Tolerance for floating-point comparison
const TOLERANCE = 1e-10;

function assertAlmostEqual(actual, expected, name) {
  const diff = Math.abs(actual - expected);
  if (diff > TOLERANCE) {
    throw new Error(`\`${name}\`: expected ${expected}, got ${actual} (diff ${diff})`);
  }
}

async function initGoldenFiles() {
  // Initialize golden files for river and temp which are "to-be-computed"
  console.log('Initializing golden files...');
  
  // Process river
  runForecastlab(['report', '--project', 'river.forecast.json', '--json', 'golden-river.json']);
  const riverReport = loadJson(resolve(EXAMPLES_DIR, 'golden-river.json'));
  GOLDEN.river.dataHash = riverReport.dataset.hash;
  GOLDEN.river.backtest.best = riverReport.backtest.best;
  GOLDEN.river.forecast.method = riverReport.forecast.method;
  saveJson(resolve(TEST_OUTPUT, 'golden-river.json'), riverReport);
  
  // Process temp
  runForecastlab(['report', '--project', 'temp.forecast.json', '--json', 'golden-temp.json']);
  const tempReport = loadJson(resolve(EXAMPLES_DIR, 'golden-temp.json'));
  GOLDEN.temp.dataHash = tempReport.dataset.hash;
  GOLDEN.temp.backtest.best = tempReport.backtest.best;
  GOLDEN.temp.forecast.method = tempReport.forecast.method;
  saveJson(resolve(TEST_OUTPUT, 'golden-temp.json'), tempReport);
  
  console.log('Golden files initialized!');
  console.log('GOLDEN values:', JSON.stringify(GOLDEN, null, 2));
}

// Main test suite
test('energy example: data hash matches', () => {
  const report = loadJson(resolve(EXAMPLES_DIR, 'energy-report.json'));
  assertStrictEqual(report.dataset.hash, GOLDEN.energy.dataHash);
});

test('energy example: backtest produces expected winner', () => {
  const report = loadJson(resolve(EXAMPLES_DIR, 'energy-report.json'));
  assertStrictEqual(report.backtest.best, GOLDEN.energy.backtest.best);
  assertStrictEqual(report.backtest.testSize, GOLDEN.energy.backtest.testSize);
});

test('energy example: backtest metrics match golden values', () => {
  const report = loadJson(resolve(EXAMPLES_DIR, 'energy-report.json'));
  for (let i = 0; i < GOLDEN.energy.backtest.methods.length; i++) {
    const expected = GOLDEN.energy.backtest.methods[i];
    const actual = report.backtest.results[i];
    assertStrictEqual(actual.method, expected.method);
    assertAlmostEqual(actual.rmse, expected.rmse, `backtest.${expected.method}.rmse`);
  }
});

test('energy example: forecast matches golden values', () => {
  const report = loadJson(resolve(EXAMPLES_DIR, 'energy-report.json'));
  const f = report.forecast;
  assertStrictEqual(f.method, GOLDEN.energy.forecast.method);
  assertStrictEqual(f.horizon, GOLDEN.energy.forecast.horizon);
  
  const firstStep = f.steps[0];
  assertAlmostEqual(firstStep.point, GOLDEN.energy.forecast.firstPoint, 'forecast.step[0].point');
  assertAlmostEqual(firstStep.lower, GOLDEN.energy.forecast.firstLower, 'forecast.step[0].lower');
  assertAlmostEqual(firstStep.upper, GOLDEN.energy.forecast.firstUpper, 'forecast.step[0].upper');
});

test('reproduce command validates energy report', () => {
  const output = runForecastlab(['reproduce', '--report', 'energy-report.json']);
  assert(output.includes('Data integrity verified'));
  assert(output.includes('Backtest reproducible'));
  assert(output.includes('Metrics match original report'));
  assert(output.includes('Forecast matches original report'));
  assert(output.includes('Reproducibility validation passed'));
});

test('diff command compares reports', () => {
  // First create a copy and modify it slightly
  const oldReport = loadJson(resolve(EXAMPLES_DIR, 'energy-report.json'));
  const newReport = JSON.parse(JSON.stringify(oldReport));
  
  // Modify one metric slightly
  if (newReport.backtest && newReport.backtest.results[0]) {
    newReport.backtest.results[0].rmse = newReport.backtest.results[0].rmse * 1.01;
  }
  
  saveJson(resolve(TEST_OUTPUT, 'compare-old.json'), oldReport);
  saveJson(resolve(TEST_OUTPUT, 'compare-new.json'), newReport);
  
  const output = runForecastlab([
    'diff',
    '--old', 'test-output/compare-old.json',
    '--new', 'test-output/compare-new.json'
  ]);
  
  assert(output.includes('Report Comparison'));
  assert(output.includes('⚠')); // Should show warning about changed metric
});

// Helper assertions
function assertStrictEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assert(condition, msg = 'Assertion failed') {
  if (!condition) {
    throw new Error(msg);
  }
}
