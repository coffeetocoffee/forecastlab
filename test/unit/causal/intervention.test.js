import { test, suite } from 'node:test';
// Unit tests for the intervention simulator.

import { strict as assert } from 'node:assert';
import { InterventionSimulator, naiveBaseline } from '../../../src/causal.js';

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

/** y_t = 0.4 x_{t-1} + 0.2 x_{t-2} + noise: a known impulse response.
 * x is near-white with a wide spread so the lagged terms stay close to
 * orthogonal and the individual coefficients are identified (a smooth,
 * autocorrelated cause would smear the same total effect across many lags). */
function panel(n = 300, seed = 21) {
  const rnd = rng(seed);
  const x = [];
  const y = [];
  for (let t = 0; t < n; t++) {
    const xv = 10 + 3 * gauss(rnd);
    x.push(xv);
    y.push(50 + 0.4 * (x[t - 1] ?? 10) + 0.2 * (x[t - 2] ?? 10) + 1.5 * gauss(rnd));
  }
  return { x, y };
}

suite('InterventionSimulator', () => {
  test('fitResponse recovers the impulse response coefficients', () => {
    const { x, y } = panel();
    const sim = new InterventionSimulator({ x, y });
    const resp = sim.fitResponse('x', 'y', { maxLag: 6 });
    assert.ok(closeTo(resp.coefficients[1], 0.4, 0.12), `lag1 ${resp.coefficients[1]}`);
    assert.ok(closeTo(resp.coefficients[2], 0.2, 0.12), `lag2 ${resp.coefficients[2]}`);
    assert.ok(resp.r2 > 0.3);
    assert.ok(resp.cumulative > 0.3);
  });

  test('a sustained change produces the cumulative multiplier', () => {
    const { x, y } = panel();
    const sim = new InterventionSimulator({ x, y });
    return sim
      .simulate({ variable: 'x', target: 'y', change: 1, horizon: 20, duration: 20, maxLag: 4 })
      .then((r) => {
        assert.ok(r.difference.length === 20);
        assert.ok(r.uncertainty.lower.length === 20 && r.uncertainty.upper.length === 20);
        // The response engages with a lag, so only the later steps carry the
        // full effect; the first steps see just the (noisy) lag-0 term.
        const engaged = r.difference.slice(3);
        for (const d of engaged) {
          assert.ok(d.delta > 0, `delta ${d.delta}`);
          assert.ok(Number.isFinite(d.delta));
        }
        assert.ok(r.cumulativeImpact > 0, `cumulative ${r.cumulativeImpact}`);
        assert.ok(r.multiplier > 0.3, `multiplier ${r.multiplier}`);
      });
  });

  test('a change confined to a few steps decays back to the baseline', () => {
    const { x, y } = panel();
    const sim = new InterventionSimulator({ x, y });
    return sim
      .simulate({ variable: 'x', target: 'y', change: 5, horizon: 30, duration: 3, start: 2, maxLag: 4 })
      .then((r) => {
        const early = r.difference.slice(2, 6).map((d) => Math.abs(d.delta));
        const late = r.difference.slice(15, 30).map((d) => Math.abs(d.delta));
        const earlyMax = Math.max(...early);
        const lateMax = Math.max(...late);
        assert.ok(earlyMax > lateMax, `early ${earlyMax} vs late ${lateMax}`);
        // The counterfactual returns to the baseline once the pulse has passed.
        assert.ok(lateMax < earlyMax * 0.5 + 1e-9);
      });
  });

  test('uncertainty bounds bracket the counterfactual', () => {
    const { x, y } = panel();
    const sim = new InterventionSimulator({ x, y });
    return sim.simulate({ variable: 'x', target: 'y', change: 2, horizon: 12 }).then((r) => {
      for (let i = 0; i < r.counterfactual.length; i++) {
        const lo = r.uncertainty.lower[i];
        const hi = r.uncertainty.upper[i];
        assert.ok(Number.isFinite(lo) && Number.isFinite(hi));
        assert.ok(hi >= lo, `band inverted at ${i}`);
        assert.ok(lo <= r.counterfactual[i].value && r.counterfactual[i].value <= hi);
      }
    });
  });

  test('warns when the change exceeds anything ever observed', () => {
    const { x, y } = panel();
    const sim = new InterventionSimulator({ x, y });
    return sim.simulate({ variable: 'x', target: 'y', change: 1e6, horizon: 10 }).then((r) => {
      assert.ok(r.warnings.some((w) => w.type === 'EXTRAPOLATION'));
    });
  });

  test('findNaturalExperiments spots an injected jump in the cause', () => {
    const rnd = rng(33);
    const n = 300;
    const x = [];
    const y = [];
    for (let t = 0; t < n; t++) {
      let xv = 10 + gauss(rnd);
      if (t >= 150 && t < 160) xv += 12; // a persistent level shift the target can react to
      x.push(xv);
      y.push(50 + 0.5 * (x[t - 1] ?? 10) + 1.2 * gauss(rnd));
    }
    const sim = new InterventionSimulator({ x, y });
    const events = sim.findNaturalExperiments({ variable: 'x', target: 'y', window: 8 });
    assert.ok(events.length > 0);
    const found = events.find((e) => Math.abs(e.index - 150) <= 2 && e.changeInX > 8);
    assert.ok(found, 'jump at step 150 not identified');
    assert.ok(found.response > 0, `response ${found.response}`);
    assert.ok(found.responsePerUnit > 0.1, `per-unit ${found.responsePerUnit}`);
    assert.ok(found.significant);
  });

  test('throws on unknown variable or target', () => {
    const { x, y } = panel();
    const sim = new InterventionSimulator({ x, y });
    return sim
      .simulate({ variable: 'nope', target: 'y', change: 1 })
      .then(
        () => assert.fail('should have thrown'),
        (e) => assert.ok(/Unknown variable/.test(e.message)),
      );
  });
});

suite('naiveBaseline', () => {
  test('extends the last value and drift for a flat series', () => {
    const b = naiveBaseline([10, 10, 10, 10], 3);
    assert.deepStrictEqual(b, [10, 10, 10]);
  });

  test('extends a trending series with its recent drift', () => {
    const b = naiveBaseline([1, 2, 3, 4, 5, 6], 3);
    assert.ok(b[0] > 6);
    assert.ok(b[1] > b[0] && b[2] > b[1]);
  });

  test('seasonal naive repeats the last cycle, plus its drift', () => {
    // Flat last cycle: the baseline should repeat it exactly.
    const flat = naiveBaseline([9, 10, 11, 12, 4, 4, 4, 4], 4, 4);
    assert.deepStrictEqual(flat, [4, 4, 4, 4]);
    // Trending series: the next cycle continues the pattern and the trend.
    const trending = naiveBaseline([1, 2, 3, 4, 5, 6, 7, 8], 4, 4);
    assert.deepStrictEqual(trending, [9, 10, 11, 12]);
  });
});

function closeTo(a, b, tol) {
  return Math.abs(a - b) <= tol;
}
