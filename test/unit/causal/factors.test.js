import { test, suite } from 'node:test';
// Unit tests for external factor integration.

import { strict as assert } from 'node:assert';
import {
  ExternalFactorIntegrator,
  DECAY_KERNELS,
  holidayCalendar,
} from '../../../src/causal.js';

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function gauss(rnd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

suite('decay kernels', () => {
  test('box is 1 inside the window and 0 outside', () => {
    assert.strictEqual(DECAY_KERNELS.box(5, 5, 3), 1);
    assert.strictEqual(DECAY_KERNELS.box(4, 5, 3), 0);
    assert.strictEqual(DECAY_KERNELS.box(8, 5, 3), 0);
  });

  test('exponential decays from the start and is zero before it', () => {
    assert.strictEqual(DECAY_KERNELS.exponential(0, 10, 3), 0);
    assert.ok(DECAY_KERNELS.exponential(10, 10, 3) > 0.9);
    assert.ok(DECAY_KERNELS.exponential(13, 10, 3) < DECAY_KERNELS.exponential(11, 10, 3));
  });

  test('triangular peaks mid-event and vanishes at the edges', () => {
    const peak = DECAY_KERNELS.triangular(5, 0, 10);
    assert.ok(peak > 0.99, `peak ${peak}`);
    assert.strictEqual(DECAY_KERNELS.triangular(0, 0, 10), 0);
    assert.strictEqual(DECAY_KERNELS.triangular(10, 0, 10), 0);
    assert.ok(DECAY_KERNELS.triangular(7, 0, 10) > DECAY_KERNELS.triangular(9, 0, 10));
  });

  test('gaussian is centred and symmetric', () => {
    const k = (t) => DECAY_KERNELS.gaussian(t, 0, 10);
    assert.ok(k(5) > k(0) && k(5) > k(10));
    assert.ok(Math.abs(k(4) - k(6)) < 1e-9);
  });

  test('step rises to a permanent level shift', () => {
    assert.strictEqual(DECAY_KERNELS.step(0, 5, 3), 0);
    assert.ok(DECAY_KERNELS.step(100, 5, 3) > 0.99);
    assert.ok(DECAY_KERNELS.step(3, 5, 3) < DECAY_KERNELS.step(30, 5, 3));
  });
});

suite('ExternalFactorIntegrator', () => {
  test('measures a known event effect against a seasonal baseline', () => {
    const rnd = rng(4242);
    const n = 400;
    const times = [];
    const y = [];
    const start = Date.UTC(2026, 0, 1);
    for (let t = 0; t < n; t++) {
      times.push(start + t * 3600 * 1000);
      let v = 100 + 30 * Math.sin((2 * Math.PI * t) / 24);
      if (t >= 200 && t < 212) v += 25; // a box-shaped event
      y.push(v + 3 * gauss(rnd));
    }
    const integ = new ExternalFactorIntegrator(times);
    integ.addEventFactor('event', { start: 200, duration: 12, decay: 'box' });
    const fit = integ.fit(y, { seasonLength: 24 });
    const event = fit.factors.find((f) => f.name === 'event');
    assert.ok(event, 'event factor missing');
    assert.ok(event.significant, `p=${event.pValue}`);
    assert.ok(Math.abs(event.coefficient - 25) < 6, `coef ${event.coefficient}`);
    assert.ok(fit.r2 > 0.7, `r2 ${fit.r2}`);
  });

  test('ranks factors by impact magnitude', () => {
    const rnd = rng(11);
    const n = 400;
    const times = [];
    const y = [];
    const start = Date.UTC(2026, 0, 1);
    for (let t = 0; t < n; t++) {
      times.push(start + t * 3600 * 1000);
      let v = 100 + 20 * Math.sin((2 * Math.PI * t) / 24);
      if (t >= 100 && t < 110) v += 40;
      if (t >= 300 && t < 306) v += 5;
      y.push(v + 2 * gauss(rnd));
    }
    const integ = new ExternalFactorIntegrator(times);
    integ.addEventFactor('big', { start: 100, duration: 10, decay: 'box' });
    integ.addEventFactor('small', { start: 300, duration: 6, decay: 'box' });
    integ.fit(y, { seasonLength: 24 });
    const ranking = integ.rankFactors();
    assert.strictEqual(ranking[0].name, 'big');
    assert.strictEqual(ranking[1].name, 'small');
    assert.ok(ranking[0].impact > ranking[1].impact);
  });

  test('series factors are padded to the target length', () => {
    const integ = new ExternalFactorIntegrator();
    integ.addSeriesFactor('covariate', [1, 2, 3]);
    const fit = integ.fit([10, 11, 12, 13, 14], { trend: false });
    assert.ok(fit.factors.find((f) => f.name === 'covariate'));
    assert.ok(Number.isFinite(fit.coefficients[1]));
  });

  test('out-of-window events are reported, not silently clamped', () => {
    const times = [Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 2), Date.UTC(2026, 6, 3)];
    // extend to enough points for a fit
    const n = 60;
    for (let i = 3; i < n; i++) times.push(Date.UTC(2026, 6, 1) + i * 86400000);
    const y = times.map((_, t) => 10 + Math.sin(t / 3));
    const integ = new ExternalFactorIntegrator(times);
    integ.addEventFactor('before', { start: '2026-01-01', duration: 2, decay: 'box' });
    const fit = integ.fit(y);
    assert.ok(fit.dropped.includes('before'), `dropped: ${fit.dropped.join(',')}`);
  });

  test('holidayCalendar generates fixed and floating US holidays', () => {
    const events = holidayCalendar({ from: 2026, to: 2026 });
    const names = events.map((e) => e.name);
    assert.ok(names.includes('new-year-2026'));
    assert.ok(names.includes('us-independence-2026'));
    assert.ok(names.includes('christmas-2026'));
    assert.ok(names.includes('thanksgiving-2026'), 'floating holiday missing');
    assert.ok(names.includes('black-friday-2026'));
    assert.ok(events.every((e) => Number.isFinite(Date.parse(e.start))), 'unparseable holiday date');
    // Thanksgiving 2026 is the fourth Thursday of November: 2026-11-26.
    assert.ok(names.includes('thanksgiving-2026') && events.some((e) => e.name === 'thanksgiving-2026' && e.start === '2026-11-26'));
  });

  test('importEventsJson accepts an array or { events: [...] }', () => {
    const integ = new ExternalFactorIntegrator([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    integ.importEventsJson([{ name: 'a', start: 1, duration: 2 }]);
    integ.importEventsJson({ events: [{ name: 'b', start: 3, duration: 1 }] });
    assert.deepStrictEqual(integ.factorNames(), ['a', 'b']);
  });

  test('applyFactor adds a factor effect to a baseline path', () => {
    const integ = new ExternalFactorIntegrator();
    integ.addSeriesFactor('promo', [0, 0, 0, 0, 0]);
    integ.fit([1, 2, 3, 4, 5, 6], { trend: false });
    const out = integ.applyFactor([10, 10, 10, 10, 10, 10], 'promo', 2, 2, 'box');
    assert.deepStrictEqual(out, [10, 10, 10, 10, 10, 10]); // coefficient is ~0 for a flat covariate
  });

  test('rejects events without a name', () => {
    const integ = new ExternalFactorIntegrator();
    assert.throws(() => integ.importEvents([{ start: 1 }]), /needs a name/);
  });
});
