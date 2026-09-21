/**
 * Causal Understanding Module - ForecastLab
 *
 * Build causal understanding without machine learning. Everything here is
 * classical statistics you can audit line by line:
 *
 *   - CausalGraph              discover lagged relationships between variables
 *                              (Pearson cross-correlation + Granger-style F-test)
 *   - InterventionSimulator    "what if we changed X?" from historical responses
 *                              (distributed-lag impulse response + natural experiments)
 *   - ExternalFactorIntegrator import holidays / promotions / weather as named
 *                              events, model their effect with temporal decay kernels
 *   - CounterfactualAnalyzer   actual vs "what would have happened", with control
 *                              groups and difference-in-differences
 *
 * No training, no black boxes, no dependencies. p-values come from the exact
 * incomplete beta function, so the significance tests are real ones.
 *
 * @module causal
 */

// ---------------------------------------------------------------------------
// CSV helpers (wide format: one time column + several value columns)
// ---------------------------------------------------------------------------

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quote = false;
      } else cur += ch;
    } else if (ch === '"') {
      quote = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseTimestamp(raw, lineNo) {
  const s = String(raw).trim();
  if (s === '') throw new Error(`Line ${lineNo}: empty timestamp`);
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`Line ${lineNo}: bad epoch timestamp "${raw}"`);
    return s.length >= 13 ? n : n * 1000;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Line ${lineNo}: unparseable timestamp "${raw}"`);
  return ms;
}

/**
 * Parse a wide CSV (one time column + any number of value columns) into
 * aligned series. Rows with a missing value in any selected column are
 * skipped and counted, so every returned column has identical length.
 *
 * @param {string} text CSV text
 * @param {Object} [options]
 * @param {string} [options.timeColumn] header of the time column (default: first)
 * @param {string[]} [options.valueColumns] subset of value columns to keep (default: all others)
 * @returns {{ timeColumn: string, valueColumns: string[], times: number[], columns: Object<string, number[]>, skipped: number }}
 */
export function parseWideCsv(text, options = {}) {
  const lines = String(text).split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('Empty CSV: no header row found');
  const headers = splitCsvLine(lines[headerIdx]).map((h) => h.trim());
  if (headers.length < 2) throw new Error('Wide CSV needs a time column plus at least one value column');

  const timeColumn = options.timeColumn ?? headers[0];
  const ti = headers.indexOf(timeColumn);
  if (ti === -1) throw new Error(`Time column "${timeColumn}" not found in ${headers.join(', ')}`);

  const valueColumns = (options.valueColumns ?? headers.filter((_, i) => i !== ti))
    .filter((c) => headers.includes(c));
  if (valueColumns.length === 0) throw new Error('No value columns selected');

  const times = [];
  const columns = Object.fromEntries(valueColumns.map((c) => [c, []]));
  let skipped = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lineNo = i + 1;
    const fields = splitCsvLine(line);
    if (fields.length !== headers.length) {
      throw new Error(`Line ${lineNo}: expected ${headers.length} fields, got ${fields.length}`);
    }
    let ok = true;
    const row = {};
    for (const c of valueColumns) {
      const raw = fields[headers.indexOf(c)].trim();
      if (raw === '') { ok = false; break; }
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`Line ${lineNo}: value "${raw}" in column "${c}" is not a number`);
      row[c] = v;
    }
    if (!ok) { skipped++; continue; }
    times.push(parseTimestamp(fields[ti], lineNo));
    for (const c of valueColumns) columns[c].push(row[c]);
  }
  if (times.length === 0) throw new Error('No usable rows: every data row was empty or incomplete');

  const order = times.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  return {
    timeColumn,
    valueColumns,
    times: order.map((i) => times[i]),
    columns: Object.fromEntries(valueColumns.map((c) => [c, order.map((i) => columns[c][i])])),
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Statistics: exact p-values via the incomplete beta function
// ---------------------------------------------------------------------------

function gammaln(xx) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  const x = xx;
  const y = xx + 5.5;
  const tmp = y - (x + 0.5) * Math.log(y);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / (x + j + 1);
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betacf(a, b, x) {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1.0;
  const qam = a - 1.0;
  let c = 1.0;
  let d = 1.0 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1.0 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1.0 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1.0 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1.0 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1.0 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1.0) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
  return 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Two-sided p-value for Student's t. */
export function tTestPValue(t, df) {
  if (!Number.isFinite(df) || df <= 0) return NaN;
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** Upper-tail p-value for the F distribution (df1, df2). */
export function fTestPValue(f, df1, df2) {
  if (!Number.isFinite(df1) || !Number.isFinite(df2) || df1 <= 0 || df2 <= 0) return NaN;
  if (f <= 0) return 1;
  // P(F > f) = I_{df2/(df2 + df1*f)}(df2/2, df1/2) (NR eq. 6.14.15)
  return betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * f));
}

/** Standard normal CDF (rational approximation, Abramowitz & Stegun 26.2.5). */
export function normCdf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function mean(values) {
  return values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;
}

export function variance(values) {
  if (values.length < 2) return NaN;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) * (v - m), 0) / (values.length - 1);
}

export function stdDev(values) {
  return Math.sqrt(variance(values));
}

/** Pearson correlation; NaN if either side is constant. */
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sxy += da * db;
    sxx += da * da;
    syy += db * db;
  }
  if (sxx <= 0 || syy <= 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/** Remove a least-squares linear trend (level and slope stay in original units). */
export function detrend(values) {
  const n = values.length;
  if (n < 3) return values.slice();
  const xs = values.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(values);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (values[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return values.map((v, i) => v - (my + slope * (i - mx)));
}

/** Subtract a seasonal profile (seasonal index model, one pass). */
function removeSeasonality(values, seasonLength) {
  const n = values.length;
  if (!seasonLength || seasonLength < 2 || n < 2 * seasonLength) return values.slice();
  const resid = detrend(values);
  const idx = new Array(seasonLength).fill(0);
  const prof = new Array(seasonLength).fill(0);
  for (let i = 0; i < n; i++) {
    prof[i % seasonLength] += resid[i];
    idx[i % seasonLength] += 1;
  }
  const m = mean(prof);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const si = idx[i % seasonLength] > 0 ? prof[i % seasonLength] / idx[i % seasonLength] : 0;
    out[i] = values[i] - (si - m);
  }
  return out;
}

/**
 * Ordinary least squares with coefficient standard errors, t-statistics and
 * exact p-values. Falls back to a tiny ridge if the design is near singular
 * and reports it, so collinear regressors degrade gracefully instead of
 * producing nonsense numbers.
 *
 * @param {number[][]} X design matrix (rows = observations; no intercept column needed)
 * @param {number[]} y response
 * @returns {{ beta: number[], fitted: number[], resid: number[], rss: number, r2: number, sigma: number, se: number[], t: number[], p: number[], df: number, regularized: boolean, degenerate: boolean }}
 */
export function ols(X, y) {
  const n = y.length;
  const k = X[0].length;
  if (n < k + 3) throw new Error(`Not enough observations for ${k} regressor(s): have ${n}, need at least ${k + 3}`);

  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }

  // Solve (XtX) - or (XtX + tiny ridge) when it is ill-conditioned - via
  // Gaussian elimination with partial pivoting. Exactly singular designs are
  // refused; merely near-singular ones take a ridge and are flagged, so a
  // collinear factor set degrades visibly instead of silently.
  let regularized = false;
  const scale = Math.max(...XtX.map((row) => Math.max(...row.map(Math.abs))), 1e-12);
  const solve = (rhs, ridged) => {
    const aug = XtX.map((row, a) => [...row, rhs[a]]);
    if (ridged) {
      for (let r = 0; r < k; r++) aug[r][r] += 1e-8 * scale;
    }
    for (let col = 0; col < k; col++) {
      let pivot = col;
      for (let r = col + 1; r < k; r++) {
        if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
      }
      if (Math.abs(aug[pivot][col]) < 1e-12 * scale) {
        throw new Error('Regressors are exactly collinear; cannot fit a stable model');
      }
      [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
      if (Math.abs(aug[col][col]) < 1e-12 * scale) {
        throw new Error('Regressors are exactly collinear; cannot fit a stable model');
      }
      for (let r = col + 1; r < k; r++) {
        const f = aug[r][col] / aug[col][col];
        for (let c = col; c <= k; c++) aug[r][c] -= f * aug[col][c];
      }
    }
    const x = new Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) {
      let s = aug[i][k];
      for (let j = i + 1; j < k; j++) s -= aug[i][j] * x[j];
      x[i] = s / aug[i][i];
    }
    return x;
  };

  // A near-singular system is retried once with a ridge and flagged, so the
  // caller can warn that the coefficients are not tightly identified.
  const trySolve = (rhs) => {
    try {
      return solve(rhs, false);
    } catch (e) {
      if (!/collinear/.test(e.message)) throw e;
      regularized = true;
      return solve(rhs, true);
    }
  };

  const beta = trySolve(Xty);
  const inv = Array.from({ length: k }, (_, j) => trySolve(Array.from({ length: k }, (_, i) => (i === j ? 1 : 0))));

  const fitted = new Array(n);
  const resid = new Array(n);
  let rss = 0;
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let a = 0; a < k; a++) f += X[i][a] * beta[a];
    fitted[i] = f;
    resid[i] = y[i] - f;
    rss += resid[i] * resid[i];
  }
  const my = mean(y);
  let tss = 0;
  for (let i = 0; i < n; i++) tss += (y[i] - my) * (y[i] - my);
  const df = n - k;
  // A fit with essentially no residual variance (an exactly collinear or
  // duplicated design) has no error variance to estimate, so t-statistics
  // and p-values are undefined; report them as such instead of dividing by
  // a near-zero sigma and pretending the fit is hyper-significant.
  const degenerate = tss > 0 && rss <= 1e-10 * tss;
  const sigma2 = degenerate ? NaN : rss / df;
  const se = degenerate
    ? new Array(k).fill(NaN)
    : inv.map((col, j) => Math.sqrt(Math.max(sigma2 * col[j], 0)));
  const t = degenerate
    ? new Array(k).fill(NaN)
    : beta.map((b, j) => (se[j] > 0 ? b / se[j] : NaN));
  const p = t.map((tt) => (Number.isFinite(tt) ? tTestPValue(tt, df) : NaN));
  const r2 = tss > 0 ? 1 - rss / tss : 0;

  return { beta, fitted, resid, rss, r2, sigma: Math.sqrt(sigma2), se, t, p, df, regularized, degenerate };
}

// ---------------------------------------------------------------------------
// Causal relationship builder
// ---------------------------------------------------------------------------

const DEFAULT_MAX_LAG = 12;
const DEFAULT_ALPHA = 0.05;

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

// ---------------------------------------------------------------------------
// Intervention simulator
// ---------------------------------------------------------------------------

/** Baseline projection used when no forecaster is supplied: seasonal naive + drift. */
export function naiveBaseline(values, horizon, seasonLength) {
  const n = values.length;
  if (n === 0) return new Array(horizon).fill(0);
  let drift = 0;
  if (n >= 2) {
    const k = Math.min(n - 1, Math.max(3, Math.floor(n / 4)));
    drift = (values[n - 1] - values[n - 1 - k]) / k;
  }
  if (seasonLength && seasonLength >= 2 && n >= 2 * seasonLength) {
    // Seasonal naive plus drift: repeat the last cycle and extend the trend
    // over the span from each phase's last observation to the forecast point.
    return Array.from({ length: horizon }, (_, h) => {
      const phase = h % seasonLength;
      const base = values[n - seasonLength + phase];
      const span = seasonLength - phase + h;
      return base + drift * span;
    });
  }
  return Array.from({ length: horizon }, (_, h) => values[n - 1] + drift * (h + 1));
}

/**
 * Answer "what if we changed X?" using how the target historically responded
 * to that variable. The response is a distributed-lag model (an impulse
 * response), so a change in X is propagated to Y over time instead of being
 * applied as a single unexplained multiplier.
 */
export class InterventionSimulator {
  /**
   * @param {Object<string, number[]>} series named aligned series (at minimum the variable and target)
   * @param {Object} [options]
   * @param {Function} [options.forecaster] async (values, horizon) => { point, lower, upper } for the no-intervention baseline
   */
  constructor(series, options = {}) {
    this.series = series;
    this.forecaster = options.forecaster ?? null;
    this.responses = new Map();
  }

  /**
   * Fit a distributed-lag response of `target` to `variable`.
   *
   * @param {string} variable cause column
   * @param {string} target effect column
   * @param {Object} [options]
   * @param {number} [options.maxLag] how many lagged terms to include (default 12)
   * @param {number} [options.seasonLength] deseasonalize both series first
   * @returns {{ coefficients: number[], lags: number[], sigma: number, r2: number, cumulative: number, n: number }}
   */
  fitResponse(variable, target, options = {}) {
    const key = `${variable}->${target}:${options.maxLag ?? DEFAULT_MAX_LAG}:${options.seasonLength ?? 'none'}`;
    const cached = this.responses.get(key);
    if (cached) return cached;
    const x = removeSeasonality(detrend(this.series[variable] ?? []), options.seasonLength ?? null);
    const y = removeSeasonality(detrend(this.series[target] ?? []), options.seasonLength ?? null);
    const maxLag = Math.max(1, Math.min(options.maxLag ?? DEFAULT_MAX_LAG, Math.floor(Math.min(x.length, y.length) / 5)));
    const start = maxLag;
    const X = [];
    const Y = [];
    for (let t = start; t < y.length; t++) {
      const row = [1];
      for (let L = 0; L <= maxLag; L++) row.push(x[t - L]);
      X.push(row);
      Y.push(y[t]);
    }
    const fit = ols(X, Y);
    const coefficients = fit.beta.slice(1); // drop intercept
    const result = {
      coefficients,
      lags: coefficients.map((_, i) => i),
      sigma: fit.sigma,
      r2: fit.r2,
      cumulative: coefficients.reduce((a, b) => a + b, 0),
      n: Y.length,
      maxLag,
    };
    this.responses.set(key, result);
    return result;
  }

  /**
   * Simulate an intervention: change `variable` by `change` units for
   * `duration` steps starting at `start`, and see what happens to `target`
   * relative to the world where nothing changed.
   *
   * @param {Object} params
   * @param {string} params.variable cause to intervene on
   * @param {string} params.target series that responds
   * @param {number} params.change units to add (negative lowers it)
   * @param {number} [params.start] step index of the change (default: first future step)
   * @param {number} [params.duration] how long the change persists (default: whole horizon)
   * @param {number} [params.horizon] steps to simulate (default: 24)
   * @param {number} [params.maxLag] response lag depth
   * @param {number} [params.seasonLength] for deseasonalizing the response fit
   * @returns {Promise<Object>} simulation result
   */
  async simulate(params) {
    const { variable, target, change } = params;
    if (!this.series[variable]) throw new Error(`Unknown variable "${variable}"`);
    if (!this.series[target]) throw new Error(`Unknown target "${target}"`);
    if (!Number.isFinite(change)) throw new Error('Intervention needs a numeric --change');

    const horizon = Math.max(1, Math.min(params.horizon ?? 24, 500));
    const start = Math.max(0, params.start ?? 0);
    const duration = Math.max(1, params.duration ?? horizon);
    const response = this.fitResponse(variable, target, {
      maxLag: params.maxLag,
      seasonLength: params.seasonLength,
    });
    const history = this.series[target];

    let baseline;
    let band;
    if (this.forecaster) {
      const f = await this.forecaster(history, horizon);
      baseline = f.point;
      band = { lower: f.lower, upper: f.upper, sigma: f.sigma ?? null };
    } else {
      baseline = naiveBaseline(history, horizon, params.seasonLength);
      const s = stdDev(history);
      band = { lower: null, upper: null, sigma: s };
    }

    // Convolve the intervention pulse with the impulse response.
    const counterfactual = baseline.slice();
    const overlap = new Array(horizon).fill(0);
    for (let h = 0; h < horizon; h++) {
      let delta = 0;
      let active = 0;
      for (let L = 0; L < response.coefficients.length; L++) {
        const pulseStep = h - L; // index into the intervention timeline
        if (pulseStep >= start && pulseStep < start + duration) {
          delta += change * response.coefficients[L];
          active++;
        }
      }
      counterfactual[h] += delta;
      overlap[h] = active;
    }

    const sigmaResp = response.sigma;
    const difference = counterfactual.map((v, h) => ({ step: h + 1, delta: v - baseline[h] }));
    let cumulative = 0;
    for (const d of difference) cumulative += d.delta;

    // Uncertainty: baseline band (if any) widened by the response model's
    // residual noise over the number of overlapping impulse terms.
    const lower = new Array(horizon);
    const upper = new Array(horizon);
    for (let h = 0; h < horizon; h++) {
      const extra = sigmaResp * Math.sqrt(Math.max(overlap[h], 1));
      const lo = band.lower ? band.lower[h] : baseline[h] - 1.28 * (band.sigma ?? sigmaResp);
      const hi = band.upper ? band.upper[h] : baseline[h] + 1.28 * (band.sigma ?? sigmaResp);
      lower[h] = lo + (counterfactual[h] - baseline[h]) - extra;
      upper[h] = hi + (counterfactual[h] - baseline[h]) + extra;
    }

    const peak = difference.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a), difference[0]);
    const warnings = [];
    if (response.r2 < 0.3) {
      warnings.push({
        type: 'WEAK_RESPONSE_MODEL',
        message: `The historical response model explains only ${Math.round(response.r2 * 100)}% of the variance in ${target}; treat the magnitude as indicative, not precise.`,
      });
    }
    const xs = this.series[variable];
    const observedRange = Math.max(...xs) - Math.min(...xs);
    if (observedRange > 0 && Math.abs(change) > observedRange) {
      warnings.push({
        type: 'EXTRAPOLATION',
        message: `The requested change (${fmtNum(change)}) is larger than anything observed in ${variable} (range ${fmtNum(observedRange)}); the response is extrapolated beyond experience.`,
      });
    }

    return {
      variable,
      target,
      change,
      lagDepth: response.coefficients.length - 1,
      baseline: baseline.map((v, h) => ({ step: h + 1, value: v })),
      counterfactual: counterfactual.map((v, h) => ({ step: h + 1, value: v })),
      difference,
      cumulativeImpact: cumulative,
      peakImpact: peak.delta,
      peakStep: peak.step,
      multiplier: change !== 0 ? cumulative / change : 0,
      uncertainty: { lower, upper, sigmaResponse: sigmaResp, sigmaBaseline: band.sigma ?? null },
      responseFunction: response.coefficients.map((c, L) => ({ lag: L, coefficient: c })),
      responseFit: { r2: response.r2, n: response.n, cumulative: response.cumulative },
      interpretation: this._interpret(params, cumulative, peak),
      warnings,
    };
  }

  _interpret(params, cumulative, peak) {
    const dir = cumulative >= 0 ? 'higher' : 'lower';
    return `Changing ${params.variable} by ${fmtNum(params.change)} unit(s) for ${params.duration ?? 'the whole'} step(s) ` +
      `leaves ${params.target} ${dir} by ${fmtNum(Math.abs(cumulative))} cumulative units ` +
      `(peak ${fmtNum(Math.abs(peak.delta))} at step ${peak.step}), based on ${this.series[params.target].length} historical observations.`;
  }

  /**
   * Find natural experiments: points in history where `variable` jumped
   * sharply, so the target's following behaviour can be read as an observed
   * response rather than a simulated one.
   *
   * @param {Object} params
   * @param {string} params.variable cause column
   * @param {string} params.target effect column
   * @param {number} [params.window] steps after the event to measure (default 6)
   * @param {number} [params.minMagnitude] multiple of the |diff| MAD that counts as a jump (default 4)
   * @param {number} [options.seasonLength] deseasonalize before detecting jumps
   * @param {number} [params.maxEvents] cap on returned events (default 10)
   * @returns {Object[]} candidate events, most striking first
   */
  findNaturalExperiments(params) {
    const { variable, target } = params;
    if (!this.series[variable] || !this.series[target]) throw new Error('findNaturalExperiments needs both variable and target');
    const window = Math.max(3, Math.min(params.window ?? 6, 60));
    const maxEvents = Math.max(1, params.maxEvents ?? 10);
    const xs = removeSeasonality(detrend(this.series[variable]), params.seasonLength ?? null);
    const ys = removeSeasonality(detrend(this.series[target]), params.seasonLength ?? null);
    const n = Math.min(xs.length, ys.length);
    if (n < 3 * window + 2) return [];

    const diffs = [];
    for (let i = 1; i < n; i++) diffs.push(Math.abs(xs[i] - xs[i - 1]));
    const sorted = [...diffs].sort((a, b) => a - b);
    const mad = sorted[Math.floor(sorted.length / 2)] || 1;
    const minMagnitude = (params.minMagnitude ?? 4) * mad;

    const candidates = [];
    for (let i = window; i < n - window; i++) {
      const jump = xs[i] - xs[i - 1];
      if (Math.abs(jump) < minMagnitude) continue;
      const pre = ys.slice(i - window, i);
      const post = ys.slice(i, i + window);
      const preMean = mean(pre);
      const postMean = mean(post);
      // Least-squares slope over the pre-window: far more stable than the
      // endpoint difference, which a single noisy point can derail.
      let drift = 0;
      if (window >= 3) {
        const xs = pre.map((_, j) => j);
        const mx = mean(xs);
        let sxy = 0;
        let sxx = 0;
        for (let j = 0; j < window; j++) {
          sxy += (xs[j] - mx) * (pre[j] - preMean);
          sxx += (xs[j] - mx) * (xs[j] - mx);
        }
        const slope = sxx > 0 ? sxy / sxx : 0;
        drift = slope * window;
      }
      const expected = preMean + drift;
      const observed = postMean;
      const response = observed - expected;
      const se = Math.sqrt((variance(pre) + variance(post)) / window) || 1e-9;
      const t = response / se;
      const pValue = tTestPValue(t, 2 * window - 2);
      candidates.push({
        index: i,
        changeInX: this.series[variable][i] - this.series[variable][i - 1],
        changeInXDetrended: jump,
        preMean,
        postMean,
        expected,
        observed,
        response,
        responsePerUnit: Math.abs(jump) > 0 ? response / jump : NaN,
        se,
        tStat: t,
        pValue,
        significant: Number.isFinite(pValue) && pValue < 0.05,
      });
    }
    candidates.sort((a, b) => Math.abs(b.tStat) - Math.abs(a.tStat));
    return candidates.slice(0, maxEvents);
  }
}

// ---------------------------------------------------------------------------
// External factor integration
// ---------------------------------------------------------------------------

/**
 * Temporal decay kernels for event effects. Each maps a step index to the
 * fraction of the event's full effect still in force.
 */
export const DECAY_KERNELS = {
  /** Full effect for the event window, then nothing. */
  box: (t, start, duration) => (t >= start && t < start + duration ? 1 : 0),
  /** Sharp onset, exponential decay (tau = duration / 3). */
  exponential: (t, start, duration) => (t >= start ? Math.exp(-(t - start) / Math.max(duration / 3, 0.5)) : 0),
  /** Ramp up to a peak mid-event, then ramp down. */
  triangular: (t, start, duration) => {
    if (t < start || t >= start + duration) return 0;
    const mid = start + duration / 2;
    return t < mid ? (t - start) / Math.max(mid - start, 0.5) : (start + duration - t) / Math.max(t - mid, 0.5);
  },
  /** Symmetric bell around the event centre. */
  gaussian: (t, start, duration) => {
    const sigma = Math.max(duration / 4, 0.5);
    const centre = start + duration / 2;
    return Math.exp(-0.5 * Math.pow((t - centre) / sigma, 2));
  },
  /** Permanent level shift approached smoothly (tau = duration / 3). */
  step: (t, start, duration) => (t >= start ? 1 - Math.exp(-(t - start) / Math.max(duration / 3, 0.5)) : 0),
};

/**
 * Import known external events (holidays, promotions, weather readings) and
 * measure their effect on a target series with an explicit, inspectable
 * regression rather than a trained black box.
 */
export class ExternalFactorIntegrator {
  /**
   * @param {number[]} [times] observation timestamps in ms; enables date -> index mapping for events
   */
  constructor(times) {
    this.times = times && Array.isArray(times) ? times : null;
    this.factors = new Map();
    this.lastFit = null;
  }

  /** Look up the step index of a timestamp. Returns null when the date falls before the observations. */
  timeToIndex(when) {
    if (typeof when === 'number' && Number.isInteger(when)) return when;
    if (!this.times) throw new Error('This integrator was built without timestamps; pass a step index instead of a date');
    const ms = typeof when === 'string' ? Date.parse(when) : when;
    if (!Number.isFinite(ms)) throw new Error(`Cannot parse date "${when}"`);
    if (ms < this.times[0]) return null; // before the first observation: no effect to estimate
    let lo = 0;
    let hi = this.times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Register an event factor (a holiday, a promotion, a storm).
   *
   * @param {string} name factor label
   * @param {Object} params
   * @param {number|string} params.start step index or date when the event begins
   * @param {number} [params.duration] steps the event spans (default 1)
   * @param {string} [params.decay] kernel: box | exponential | triangular | gaussian | step (default box)
   * @param {number} [params.effect] expected effect size; used as a prior scale, the regression still estimates its own coefficient
   */
  addEventFactor(name, params) {
    const start = this.timeToIndex(params.start);
    const duration = Math.max(1, params.duration ?? 1);
    const decay = DECAY_KERNELS[params.decay] ? params.decay : 'box';
    this.factors.set(name, {
      name,
      type: 'event',
      start: start ?? 0,
      outOfRange: start === null,
      duration,
      decay,
      effect: Number.isFinite(params.effect) ? params.effect : null,
      // Out-of-range events build an all-zero column on purpose, so the fit
      // reports them as unidentifiable instead of silently clamping them onto
      // the first observation.
      build: start === null
        ? (n) => new Array(n).fill(0)
        : (n) => Array.from({ length: n }, (_, t) => DECAY_KERNELS[decay](t, start, duration)),
    });
    return this;
  }

  /**
   * Register a numeric covariate aligned to the target (a weather series, a
   * price series). Shorter series are padded with their mean; longer ones
   * are truncated.
   */
  addSeriesFactor(name, values, options = {}) {
    if (!Array.isArray(values)) throw new Error(`Series factor "${name}" needs a numeric array`);
    this.factors.set(name, {
      name,
      type: 'series',
      build: (n) => {
        const v = values.slice(0, n);
        const m = mean(v.filter(Number.isFinite));
        const out = v.map((x) => (Number.isFinite(x) ? x : m));
        while (out.length < n) out.push(m);
        return out;
      },
    });
    return this;
  }

  /** Import many event factors at once: [{ name, start, duration, decay, effect }]. */
  importEvents(events) {
    if (!Array.isArray(events)) throw new Error('importEvents needs an array of event descriptors');
    for (const e of events) {
      if (!e.name) throw new Error('Every event needs a name');
      this.addEventFactor(e.name, e);
    }
    return this;
  }

  /** Import event factors from a JSON file's parsed contents ({ events: [...] } or [...]). */
  importEventsJson(parsed) {
    const list = Array.isArray(parsed) ? parsed : parsed?.events;
    if (!Array.isArray(list)) throw new Error('Expected an array or { events: [...] }');
    return this.importEvents(list);
  }

  /**
   * Import series factors from a wide CSV (timestamp plus one column per
   * factor). Factors are aligned to the target by row order.
   */
  importCsv(text, options = {}) {
    const parsed = parseWideCsv(text, options);
    for (const col of parsed.valueColumns) this.addSeriesFactor(col, parsed.columns[col]);
    return this;
  }

  /** Names of all registered factors. */
  factorNames() {
    return Array.from(this.factors.keys());
  }

  /**
   * Build the design matrix for the first n steps. When a season length is
   * given, Fourier terms of the daily cycle enter as controls, so event
   * effects are measured against a seasonal baseline instead of raw noise.
   */
  designMatrix(n, options = {}) {
    const cols = [];
    const names = [];
    cols.push(new Array(n).fill(1)); // intercept
    names.push('(intercept)');
    if (options.trend !== false) {
      cols.push(Array.from({ length: n }, (_, t) => t));
      names.push('(trend)');
    }
    const seasonLength = options.seasonLength ?? null;
    const harmonics = Math.max(1, Math.min(options.harmonics ?? 3, 6));
    if (seasonLength && seasonLength >= 2) {
      for (let k = 1; k <= harmonics; k++) {
        cols.push(Array.from({ length: n }, (_, t) => Math.sin((2 * Math.PI * k * t) / seasonLength)));
        names.push(`(fourier sin k=${k})`);
        cols.push(Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * k * t) / seasonLength)));
        names.push(`(fourier cos k=${k})`);
      }
    }
    for (const factor of this.factors.values()) {
      cols.push(factor.build(n));
      names.push(factor.name);
    }
    return { X: Array.from({ length: n }, (_, i) => cols.map((c) => c[i])), names };
  }

  /**
   * Fit the factor model to a target series and keep the result for
   * importance ranking and projection.
   *
   * @param {number[]} targetValues series to explain
   * @param {Object} [options]
   * @param {boolean} [options.trend=true] include a linear trend term
   * @param {number} [options.seasonLength] season length; Fourier controls for the cycle are added so events are measured against a seasonal baseline
   * @param {number} [options.harmonics=3] number of Fourier harmonics
   * @returns {Object} fit summary with per-factor statistics
   */
  fit(targetValues, options = {}) {
    const n = targetValues.length;
    let { X, names } = this.designMatrix(n, options);

    // A factor that never varies (e.g. a holiday outside the observation
    // window) has an unidentifiable coefficient and makes the whole system
    // singular. Drop those and say so, rather than emitting silence.
    const dropped = [];
    const keep = names.map((name, j) => {
      if (name.startsWith('(')) return true;
      const col = X.map((row) => row[j]);
      const sd = stdDev(col);
      if (!Number.isFinite(sd) || sd < 1e-12) {
        dropped.push(name);
        return false;
      }
      return true;
    });
    if (dropped.length > 0) {
      X = X.map((row) => row.filter((_, j) => keep[j]));
      names = names.filter((_, j) => keep[j]);
    }

    const result = ols(X, targetValues.slice(0, n));
    const controlSet = new Set(names.filter((name) => name.startsWith('(')));
    const perFactor = names.map((name, j) => {
      const col = X.map((row) => row[j]);
      const sd = stdDev(col);
      return {
        name,
        coefficient: result.beta[j],
        stdError: result.se[j],
        tStat: result.t[j],
        pValue: result.p[j],
        significant: Number.isFinite(result.p[j]) && result.p[j] < (options.alpha ?? DEFAULT_ALPHA),
        // Impact magnitude: how much the factor moves the target across its
        // own typical range. This is the importance ranking quantity.
        impact: Number.isFinite(sd) ? Math.abs(result.beta[j] * sd) : 0,
        type: controlSet.has(name) ? 'control' : (this.factors.has(name) ? this.factors.get(name).type : 'control'),
      };
    });
    this.lastFit = {
      names,
      coefficients: result.beta,
      r2: result.r2,
      sigma: result.sigma,
      df: result.df,
      n,
      regularized: result.regularized,
      dropped,
      seasonLength: options.seasonLength ?? null,
      factors: perFactor,
    };
    return this.lastFit;
  }

  /**
   * Rank factors by impact magnitude (absolute effect on the target across
   * the factor's observed range), with significance alongside.
   */
  rankFactors() {
    if (!this.lastFit) throw new Error('Call fit(targetValues) before ranking factors');
    return this.lastFit.factors
      .filter((f) => f.type !== 'control')
      .slice()
      .sort((a, b) => b.impact - a.impact);
  }

  /** Predict the target from the fitted model over the first n steps. */
  predict(n) {
    if (!this.lastFit) throw new Error('Call fit(targetValues) before predicting');
    const { X } = this.designMatrix(n, {
      trend: this.lastFit.names.includes('(trend)'),
      seasonLength: this.lastFit.seasonLength,
    });
    return X.map((row) => row.reduce((s, v, j) => {
      const idx = this.lastFit.names[j];
      return s + (idx !== undefined ? v * this.lastFit.coefficients[j] : 0);
    }, 0));
  }

  /**
   * Apply a factor's fitted effect to a baseline path (e.g. a forecast),
   * honouring its decay kernel. Useful for "add next week's promotion to the
   * forecast" without refitting anything.
   */
  applyFactor(baseline, name, start, duration = 1, decay = 'box') {
    if (!this.lastFit) throw new Error('Call fit(targetValues) before applying factor effects');
    const factor = this.lastFit.factors.find((f) => f.name === name);
    const coef = factor ? factor.coefficient : 0;
    const kernel = DECAY_KERNELS[decay] ?? DECAY_KERNELS.box;
    const n = baseline.length;
    const out = baseline.slice();
    for (let t = 0; t < n; t++) out[t] += coef * kernel(t, start, duration);
    return out;
  }
}

/**
 * A small local holiday calendar. Fixed arithmetic only - no network, no
 * timezone assumptions beyond UTC, and no claim of completeness. Use it as a
 * starting set and add your own events with importEvents.
 */
export function holidayCalendar(options = {}) {
  const from = options.from ?? new Date().getUTCFullYear();
  const to = options.to ?? from;
  if (to < from) throw new Error('holidayCalendar: "to" must be >= "from"');
  const events = [];

  // Fixed-date holidays.
  const fixed = [
    ['new-year', '01-01', 1, 'box'],
    ['valentines', '02-14', 3, 'gaussian'],
    ['easter-monday', null, 2, 'gaussian'],
    ['juneteenth', '06-19', 1, 'box'],
    ['us-independence', '07-04', 1, 'box'],
    ['halloween', '10-31', 3, 'triangular'],
    ['christmas', '12-25', 3, 'box'],
    ['new-years-eve', '12-31', 2, 'triangular'],
  ];
  // US floating holidays (nth weekday of a month).
  const nthWeekday = (year, month, weekday, n) => {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, month, d));
      if (dt.getUTCMonth() !== month) break;
      if (dt.getUTCDay() === weekday) {
        count++;
        if (count === n) return dt;
      }
    }
    return null;
  };
  // Anonymous (Gregorian) Easter via Meeus/Jones/Butcher.
  const easter = (year) => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month, day));
  };

  for (let year = from; year <= to; year++) {
    for (const [name, mmdd, duration, decay] of fixed) {
      if (!mmdd) continue;
      events.push({ name: `${name}-${year}`, start: `${year}-${mmdd}`, duration, decay });
    }
    const em = easter(year);
    if (em) events.push({ name: `easter-monday-${year}`, start: em.toISOString().slice(0, 10), duration: 2, decay: 'gaussian' });
    const mlk = nthWeekday(year, 0, 1, 3);
    const presidents = nthWeekday(year, 1, 1, 3);
    const memorial = nthWeekday(year, 4, 1, -1);
    const labor = nthWeekday(year, 8, 1, 1);
    const columbus = nthWeekday(year, 9, 1, 2);
    const veterans = nthWeekday(year, 10, 1, 4);
    const thanks = nthWeekday(year, 10, 4, 4);
    const fridayAfter = thanks ? new Date(thanks.getTime() + 86400000) : null;
    const cyber = fridayAfter ? new Date(fridayAfter.getTime() + 86400000) : null;
    for (const [name, dt, duration, decay] of [
      ['mlk-day', mlk, 1, 'box'],
      ['presidents-day', presidents, 1, 'box'],
      ['memorial-day', memorial, 1, 'box'],
      ['labor-day', labor, 1, 'box'],
      ['columbus-day', columbus, 1, 'box'],
      ['veterans-day', veterans, 1, 'box'],
      ['thanksgiving', thanks, 2, 'triangular'],
      ['black-friday', fridayAfter, 3, 'triangular'],
      ['cyber-monday', cyber, 4, 'exponential'],
    ]) {
      if (dt) events.push({ name: `${name}-${year}`, start: dt.toISOString().slice(0, 10), duration, decay });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Counterfactual analysis (difference-in-differences)
// ---------------------------------------------------------------------------

/**
 * Compare what happened against what would have happened, using a control
 * group of similar periods and a difference-in-differences estimate. The
 * counterfactual is "the treated series, growing like the control group did".
 */
export class CounterfactualAnalyzer {
  /**
   * Build a control group from candidate windows by similarity of the
   * pre-event period (level, slope and volatility). Each chosen control is
   * realigned to the event: index 0 of a returned control is the first
   * pre-event step, so controls are directly comparable to the treated
   * series' own pre/post structure.
   *
   * @param {Object} params
   * @param {number[]} params.treated the series that received the intervention
   * @param {number[][]} [params.candidates] control candidate series (other units, aligned to treated)
   * @param {number} [params.eventIndex] index of the intervention (default: middle of the treated series)
   * @param {number} [params.preWindow] steps before the event to match on (default 12)
   * @param {number} [params.postWindow] steps after the event to compare (default 12)
   * @param {number} [params.k] number of controls to keep (default 3)
   * @param {boolean} [params.sameSeries] build candidates from other windows of the treated series itself (default true when no candidates given)
   * @returns {{ controls: number[][], chosen: Object[], eventIndex: number, preWindow: number, postWindow: number }}
   */
  buildControlGroup(params) {
    const treated = params.treated;
    if (!Array.isArray(treated) || treated.length < 20) throw new Error('buildControlGroup needs a treated series of at least 20 points');
    const preWindow = Math.max(3, Math.min(params.preWindow ?? 12, Math.floor(treated.length / 3)));
    const postWindow = Math.max(3, Math.min(params.postWindow ?? 12, Math.floor(treated.length / 3)));
    const eventIndex = Number.isInteger(params.eventIndex) ? params.eventIndex : Math.floor(treated.length / 2);
    if (eventIndex - preWindow < 0 || eventIndex + postWindow > treated.length) {
      throw new Error('Event index leaves no room for the requested pre/post windows');
    }
    const k = Math.max(1, params.k ?? 3);
    const span = preWindow + postWindow;

    const profile = (series, ev) => {
      const pre = series.slice(ev - preWindow, ev);
      const m = mean(pre);
      const slope = pre.length > 1 ? (pre[pre.length - 1] - pre[0]) / (pre.length - 1) : 0;
      const sd = stdDev(pre) || 1e-9;
      return { level: m, slope, volatility: sd, norm: pre.map((v) => (v - m) / sd) };
    };

    const target = profile(treated, eventIndex);
    const scored = [];

    const consider = (series, label, ev) => {
      if (ev - preWindow < 0 || ev + postWindow > series.length) return;
      const p = profile(series, ev);
      let dist = 0;
      const n = Math.min(p.norm.length, target.norm.length);
      for (let i = 0; i < n; i++) {
        const d = p.norm[i] - target.norm[i];
        dist += d * d;
      }
      dist = Math.sqrt(dist / n);
      // Penalize different trend and volatility so controls behave like the
      // treated unit, not just look like it.
      dist += 0.5 * Math.abs(p.slope - target.slope) / (Math.abs(target.slope) + 1e-9);
      dist += 0.3 * Math.abs(p.volatility - target.volatility) / (target.volatility + 1e-9);
      scored.push({
        label,
        distance: dist,
        eventIndex: ev,
        profile: p,
        window: series.slice(ev - preWindow, ev + postWindow),
      });
    };

    const candidates = params.candidates ?? null;
    if (candidates) {
      candidates.forEach((c, i) => {
        if (!Array.isArray(c) || c.length < span) return;
        consider(c, `unit-${i + 1}`, Math.floor(c.length / 2));
      });
    }
    if (params.sameSeries || !candidates || scored.length === 0) {
      // Other windows of the same series, excluding anything overlapping the event.
      for (let ev = preWindow; ev + postWindow <= treated.length; ev++) {
        if (Math.abs(ev - eventIndex) < span) continue;
        consider(treated, `window@${ev}`, ev);
      }
    }
    if (scored.length === 0) throw new Error('No usable control candidates; try smaller windows or supply other units');

    scored.sort((a, b) => a.distance - b.distance);
    const chosen = scored.slice(0, k);
    return {
      controls: chosen.map((c) => c.window),
      chosen: chosen.map(({ label, distance, eventIndex: ev, profile }) => ({ label, distance, eventIndex: ev, profile })),
      target,
      preWindow,
      postWindow,
      eventIndex,
    };
  }

  /**
   * Run a difference-in-differences comparison.
   *
   * @param {Object} params
   * @param {number[]} params.treated series that received the intervention
   * @param {number[][]} [params.controls] control series (same length as treated preferred; see buildControlGroup)
   * @param {number} [params.eventIndex] step where the intervention happened
   * @param {number} [params.preWindow] steps before the event (default 12)
   * @param {number} [params.postWindow] steps after the event (default 12)
   * @param {number} [params.alpha] significance threshold (default 0.05)
   * @returns {Object} counterfactual result
   */
  run(params) {
    const treated = params.treated;
    if (!Array.isArray(treated) || treated.length < 20) throw new Error('Counterfactual needs a treated series of at least 20 points');
    const preWindow = Math.max(3, Math.min(params.preWindow ?? 12, Math.floor(treated.length / 3)));
    const postWindow = Math.max(3, Math.min(params.postWindow ?? 12, Math.floor(treated.length / 3)));
    const eventIndex = Number.isInteger(params.eventIndex) ? params.eventIndex : Math.floor(treated.length / 2);
    if (eventIndex - preWindow < 0 || eventIndex + postWindow > treated.length) {
      throw new Error('Event index leaves no room for the requested pre/post windows');
    }
    const alpha = params.alpha ?? DEFAULT_ALPHA;
    const span = preWindow + postWindow;
    // Controls may be either full series aligned to the treated timeline, or
    // event-aligned windows of length preWindow + postWindow (as returned by
    // buildControlGroup). Both are normalized to pre/post slices here.
    const controls = (params.controls ?? [])
      .filter((c) => Array.isArray(c) && c.length >= span)
      .map((c) => (c.length >= eventIndex + postWindow
        ? { pre: c.slice(eventIndex - preWindow, eventIndex), post: c.slice(eventIndex, eventIndex + postWindow) }
        : { pre: c.slice(0, preWindow), post: c.slice(preWindow, span) }));

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

// ---------------------------------------------------------------------------
// Formatting helpers (shared with the CLI and the HTML views)
// ---------------------------------------------------------------------------

export function fmtNum(v, digits = 3) {
  if (!Number.isFinite(v)) return 'n/a';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(2);
  return Number(v.toFixed(digits)).toString();
}

export function fmtP(v) {
  if (!Number.isFinite(v)) return 'n/a';
  if (v < 1e-12) return '<1e-12';
  if (v < 1e-4) return v.toExponential(2);
  return v.toFixed(4);
}
