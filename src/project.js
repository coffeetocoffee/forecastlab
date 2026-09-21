// Reproducible project files: a small JSON sidecar that records exactly
// which data, columns, and settings produced a forecast.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { parseCsv, loadCsvFile, validateSeries, resamplePoints, dominantStep } from './series.js';

/** Compare semantic versions: returns -1 (older), 0 (equal), or 1 (newer) */
export function compareVersions(a, b) {
  const partsA = String(a).split('.').map((x) => parseInt(x, 10));
  const partsB = String(b).split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const aa = partsA[i] ?? 0;
    const bb = partsB[i] ?? 0;
    if (aa < bb) return -1;
    if (aa > bb) return 1;
  }
  return 0;
}

/** Check if current version satisfies requirement. Supports exact match and ^ ranges. */
export function versionSatisfies(current, required) {
  if (!required || required === '*') return true;
  if (required.startsWith('^')) {
    const base = required.slice(1);
    const parts = base.split('.').map((x) => parseInt(x, 10));
    if (parts.length < 2) return true;
    // ^X.Y requires X.y where y >= Y
    const curParts = current.split('.').map((x) => parseInt(x, 10));
    if (curParts[0] !== parts[0]) return false;
    if (curParts[1] < parts[1]) return false;
    return true;
  }
  return current === required;
}

export function defaultProject(name, dataRel) {
  return {
    name,
    description: '',
    data: dataRel,
    timeColumn: null,
    valueColumn: null,
    unit: null,
    seasonLength: null,
    horizon: 24,
    interval: 80,
    testSize: null,
    resample: false,
    agg: 'mean',
    step: null,
    damped: false,
    seasonality: 'additive',
    // Phase 1: Exogenous features configuration
    features: null,
    // Default forecasting method (auto or specific method ID)
    method: 'auto',
    createdWith: 'forecastlab init',
    requiresVersion: '0.1.0', // Tier-3: Version pinning for reproducibility
  };
}

export function readProjectFile(path, currentVersion = '0.1.0') {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read project file "${path}": ${e.message}`);
  }
  let proj;
  try {
    proj = JSON.parse(raw);
  } catch {
    throw new Error(`Project file "${path}" is not valid JSON`);
  }
  if (!proj || typeof proj !== 'object' || !proj.data) {
    throw new Error(`Project file "${path}" must be a JSON object with at least a "data" field`);
  }
  // Tier-3: Version pinning check
  if (proj.requiresVersion && !versionSatisfies(currentVersion, proj.requiresVersion)) {
    throw new Error(
      `Project requires version ${proj.requiresVersion}, but this is ${currentVersion}. ` +
      `Please upgrade forecastlab or update the project file.`
    );
  }
  return proj;
}

export function writeProjectFile(path, project) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(project, null, 2) + '\n', 'utf8');
}

function toIntOrNull(v, flag) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a non-negative integer, got "${v}"`);
  return n;
}

/**
 * Merge CLI options over an optional project file, load and validate the CSV.
 * Resampling, when requested, happens after parsing and before validation, so
 * every downstream view sees the fixed grid.
 * Returns { config, dataPath, dataHash, parsed, values, validation, resampled }.
 */
export function resolveInput(opts = {}, currentVersion = '0.1.0') {
  const cwd = process.cwd();
  let proj = {};
  let baseDir = cwd;
  if (opts.project) {
    let projectPath = resolve(cwd, opts.project);
    // Allow pointing at a directory that holds the project file (e.g. "check .")
    if (existsSync(projectPath) && statSync(projectPath).isDirectory()) {
      const found = readdirSync(projectPath).filter((f) => f.endsWith('.forecast.json')).sort();
      if (found.length === 1) {
        projectPath = join(projectPath, found[0]);
      } else {
        throw new Error(
          `Directory "${opts.project}" must contain exactly one *.forecast.json file, found ${found.length}.`,
        );
      }
    }
    proj = readProjectFile(projectPath, currentVersion);
    baseDir = dirname(projectPath);
  } else if (!opts.data) {
    // No explicit input given: use the working directory's project file if there is exactly one.
    const found = readdirSync(cwd).filter((f) => f.endsWith('.forecast.json')).sort();
    if (found.length === 1) {
      proj = readProjectFile(resolve(cwd, found[0]), currentVersion);
      baseDir = cwd;
    }
  }
  const dataRel = opts.data ?? proj.data;
  if (!dataRel) throw new Error('No input data. Use --data <file.csv> or --project <file.json>');

  const dataPath = resolve(baseDir, dataRel);
  let text;
  let hash;
  try {
    ({ text, hash } = loadCsvFile(dataPath));
  } catch (e) {
    throw new Error(`Cannot read data file "${dataRel}": ${e.message}`);
  }
  const parsed = parseCsv(text, {
    timeColumn: opts.time ?? proj.timeColumn ?? undefined,
    valueColumn: opts.value ?? proj.valueColumn ?? undefined,
  });

  const seasonLength = toIntOrNull(opts.season ?? proj.seasonLength, '--season');
  const horizon = toIntOrNull(opts.horizon ?? proj.horizon, '--horizon') ?? 24;
  const interval = toIntOrNull(opts.interval ?? proj.interval, '--interval') ?? 80;
  const testSize = toIntOrNull(opts.testSize ?? proj.testSize, '--test-size');
  const step = toIntOrNull(opts.step ?? proj.step, '--step');
  const agg = opts.agg ?? proj.agg ?? 'mean';
  const resample = opts.resample === true || proj.resample === true;
  const damped = opts.damped === true || proj.damped === true;
  const seasonality = opts.seasonality ?? proj.seasonality ?? 'additive';
  if (!['additive', 'multiplicative'].includes(seasonality)) {
    throw new Error('--seasonality must be additive or multiplicative');
  }
  const methods = opts.methods
    ? String(opts.methods).split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const features = opts.features ?? proj.features ?? null;
  const method = opts.method ?? proj.method ?? 'auto';

  const config = {
    name: opts.name ?? proj.name ?? basename(dataPath),
    description: proj.description ?? '',
    data: dataRel,
    timeColumn: parsed.timeColumn,
    valueColumn: parsed.valueColumn,
    unit: opts.unit ?? proj.unit ?? null,
    seasonLength,
    horizon,
    interval,
    testSize,
    resample,
    agg,
    step,
    damped,
    seasonality,
    methods,
    features,
    method,
  };
  if (horizon < 1) throw new Error('--horizon must be a positive integer');
  if (![80, 90, 95].includes(interval)) throw new Error('--interval must be one of 80, 90, 95');

  let resampled = null;
  if (resample) {
    const detectedStep = dominantStep(parsed.points);
    parsed.points = resamplePoints(parsed.points, { stepMs: step, agg });
    resampled = { stepMs: step ?? detectedStep, agg, count: parsed.points.length };
  }

  const validation = validateSeries(parsed.points, parsed.skipped, { seasonLength });
  const values = parsed.points.map((p) => p.value);
  return { config, dataPath, dataHash: hash, parsed, values, validation, resampled };
}
