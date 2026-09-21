import { test, suite } from 'node:test';
// Unit tests for the statistical foundations of causal understanding.

import { strict as assert } from 'node:assert';
import {
  betai,
  tTestPValue,
  fTestPValue,
  ols,
  pearson,
  detrend,
  parseWideCsv,
} from '../../../src/causal.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

suite('exact p-values', () => {
  test('betai is bounded in [0, 1] and hits the endpoints', () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      const v = betai(2, 3, x);
      assert.ok(v >= 0 && v <= 1, `betai out of range at ${x}: ${v}`);
    }
    assert.strictEqual(betai(2, 3, 0), 0);
    assert.strictEqual(betai(2, 3, 1), 1);
  });

  test('betai is symmetric under a/b and x -> 1-x', () => {
    assert.ok(close(betai(3, 7, 0.4), 1 - betai(7, 3, 0.6), 1e-9));
  });

  test('t-test p-values match published tables', () => {
    // two-sided p for t=2.0, df=10 is 0.0734
    assert.ok(close(tTestPValue(2.0, 10), 0.0734, 1e-3));
    // t=2.977, df=15 -> p = 0.01
    assert.ok(close(tTestPValue(2.947, 15), 0.01, 1e-3));
    // large |t| -> ~0
    assert.ok(tTestPValue(50, 5) < 1e-6);
  });

  test('f-test p-values match published tables', () => {
    // F(1,10)=4.0 equals t(10)=2 squared -> same p as above
    assert.ok(close(fTestPValue(4.0, 1, 10), 0.0734, 1e-3));
    // F(5,20)=2.71 -> p ~ 0.05
    assert.ok(close(fTestPValue(2.71, 5, 20), 0.05, 0.01));
    assert.ok(close(fTestPValue(1.0, 2, 20), 0.385, 1e-2));
  });

  test('p-values are monotone in the statistic', () => {
    assert.ok(fTestPValue(10, 5, 30) < fTestPValue(2, 5, 30));
    assert.ok(tTestPValue(5, 30) < tTestPValue(1, 30));
  });
});

suite('ols', () => {
  test('recovers coefficients of a known line', () => {
    const y = [];
    const X = [];
    for (let i = 0; i < 100; i++) {
      const x1 = i / 10;
      const x2 = Math.sin(i / 5);
      y.push(3 + 2 * x1 - 4 * x2);
      X.push([1, x1, x2]);
    }
    const fit = ols(X, y);
    assert.ok(close(fit.beta[0], 3, 1e-8));
    assert.ok(close(fit.beta[1], 2, 1e-8));
    assert.ok(close(fit.beta[2], -4, 1e-8));
    assert.ok(close(fit.r2, 1, 1e-8));
    // An exact fit has no residual variance to estimate.
    assert.ok(fit.degenerate);
    assert.ok(Number.isNaN(fit.sigma));
  });

  test('standard errors scale with added noise', () => {
    const y = [];
    const X = [];
    for (let i = 0; i < 200; i++) {
      const e = (i % 7) - 3; // deterministic "noise"
      y.push(1 + 2 * (i / 100) + e);
      X.push([1, i / 100]);
    }
    const fit = ols(X, y);
    assert.ok(close(fit.beta[1], 2, 0.05), `slope ${fit.beta[1]}`);
    assert.ok(fit.se[1] > 0 && fit.se[1] < 1, `se ${fit.se[1]}`);
    assert.ok(fit.df === 198);
  });

  test('exactly collinear regressors are flagged, not silently trusted', () => {
    const y = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const X = y.map((v) => [1, v, 2 * v]); // third column is exactly twice the second
    const fit = ols(X, y);
    assert.ok(fit.regularized, 'a collinear design must be flagged as regularized');
    assert.ok(fit.degenerate, 'a fit with no residual variance must be flagged as degenerate');
    // The split between the collinear columns is arbitrary, but the model
    // still reproduces the response it was asked to fit.
    for (let i = 0; i < y.length; i++) {
      assert.ok(Math.abs(fit.fitted[i] - y[i]) < 1e-6, `fitted ${fit.fitted[i]} vs ${y[i]}`);
    }
    // With no error variance, significance is undefined rather than 0.
    assert.ok(Number.isNaN(fit.p[1]) || fit.p[1] > 0.2);
  });
});

suite('helpers', () => {
  test('pearson detects perfect positive and negative association', () => {
    assert.ok(close(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1));
    assert.ok(close(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1));
    assert.ok(Math.abs(pearson([1, 2, 3, 4], [1, 1, 1, 1])) < 1e-12 || Number.isNaN(pearson([1, 2, 3, 4], [1, 1, 1, 1])));
  });

  test('detrend removes level and slope', () => {
    const v = Array.from({ length: 50 }, (_, i) => 7 + 3 * i);
    const d = detrend(v);
    assert.ok(Math.max(...d.map(Math.abs)) < 1e-9);
  });

  test('parseWideCsv aligns columns and skips incomplete rows', () => {
    const text = 't,a,b\n2026-01-01,1,10\n2026-01-02,,11\n2026-01-03,3,12\n';
    const p = parseWideCsv(text);
    assert.deepStrictEqual(p.valueColumns, ['a', 'b']);
    assert.strictEqual(p.times.length, 2);
    assert.deepStrictEqual(p.columns.a, [1, 3]);
    assert.strictEqual(p.skipped, 1);
  });

  test('parseWideCsv honours valueColumns selection', () => {
    const text = 't,a,b\n2026-01-01,1,10\n2026-01-02,2,11\n';
    const p = parseWideCsv(text, { valueColumns: ['b'] });
    assert.deepStrictEqual(p.valueColumns, ['b']);
    assert.deepStrictEqual(p.columns.b, [10, 11]);
    assert.ok(!p.columns.a);
  });

  test('parseWideCsv rejects too-wide mismatches and bad headers', () => {
    assert.throws(() => parseWideCsv('t\n2026-01-01\n'), /at least one value column/i);
    assert.throws(() => parseWideCsv('t,a\n2026-01-01,1,2\n'), /expected 2 fields/);
  });
});
