/**
 * ForecastLab Causal Module - Statistical Utilities
 * 
 * Exact p-values via incomplete beta, Pearson correlation, OLS regression,
 * detrending, and seasonal removal. All classical statistics, no black boxes.
 */

/** Log gamma function approximation (Numerical Recipes). */
export function gammaln(xx) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  const x = xx;
  const y = xx + 5.5;
  const tmp = y - (x + 0.5) * Math.log(y);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / (x + j + 1);
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Continued fraction for incomplete beta (Numerical Recipes). */
export function betacf(a, b, x) {
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
export function removeSeasonality(values, seasonLength) {
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

/** Format numbers for display. */
export function fmtNum(v, digits = 3) {
  if (!Number.isFinite(v)) return 'n/a';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(2);
  return Number(v.toFixed(digits)).toString();
}

/** Format p-values for display. */
export function fmtP(v) {
  if (!Number.isFinite(v)) return 'n/a';
  if (v < 1e-12) return '<1e-12';
  if (v < 1e-4) return v.toExponential(2);
  return v.toFixed(4);
}
