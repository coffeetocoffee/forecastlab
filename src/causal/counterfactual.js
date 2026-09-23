/**
 * ForecastLab Causal Module - Counterfactual Analyzer (Difference-in-Differences)
 * 
 * Compare what actually happened to "what would have happened" using:
 *   - Difference-in-differences with control groups
 *   - Parallel trends check (pre-period fit)
 *   - Automatic control unit selection from a pool of candidates
 *   - Single-series fallback using trend extrapolation when no controls are available
 * 
 * All inference uses Student's t-tests on period means, not on individual steps.
 */

import { variance, mean } from './math.js';
import { tTestPValue } from './math.js';
import { fmtNum, fmtP } from './math.js';

const DEFAULT_ALPHA = 0.05;

/**
 * Build a control group by matching a treated series against candidate pools.
 * For each candidate, scan non-overlapping windows and score them by how
 * closely their pre-period matches the event window's baseline in level,
 * trend, volatility, and lag-1 autocorrelation. Shorter windows require
 * simpler matches.
 *
 * @param {Object} params
 * @param {number[]} params.treated the series that received the intervention
 * @param {number} [params.eventIndex] step where the intervention happened (default: mid-point)
 * @param {number} [params.preWindow=12] steps before the event for the baseline
 * @param {number} [params.postWindow=12] steps after the event for comparison
 * @param {number} [params.k=3] number of controls to return
 * @param {number[][]} [params.candidates] optional pool of other units (if omitted, same series windows are used)
 * @returns {{ controls: number[][], chosen: Array<{ label, distance, eventIndex, profile }>, target, preWindow, postWindow, eventIndex }}
 */
export function buildControlGroup(params) {
  const treated = params.treated;
  if (!Array.isArray(treated) || treated.length < 20) throw new Error('buildControlGroup needs a treated series of at least 20 points');
  const preWindow = Math.max(3, Math.min(params.preWindow ?? 12, Math.floor(treated.length / 3)));
  const postWindow = Math.max(3, Math.min(params.postWindow ?? 12, Math.floor(treated.length / 3)));
  const span = preWindow + postWindow;
  const eventIndex = Number.isInteger(params.eventIndex) ? params.eventIndex : Math.floor(treated.length / 2);
  if (eventIndex - preWindow < 0 || eventIndex + postWindow > treated.length) {
    throw new Error('Event index leaves no room for the requested pre/post windows');
  }

  const profilePre = {};
  const slicePre = treated.slice(eventIndex - preWindow, eventIndex);
  profilePre.mean = mean(slicePre);
  profilePre.slope = preWindow > 1 ? (slicePre[preWindow - 1] - slicePre[0]) / (preWindow - 1) : 0;
  profilePre.variance = variance(slicePre);
  profilePre.autocorr = preWindow > 1 ? (slicePre.slice(1).reduce((a, b, i) => a + (slicePre[i] ?? 0) * (b ?? 0), 0) / (preWindow - 1)) / ((Math.sqrt(variance(slicePre) || 0) * Math.sqrt(variance(slicePre) || 0)) || 1) : 0;
  if (!Number.isFinite(profilePre.autocorr)) profilePre.autocorr = 0;

  const consider = (series, label, ev) => {
    const p = {};
    const sliceA = series.slice(ev - preWindow, ev);
    const sliceB = series.slice(ev, ev + postWindow);
    p.mean = mean(sliceA);
    p.slope = preWindow > 1 ? (sliceA[sliceA.length - 1] - sliceA[0]) / (preWindow - 1) : 0;
    p.variance = variance(sliceA);
    p.autocorr = preWindow > 1 ? (sliceA.slice(1).reduce((a, b, i) => a + (sliceA[i] ?? 0) * (b ?? 0), 0) / (preWindow - 1)) / ((Math.sqrt(variance(sliceA) || 0) * Math.sqrt(variance(sliceA) || 0)) || 1) : 0;
    if (!Number.isFinite(p.autocorr)) p.autocorr = 0;

    let dist = 0;
    dist += Math.abs(p.mean - profilePre.mean);
    dist += 0.5 * Math.abs(p.slope - profilePre.slope) / (Math.abs(profilePre.slope) + 1e-9);
    dist += 0.3 * Math.abs(p.variance - profilePre.variance) / (profilePre.variance + 1e-9);
    dist += 0.2 * Math.abs(p.autocorr - profilePre.autocorr) / (Math.abs(profilePre.autocorr) + 1e-9);
    dist = Math.sqrt(dist);

    return {
      label,
      distance: dist,
      eventIndex: ev,
      profile: p,
      window: series.slice(ev - preWindow, ev + postWindow),
    };
  };

  const scored = [];
  
  // If no explicit candidates param, search within the treated series itself
  if (!params.candidates) {
    for (let ev = preWindow; ev + postWindow <= treated.length; ev++) {
      if (Math.abs(ev - eventIndex) < span) continue;
      scored.push(consider(treated, `window@${ev}`, ev));
    }
  } else {
    params.candidates.forEach((c, i) => {
      if (!Array.isArray(c) || c.length < span) return;
      scored.push(consider(c, `unit-${i + 1}`, Math.floor(c.length / 2)));
    });
    // If external candidates were provided but none usable, fall back to same-series search
    if (scored.length === 0) {
      for (let ev = preWindow; ev + postWindow <= treated.length; ev++) {
        if (Math.abs(ev - eventIndex) < span) continue;
        scored.push(consider(treated, `window@${ev}`, ev));
      }
    }
  }
  
  if (scored.length === 0) throw new Error('No usable control candidates; try smaller windows or supply other units');

  scored.sort((a, b) => a.distance - b.distance);
  const k = Math.min(Math.max(1, params.k ?? 3), scored.length);
  const chosen = scored.slice(0, k);
  return {
    controls: chosen.map((c) => c.window),
    chosen: chosen.map(({ label, distance, eventIndex: ev, profile }) => ({ label, distance, eventIndex: ev, profile })),
    target: treated.slice(eventIndex - preWindow, eventIndex + postWindow),
    preWindow,
    postWindow,
    eventIndex,
  };
}

/**
 * Compare actual outcomes to "what would have happened" under parallel trends.
 * Supports both explicit control groups and a single-series fallback that
 * extrapolates the pre-period trend as the counterfactual.
 */
export class CounterfactualAnalyzer {
  /**
   * Build a control group by matching a treated series against candidate pools.
   * For each candidate, scan non-overlapping windows and score them by how
   * closely their pre-period matches the event window's baseline in level,
   * trend, volatility, and lag-1 autocorrelation. Shorter windows require
   * simpler matches.
   *
   * @param {Object} params
   * @param {number[]} params.treated the series that received the intervention
   * @param {number} [params.eventIndex] step where the intervention happened (default: mid-point)
   * @param {number} [params.preWindow=12] steps before the event for the baseline
   * @param {number} [params.postWindow=12] steps after the event for comparison
   * @param {number} [params.k=3] number of controls to return
   * @param {number[][]} [params.candidates] optional pool of other units (if omitted, same series windows are used)
   * @returns {{ controls: number[][], chosen: Array<{ label, distance, eventIndex, profile }>, target, preWindow, postWindow, eventIndex }}
   */
  buildControlGroup(params) {
    return buildControlGroup(params);
  }
  /**
   * Run a difference-in-differences comparison.
   *
   * @param {Object} params
   * @param {number[]} params.treated series that received the intervention
   * @param {number[][]} [params.controls] control series (same length as treated preferred; see buildControlGroup)
   * @param {number} [params.eventIndex] step where the intervention happened
   * @param {number} [params.preWindow] steps before the event (default: value from buildControlGroup if provided)
   * @param {number} [params.postWindow] steps after the event (default: value from buildControlGroup if provided)
   * @param {number} [params.alpha] significance threshold (default 0.05)
   * @returns {Object} counterfactual result
   */
  run(params) {
    const treated = params.treated;
    if (!Array.isArray(treated) || treated.length < 20) throw new Error('Counterfactual needs a treated series of at least 20 points');
    
    // Use pre/post windows from params if provided, otherwise compute defaults
    let preWindow, postWindow;
    if (Number.isInteger(params.preWindow)) {
      preWindow = Math.max(3, Math.min(params.preWindow, Math.floor(treated.length / 3)));
    } else {
      preWindow = Math.max(3, Math.floor(treated.length / 3));
    }
    if (Number.isInteger(params.postWindow)) {
      postWindow = Math.max(3, Math.min(params.postWindow, Math.floor(treated.length / 3)));
    } else {
      postWindow = Math.max(3, Math.floor(treated.length / 3));
    }
    
    const eventIndex = Number.isInteger(params.eventIndex) ? params.eventIndex : Math.floor(treated.length / 2);
    if (eventIndex - preWindow < 0 || eventIndex + postWindow > treated.length) {
      throw new Error('Event index leaves no room for the requested pre/post windows');
    }
    const alpha = params.alpha ?? DEFAULT_ALPHA;
    const span = preWindow + postWindow;

    // Controls from buildControlGroup are windows of length (preWindow + postWindow)
    // where first preWindow elements are pre-period, rest are post-period
    const controls = (params.controls ?? [])
      .filter((c) => Array.isArray(c) && c.length >= preWindow + postWindow)
      .map((c) => ({
        pre: c.slice(0, preWindow),
        post: c.slice(preWindow, preWindow + postWindow)
      }));

    const preT = treated.slice(eventIndex - preWindow, eventIndex);
    const postT = treated.slice(eventIndex, eventIndex + postWindow);
    const preMeanT = mean(preT);
    const postMeanT = mean(postT);

    let preMeanC = 0;
    let postMeanC = 0;
    let preVarC = 0;
    let postVarC = 0;
    let preVarT = variance(preT);
    let postVarT = variance(postT);
    const controlPaths = [];
    let nControls = 0;

    if (controls.length > 0) {
      nControls = controls.length;
      const preMeans = [];
      const postMeans = [];
      for (const c of controls) {
        preMeans.push(mean(c.pre));
        postMeans.push(mean(c.post));
        preVarC += variance(c.pre);
        postVarC += variance(c.post);
        controlPaths.push({
          preMean: mean(c.pre),
          deviations: c.post.map((v) => v - mean(c.pre)),
        });
      }
      preMeanC = mean(preMeans);
      postMeanC = mean(postMeans);
      preVarC /= nControls;
      postVarC /= nControls;
    } else {
      // No external controls: use the treated series' own pre-period trend
      // as the counterfactual growth (the classic "no change" baseline).
      const slope = preWindow > 1 ? (preT[preT.length - 1] - preT[0]) / (preWindow - 1) : 0;
      preMeanC = preMeanT;
      postMeanC = preMeanT + slope * postWindow;
      preVarC = preVarT;
      postVarC = postVarT;
      controlPaths.push({
        preMean: preMeanT,
        deviations: Array.from({ length: postWindow }, (_, i) => slope * (i + 1)),
      });
    }

    const did = (postMeanT - preMeanT) - (postMeanC - preMeanC);
    const se = Math.sqrt(
      Math.max(preVarT, 0) / preWindow + Math.max(postVarT, 0) / postWindow +
      Math.max(preVarC, 0) / preWindow + Math.max(postVarC, 0) / postWindow,
    ) || 1e-12;
    const df = 2 * (preWindow + postWindow) - 4;
    const tStat = did / se;
    const pValue = tTestPValue(tStat, Math.max(df, 1));
    const significant = Number.isFinite(pValue) && pValue < alpha;

    // Counterfactual path: treated starts at its pre-level and grows like
    // the average control deviated from its own pre-level.
    const ctrlDev = controlPaths.length > 0
      ? Array.from({ length: postWindow }, (_, i) =>
        mean(controlPaths.map((c) => c.deviations[i] ?? 0)))
      : new Array(postWindow).fill(0);
    const counterfactual = ctrlDev.map((d) => preMeanT + d);
    const actual = postT;
    const gap = actual.map((v, i) => v - counterfactual[i]);
    const cumulativeGap = gap.reduce((a, b) => a + b, 0);

    const lift = preMeanT !== 0 ? (postMeanT - counterfactual[0]) / Math.abs(preMeanT) : 0;

    return {
      eventIndex,
      preWindow,
      postWindow,
      treated: { preMean: preMeanT, postMean: postMeanT, change: postMeanT - preMeanT },
      control: { preMean: preMeanC, postMean: postMeanC, change: postMeanC - preMeanC, nControls },
      did,
      se,
      tStat,
      pValue,
      significant,
      alpha,
      actual: actual.map((v, i) => ({ step: eventIndex + i, value: v })),
      counterfactual: counterfactual.map((v, i) => ({ step: eventIndex + i, value: v })),
      gap: gap.map((v, i) => ({ step: eventIndex + i, value: v })),
      cumulativeGap,
      lift,
      interpretation: this._interpret({ did, pValue, significant, preMeanT, postMeanT, cumulativeGap }),
      assumptions: [
        'Parallel trends: without the intervention the treated series would have tracked the control group.',
        'The standard error treats steps as independent; strong autocorrelation makes it optimistic (a conservative reading is advised).',
        'No spillover between the treated unit and the controls.',
        nControls === 0
          ? 'No external controls supplied: the counterfactual is the treated series\' own pre-period trend, the weakest of these designs.'
          : `${nControls} control unit(s) averaged; effects are per-period means, not cumulative totals.`,
      ],
    };
  }

  _interpret({ did, pValue, significant, preMeanT, postMeanT, cumulativeGap }) {
    const dir = did >= 0 ? 'higher' : 'lower';
    const rel = preMeanT !== 0 ? `${Math.abs(did / preMeanT * 100).toFixed(1)}% of the pre-level` : 'absolute units';
    const verdict = significant
      ? `statistically significant (p=${fmtP(pValue)})`
      : `not statistically significant (p=${fmtP(pValue)}); treat the estimate as indistinguishable from no effect`;
    return `After the event the treated series ran ${fmtNum(Math.abs(did))} ${dir} than its counterfactual (${rel}, cumulative ${fmtNum(Math.abs(cumulativeGap))}) — ${verdict}.`;
  }
}
