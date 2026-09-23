import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MultiSeriesCorrelator } from '../../../src/data-quality/correlation/multi-series-correlator.js';

const DAY = 24 * 60 * 60 * 1000;

function makeSeries(n, fn, startDate = '2026-01-01') {
  const start = new Date(startDate).getTime();
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * DAY).toISOString().slice(0, 10),
    value: fn(i)
  }));
}

describe('MultiSeriesCorrelator.analyze', () => {
  it('analyzes correlated series without crashing and reports structure', async () => {
    const correlator = new MultiSeriesCorrelator();
    const result = await correlator.analyze([
      { name: 'temp', data: makeSeries(60, i => 20 + 5 * Math.sin((2 * Math.PI * i) / 7)) },
      { name: 'demand', data: makeSeries(60, i => 100 + 10 * Math.sin((2 * Math.PI * i) / 7)) }
    ], { maxLags: 3, minSignificance: 0.6 });

    assert.equal(result.seriesCount, 2);
    assert.equal(result.totalPairs, 1);
    assert.ok(Array.isArray(result.significantRelations));
    assert.ok(Array.isArray(result.causalityInsights));
    assert.ok(Array.isArray(result.clusters));
    assert.ok(result.summary);
  });

  it('identifies a strong positive lag-0 relationship', async () => {
    const correlator = new MultiSeriesCorrelator();
    const result = await correlator.analyze([
      { name: 'a', data: makeSeries(60, i => i % 10) },
      // Near-perfect linear map of a with a little wiggle (r === 1 is treated as self-correlation and skipped)
      { name: 'b', data: makeSeries(60, i => 5 + 2 * (i % 10) + 0.1 * Math.sin(i * 3)) }
    ], { maxLags: 2, minSignificance: 0.9 });

    assert.ok(result.significantPairs >= 1,
      `expected at least one significant pair, got ${result.significantPairs}`);
    const rel = result.strongestPairs[0];
    assert.ok(Math.abs(parseFloat(rel.correlation)) > 0.9);
  });

  it('returns zero significant pairs for unrelated noisy series', async () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const correlator = new MultiSeriesCorrelator();
    const result = await correlator.analyze([
      { name: 'noise1', data: makeSeries(80, () => rand()) },
      { name: 'noise2', data: makeSeries(80, () => rand()) }
    ], { maxLags: 3, minSignificance: 0.95 });

    assert.equal(result.significantPairs, 0);
  });

  it('categorizes correlation strength', () => {
    const correlator = new MultiSeriesCorrelator();
    assert.equal(correlator.categorizeStrength(0.95), 'very_strong');
    assert.equal(correlator.categorizeStrength(0.5), 'moderate');
    assert.equal(correlator.categorizeStrength(0.05), 'very_weak');
  });
});
