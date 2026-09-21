import { test, suite } from 'node:test';
// Unit tests for counterfactual analysis (difference-in-differences).

import { strict as assert } from 'node:assert';
import { CounterfactualAnalyzer } from '../../../src/causal.js';

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

/** A treated series with a clean step-up intervention at eventIndex. */
function treatedSeries(n, eventIndex, lift = 30, seed = 101) {
  const rnd = rng(seed);
  return Array.from({ length: n }, (_, t) => {
    const weekly = t % 7 >= 5 ? -8 : 0;
    return 120 + weekly + 0.3 * t + (t >= eventIndex ? lift : 0) + 5 * gauss(rnd);
  });
}

suite('CounterfactualAnalyzer', () => {
  test('detects a known positive intervention', () => {
    const n = 200;
    const eventIndex = 100;
    const treated = treatedSeries(n, eventIndex, 30);
    const analyzer = new CounterfactualAnalyzer();
    const group = analyzer.buildControlGroup({ treated, eventIndex, preWindow: 12, postWindow: 12 });
    const result = analyzer.run({ treated, controls: group.controls, eventIndex, preWindow: 12, postWindow: 12 });
    assert.ok(result.significant, `p=${result.pValue}`);
    assert.ok(Math.abs(result.did - 30) < 8, `did ${result.did}`);
    assert.ok(result.cumulativeGap > 12 * 20, `cumulative gap ${result.cumulativeGap}`);
    assert.ok(result.actual.length === 12 && result.counterfactual.length === 12);
  });

  test('reports no significant effect when nothing happened', () => {
    const n = 200;
    const treated = treatedSeries(n, 100, 0); // no lift at all
    const analyzer = new CounterfactualAnalyzer();
    const group = analyzer.buildControlGroup({ treated, eventIndex: 100 });
    const result = analyzer.run({ treated, controls: group.controls, eventIndex: 100 });
    assert.ok(!result.significant, `p=${result.pValue}`);
    assert.ok(Math.abs(result.did) < 10, `did ${result.did}`);
  });

  test('control windows are event-aligned and the right length', () => {
    const treated = treatedSeries(200, 100, 30);
    const analyzer = new CounterfactualAnalyzer();
    const group = analyzer.buildControlGroup({ treated, eventIndex: 100, preWindow: 10, postWindow: 8, k: 2 });
    assert.ok(group.controls.length === 2);
    for (const c of group.controls) assert.strictEqual(c.length, 18);
    // Controls never overlap the treated event window.
    for (const chosen of group.chosen) assert.ok(Math.abs(chosen.eventIndex - 100) >= 18);
  });

  test('external control units are accepted', () => {
    const n = 200;
    const treated = treatedSeries(n, 100, 25);
    const untreated = treatedSeries(n, 0, 0, 202).map((v) => v - 0.3 * 100); // same shape, no lift
    const analyzer = new CounterfactualAnalyzer();
    const result = analyzer.run({ treated, controls: [untreated], eventIndex: 100, preWindow: 12, postWindow: 12 });
    assert.ok(result.control.nControls === 1);
    assert.ok(Math.abs(result.did - 25) < 10, `did ${result.did}`);
  });

  test('falls back to the pre-period trend when no controls are given', () => {
    const treated = treatedSeries(200, 100, 30);
    const analyzer = new CounterfactualAnalyzer();
    const result = analyzer.run({ treated, eventIndex: 100, preWindow: 12, postWindow: 12 });
    assert.ok(result.control.nControls === 0);
    assert.ok(result.assumptions.some((a) => /pre-period trend/.test(a)));
  });

  test('counterfactual path starts at the treated pre-level', () => {
    const treated = treatedSeries(200, 100, 30);
    const analyzer = new CounterfactualAnalyzer();
    const result = analyzer.run({ treated, eventIndex: 100, preWindow: 12, postWindow: 12 });
    assert.ok(Math.abs(result.counterfactual[0].value - result.treated.preMean) < 30);
  });

  test('gap equals actual minus counterfactual at every step', () => {
    const treated = treatedSeries(200, 100, 30);
    const analyzer = new CounterfactualAnalyzer();
    const result = analyzer.run({ treated, eventIndex: 100, preWindow: 12, postWindow: 12 });
    for (let i = 0; i < result.actual.length; i++) {
      assert.ok(Math.abs(result.gap[i].value - (result.actual[i].value - result.counterfactual[i].value)) < 1e-9);
    }
  });

  test('interpretation and assumptions are always populated', () => {
    const treated = treatedSeries(200, 100, 30);
    const analyzer = new CounterfactualAnalyzer();
    const result = analyzer.run({ treated, eventIndex: 100, preWindow: 12, postWindow: 12 });
    assert.ok(typeof result.interpretation === 'string' && result.interpretation.length > 20);
    assert.ok(result.assumptions.length >= 3);
    assert.ok(/parallel trends/i.test(result.assumptions.join(' ')));
  });

  test('rejects series that are too short or windows that do not fit', () => {
    const analyzer = new CounterfactualAnalyzer();
    assert.throws(() => analyzer.run({ treated: [1, 2, 3], eventIndex: 1 }), /at least 20 points/);
    const treated = treatedSeries(40, 20, 10);
    assert.throws(() => analyzer.run({ treated, eventIndex: 35, preWindow: 10, postWindow: 10 }), /no room/);
  });
});
