// Generates the built-in example datasets. Deterministic (seeded PRNG) so
// every checkout produces byte-identical CSVs. Run: node scripts/make-examples.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
mkdirSync(root, { recursive: true });

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function toCsv(rows) {
  return 'timestamp,value\n' + rows.map(([t, v]) => `${t},${v}`).join('\n') + '\n';
}

function writeProject(filename, project) {
  writeFileSync(join(root, filename), JSON.stringify(project, null, 2) + '\n', 'utf8');
}

// --- 1. Hourly building electricity use: daily cycle + weekend dip + noise ---
{
  const rng = mulberry32(20260101);
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const rows = [];
  for (let i = 0; i < 21 * 24; i++) {
    const d = new Date(start + i * 3600 * 1000);
    const h = d.getUTCHours();
    const day = d.getUTCDay();
    const daily = 1.7 * Math.sin((2 * Math.PI * (h - 9)) / 24) + 0.35 * Math.sin((4 * Math.PI * (h - 1)) / 24);
    const weekend = day === 0 || day === 6 ? -0.7 : 0;
    const v = Math.max(0.5, 4.2 + daily + weekend + 0.0008 * i + 0.25 * gauss(rng));
    rows.push([d.toISOString(), v.toFixed(3)]);
  }
  writeFileSync(join(root, 'energy-hourly.csv'), toCsv(rows), 'utf8');
  writeProject('energy.forecast.json', {
    name: 'Building electricity use',
    description: 'Synthetic hourly meter data: daily cycle, weekend dip, slow growth. Season = 24 hours.',
    data: 'energy-hourly.csv',
    timeColumn: 'timestamp',
    valueColumn: 'value',
    unit: 'kWh',
    seasonLength: 24,
    horizon: 48,
    interval: 80,
    testSize: 72,
  });
}

// --- 2. Daily river level: slow wave + rain events + one sensor glitch ---
{
  const rng = mulberry32(606060);
  const start = Date.UTC(2026, 3, 1, 0, 0, 0);
  // Rain arrives as smooth multi-day humps (rivers respond over days);
  // only the single-point sensor glitch should trip outlier detection.
  const rainEvents = [[24, 0.9], [88, 1.2], [141, 1.0]];
  const rainAt = (i) => rainEvents.reduce((s, [c, a]) => {
    const d = (i - c) / 2.0;
    return s + a * Math.exp(-(d * d) / 2);
  }, 0);
  const rows = [];
  for (let i = 0; i < 180; i++) {
    const d = new Date(start + i * 86400 * 1000);
    let v = 2.4 + 0.5 * Math.sin((2 * Math.PI * i) / 60) + rainAt(i) + 0.06 * gauss(rng);
    if (i === 100) v = 8.7; // sensor glitch: `check` should flag this outlier
    rows.push([d.toISOString(), v.toFixed(3)]);
  }
  writeFileSync(join(root, 'river-daily.csv'), toCsv(rows), 'utf8');
  writeProject('river.forecast.json', {
    name: 'River level',
    description: 'Synthetic daily gauge data: slow wave, three rain surges, and a sensor glitch on day 100. `check` flags the surges and the glitch as candidates — see docs/workflow.md on telling events apart from errors.',
    data: 'river-daily.csv',
    timeColumn: 'timestamp',
    valueColumn: 'value',
    unit: 'm',
    seasonLength: 30,
    horizon: 14,
    interval: 80,
    testSize: 30,
  });
}

// --- 3. Daily mean temperature: warming trend + weekly oscillation + noise ---
{
  const rng = mulberry32(70707);
  const start = Date.UTC(2026, 5, 1, 0, 0, 0);
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const d = new Date(start + i * 86400 * 1000);
    const v = 11 + 0.04 * i + 2.0 * Math.sin((2 * Math.PI * i) / 7 + 0.8) + 0.5 * gauss(rng);
    rows.push([d.toISOString(), v.toFixed(2)]);
  }
  writeFileSync(join(root, 'temp-daily.csv'), toCsv(rows), 'utf8');
  writeProject('temp.forecast.json', {
    name: 'Daily mean temperature',
    description: 'Synthetic daily temperature: warming trend plus a weekly oscillation.',
    data: 'temp-daily.csv',
    timeColumn: 'timestamp',
    valueColumn: 'value',
    unit: 'C',
    seasonLength: 7,
    horizon: 14,
    interval: 80,
    testSize: 21,
  });
}

console.log('Wrote examples to', root);
