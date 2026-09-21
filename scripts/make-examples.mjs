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

function toWideCsv(header, rows) {
  return header.join(',') + '\n' + rows.map((r) => r.join(',')).join('\n') + '\n';
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

// --- 4. Hourly energy market: temperature and price drive demand (causal demo) ---
// A wide CSV for "causal graph" / "causal what-if": demand responds to a
// temperature anomaly at lags 0-2 and to the previous hour's slow price
// movement, on top of a daily cycle. A three-day heat wave mid-month provides
// a natural experiment. Pass --season 24 to the causal commands so the shared
// daily cycle is removed and the true effect sizes surface.
{
  const rng = mulberry32(424242);
  const start = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01
  const hours = 28 * 24;
  const dayOf = (i) => Math.floor(i / 24);
  const heat = (i) => {
    const d = dayOf(i);
    return d >= 11 && d <= 13 ? 7 * Math.exp(-Math.pow((d - 12) / 0.9, 2)) : 0;
  };
  // Slow weather wave and slow price movement: these survive deseasonalizing
  // the daily cycle, so they are what the causal tests can actually see.
  const tempAnom = new Array(hours);
  const priceSlow = new Array(hours);
  for (let i = 0; i < hours; i++) {
    tempAnom[i] = 4 * Math.sin((2 * Math.PI * dayOf(i)) / 11 + 0.3) + heat(i) + 0.7 * gauss(rng);
    priceSlow[i] = 0.02 * Math.sin((2 * Math.PI * dayOf(i)) / 9 + 1.7) + 0.006 * gauss(rng);
  }
  const rows = [];
  for (let i = 0; i < hours; i++) {
    const d = new Date(start + i * 3600 * 1000);
    const h = d.getUTCHours();
    const weekday = d.getUTCDay();
    const daily = 140 * Math.sin((2 * Math.PI * (h - 13)) / 24) + 28 * Math.sin((4 * Math.PI * (h - 6)) / 24);
    const weekend = weekday === 0 || weekday === 6 ? -45 : 0;
    const cooling =
      4.5 * tempAnom[i] +
      2.2 * (tempAnom[i - 1] ?? 0) +
      0.8 * (tempAnom[i - 2] ?? 0);
    const priceResponse = -1500 * (priceSlow[i - 1] ?? 0);
    const temperature = 19 + 7 * Math.sin((2 * Math.PI * (h - 15)) / 24) + tempAnom[i];
    const price = 0.12 + 0.03 * Math.sin((2 * Math.PI * (h - 18)) / 24) + priceSlow[i];
    const demand = Math.max(50, 520 + daily + weekend + cooling + priceResponse + 12 * gauss(rng));
    rows.push([d.toISOString(), temperature.toFixed(2), price.toFixed(4), demand.toFixed(1)]);
  }
  writeFileSync(join(root, 'causal-energy.csv'), toWideCsv(['timestamp', 'temperature', 'price', 'demand'], rows), 'utf8');

  // Known external events over the same window, for "causal factors".
  writeFileSync(join(root, 'causal-factors.json'), JSON.stringify({
    events: [
      { name: 'heatwave', start: '2026-07-12', duration: 24 * 3, decay: 'exponential' },
      { name: 'price-spike', start: '2026-07-18T18:00:00', duration: 6, decay: 'triangular' },
      { name: 'stadium-event', start: '2026-07-25', duration: 24 * 2, decay: 'box' },
    ],
  }, null, 2) + '\n', 'utf8');
}

// --- 5. Daily product sales with a two-week promotion (counterfactual demo) ---
// A single intervention on 2026-04-01 so "causal counterfactual" can measure
// the lift against control windows taken from the rest of the same series.
{
  const rng = mulberry32(515151);
  const start = Date.UTC(2026, 2, 1, 0, 0, 0); // 2026-03-01
  const days = 26 * 7; // half a year
  const promoStart = 31; // 2026-04-01
  const promoLen = 14;
  const rows = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86400 * 1000);
    const weekday = d.getUTCDay();
    const weekly = weekday === 0 || weekday === 6 ? -12 : (weekday === 5 ? 8 : 0);
    let promo = 0;
    if (i >= promoStart && i < promoStart + promoLen) {
      promo = 34 * Math.min(1, (i - promoStart + 1) / 2) * Math.min(1, (promoStart + promoLen - i) / 2);
    }
    const v = 120 + weekly + promo + 0.35 * i + 6 * gauss(rng);
    rows.push([d.toISOString(), v.toFixed(2)]);
  }
  writeFileSync(join(root, 'causal-sales.csv'), toCsv(rows), 'utf8');
}

console.log('Wrote causal examples to', root);
