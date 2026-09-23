import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataQualityEngine, checkDataQuality } from '../../../src/data-quality/data-engine.js';

const DAY = 24 * 60 * 60 * 1000;

function makeSeries(n, fn, startDate = '2026-01-01') {
  const start = new Date(startDate).getTime();
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * DAY).toISOString().slice(0, 10),
    value: fn(i)
  }));
}

describe('DataQualityEngine.analyze', () => {
  it('produces a complete quality report on clean seasonal data', async () => {
    const data = makeSeries(90, i => 100 + 10 * Math.sin((2 * Math.PI * i) / 7));
    const engine = new DataQualityEngine();
    const report = await engine.analyze(data);

    assert.ok(report.summary);
    assert.ok(report.provenanceId.startsWith('pq-'));
    assert.equal(typeof report.summary.overallHealth, 'string');
    assert.equal(report.missingData.totalMissing, 0);
    assert.equal(report.missingData.coveragePercent, '100.00');
    assert.ok(Array.isArray(report.recommendations));
    assert.deepEqual(Object.keys(report),
      ['summary', 'anomalies', 'missingData', 'trendAnalysis',
       'seasonalityAnalysis', 'errorPatterns', 'outlierAnalysis',
       'stationarityTest', 'recommendations', 'provenanceId']);
  });

  it('detects gaps and reports coverage for missing values', async () => {
    const data = makeSeries(60, i => 50 + i);
    data[10].value = null;
    data[11].value = null;
    data[12].value = null;
    data[40].value = null;

    const engine = new DataQualityEngine();
    const missing = engine.checkMissingValues(data);

    assert.equal(missing.totalMissing, 4);
    assert.equal(missing.gapCount, 2);
    assert.ok(missing.gaps.find(g => g.type === 'complete_time_gap' && g.duration === 3));
    assert.ok(missing.gaps.find(g => g.type === 'scattered_hole' && g.duration === 1));
    assert.equal(missing.coveragePercent, '93.33');
  });

  it('flags extreme outliers via z-score', () => {
    const engine = new DataQualityEngine();
    const data = makeSeries(100, i => 100 + (i % 7));
    data[50].value = 10000;

    const anomalies = engine.detectViaZScore(data);
    assert.ok(anomalies.some(a => a.index === 50));
    assert.ok(anomalies.every(a => a.zScore > 2.5));
  });

  it('detects a structural level shift as a trend break', () => {
    const engine = new DataQualityEngine();
    const data = makeSeries(120, i => (i < 60 ? 10 : 60) + 2 * Math.sin(i));

    const shifts = engine.detectTrendShifts(data);
    assert.ok(shifts.hasMajorShift);
    assert.ok(shifts.significantShifts.length > 0);
    assert.ok(shifts.significantShifts.some(s => Math.abs(s.magnitude) > 40));
  });

  it('treats short series as insufficient for seasonality breaks', () => {
    const engine = new DataQualityEngine();
    const result = engine.detectSeasonalityBreaks(makeSeries(10, i => i));
    assert.equal(result.seasonalStability, 'insufficient_data');
  });

  it('flags potential unit mismatches from extreme ratios', () => {
    const engine = new DataQualityEngine();
    const data = makeSeries(50, i => 100 + i);
    data[25].value = 5000;

    const errors = engine.identifyHumanErrors(data);
    assert.ok(errors.errors.some(e => e.type === 'potential_unit_mismatch'));
  });

  it('logs provenance entries for analysis start and completion', async () => {
    const engine = new DataQualityEngine();
    await engine.analyze(makeSeries(40, i => 10 + i));
    const log = engine.getProvenanceLog();

    assert.equal(log.length, 2);
    assert.equal(log[0].action, 'analysis_started');
    assert.equal(log[1].action, 'analysis_completed');
    assert.equal(log[0].dataPoints, 40);
  });
});

describe('DataQualityEngine.imputeMissing', () => {
  it('fills a single hole with the neighbor average (linear)', () => {
    const engine = new DataQualityEngine();
    const data = makeSeries(20, i => i);
    data[10].value = null;

    const result = engine.imputeMissing(data, 'linear');
    assert.equal(result.data[10].value, 10); // (9 + 11) / 2
    assert.equal(result.history.length, 1);
    assert.equal(result.metadata.method, 'linear');
    // Original data untouched
    assert.equal(data[10].value, null);
  });

  it('fills using seasonal means when period is given', () => {
    const engine = new DataQualityEngine();
    const data = makeSeries(28, i => 100 + (i % 7) * 5);
    data[7].value = null; // same slot as index 0, 14, 21

    const result = engine.imputeMissing(data, 'seasonal', { period: 7 });
    // Slot picked by calendar weekday: same weekday as indices 0, 14, 21 → 100 + 4*5
    assert.equal(result.data[7].value, 120);
    assert.equal(result.history[0].method, 'seasonal');
  });

  it('fills with a local window average (neighbor_avg)', () => {
    const engine = new DataQualityEngine();
    const data = makeSeries(20, i => 10);
    data[10].value = null;

    const result = engine.imputeMissing(data, 'neighbor_avg', { window: 2 });
    assert.equal(result.data[10].value, 10);
    assert.equal(result.history[0].neighbors, 4);
  });

  it('fills with the recent mean (model_based)', () => {
    const engine = new DataQualityEngine();
    const data = makeSeries(30, i => 5);
    data[3].value = null;

    const result = engine.imputeMissing(data, 'model_based');
    assert.equal(result.data[3].value, 5);
  });

  it('throws on an unknown method', () => {
    const engine = new DataQualityEngine();
    assert.throws(() => engine.imputeMissing([], 'nonexistent'),
      /Unknown imputation method/);
  });
});

describe('checkDataQuality helper', () => {
  it('returns the same report shape as the engine', async () => {
    const report = await checkDataQuality(makeSeries(30, i => i));
    assert.ok(report.summary.overallHealth);
    assert.ok(report.provenanceId);
  });
});

describe('DataQualityEngine.exportQualityReport', () => {
  it('serializes to JSON after analysis and errors before', async () => {
    const engine = new DataQualityEngine();
    assert.deepEqual(engine.exportQualityReport(), { error: 'No analysis performed yet' });

    await engine.analyze(makeSeries(20, i => i));
    const parsed = JSON.parse(engine.exportQualityReport('json'));
    assert.equal(parsed.version, '1.0');
    assert.ok(parsed.summary);
  });
});
