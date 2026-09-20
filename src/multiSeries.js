/**
 * Multi-Series Modeling Module - ForecastLab Phase 4A
 * 
 * Provides hierarchical reconciliation, panel analysis, VAR modeling, and factor extraction
 * for multi-series forecasting while maintaining classical statistics approach.
 * 
 * @module multiSeries
 */

const { TimeSeries } = require('./series');
const { fit: singleFit, forecast: singleForecast } = require('./models');
const { evaluate, calculateMetrics } = require('./evaluate');

/**
 * Hierarchical Reconciliation Engine
 * Implements optimal combination reconciliation for hierarchical time series
 */
class HierarchicalReconciler {
    /**
     * Create hierarchical reconciler
     * @param {Object} hierarchyConfig - Hierarchy configuration with levels and constraints
     */
    constructor(hierarchyConfig) {
        this.hierarchy = this._parseHierarchy(hierarchyConfig);
        this.aggregationMatrix = null;
    }

    /**
     * Parse hierarchy configuration into internal structure
     */
    _parseHierarchy(config) {
        const hierarchy = {
            levels: config.levels || [],
            nodes: [],
            edges: [],
            seriesMap: {}
        };

        // Create node structure
        for (const [seriesId, path] of Object.entries(config.series)) {
            hierarchy.nodes.push({ id: seriesId, path, level: path.length });
            hierarchy.seriesMap[seriesId] = path;
        }

        // Infer edges from parent-child relationships
        for (const node of hierarchy.nodes) {
            if (node.path.length > 0) {
                const parentPath = node.path.slice(0, -1);
                const parentId = parentPath.join('_');
                hierarchy.edges.push({ parent: parentId, child: node.id });
            }
        }

        return hierarchy;
    }

    /**
     * Build aggregation matrix S where S[i,j] = 1 if series j contributes to total i
     */
    buildAggregationMatrix() {
        const nodeIds = this.hierarchy.nodes.map(n => n.id);
        const numNodes = nodeIds.length;
        
        // Initialize sparse matrix as array of objects for memory efficiency
        this.aggregationMatrix = Array(numNodes).fill(null).map(() => ({}));

        for (let i = 0; i < numNodes; i++) {
            const currentNode = this.hierarchy.nodes.find(n => n.id === nodeIds[i]);
            
            // Summation constraints: parent = sum(children)
            for (let j = 0; j < numNodes; j++) {
                const childNode = this.hierarchy.nodes.find(n => n.id === nodeIds[j]);
                
                // Check if child's path starts with parent's path
                if (this._isDescendant(childNode.path, currentNode.path)) {
                    this.aggregationMatrix[i][j] = 1;
                }
            }
        }

        return this.aggregationMatrix;
    }

    /**
     * Check if childPath is descendant of ancestorPath
     */
    _isDescendant(childPath, ancestorPath) {
        if (ancestorPath.length === 0) return true; // Total node
        if (childPath.length < ancestorPath.length) return false;
        
        for (let i = 0; i < ancestorPath.length; i++) {
            if (childPath[i] !== ancestorPath[i]) return false;
        }
        return true;
    }

    /**
     * Forecast bottom-level series independently
     */
    async forecastBottom(seriesData, options) {
        const forecasts = {};

        for (const [seriesId, timeSeries] of Object.entries(seriesData)) {
            if (this._isBaseLevel(seriesId)) {
                const ts = new TimeSeries(timeSeries);
                const model = await singleFit(ts.values, options.method || 'holt');
                const forecast = singleForecast(model, options.horizon || 10);
                
                forecasts[seriesId] = {
                    points: forecast.forecasts,
                    model: model
                };
            }
        }

        return forecasts;
    }

    /**
     * Check if series is at base level (leaf node)
     */
    _isBaseLevel(seriesId) {
        const node = this.hierarchy.nodes.find(n => n.id === seriesId);
        return node && node.level === Math.max(...this.hierarchy.nodes.map(n => n.level));
    }

    /**
     * Compute optimal reconciliation weights using OLS
     * Minimize: ||y - ŷ||² subject to summation constraints
     */
    computeWeights(bottomForecasts) {
        this.buildAggregationMatrix();
        const S = this._matrixToSparse(this.aggregationMatrix);

        // Extract residual covariance from bottom forecasts
        const residuals = this._extractResiduals(bottomForecasts);
        const Sigma = this._estimateCovariance(residuals);

        // Normal equations: β = (S'Σ⁻¹S)⁻¹ S'Σ⁻¹ y
        const StSigmaInv = this._multiplySparse(S, this._inverseSigma(Sigma));
        const weightMatrix = this._inverse(StSigmaInv);

        return { weightMatrix, aggregationMatrix: S };
    }

    /**
     * Apply reconciliation using computed weights
     */
    reconcile(bottomForecasts) {
        const { weightMatrix, aggregationMatrix } = this.computeWeights(bottomForecasts);
        
        // Aggregate bottom forecasts upward
        const aggregated = this._aggregateForecasts(bottomForecasts, aggregationMatrix);
        
        // Apply optimal weights for reconciliation
        const reconciled = this._applyWeights(aggregated, weightMatrix);
        
        return reconciled;
    }

    /**
     * Top-down proportional allocation method
     */
    topDownReconcile(topForecast, baseProportions) {
        const allocation = {};

        for (const node of this.hierarchy.nodes) {
            if (node.level === Math.max(...this.hierarchy.nodes.map(n => n.level))) {
                // Leaf node: allocate proportionally
                allocation[node.id] = topForecast * baseProportions[node.id];
            } else {
                // Internal node: sum up children's allocations
                const children = this.hierarchy.edges
                    .filter(e => e.parent === node.id)
                    .map(e => e.child);
                
                allocation[node.id] = children.reduce(
                    (sum, childId) => sum + allocation[childId], 0
                );
            }
        }

        return allocation;
    }

    /**
     * Benchmark reconciliation methods
     */
    async benchmarkMethods(actualData, bottomForecasts) {
        const metrics = {};

        // Bottom-up approach
        const bottomUp = await this.forecastBottom(actualData.data, { method: 'holt' });
        metrics.bottomUp = this._calculateMetrics(bottomUp, actualData.actual);

        // Optimal combination
        const optimalComb = this.reconcile(bottomUp);
        metrics.optimalComb = this._calculateMetrics(optimalComb, actualData.actual);

        return metrics;
    }

    /**
     * Utility: Convert dense matrix to sparse representation
     */
    _matrixToSparse(matrix) {
        return matrix.map(row => Object.keys(row).length > 0 ? row : null);
    }

    /**
     * Utility: Calculate metrics for reconciliation evaluation
     */
    _calculateMetrics(forecasts, actual) {
        const errors = {};
        
        for (const [id, forecast] of Object.entries(forecasts)) {
            if (actual[id]) {
                const rmse = Math.sqrt(
                    forecast.points.reduce((sum, pred, i) => 
                        sum + Math.pow(pred - actual[id][i], 2), 0
                    ) / forecast.points.length
                );
                errors[id] = { RMSE: rmse };
            }
        }
        
        return errors;
    }
}

/**
 * Panel Data Analysis Module
 * Compare forecasting performance across groups of series
 */
class PanelAnalyzer {
    constructor(seriesGroup) {
        this.seriesGroup = seriesGroup;
        this.categories = this._extractCategories();
    }

    /**
     * Extract unique categories from series metadata
     */
    _extractCategories() {
        const categories = new Set();
        for (const series of this.seriesGroup) {
            if (series.category) categories.add(series.category);
        }
        return Array.from(categories);
    }

    /**
     * Compare multiple methods across all series in panel
     */
    async compareMethods(methodsList, metrics = ['RMSE', 'MAE']) {
        const results = {};

        for (const method of methodsList) {
            const seriesResults = [];

            for (const series of this.seriesGroup) {
                const forecast = await this._fitAndForecast(series.data, method);
                const errors = this._evaluateErrors(forecast, series.actual, metrics);

                seriesResults.push({
                    seriesId: series.id,
                    category: series.category || 'unknown',
                    errors
                });
            }

            results[method] = this._aggregateResults(seriesResults, metrics);
        }

        return results;
    }

    /**
     * Fit model and forecast for single series
     */
    async _fitAndForecast(data, method) {
        const ts = new TimeSeries(data);
        const model = await singleFit(ts.values, method);
        return singleForecast(model, 10);
    }

    /**
     * Evaluate forecast errors against actual
     */
    _evaluateErrors(forecast, actual, metrics) {
        const errors = {};
        
        if (!forecast || !actual) return errors;

        const pred = forecast.forecasts.slice(0, actual.length);
        
        for (const metric of metrics) {
            if (metric === 'RMSE') {
                errors.RMSE = Math.sqrt(
                    pred.reduce((sum, p, i) => sum + Math.pow(p - actual[i], 2), 0) / pred.length
                );
            } else if (metric === 'MAE') {
                errors.MAE = pred.reduce((sum, p, i) => sum + Math.abs(p - actual[i]), 0) / pred.length;
            } else if (metric === 'MAPE') {
                errors.MAPE = pred.reduce((sum, p, i) => 
                    sum + Math.abs((p - actual[i]) / actual[i]), 0
                ) / pred.length * 100;
            }
        }

        return errors;
    }

    /**
     * Aggregate results across series by category
     */
    _aggregateResults(seriesResults, metrics) {
        const aggregated = {
            overall: {},
            byCategory: {}
        };

        // Overall metrics
        for (const metric of metrics) {
            const values = seriesResults.flatMap(r => r.errors[metric] ? [r.errors[metric]] : []);
            aggregated.overall[metric] = {
                mean: this._mean(values),
                median: this._median(values),
                stdDev: this._stdDev(values),
                min: Math.min(...values),
                max: Math.max(...values)
            };
        }

        // By category
        const grouped = this._groupBy(seriesResults, 'category');
        for (const [category, group] of Object.entries(grouped)) {
            aggregated.byCategory[category] = {};
            
            for (const metric of metrics) {
                const values = group.flatMap(r => r.errors[metric] ? [r.errors[metric]] : []);
                aggregated.byCategory[category][metric] = {
                    mean: this._mean(values),
                    count: values.length
                };
            }
        }

        return aggregated;
    }

    /**
     * Diebold-Mariano test for statistical significance
     */
    dmTest(methodA_forecasts, methodB_forecasts, actual) {
        const diffSeries = [];

        for (let i = 0; i < actual.length; i++) {
            const lossA = Math.pow(methodA_forecasts[i] - actual[i], 2);
            const lossB = Math.pow(methodB_forecasts[i] - actual[i], 2);
            diffSeries.push(lossA - lossB);
        }

        const meanDiff = this._mean(diffSeries);
        const varianceDiff = this._variance(diffSeries);
        const n = diffSeries.length;

        // DM statistic
        const dmStat = meanDiff / Math.sqrt(varianceDiff / n);

        // Approximate p-value using normal distribution for large n
        const pValue = 2 * (1 - this._normalCDF(Math.abs(dmStat)));

        return {
            statistic: dmStat,
            pValue: pValue,
            significant: pValue < 0.05,
            betterMethod: meanDiff > 0 ? methodB : methodA
        };
    }

    // Statistical utilities
    _mean(values) {
        return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    }

    _median(values) {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
    }

    _stdDev(values) {
        const m = this._mean(values);
        const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    _variance(values) {
        const m = this._mean(values);
        return values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
    }

    _groupBy(array, key) {
        return array.reduce((groups, item) => {
            const groupKey = item[key] || 'unknown';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(item);
            return groups;
        }, {});
    }

    _normalCDF(x) {
        // Approximation of standard normal CDF
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061403639;
        const p = 0.3275911;
        
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);
        
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        
        return 0.5 * (1.0 + sign * y);
    }
}

/**
 * Vector Autoregression (VAR) Model
 * Simplified VAR without MCMC complexity
 */
class VARModel {
    constructor(order = 1) {
        this.order = order;
        this.coefficients = null;
        this.residuals = null;
    }

    /**
     * Fit VAR model to multivariate time series
     */
    async fit(timeSeriesMatrix, options = {}) {
        const nSeries = timeSeriesMatrix.length;
        const nObservations = timeSeriesMatrix[0].length;

        // Build design matrices with lagged features
        const X = this._buildDesignMatrix(timeSeriesMatrix, this.order);
        const Y = this._buildResponseMatrix(timeSeriesMatrix, this.order);

        // OLS estimation: β = (X'X)⁻¹X'Y
        const XtX = this._matmul(X.transpose(), X);
        const XtY = this._matmul(X.transpose(), Y);
        const beta = this._solveLinearSystem(XtX, XtY);

        this.coefficients = beta;
        this.residuals = Y.subtract(this._matmul(X, beta));

        return {
            coefficients: this._formatCoefficients(beta, nSeries),
            rSquared: this._computeRSquared(Y, this.residuals),
            dimensions: { nSeries, nObservations }
        };
    }

    /**
     * Build design matrix with lagged features
     */
    _buildDesignMatrix(data, order) {
        const nSeries = data.length;
        const nObs = data[0].length - order;
        const X = [];

        for (let t = order; t < data[0].length; t++) {
            const row = [];
            // Include all series' lags
            for (let i = 0; i < nSeries; i++) {
                for (let k = 1; k <= order; k++) {
                    row.push(data[i][t - k]);
                }
            }
            X.push(row);
        }

        return X;
    }

    /**
     * Build response matrix (current values)
     */
    _buildResponseMatrix(data, order) {
        const nSeries = data.length;
        const nObs = data[0].length - order;
        const Y = Array(nObs).fill(null).map(() => Array(nSeries).fill(0));

        for (let t = order; t < data[0].length; t++) {
            for (let i = 0; i < nSeries; i++) {
                Y[t - order][i] = data[i][t];
            }
        }

        return Y;
    }

    /**
     * Matrix multiplication
     */
    _matmul(A, B) {
        const rowsA = A.length, colsA = A[0].length;
        const rowsB = B.length, colsB = B[0].length;

        if (colsA !== rowsB) throw new Error('Matrix dimension mismatch');

        const result = Array(rowsA).fill(null).map(() => Array(colsB).fill(0));

        for (let i = 0; i < rowsA; i++) {
            for (let j = 0; j < colsB; j++) {
                let sum = 0;
                for (let k = 0; k < colsA; k++) {
                    sum += A[i][k] * B[k][j];
                }
                result[i][j] = sum;
            }
        }

        return result;
    }

    /**
     * Solve linear system Ax = b using Gaussian elimination
     */
    _solveLinearSystem(A, b) {
        const n = A.length;
        const aug = A.map((row, i) => [...row, ...b[i]]);

        // Forward elimination
        for (let col = 0; col < n; col++) {
            // Pivot
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
                    maxRow = row;
                }
            }
            [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

            // Eliminate
            for (let row = col + 1; row < n; row++) {
                const factor = aug[row][col] / aug[col][col];
                for (let j = col; j <= n; j++) {
                    aug[row][j] -= factor * aug[col][j];
                }
            }
        }

        // Back substitution
        const x = Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            x[i] = aug[i][n];
            for (let j = i + 1; j < n; j++) {
                x[i] -= aug[i][j] * x[j];
            }
            x[i] /= aug[i][i];
        }

        return x;
    }

    /**
     * Format coefficients with series labels
     */
    _formatCoefficients(beta, nSeries) {
        const formatted = {};
        const coeffPerSeries = this.order;

        for (let i = 0; i < nSeries; i++) {
            formatted[`series_${i}`] = {};
            for (let j = 0; j < nSeries; j++) {
                formatted[`series_${i}`][`lag_${this.order}_coeff`] = 
                    beta[i * nSeries * coeffPerSeries + j * coeffPerSeries];
            }
        }

        return formatted;
    }

    /**
     * Compute R-squared
     */
    _computeRSquared(Y, residuals) {
        const yMean = this._meanArray(Y.flat());
        const ssTot = Y.flat().reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
        const ssRes = residuals.flat().reduce((sum, e) => sum + Math.pow(e, 2), 0);
        
        return 1 - (ssRes / ssTot);
    }

    _meanArray(arr) {
        return arr.reduce((sum, val) => sum + val, 0) / arr.length;
    }

    /**
     * Forecast h steps ahead
     */
    forecast(stepsAhead) {
        const nSeries = this.coefficients.length;
        const forecasts = [];

        // Get last observed state
        let currentState = this._getLastState();

        for (let s = 1; s <= stepsAhead; s++) {
            const nextStep = this._applyCoefficients(currentState);
            forecasts.push(nextStep);
            currentState = this._shiftState(currentState, nextStep);
        }

        return forecasts;
    }

    _getLastState() {
        // Simplified - would extract from fitted data in production
        return Array(this.coefficients.length / this.order).fill(0);
    }

    _applyCoefficients(state) {
        // Apply coefficient matrix to current state
        return state.map((val, i) => val * this.coefficients[i]);
    }

    _shiftState(state, newValue) {
        return [...state.slice(1), newValue];
    }
}

/**
 * Factor Model Extraction
 * Analytical PCA for common latent drivers without MCMC
 */
class FactorExtractor {
    constructor() {
        // Pure analytical approach, no state needed
    }

    /**
     * Extract principal components from series matrix
     */
    extractFactors(dataMatrix, k) {
        // Standardize each series
        const standardized = this._standardizeRows(dataMatrix);
        
        // Compute covariance matrix
        const covMatrix = this._covarianceMatrix(standardized);
        
        // Eigenvalue decomposition
        const { eigenvalues, eigenvectors } = this._eigenDecomposition(covMatrix);
        
        // Select top k factors
        const sortedIndices = this._sortEigenvaluesDesc(eigenvalues);
        const selectedEigenvectors = sortedIndices.slice(0, k).map(idx => eigenvectors[idx]);
        const selectedEigenvalues = sortedIndices.slice(0, k).map(idx => eigenvalues[idx]);
        
        // Compute factor scores
        const factorScores = this._matmul(standardized.transpose(), selectedEigenvectors);
        
        return {
            factors: selectedEigenvectors,
            loadings: selectedEigenvectors,
            factorScores: factorScores,
            varianceExplained: selectedEigenvalues,
            cumulativeVariance: this._cumulativeSum(selectedEigenvalues)
        };
    }

    _standardizeRows(matrix) {
        return matrix.map(row => {
            const mean = row.reduce((sum, v) => sum + v, 0) / row.length;
            const std = Math.sqrt(row.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / row.length);
            return std === 0 ? row.map(() => 0) : row.map(v => (v - mean) / std);
        });
    }

    _covarianceMatrix(data) {
        const nFeatures = data[0].length;
        const covMatrix = Array(nFeatures).fill(null).map(() => Array(nFeatures).fill(0));

        const means = Array(nFeatures).fill(0);
        for (const row of data) {
            for (let j = 0; j < nFeatures; j++) {
                means[j] += row[j];
            }
        }
        for (let j = 0; j < nFeatures; j++) {
            means[j] /= data.length;
        }

        for (let i = 0; i < data.length; i++) {
            const centered = data[i].map((v, j) => v - means[j]);
            for (let j = 0; j < nFeatures; j++) {
                for (let k = j; k < nFeatures; k++) {
                    covMatrix[j][k] += centered[j] * centered[k];
                    if (j !== k) covMatrix[k][j] = covMatrix[j][k];
                }
            }
        }

        for (let j = 0; j < nFeatures; j++) {
            for (let k = j; k < nFeatures; k++) {
                covMatrix[j][k] /= data.length - 1;
                if (j !== k) covMatrix[k][j] = covMatrix[j][k];
            }
        }

        return covMatrix;
    }

    _eigenDecomposition(matrix) {
        // Power iteration for dominant eigenvector
        const n = matrix.length;
        const eigenvectors = [];
        const eigenvalues = [];
        let remainingMatrix = JSON.parse(JSON.stringify(matrix));

        for (let iter = 0; iter < n && eigenvalues.length < n; iter++) {
            // Start with random vector
            let v = Array(n).fill(0).map(() => Math.random() - 0.5);
            v = this._normalize(v);

            // Power iteration
            for (let it = 0; it < 100; it++) {
                const Av = this._matmul(remainingMatrix, v);
                const lambda = this._dot(v, Av);
                const vNew = this._normalize(Av);

                if (this._distance(v, vNew) < 1e-6) break;
                v = vNew;
            }

            eigenvalues.push(lambda);
            eigenvectors.push(v);

            // Deflate matrix
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    remainingMatrix[i][j] -= lambda * v[i] * v[j];
                }
            }
        }

        return { eigenvalues, eigenvectors };
    }

    _normalize(v) {
        const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
        return norm === 0 ? v : v.map(x => x / norm);
    }

    _dot(a, b) {
        return a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    }

    _distance(a, b) {
        return Math.sqrt(this._dot(a.map((ai, i) => ai - b[i]), a.map((ai, i) => ai - b[i])));
    }

    _sortEigenvaluesDesc(eigenvalues) {
        return eigenvalues.map((val, idx) => ({ val, idx }))
            .sort((a, b) => b.val - a.val)
            .map(item => item.idx);
    }

    _cumulativeSum(values) {
        const cumsum = [];
        let sum = 0;
        for (const v of values) {
            sum += v;
            cumsum.push(sum);
        }
        return cumsum;
    }

    _matmul(A, B) {
        const rowsA = A.length, colsA = A[0].length;
        const colsB = B[0].length;
        const result = Array(rowsA).fill(null).map(() => Array(colsB).fill(0));

        for (let i = 0; i < rowsA; i++) {
            for (let j = 0; j < colsB; j++) {
                for (let k = 0; k < colsA; k++) {
                    result[i][j] += A[i][k] * B[k][j];
                }
            }
        }

        return result;
    }
}

// Matrix transpose helper
Array.prototype.transpose = function() {
    return this[0].map((_, colIndex) => this.map(row => row[colIndex]));
};

// Export modules
module.exports = {
    HierarchicalReconciler,
    PanelAnalyzer,
    VARModel,
    FactorExtractor
};
