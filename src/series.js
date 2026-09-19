// Time-series loading and validation. Works offline on local CSV files.
// A "series" is an ordered list of { t, iso, value } points plus quality notes.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const TIME_CANDIDATES = ['timestamp', 'time', 'date', 'datetime', 'dt'];
export const VALUE_CANDIDATES = [
  'value', 'observation', 'obs', 'y', 'reading', 'level',
  'demand', 'temp', 'temperature', 'flow', 'usage', 'count',
];

/** SHA-256 hex of a string. Used to fingerprint input data for reproducibility. */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Split one CSV line, honouring double-quoted fields and escaped quotes. */
export function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

function findColumn(headers, explicit, candidates, kind) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  if (explicit) {
    const idx = lower.indexOf(String(explicit).trim().toLowerCase());
    if (idx === -1) {
      throw new Error(`Column "${explicit}" not found. Available columns: ${headers.join(', ')}`);
    }
    return idx;
  }
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return idx;
  }
  if (headers.length === 2) return kind === 'time' ? 0 : 1;
  throw new Error(
    `Could not detect the ${kind} column. Use --${kind} <name>. Available columns: ${headers.join(', ')}`,
  );
}

function parseTime(raw, lineNo) {
  const s = String(raw).trim();
  if (s === '') throw new Error(`Line ${lineNo}: empty timestamp`);
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`Line ${lineNo}: bad epoch timestamp "${raw}"`);
    return s.length >= 13 ? n : n * 1000; // milliseconds vs seconds
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Line ${lineNo}: unparseable timestamp "${raw}"`);
  return ms;
}

/**
 * Parse CSV text into time-ordered points.
 * Empty value cells are skipped and counted (messy real-world data);
 * malformed timestamps/numbers throw with a line number.
 */
export function parseCsv(text, options = {}) {
  const rawLines = String(text).split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].trim() !== '') { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('Empty CSV: no header row found');
  const headers = splitCsvLine(rawLines[headerIdx]).map((h) => h.trim());
  if (headers.length < 2) throw new Error('CSV needs at least two columns (time + value)');
  const ti = findColumn(headers, options.timeColumn, TIME_CANDIDATES, 'time');
  const vi = findColumn(headers, options.valueColumn, VALUE_CANDIDATES, 'value');

  const points = [];
  const skipped = [];
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.trim() === '') continue;
    const lineNo = i + 1;
    const fields = splitCsvLine(line);
    if (fields.length !== headers.length) {
      throw new Error(`Line ${lineNo}: expected ${headers.length} fields, got ${fields.length}`);
    }
    const t = parseTime(fields[ti], lineNo);
    const rawValue = fields[vi].trim();
    if (rawValue === '') { skipped.push({ line: lineNo, reason: 'missing value' }); continue; }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new Error(`Line ${lineNo}: value "${fields[vi]}" is not a number`);
    points.push({ t, iso: new Date(t).toISOString(), value, line: lineNo });
  }
  if (points.length === 0) throw new Error('No usable rows: every data row was empty');
  points.sort((a, b) => a.t - b.t || a.line - b.line);
  return {
    timeColumn: headers[ti],
    valueColumn: headers[vi],
    points,
    skipped,
    dataRows: rawLines.length - headerIdx - 1,
  };
}

export function loadCsvFile(path) {
  const text = readFileSync(path, 'utf8');
  return { text, hash: sha256Hex(text) };
}

export function median(sorted) {
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function modeOf(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return { value: best, count: bestCount };
}

/**
 * Describe data quality: duplicates, gaps vs the dominant step, and
 * rolling-window outliers (Hampel-style: median + scaled MAD of neighbours).
 */
export function validateSeries(points, skipped = [], options = {}) {
  const issues = [];
  const values = points.map((p) => p.value);

  const seen = new Map();
  const duplicates = [];
  for (const p of points) {
    if (seen.has(p.t)) duplicates.push({ time: p.iso, line: p.line });
    else seen.set(p.t, true);
  }
  for (const d of duplicates.slice(0, 20)) {
    issues.push({ type: 'duplicate', message: `Duplicate timestamp ${d.time} (line ${d.line}); later row kept in order, earlier row still counted.` });
  }

  let stepMs = null;
  let regular = true;
  const gaps = [];
  if (points.length >= 3) {
    const diffs = [];
    for (let i = 1; i < points.length; i++) diffs.push(points[i].t - points[i - 1].t);
    const positive = diffs.filter((d) => d > 0);
    if (positive.length > 0) {
      const { value, count } = modeOf(positive);
      stepMs = value;
      regular = count / diffs.length >= 0.8;
      if (regular) {
        for (let i = 1; i < points.length; i++) {
          const d = points[i].t - points[i - 1].t;
          if (d > stepMs * 1.5) {
            const missing = Math.round(d / stepMs) - 1;
            if (missing > 0) {
              gaps.push({ from: points[i - 1].iso, to: points[i].iso, missingSteps: missing });
            }
          }
        }
      }
    }
  }
  for (const g of gaps.slice(0, 20)) {
    issues.push({ type: 'gap', message: `Gap of ~${g.missingSteps} missing step(s) between ${g.from} and ${g.to}.` });
  }

  const outliers = [];
  const n = values.length;
  if (n >= 9) {
    // Trend-aware Hampel test: compare each point to the interpolation between
    // the medians of its left and right neighbours (a plain median would flag
    // every point of a steady trend). Spread comes from pooled neighbour
    // deviations, scaled to approximate a standard deviation.
    const k = Math.max(3, Math.min(12, Math.floor(n / 10)));
    const med = (arr) => median([...arr].sort((a, b) => a - b));
    for (let i = 0; i < n; i++) {
      const left = values.slice(Math.max(0, i - k), i);
      const right = values.slice(i + 1, Math.min(n, i + 1 + k));
      if (left.length === 0 || right.length === 0) continue; // edges: no both-sided context
      const leftMed = med(left);
      const rightMed = med(right);
      const expected = (leftMed + rightMed) / 2;
      const devs = [
        ...left.map((v) => Math.abs(v - leftMed)),
        ...right.map((v) => Math.abs(v - rightMed)),
      ];
      const floor = 1e-9 * Math.max(1, Math.abs(expected));
      const scale = Math.max(1.4826 * med(devs), floor);
      if (Math.abs(values[i] - expected) > 5 * scale && outliers.length < 50) {
        outliers.push({ index: i, time: points[i].iso, value: values[i] });
      }
    }
  }
  for (const o of outliers.slice(0, 20)) {
    issues.push({ type: 'outlier', message: `Possible outlier at ${o.time}: ${o.value} differs sharply from its neighbours.` });
  }

  for (const s of skipped.slice(0, 20)) {
    issues.push({ type: 'missing', message: `Line ${s.line} skipped: ${s.reason}.` });
  }

  const seasonLength = options.seasonLength;
  if (seasonLength && points.length < seasonLength * 2) {
    issues.push({
      type: 'season',
      message: `Only ${points.length} points for a season length of ${seasonLength}; seasonal methods need at least two full cycles.`,
    });
  }
  if (!regular && seasonLength) {
    issues.push({
      type: 'season',
      message: 'Timestamps are irregular, so seasonal methods treat observations as evenly spaced steps. Resample to a fixed grid with --resample for strict seasonality.',
    });
  }

  return { count: n, stepMs, regular, duplicates, gaps, outliers, issues };
}

export function summarizeSeries(points, validation) {
  return {
    count: points.length,
    start: points[0]?.iso ?? null,
    end: points[points.length - 1]?.iso ?? null,
    stepMs: validation.stepMs,
    regular: validation.regular,
    issueCount: validation.issues.length,
  };
}

const AGGREGATORS = {
  mean: (vs) => vs.reduce((s, v) => s + v, 0) / vs.length,
  sum: (vs) => vs.reduce((s, v) => s + v, 0),
  first: (vs) => vs[0],
  last: (vs) => vs[vs.length - 1],
  min: (vs) => vs.reduce((m, v) => (v < m ? v : m), Infinity),
  max: (vs) => vs.reduce((m, v) => (v > m ? v : m), -Infinity),
};

/** Most common positive spacing between observations, or null if there is none. */
export function dominantStep(points) {
  const diffs = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i].t - points[i - 1].t;
    if (d > 0) diffs.push(d);
  }
  return diffs.length === 0 ? null : modeOf(diffs).value;
}

/**
 * Project observations onto a strictly regular grid of `stepMs` milliseconds,
 * aggregating every value that falls in a bin (mean by default). The detected
 * dominant spacing is used when no step is given. Bins with no observation are
 * dropped and reappear as gaps in validation: resampling never invents data.
 */
export function resamplePoints(points, options = {}) {
  const { stepMs = null, agg = 'mean' } = options;
  if (!Array.isArray(points) || points.length < 2) throw new Error('Resampling needs at least two observations');
  const aggregate = AGGREGATORS[agg];
  if (!aggregate) throw new Error(`Unknown aggregation "${agg}". Choose: ${Object.keys(AGGREGATORS).join(', ')}`);
  const step = stepMs ?? dominantStep(points);
  if (!Number.isInteger(step) || step < 1) {
    throw new Error('Resampling needs a positive grid step in milliseconds; pass --step <ms>');
  }
  const t0 = points[0].t;
  const bins = new Map();
  for (const p of points) {
    const k = Math.floor((p.t - t0) / step);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(p.value);
  }
  const out = Array.from(bins, ([k, vs]) => {
    const t = t0 + k * step;
    return { t, iso: new Date(t).toISOString(), value: aggregate(vs), line: null };
  });
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Split ordered values into { train, test } with the last `testSize` points held out. */
export function splitTrainTest(values, testSize) {
  if (!Number.isInteger(testSize) || testSize < 1) throw new Error('--test-size must be a positive integer');
  if (testSize >= values.length) {
    throw new Error(`--test-size ${testSize} leaves no training data (${values.length} points total)`);
  }
  return { train: values.slice(0, values.length - testSize), test: values.slice(values.length - testSize) };
}
