import { test, suite } from 'node:test';
// Unit tests for causal relationship discovery.

import { strict as assert } from 'node:assert';
import { CausalGraph } from '../../../src/causal.js';

// Deterministic PRNG so these tests are reproducible.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Build a synthetic panel where x drives y at a known lag with a known slope. */
function panel({ n = 300, lag = 2, slope = 0.5, noise = 0.2, seed = 7, periodic = false }) {
  const rnd = rng(seed);
  const x = [];
  const y = [];
  for (let t = 0; t < n; t++) {
    const xv = periodic ? Math.sin((2 * Math.PI * t) / 24) : 0.5 * Math.sin(t / 31) + 0.3 * rnd();
    x.push(xv);
    const past = x[t - lag] ?? 0;
    y.push(slope * past + noise * rnd());
  }
  return { x, y };
}

suite('CausalGraph discovery', () => {
  test('detects a lagged cause at the right lag', () => {
    const { x, y } = panel({ lag: 3, slope: 0.8 });
    const g = new CausalGraph({ x, y });
    const edge = g.testRelationship('x', 'y', { maxLag: 8 });
    assert.ok(edge, 'test returned null');
    assert.strictEqual(edge.lag, 3, `best lag ${edge.lag}`);
    assert.ok(edge.correlation > 0.8, `r=${edge.correlation}`);
    assert.ok(edge.pValue < 1e-6, `p=${edge.pValue}`);
    assert.ok(edge.significant);
  });

  test('estimates the effect in units of the target per unit of the cause', () => {
    const { x, y } = panel({ slope: 0.5 });
    const g = new CausalGraph({ x, y });
    const edge = g.testRelationship('x', 'y', { maxLag: 6 });
    assert.ok(Math.abs(edge.effect - 0.5) < 0.15, `effect ${edge.effect}`);
  });

  test('confidence is a probability in [0, 1] and high for a clean link', () => {
    const { x, y } = panel({ noise: 0.05 });
    const g = new CausalGraph({ x, y });
    const edge = g.testRelationship('x', 'y', { maxLag: 6 });
    assert.ok(edge.confidence >= 0 && edge.confidence <= 1);
    assert.ok(edge.confidence > 0.8, `confidence ${edge.confidence}`);
  });

  test('an unrelated pair is not flagged as significant', () => {
    const rnd = rng(99);
    const a = Array.from({ length: 200 }, (_, t) => Math.sin(t / 13) + 0.2 * rnd());
    const b = Array.from({ length: 200 }, () => 5 + 2 * rnd());
    const g = new CausalGraph({ a, b });
    const edge = g.testRelationship('a', 'b', { maxLag: 6 });
    assert.ok(!edge.significant, `p=${edge.pValue}`);
    assert.ok(edge.confidence < 0.5);
  });

  test('discover returns both directions sorted by confidence and annotates feedback', () => {
    const { x, y } = panel({ lag: 2, slope: 0.6 });
    const g = new CausalGraph({ x, y });
    const edges = g.discover({ maxLag: 6 });
    assert.ok(edges.length >= 1);
    assert.ok(edges[0].confidence >= edges[edges.length - 1].confidence);
    const pair = edges.filter((e) => (e.from === 'x' && e.to === 'y') || (e.from === 'y' && e.to === 'x'));
    if (pair.length === 2) {
      assert.ok(pair.some((e) => e.direction === 'forward'));
      assert.ok(pair.some((e) => e.direction === 'reverse'));
      assert.ok(pair.every((e) => e.feedback === true));
    }
  });

  test('includeAll keeps rejected links flagged as not significant', () => {
    const rnd = rng(5);
    const a = Array.from({ length: 200 }, () => rnd());
    const b = Array.from({ length: 200 }, () => rnd());
    const g = new CausalGraph({ a, b });
    const edges = g.discover({ maxLag: 4, includeAll: true });
    assert.ok(edges.length >= 1);
    assert.ok(edges.every((e) => e.significant === false));
  });

  test('deseasonalizing with seasonLength keeps the true anomaly response', () => {
    // x is a pure 24-step cycle plus a slow anomaly; y follows only the
    // anomaly. Deseasonalizing must leave that relationship intact while
    // stripping the cycle both series share.
    const rnd = rng(13);
    const n = 400;
    const x = [];
    const y = [];
    for (let t = 0; t < n; t++) {
      const anomaly = 3 * Math.sin(t / 37);
      x.push(Math.sin((2 * Math.PI * t) / 24) + anomaly + 0.2 * rnd());
      y.push(2 * anomaly + 0.3 * rnd());
    }
    const g = new CausalGraph({ x, y });
    const deseasonalized = g.testRelationship('x', 'y', { maxLag: 4, seasonLength: 24 });
    assert.ok(deseasonalized.significant, `r=${deseasonalized.correlation} p=${deseasonalized.pValue}`);
    assert.ok(deseasonalized.correlation > 0.5, `deseasonalized r=${deseasonalized.correlation}`);
    assert.ok(Math.abs(deseasonalized.effect - 2) < 0.6, `effect ${deseasonalized.effect}`);
  });

  test('explain documents the method', () => {
    const g = new CausalGraph(panel({}));
    const lines = g.explain();
    assert.ok(Array.isArray(lines));
    assert.ok(lines.join('\n').includes('Granger'));
  });

  test('describeEdge reads a link back in plain language', () => {
    const { x, y } = panel({ slope: 0.5 });
    const g = new CausalGraph({ x, y });
    const edge = g.testRelationship('x', 'y', { maxLag: 6 });
    const text = CausalGraph.describeEdge(edge);
    assert.ok(text.includes('x') && text.includes('y'));
    assert.ok(text.includes('p='));
  });

  test('rejects too-short or single-series input', () => {
    assert.throws(() => new CausalGraph({ a: [1, 2, 3] }), /at least two series/);
    assert.throws(() => new CausalGraph({ a: Array(20).fill(1), b: Array(20).fill(2) }), /at least 30 aligned points/);
  });

  test('testRelationship returns null on unknown variables', () => {
    const { x, y } = panel({});
    const g = new CausalGraph({ x, y });
    assert.strictEqual(g.testRelationship('x', 'nope'), null);
    assert.strictEqual(g.testRelationship('x', 'x'), null);
  });
});
