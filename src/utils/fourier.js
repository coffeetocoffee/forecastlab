// Fourier terms for capturing complex seasonality patterns.
// Still classical statistics (GLM regression), NOT machine learning.
// 
// Fouries capture periodic patterns by decomposing them into sine/cosine waves.
// Can handle multiple overlapping seasonalities simultaneously (e.g., daily + weekly in hourly data).

/**
 * Calculate Fourier terms for a single season length.
 * @param {number} t - Time index (0-based)
 * @param {number} m - Season length (e.g., 24 for hourly with daily cycle)
 * @param {number} K - Number of harmonics to include
 * @returns {number[]} Array of 2*K Fourier terms: [sin(2πt/m), cos(2πt/m), sin(4πt/m), cos(4πt/m), ...]
 */
export function fourierTerm(t, m, K = 1) {
  const terms = [];
  for (let k = 1; k <= K; k++) {
    const omega = (2 * Math.PI * k) / m;
    terms.push(Math.sin(omega * t));
    terms.push(Math.cos(omega * t));
  }
  return terms;
}

/**
 * Generate Fourier terms for a full time series.
 * @param {Array<number>} values - Time series values (length n)
 * @param {number} m - Season length(s)
 * @param {Object} options - Options
 * @param {number} [options.K=1] - Default harmonics per seasonality
 * @returns {Object} { matrix, seasonLengths, harmonics } where matrix is n × (2*K*seasonalities)
 */
export function fourierFeatures(values, m, options = {}) {
  const { K = 1 } = options;
  const n = values.length;
  
  // Handle both single season length and array of season lengths
  const seasonLengths = Array.isArray(m) ? m : [m];
  const totalHarmonics = seasonLengths.reduce((sum, sl) => sum + K, 0);
  const numTerms = totalHarmonics * 2;
  
  const matrix = new Array(n);
  for (let i = 0; i < n; i++) {
    matrix[i] = new Float64Array(numTerms);
    let idx = 0;
    for (const sl of seasonLengths) {
      const terms = fourierTerm(i, sl, K);
      for (let j = 0; j < terms.length; j++) {
        matrix[i][idx + j] = terms[j];
      }
      idx += terms.length;
    }
  }
  
  return {
    matrix,
    seasonLengths,
    harmonics: K,
    numTerms,
  };
}

/**
 * Get Fourier terms for forecast horizon steps ahead.
 * @param {Object} lastObs - Last observations info
 * @param {number} lastObs.t - Last time index (0-based)
 * @param {number} lastObs.n - Number of historical points
 * @param {number} m - Season length(s)
 * @param {number} horizon - Forecast horizon
 * @param {Object} options - Options including K
 * @returns {Object} Same structure as fourierFeatures but for forecast horizons
 */
export function fourierForecast(lastObs, m, horizon, options = {}) {
  const { K = 1 } = options;
  const startT = lastObs.t + 1;

  const seasonLengths = Array.isArray(m) ? m : [m];
  // K may be a single value or one entry per season length (as produced by autoFourier)
  const harmonics = Array.isArray(K)
    ? K
    : new Array(seasonLengths.length).fill(K);
  const numTerms = harmonics.reduce((sum, k) => sum + 2 * (k ?? 1), 0);

  const matrix = new Array(horizon);
  for (let h = 1; h <= horizon; h++) {
    const t = startT + h - 1; // forecast time indices
    matrix[h - 1] = new Float64Array(numTerms);
    let idx = 0;
    for (let s = 0; s < seasonLengths.length; s++) {
      const terms = fourierTerm(t, seasonLengths[s], harmonics[s] ?? 1);
      for (let j = 0; j < terms.length; j++) {
        matrix[h - 1][idx + j] = terms[j];
      }
      idx += terms.length;
    }
  }

  return {
    matrix,
    seasonLengths,
    harmonics,
    numTerms,
    startT,
  };
}

/**
 * Detect dominant seasonality via autocorrelation peak detection.
 * @param {Array<number>} values - Time series values
 * @param {Object} options - Detection options
 * @param {number} [options.maxLag=null] - Maximum lag to check (default: min(500, n/2))
 * @param {number} [options.minPeakHeight=0.1] - Minimum autocorrelation height to consider
 * @param {number} [options.minPeakDistance=3] - Minimum distance between peaks
 * @returns {Object} { detected: boolean, lags: [{lag, acf, confidence}], recommendedSeason }
 */
export function detectSeasonality(values, options = {}) {
  const {
    maxLag = null,
    minPeakHeight = 0.1,
    minPeakDistance = 3,
  } = options;
  
  const n = values.length;
  if (n < 10) {
    return { detected: false, lags: [], recommendedSeason: null, message: 'Need at least 10 points for seasonality detection' };
  }
  
  // Compute mean and variance
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  
  if (variance < 1e-10) {
    return { detected: false, lags: [], recommendedSeason: null, message: 'Zero variance: no seasonality possible' };
  }
  
  // Set max lag
  const maxLagValue = maxLag ?? Math.min(500, Math.floor(n / 2));
  
  // Compute autocorrelation function (ACF)
  const acf = new Array(maxLagValue);
  const confidenceInterval = 1.96 / Math.sqrt(n); // 95% CI
  
  for (let lag = 1; lag <= maxLagValue; lag++) {
    let cov = 0;
    for (let i = 0; i < n - lag; i++) {
      cov += (values[i] - mean) * (values[i + lag] - mean);
    }
    acf[lag - 1] = { lag, value: cov / ((n - lag) * variance) };
  }
  
  // Find peaks in ACF
  const peaks = [];
  for (let i = 1; i < acf.length - 1; i++) {
    const current = acf[i].value;
    const prev = acf[i - 1].value;
    const next = acf[i + 1].value;
    
    // Check if it's a local maximum
    if (current > prev && current > next) {
      // Check if it exceeds minimum height and confidence bound
      if (current > minPeakHeight && Math.abs(current) > confidenceInterval) {
        peaks.push({ ...acf[i], peakHeight: current });
      }
    }
  }
  
  // Filter peaks to maintain minimum distance
  const filteredPeaks = [];
  for (const peak of peaks) {
    if (filteredPeaks.length === 0 || peak.lag - filteredPeaks[filteredPeaks.length - 1].lag >= minPeakDistance) {
      filteredPeaks.push(peak);
    } else {
      // Replace with stronger peak
      if (peak.peakHeight > filteredPeaks[filteredPeaks.length - 1].peakHeight) {
        filteredPeaks[filteredPeaks.length - 1] = peak;
      }
    }
  }
  
  // Sort by ACF value (strongest first)
  filteredPeaks.sort((a, b) => b.value - a.value);
  
  // Determine recommended season
  let recommendedSeason = null;
  let message = '';
  
  if (filteredPeaks.length > 0) {
    recommendedSeason = filteredPeaks[0].lag;
    message = `Detected ${filteredPeaks.length} seasonality/seasonalities`;
  } else {
    message = 'No significant seasonality detected';
  }
  
  return {
    detected: filteredPeaks.length > 0,
    lags: filteredPeaks,
    recommendedSeason,
    message,
  };
}

/**
 * Create Fourier features with auto-detection of seasonality.
 * @param {Array<number>} values - Time series values
 * @param {Object} options - Detection and Fourier options
 * @param {number} [options.maxLag=500] - Max lag for seasonality detection
 * @param {number} [options.K=2] - Default harmonics for detected seasons
 * @param {number} [options.minHarmonics=1] - Min harmonics to use
 * @returns {Object} { matrix, seasonLengths, harmonics, detection }
 */
export function autoFourier(features, options = {}) {
  const { maxLag = null, K = 2, minHarmonics = 1 } = options;

  // Detect seasonality.
  // maxLag defaults to ~n/2 inside detectSeasonality: a period longer than half
  // the sample cannot be estimated and makes the design matrix near-singular.
  const detection = detectSeasonality(features.values, { maxLag });
  
  if (!detection.detected) {
    // No seasonality: return zeros or empty
    return {
      matrix: new Array(features.values.length).fill(0),
      seasonLengths: [],
      harmonics: 0,
      numTerms: 0,
      detection,
      usesFourier: false,
    };
  }
  
  // Use detected seasonality with appropriate harmonics
  const allDetectedLags = detection.lags.map(p => p.lag);
  // A lag that is a small integer multiple of a shorter detected lag is already
  // spanned by that lag's harmonics; keeping both makes the design matrix singular.
  const seasonLengths = [];
  for (const sl of [...allDetectedLags].sort((a, b) => a - b)) {
    const redundant = seasonLengths.some((s) => sl % s === 0 && sl / s <= K);
    if (!redundant) seasonLengths.push(sl);
  }
  if (seasonLengths.length === 0) seasonLengths.push(allDetectedLags[0]);
  // Add default K if not specified by user
  const harmonics = seasonLengths.map(() => K);
  
  // Build combined Fourier features
  const n = features.values.length;
  const totalTerms = seasonLengths.reduce((sum, sl, i) => sum + 2 * harmonics[i], 0);
  
  const matrix = new Array(n);
  for (let i = 0; i < n; i++) {
    matrix[i] = new Float64Array(totalTerms);
    let idx = 0;
    for (let s = 0; s < seasonLengths.length; s++) {
      const terms = fourierTerm(i, seasonLengths[s], harmonics[s]);
      for (let j = 0; j < terms.length; j++) {
        matrix[i][idx + j] = terms[j];
      }
      idx += terms.length;
    }
  }
  
  return {
    matrix,
    seasonLengths,
    harmonics,
    numTerms: totalTerms,
    detection,
    allDetectedLags,
    usesFourier: true,
  };
}

/**
 * Validate Fourier feature matrix dimensions and structure.
 * @param {Object} features - Fourier features object
 * @returns {Object} { valid: boolean, errors: [] }
 */
export function validateFourierFeatures(features) {
  const errors = [];
  
  if (!features.matrix || !Array.isArray(features.matrix)) {
    errors.push('Missing or invalid matrix');
    return { valid: false, errors };
  }
  
  if (features.matrix.length === 0) {
    errors.push('Empty matrix');
    return { valid: false, errors };
  }
  
  if (!features.seasonLengths || !Array.isArray(features.seasonLengths)) {
    errors.push('Missing seasonLengths array');
    return { valid: false, errors };
  }
  
  // harmonics may be a single value or one entry per detected season length
  const harmonics = Array.isArray(features.harmonics)
    ? features.harmonics
    : new Array(features.seasonLengths.length).fill(features.harmonics || 1);
  const expectedTerms = features.seasonLengths.reduce(
    (sum, sl, i) => sum + 2 * (harmonics[i] ?? 1), 0
  );
  
  if (features.numTerms !== expectedTerms) {
    errors.push(`Term count mismatch: expected ${expectedTerms}, got ${features.numTerms}`);
  }
  
  for (let i = 0; i < features.matrix.length; i++) {
    if (!features.matrix[i] || features.matrix[i].length !== expectedTerms) {
      errors.push(`Row ${i} has wrong dimension: expected ${expectedTerms}, got ${features.matrix[i]?.length}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}
