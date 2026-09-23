/**
 * ForecastLab Causal Module - Causal Graph Builder
 * 
 * Discover and test lagged relationships between variables using Granger-style F-tests.
 */

import { pearson, detrend, removeSeasonality, ols, fTestPValue, fmtNum, fmtP, stdDev } from './math.js';

const DEFAULT_MAX_LAG = 12;
export const DEFAULT_ALPHA = 0.05;

/**
 * Discover and test lagged relationships between variables. A link
 * `a -> b` at lag L means: knowing a up to L steps ago improves the
 * prediction of b beyond b's own history (a Granger-style F-test), and the
 * lagged pair correlates at that L.
 */
export class CausalGraph {
  /**
   * @param {Object<string, number[]>} series named, aligned value arrays
   */
  constructor(series) {
    if (!series || typeof series !== 'object') throw new Error('CausalGraph needs a map of { name: values[] }');
    const names = Object.keys(series).filter((n) => Array.isArray(series[n]));
    if (names.length < 2) throw new Error('CausalGraph needs at least two series');
    const n = Math.min(...names.map((n2) => series[n2].length));
    if (n < 30) throw new Error(`CausalGraph needs at least 30 aligned points per series (have ${n})`);
    this.series = Object.fromEntries(names.map((nm) => [nm, series[nm].slice(0, n)]));
    this.names = names;
    this.n = n;
    this.edges = [];
    this.options = null;
  }

  /**
   * Test one directed relationship. Public so an interface can ask for a
   * specific hypothesis ("does a cause b?") and get the same numbers the
   * automatic discovery produces.
   *
   * @param {string} from cause variable
   * @param {string} to effect variable
   * @param {Object} [options]
   * @param {number} [options.maxLag] furthest lag to scan (default 12)
   * @param {number} [options.arLag] autoregressive lags of `to` used as control (default 4, capped)
   * @param {number} [options.seasonLength] season length; seasonality is removed from both series first
   * @param {number} [options.alpha] significance threshold (default 0.05)
   * @returns {Object|null} edge record, or null when the test cannot be run
   */
  testRelationship(from, to, options = {}) {
    if (!this.series[from] || !this.series[to]) return null;
    if (from === to) return null;
    const maxLag = Math.max(1, Math.min(options.maxLag ?? DEFAULT_MAX_LAG, Math.floor(this.n / 5)));
    const arLag = Math.max(1, Math.min(options.arLag ?? 4, Math.floor((this.n - maxLag - 4) / 2)));
    const alpha = options.alpha ?? DEFAULT_ALPHA;
    const prep = (v) => removeSeasonality(detrend(v), options.seasonLength ?? null);
    const x = prep(this.series[from]);
    const y = prep(this.series[to]);
    const start = Math.max(arLag, maxLag);
    const nUsed = this.n - start;
    const df2 = nUsed - arLag - (maxLag + 1) - 1;
    if (nUsed < 25 || df2 < 8) return null;

    // Per-lag profile: correlation of x[t-L] with y[t], plus a single-lag
    // F-test on top of b's own autoregressive past.
    const lagProfile = [];
    for (let L = 0; L <= maxLag; L++) {
      const xa = [];
      const ya = [];
      for (let t = start; t < this.n; t++) {
        xa.push(x[t - L]);
        ya.push(y[t]);
      }
      const r = pearson(xa, ya);
      // Single-lag t-test on top of the target's own autoregressive past.
      const single = ols(
        xa.map((_, i) => [1, xa[i], ...Array.from({ length: arLag }, (_, k) => ya[Math.max(0, i - 1 - k)])]),
        ya,
      );
      lagProfile.push({
        lag: L,
        r,
        coefficient: single.beta[1],
        f: single.t[1] * single.t[1],
        p: single.p[1],
      });
    }

    // Joint Granger-style test: does x at lags 0..maxLag add explanatory
    // power for y beyond y's own past?
    const Xr = [];
    const Xu = [];
    const Y = [];
    for (let t = start; t < this.n; t++) {
      const row = [1];
      for (let k = 1; k <= arLag; k++) row.push(y[t - k]);
      Xr.push(row);
      const rowU = [...row];
      for (let L = 0; L <= maxLag; L++) rowU.push(x[t - L]);
      Xu.push(rowU);
      Y.push(y[t]);
    }
    const restricted = ols(Xr, Y);
    const unrestricted = ols(Xu, Y);
    const df1 = maxLag + 1;
    const fStat = ((restricted.rss - unrestricted.rss) / df1) / (unrestricted.rss / unrestricted.df);
    const pValue = fTestPValue(fStat, df1, unrestricted.df);

    // Effect per unit of `from`, in units of `to`, at the strongest lag.
    const best = lagProfile.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
    const rBest = best.r;
    const sx = stdDev(x);
    const sy = stdDev(y);
    const effect = Number.isFinite(rBest) && sx > 0 ? rBest * sy / sx : NaN;

    // Stability: share of sub-windows whose correlation sign matches the
    // overall sign (a durable link, not one driven by a single episode).
    const windows = 4;
    const per = Math.floor(nUsed / windows);
    let agree = 0;
    let counted = 0;
    if (per >= 8) {
      for (let w = 0; w < windows; w++) {
        const xa = [];
        const ya = [];
        for (let i = w * per; i < (w + 1) * per; i++) {
          xa.push(x[start + i - best.lag] ?? x[x.length - 1]);
          ya.push(y[start + i]);
        }
        const rw = pearson(xa, ya);
        if (Number.isFinite(rw) && Number.isFinite(rBest)) {
          counted++;
          if (Math.sign(rw) === Math.sign(rBest)) agree++;
        }
      }
    }
    const stability = counted > 0 ? agree / counted : 0;
    const confidence = Number.isFinite(rBest)
      ? Math.min(1, 0.6 * Math.abs(rBest) + 0.4 * stability)
      : 0;

    return {
      id: `${from}->${to}`,
      from,
      to,
      lag: best.lag,
      correlation: rBest,
      effect,
      pValue,
      fStat,
      grangerDf: [df1, unrestricted.df],
      significant: Number.isFinite(pValue) && pValue < alpha,
      confidence,
      stability,
      nUsed,
      alpha,
      lagProfile,
    };
  }

  /**
   * Discover every pairwise relationship and rank them.
   *
   * @param {Object} [options] passed through to {@link testRelationship}
   * @param {boolean} [options.includeAll=false] keep non-significant links too (flagged)
   * @returns {Object[]} edges sorted by confidence, most convincing first
   */
  discover(options = {}) {
    const { includeAll = false, ...rest } = options;
    const edges = [];
    for (const a of this.names) {
      for (const b of this.names) {
        if (a === b) continue;
        const e = this.testRelationship(a, b, rest);
        if (e && (includeAll || e.significant)) edges.push(e);
      }
    }
    this._annotateDirections(edges);
    edges.sort((x, y) => y.confidence - x.confidence);
    this.edges = edges;
    this.options = rest;
    return edges;
  }

  /**
   * Cross-correlation is symmetric, so both directions of a pair usually
   * light up. Mark the weaker one as a reverse link so the reader knows the
   * evidence points mainly one way, and flag genuine two-way links as
   * feedback (or a hidden common cause - the test cannot tell those apart).
   */
  _annotateDirections(edges) {
    const byPair = new Map();
    for (const e of edges) {
      const key = [e.from, e.to].sort().join('|');
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(e);
    }
    for (const group of byPair.values()) {
      if (group.length < 2) {
        group[0].direction = 'forward';
        continue;
      }
      group.sort((a, b) => b.confidence - a.confidence);
      group[0].direction = 'forward';
      for (let i = 1; i < group.length; i++) group[i].direction = 'reverse';
      for (const e of group) {
        e.feedback = true;
        e.directionNote = 'Both directions test significant: this is either genuine feedback or a hidden common cause. Treat the direction as unresolved.';
      }
    }
  }

  /** Human-readable summary of the discovery rules, for reports. */
  explain() {
    const o = this.options ?? {};
    return [
      'Links are tested pairwise. Both series are detrended' +
        (o.seasonLength ? ` and deseasonalized (season length ${o.seasonLength})` : '') +
        ', then for every ordered pair (a -> b):',
      '1. lag scan: correlation of a[t-L] with b[t] for L = 0..maxLag' + (o.maxLag ? ` (here ${o.maxLag})` : ''),
      '2. Granger-style F-test: do lags 0..maxLag of a predict b beyond the AR(' +
        (o.arLag ?? 4) + ') past of b itself?',
      '3. effect = correlation * sd(b) / sd(a): units of b per unit of a, at the strongest lag',
      '4. confidence = 0.6 * |correlation| + 0.4 * sign-stability across sub-periods',
      'A link is reported as significant when p < ' + (o.alpha ?? DEFAULT_ALPHA) +
        '. Correlation is never proof of causation: use these links as hypotheses to check with interventions.',
    ];
  }

  /** Plain-language reading of one edge, for tooltips and reports. */
  static describeEdge(edge) {
    if (!edge) return '';
    const dir = Number.isFinite(edge.effect) ? (edge.effect >= 0 ? 'raises' : 'lowers') : 'moves';
    return `${edge.from} ${dir} ${edge.to} by ${fmtNum(Math.abs(edge.effect ?? 0))} per unit, ` +
      `peaking ${edge.lag} step(s) earlier (r=${fmtNum(edge.correlation)}, p=${fmtP(edge.pValue)}, ` +
      `confidence=${Math.round((edge.confidence ?? 0) * 100)}%).`;
  }
}
