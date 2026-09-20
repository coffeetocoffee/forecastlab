/**
 * Uncertainty Quantification Module - ForecastLab Phase 4B
 * 
 * Advanced uncertainty analysis including cumulative intervals, joint bands,
 * density forecasts, and scenario trees.
 * 
 * @module uncertainty
 */

class MonteCarloSimulator {
    /**
     * Create Monte Carlo simulator
     * @param {Object} options - Configuration options
     * @param {number} options.nSims - Number of simulations (default: 10000)
     * @param {number} options.seed - Random seed for reproducibility
     */
    constructor(options = {}) {
        this.nSims = options.nSims || 10000;
        this.seed = options.seed || Date.now();
        this._randomState = this.seed;
    }

    /**
     * Generate pseudo-random number using linear congruential generator
     */
    _random() {
        // LCG parameters (same as MINSTD)
        this._randomState = (this._randomState * 48271) % 2147483647;
        return (this._randomState - 0.5) / 1073741823.5;
    }

    /**
     * Generate standard normal random variable using Box-Muller transform
     */
    _randomNormal() {
        const u1 = this._random();
        const u2 = this._random();
        
        // Avoid log(0)
        if (u1 === 0) return this._randomNormal();
        
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return z0;
    }

    /**
     * Simulate prediction paths for forecasting model
     */
    async simulatePaths(model, horizon, nSims = null) {
        const sims = nSims || this.nSims;
        const paths = [];

        for (let sim = 0; sim < sims; sim++) {
            let path = [];
            let state = this._getStateFromModel(model);

            for (let t = 0; t < horizon; t++) {
                // Draw random error
                const error = this._randomNormal() * model.stdDev;
                
                // Propagate forecast
                const forecast = this._getNextForecast(state, model);
                const actualWithNoise = forecast + error;
                
                path.push(actualWithNoise);
                state = this._updateState(state, actualWithNoise);
            }

            paths.push(path);
        }

        return paths;
    }

    _getStateFromModel(model) {
        // Extract initial state from fitted model
        return {
            value: model.lastValue || 0,
            trend: model.trend || 0
        };
    }

    _getNextForecast(state, model) {
        // Simple autoregressive forecast
        return state.value + state.trend;
    }

    _updateState(state, newValue) {
        // Update state with new observation
        return {
            value: newValue,
            trend: state.trend
        };
    }

    /**
     * Compute cumulative prediction interval
     */
    computeCumulativeInterval(paths, periodLength, confidence = 0.95) {
        const cumulativeSums = paths.map(path => 
            path.slice(0, periodLength).reduce((sum, val) => sum + val, 0)
        );

        const sorted = [...cumulativeSums].sort((a, b) => a - b);
        const lowerIdx = Math.floor(sorted.length * (1 - confidence) / 2);
        const upperIdx = Math.ceil(sorted.length * (1 + confidence) / 2);

        return {
            pointEstimate: cumulativeSums.reduce((a, b) => a + b, 0) / cumulativeSums.length,
            interval: {
                lower: sorted[lowerIdx],
                upper: sorted[upperIdx]
            },
            confidence: confidence,
            method: 'monte_carlo'
        };
    }

    /**
     * Compute joint prediction bands across all horizons
     */
    computeJointBands(paths, confidence = 0.95, method = 'simulation') {
        const horizon = paths[0].length;
        
        if (method === 'simulation') {
            return this._jointBandsSimulation(paths, horizon, confidence);
        } else if (method === 'bonferroni') {
            return this._jointBandsBonferroni(paths, horizon, confidence);
        }
    }

    _jointBandsSimulation(paths, horizon, confidence) {
        const jointLower = Array(horizon).fill(Infinity);
        const jointUpper = Array(horizon).fill(-Infinity);

        for (const path of paths) {
            for (let t = 0; t < horizon; t++) {
                jointLower[t] = Math.min(jointLower[t], path[t]);
                jointUpper[t] = Math.max(jointUpper[t], path[t]);
            }
        }

        return { lower: jointLower, upper: jointUpper };
    }

    _jointBandsBonferroni(paths, horizon, confidence) {
        const alpha = 1 - confidence;
        const alphaAdj = alpha / horizon;
        
        // Find z-score for adjusted alpha
        const zScore = this._inverseNormalCDF(1 - alphaAdj / 2);

        const means = Array(horizon).fill(0);
        const stdDevs = Array(horizon).fill(0);

        for (let t = 0; t < horizon; t++) {
            const valuesAtT = paths.map(p => p[t]);
            means[t] = valuesAtT.reduce((a, b) => a + b, 0) / valuesAtT.length;
            stdDevs[t] = Math.sqrt(
                valuesAtT.reduce((sum, v) => sum + Math.pow(v - means[t], 2), 0) / valuesAtT.length
            );
        }

        const bounds = {
            lower: means.map((m, t) => m - zScore * stdDevs[t]),
            upper: means.map((m, t) => m + zScore * stdDevs[t])
        };

        return bounds;
    }

    /**
     * Compute risk metrics from simulated paths
     */
    computeRiskMetrics(paths, horizon, confLevel = 0.95) {
        const valuesAtHorizon = paths.map(p => p[horizon - 1]);
        const sorted = [...valuesAtHorizon].sort((a, b) => a - b);

        const varIdx = Math.floor(sorted.length * (1 - confLevel));
        const cvarIdxStart = varIdx;
        const cvarValues = sorted.slice(0, cvarIdxStart);

        return {
            var_95: sorted[varIdx],
            cvar_95: cvarValues.reduce((a, b) => a + b, 0) / cvarValues.length,
            downsideProbability: valuesAtHorizon.filter(v => v < 0).length / valuesAtHorizon.length
        };
    }

    _inverseNormalCDF(p) {
        // Approximation of inverse normal CDF (probit function)
        const a = [
            -3.96968302866544169315524e+01,
             2.20946098424587858582870e+02,
            -2.75928510446968701009783e+02,
             1.38357751867269012702094e+02,
            -3.06647980661471618496544e+01,
             2.50662827745923923834828e+00
        ];

        const b = [
            -5.44760987982240727944965e+01,
             1.61585836858040985915013e+02,
            -1.55698979859886867682638e+02,
             6.68013118877197230197186e+01,
            -1.32806815546903449727853e+01
        ];

        const c = [
             1.42491194122703712079064e+00,
            -0.72005192779834566726932e-01,
             0.42443190326127427127162e-02,
            -0.35270963896523026921220e-04,
             0.32351674091697045413728e-06
        ];

        const d = [
             1.00000000000000000000000e+00,
            -1.97084045093032710452237e-01,
             1.33027120943298478533097e-02,
            -6.38687941250142696399065e-04,
             4.50290268944598630882325e-06,
            -1.40267973036841177879706e-07
        ];

        if (p <= 0 || p >= 1) {
            throw new Error('p must be strictly between 0 and 1');
        }

        const ll = 0.5 - p;
        let sign = 1;
        if (ll > 0) {
            sign = -1;
            ll = p - 0.5;
        }

        if (ll <= 0.42) {
            const zz = 0.5 - 2.0 * ll;
            const xx = ll * ll;
            const num = (((((a[0] * xx + a[1]) * xx + a[2]) * xx + a[3]) * xx + a[4]) * xx + a[5]) * ll;
            const den = (((((b[0] * xx + b[1]) * xx + b[2]) * xx + b[3]) * xx + b[4]) * xx + 1.0);
            return sign * (num / den + zz);
        }

        const zz = Math.sqrt(-2.0 * Math.log(ll));
        const x = (((((c[0] * zz + c[1]) * zz + c[2]) * zz + c[3]) * zz + c[4]) * zz + c[5]);
        const y = (((((d[0] * zz + d[1]) * zz + d[2]) * zz + d[3]) * zz + d[4]) * zz + d[5]) * zz + 1.0;
        return sign * (x / y + zz);
    }
}

/**
 * Predictive Density Distribution
 * Supports Gaussian, Student-t, and Skewed-t distributions
 */
class PredictiveDensity {
    constructor(params) {
        this.distribution = params.distribution || 'gaussian';
        this.mu = params.mu; // Mean
        this.sigma = params.sigma || 1; // Std dev
        this.df = params.df || 10; // Degrees of freedom for Student-t
        this.skew = params.skew || 0; // Skewness parameter
    }

    /**
     * Probability density function at value x
     */
    pdf(x) {
        if (this.distribution === 'gaussian') {
            return this._gaussianPDF(x);
        } else if (this.distribution === 'student-t') {
            return this._studentTPDF(x);
        } else if (this.distribution === 'skewed-t') {
            return this._skewedTPDF(x);
        }
    }

    _gaussianPDF(x) {
        const expArg = -Math.pow(x - this.mu, 2) / (2 * Math.pow(this.sigma, 2));
        return Math.exp(expArg) / (this.sigma * Math.sqrt(2 * Math.PI));
    }

    _studentTPDF(x) {
        const df = this.df;
        const tSquared = Math.pow((x - this.mu) / this.sigma, 2);
        const gammaHalf = this._gammaFunction((df + 1) / 2);
        const gammaDfHalf = this._gammaFunction(df / 2);
        const pi = Math.PI;

        const coeff = gammaHalf / (gammaDfHalf * Math.sqrt(df * pi) * this.sigma);
        const term = Math.pow(1 + tSquared / df, -(df + 1) / 2);

        return coeff * term;
    }

    _gammaFunction(z) {
        // Lanczos approximation for Gamma function
        const g = 7;
        const c = [
            0.99999999999980993, 676.5203681218851, -1259.1392167224028,
            771.32342877765313, -176.61502916214059, 12.507343278686905,
            -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
        ];

        if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * this._gammaReflection(1 - z));
        
        z -= 1;
        let x = c[0];
        for (let i = 1; i < c.length; i++) {
            x += c[i] / (z + i);
        }

        const t = z + g + 0.5;
        return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
    }

    _gammaReflection(z) {
        const c = [
            1.00000000000000003e+00, 5.7156249655617438e-01, -2.6473829074861197e-01,
            1.2491235008561187e-02, -7.0138445517548364e-04, 1.6739223348821298e-04,
            -2.5114162997148638e-05, 7.0628003281879911e-07
        ];

        let x = 0;
        for (let i = 0; i < c.length; i++) {
            x += c[i] / (z + i + 1);
        }
        return Math.exp(-1 / z) / (z * x);
    }

    _studentTPDF(x) {
        const z = (x - this.mu) / this.sigma;
        const numerator = this._gamma((this.df + 1) / 2);;
        const denominator = this._gamma(this.df / 2) * Math.sqrt(this.df * Math.PI) * this.sigma;
        const power = -(this.df + 1) / 2;
        
        return (numerator / denominator) * Math.pow(1 + z*z / this.df, power);
    }

    _gamma(z) {
        if (z === 1 || z === 2) return z - 1;
        if (z < 1) return this._gamma(z + 1) / z;
        
        z -= 1;
        const c = [1, 76.180091729471, -86.505320329416, 24.01409824083, 
                   -1.23173957245, 0.120865097387e-2, -0.539523938495e-5];
        
        let x = c[0];
        for (let j = 1; j < c.length; j++) x += c[j] / (z + j);
        
        const t = z + 5.5;
        return Math.exp(-t) * Math.pow(t, z) * x * Math.sqrt(2 * Math.PI);
    }

    /**
     * Cumulative distribution function at value x
     */
    cdf(x) {
        if (this.distribution === 'gaussian') {
            return this._normalCDF(x);
        } else if (this.distribution === 'student-t') {
            // Use approximation via regularized incomplete beta function
            return this._studentTCDF(x);
        }
    }

    _normalCDF(x) {
        const z = (x - this.mu) / (this.sigma * Math.sqrt(2));
        
        // Approximation
        const a1 =  0.254829592;
        const a2 = -0.284496736;
        const a3 =  1.421413741;
        const a4 = -1.453152027;
        const a5 =  1.061403639;
        const p  =  0.3275911;
        
        const sign = z < 0 ? -1 : 1;
        const absZ = Math.abs(z);
        
        const t = 1.0 / (1.0 + p * absZ);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ);
        
        return 0.5 * (1.0 + sign * y);
    }

    _studentTCDF(x) {
        // Simplified approximation for Student-t CDF
        const z = (x - this.mu) / this.sigma;
        const df = this.df;
        
        // For large df, approximate as normal
        if (df > 30) {
            return this._normalCDF(z);
        }
        
        // Otherwise use rough approximation
        const normCdf = this._normalCDF(z);
        const adjustment = Math.log(df) / (2 * df);
        return normCdf + adjustment * (z < 0 ? -1 : 1) * (1 - normCdf);
    }

    /**
     * Quantile function (inverse CDF)
     */
    quantile(probability) {
        // Newton-Raphson iteration to find quantile
        let x = this.mu;
        const maxIter = 100;
        const tol = 1e-6;

        for (let iter = 0; iter < maxIter; iter++) {
            const cdfVal = this.cdf(x);
            const pdfVal = this.pdf(x);
            
            const diff = probability - cdfVal;
            if (Math.abs(diff) < tol) break;
            
            x += diff / pdfVal;
        }

        return x;
    }
}

/**
 * Scenario Tree Builder
 * Multi-path branching scenarios for strategic planning
 */
class ScenarioTreeBuilder {
    constructor(baseForecast) {
        this.baseForecast = baseForecast;
        this.scenarios = [];
    }

    /**
     * Add a scenario to the tree
     */
    addScenario(name, probability, intervention) {
        this.scenarios.push({
            id: this._generateUUID(),
            name,
            probability,
            intervention,
            forecast: this._applyIntervention(intervention)
        });
    }

    /**
     * Apply intervention to base forecast
     */
    _applyIntervention(intervention) {
        if (!intervention) return this.baseForecast.points;

        const modifiedPoints = [...this.baseForecast.points];

        switch (intervention.type) {
            case 'multiplicative':
                return modifiedPoints.map(v => v * intervention.factor);
            
            case 'additive':
                return modifiedPoints.map(v => v + intervention.shift);
            
            case 'promotion':
                return modifiedPoints.map((v, i) => {
                    if (i < intervention.duration) {
                        return v * (1 + intervention.uplift);
                    }
                    return v;
                });
            
            case 'supply_shock':
                return modifiedPoints.map((v, i) => {
                    if (i < intervention.duration) {
                        return v * (1 - intervention.reduction);
                    }
                    return v;
                });
            
            default:
                return modifiedPoints;
        }
    }

    /**
     * Build visualization data structure
     */
    buildVisualization() {
        const weightedExpected = this._computeWeightedExpectedValue();

        return {
            baseForecast: this.baseForecast,
            branches: this.scenarios.map(s => ({
                name: s.name,
                probability: s.probability,
                trajectory: s.forecast
            })),
            weightedExpectedValue: weightedExpected,
            root: {
                name: 'Base Case',
                children: this.scenarios.map(s => ({
                    name: s.name,
                    probability: s.probability,
                    forecast: s.forecast
                }))
            }
        };
    }

    _computeWeightedExpectedValue() {
        const expectedByHorizon = {};
        const horizon = this.baseForecast.points.length;

        for (let h = 0; h < horizon; h++) {
            let weightedSum = 0;
            
            // Base case contribution
            weightedSum += 0.6 * this.baseForecast.points[h];
            
            // Scenario contributions
            for (const scenario of this.scenarios) {
                weightedSum += scenario.probability * scenario.forecast[h];
            }
            
            expectedByHorizon[h] = weightedSum;
        }

        return expectedByHorizon;
    }

    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

// Export modules
module.exports = {
    MonteCarloSimulator,
    PredictiveDensity,
    ScenarioTreeBuilder
};
