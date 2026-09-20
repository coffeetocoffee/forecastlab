# ForecastLab: Phase 4A - Multi-Series Modeling Implementation Plan 📊

**Version**: 1.0  
**Status**: Implementation Plan  
**Timeline**: Months 1-3 of Phase 4  

---

## Executive Summary

Phase 4A focuses on extending ForecastLab from single-series forecasting to **multi-series modeling**, enabling:

1. **Hierarchical reconciliation** - Coherent forecasts across organizational structures
2. **Panel analysis** - Comparative performance across groups
3. **Spillover effects** - Cross-series influence detection
4. **Factor models** - Common latent drivers extraction

All implementations remain classical statistics-based with no ML dependencies.

---

## Architecture Overview

### Current State
```
src/
├── engine/
    ├── series.js         # Single time series operations
    ├── models/           # Forecasting models (ETS, Holt, etc.)
    ├── evaluate.js       # Accuracy metrics
    └── report.js         # HTML/JSON reporting
```

### Target State (Post-4A)
```
src/
├── engine/
    ├── series.js         # Extended for multi-series ops
    ├── multiSeries.js    # NEW: Hierarchical & panel utilities
    ├── models/
    │   ├── single.js     # Existing single-series models
    │   ├── var.js        # NEW: Vector autoregression
    │   └── factor.js     # NEW: Factor model extraction
    ├── reconcile.js      # NEW: Hierarchical reconciliation engine
    └── panel.js          # NEW: Panel data analysis
```

---

## Module 1: Hierarchical Reconciliation

### 1.1 Data Structure Design

**Hierarchy Configuration File:**
```json
{
  "name": "Retail Sales",
  "levels": ["country", "region", "product"],
  "series": {
    "total": ["na", "na", "na"],
    "usa_east electronics": ["usa", "east", "electronics"],
    "usa_east clothing": ["usa", "east", "clothing"],
    "usa_west electronics": ["usa", "west", "electronics"],
    "usa_west clothing": ["usa", "west", "clothing"]
  },
  "constraints": [
    { "type": "sum", "parent": "total", "children": ["usa_total", "canada_total"] },
    { "type": "sum", "parent": "usa", "children": ["usa_east", "usa_west"] }
  ]
}
```

**JavaScript Object Representation:**
```javascript
const hierarchy = {
    nodes: [
        {id: 'total', path: [], level: 0},
        {id: 'USA', path: ['USA'], level: 1},
        {id: 'USA_EAST', path: ['USA', 'EAST'], level: 1},
        {id: 'PRODUCT_A', path: ['PRODUCT_A'], level: 1}
    ],
    edges: [
        {parent: 'total', children: ['USA', 'CANADA']},
        {parent: 'USA', children: ['USA_EAST', 'USA_WEST']}
    ]
};
```

### 1.2 Bottom-Up Reconciliation Algorithm

**Mathematical Formulation:**
```
Given forecasts f_i at base level with covariance Σ_i,
find weights W that minimize reconstruction error subject to summing constraints.

Minimize:  ||y - ŷ||² + λ·||W||²  (with L2 regularization)
Subject to:  H·ŷ = y_top
```

**Implementation Steps:**

```javascript
// File: src/engine/reconcile.js

class HierarchicalReconciler {
    constructor(hierarchyConfig) {
        this.hierarchy = this._parseHierarchy(hierarchyConfig);
        this.S = null;  // Covariance matrix (estimated later)
    }
    
    // Step 1: Fit bottom-level forecasts independently
    async forecastBottom(seriesData, options) {
        const forecasts = {};
        
        for (const [seriesId, timeseries] of Object.entries(seriesData)) {
            if (this.hierarchy.isBaseLevel(seriesId)) {
                forecasts[seriesId] = await fitModel(timeseries, options);
            }
        }
        
        return forecasts;
    }
    
    // Step 2: Compute aggregation matrix S
    _buildAggregationMatrix() {
        // S[i,j] = 1 if series j contributes to total i
        const S = this._createSparseMatrix();
        return S;
    }
    
    // Step 3: Solve optimal reconciliation weights
    computeWeights(bottomForecasts) {
        const residuals = this._extractResiduals(bottomForecasts);
        const S = this._buildAggregationMatrix();
        
        // Estimate covariance matrix of residuals
        const Sigma = this._estimateCovariance(residuals);
        
        // Normal equations for OLS reconciliation
        // β = (S'Σ⁻¹S)⁻¹ S'Σ⁻¹ y
        const StSigmaInv = this._multiply(S, this._inverse(Sigma));
        const weightMatrix = this._inverse(this._multiply(StSigmaInv, S.transpose()));
        
        return weightMatrix;
    }
    
    // Step 4: Apply reconciliation
    reconcile(bottomForecasts) {
        const weights = this.computeWeights(bottomForecasts);
        const aggregated = this._aggregateForecasts(bottomForecasts);
        
        // Adjust using optimal weights
        const reconciled = this._applyWeights(aggregated, weights);
        
        return reconciled;
    }
}
```

### 1.3 Top-Down Proportional Method

**Alternative approach:** Forecast top-level, then proportionally allocate downward.

```javascript
class TopDownReconciler {
    constructor(hierarchy) {
        this.hierarchy = hierarchy;
    }
    
    reconcile(topForecast, baseProportions) {
        // topForecast: prediction for highest level
        // baseProportions: historical averages showing split ratios
        
        const allocation = {};
        
        for (const node of this.hierarchy.getAllNodes()) {
            if (node.isLeaf()) {
                allocation[node.id] = topForecast * baseProportions[node.id];
            } else {
                // Sum up children's allocations
                allocation[node.id] = node.children.reduce(
                    (sum, child) => sum + allocation[child.id], 0
                );
            }
        }
        
        return allocation;
    }
}
```

### 1.4 Benchmarking Methods

**Three approaches to benchmark:**

1. **Bottom-Up:** Unconstrained forecasts summed upward
2. **Top-Down:** Top forecast allocated downward by proportions
3. **Optimal Comb:** Statistically optimal combination

**Evaluation Function:**
```javascript
async function benchmarkReconciliationMethods(forecastResults, actualData) {
    const metrics = {};
    
    for (const [level, seriesList] of hierarchy.levels) {
        for (const seriesId of seriesList) {
            const actual = actualData[seriesId];
            const bottomUpErr = calculateRMSE(bottomUpResult[seriesId], actual);
            const topDownErr = calculateRMSE(topDownResult[seriesId], actual);
            const optimalErr = calculateRMSE(optimalCombResult[seriesId], actual);
            
            metrics[seriesId] = {
                bottomUp: bottomUpErr,
                topDown: topDownErr,
                optimal: optimalErr,
                bestMethod: Math.min(bottomUpErr, topDownErr, optimalErr) === optimalErr ? 'optimal' : ...
            };
        }
    }
    
    return metrics;
}
```

---

## Module 2: Panel Data Analysis

### 2.1 Group Performance Comparison

```javascript
// File: src/engine/panel.js

class PanelAnalyzer {
    constructor(seriesGroup) {
        this.seriesGroup = seriesGroup;  // Array of series with metadata
        this.categories = this._extractCategories();
    }
    
    // Compare methods across all series in panel
    compareMethods(methodsList, metrics = ['RMSE', 'MAE']) {
        const results = {};
        
        for (const method of methodsList) {
            const seriesResults = [];
            
            for (const series of this.seriesGroup) {
                const forecast = await fitAndForecast(series.data, method);
                const errors = evaluate(forecast, series.actual);
                
                seriesResults.push({
                    seriesId: series.id,
                    category: series.category,
                    errors
                });
            }
            
            // Aggregate across series
            results[method] = this._aggregateResults(seriesResults, metrics);
        }
        
        return results;
    }
    
    _aggregateResults(seriesResults, metrics) {
        const aggregated = {};
        
        for (const metric of metrics) {
            const values = seriesResults.map(r => r.errors[metric]);
            aggregated[metric] = {
                mean: mean(values),
                median: median(values),
                stdDev: stddev(values),
                min: Math.min(...values),
                max: Math.max(...values)
            };
        }
        
        return aggregated;
    }
    
    // Diebold-Mariano test for statistical significance
    dmTest(methodA, methodB, seriesResults) {
        const diffSeries = [];
        
        for (const result of seriesResults) {
            const d = result.errors[methodA] - result.errors[methodB];
            diffSeries.push(d);
        }
        
        // DM statistic: t = E[d] / sqrt(Var[d]/n)
        const meanDiff = mean(diffSeries);
        const varianceDiff = variance(diffSeries);
        const n = diffSeries.length;
        const dmStat = meanDiff / Math.sqrt(varianceDiff / n);
        
        // P-value from t-distribution
        const pValue = 2 * (1 - tCDF(Math.abs(dmStat), n - 1));
        
        return {
            statistic: dmStat,
            pValue: pValue,
            significant: pValue < 0.05,
            betterMethod: meanDiff > 0 ? methodB : methodA
        };
    }
}
```

### 2.2 Visualization Components

**Heatmap Generation:**
```javascript
generatePanelHeatmap(panelResults) {
    // rows: methods, cols: categories, cells: relative RMSE
    
    const heatmapData = [];
    
    for (const method of Object.keys(panelResults)) {
        for (const category of Object.keys(panelResults[method].byCategory)) {
            heatmapData.push({
                method,
                category,
                rmse: panelResults[method].byCategory[category].meanRMSE,
                normalized: this._normalizeRMSE(method, category)
            });
        }
    }
    
    return heatmapData;
}
```

**Output Format (for D3.js or Chart.js):**
```json
{
  "methods": ["holt", "snaive", "ets", "theta"],
  "categories": ["Electronics", "Clothing", "Food"],
  "matrix": [
    [234, 189, 312],  // holt
    [267, 198, 289],  // snaive
    [245, 201, 298],  // ets
    [256, 195, 305]   // theta
  ]
}
```

---

## Module 3: Spillover Effects (VAR)

### 3.1 VAR(1) Implementation

```javascript
// File: src/models/var.js

class VARModel {
    constructor(order = 1) {
        this.order = order;
        this.coefficients = null;
        this.residuals = null;
    }
    
    async fit(timeSeriesMatrix, options = {}) {
        // timeSeriesMatrix: N × T matrix (N series, T timepoints)
        
        const nSeries = timeSeriesMatrix.length;
        const nObservations = timeSeriesMatrix[0].length;
        
        // Build design matrices
        const X = this._buildDesignMatrix(timeSeriesMatrix, this.order);
        const Y = this._buildResponseMatrix(timeSeriesMatrix, this.order);
        
        // OLS estimation: β = (X'X)⁻¹X'Y
        const XtX = this._matmul(X.transpose(), X);
        const XtY = this._matmul(X.transpose(), Y);
        const beta = this._solveLinearSystem(XtX, XtY);
        
        this.coefficients = beta;
        this.residuals = Y - X.dot(beta);
        
        return {
            coefficients: this._formatCoefficients(beta),
            residuals: this.residuals,
            rSquared: this._computeRSquared(Y, this.residuals)
        };
    }
    
    _buildDesignMatrix(data, order) {
        // Create lagged features for each series
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
    
    forecast(stepsAhead) {
        const nSeries = this.coefficients.n_rows;
        
        let forecasts = [];
        let currentState = this._getLastObservedState();
        
        for (let s = 1; s <= stepsAhead; s++) {
            const nextStep = this.coefficients.dot(currentState);
            forecasts.push(nextStep);
            currentState = this._shiftState(currentState, nextStep);
        }
        
        return forecasts;
    }
}
```

### 3.2 Granger Causality Detection

**Question:** Does series A help predict series B beyond what B knows about itself?

```javascript
async function detectGrangerCausality(seriesA, seriesB, maxLags = 4) {
    // Model 1: B regressed on its own lags (restricted)
    const restricted = new VARModel(1);
    await restricted.fit([seriesB], {lags: maxLags});
    const rssRestricted = sumSquaredErrors(restricted.residuals);
    
    // Model 2: B regressed on its lags AND A's lags (unrestricted)
    const unrestricted = new VARModel(1);
    await unrestricted.fit([seriesA, seriesB], {lags: maxLags});
    const rssUnrestricted = sumSquaredErrors(unrestricted.residuals);
    
    // F-test: does adding A significantly reduce RSS?
    const n = seriesB.length;
    const kRestricted = maxLags;
    const kUnrestricted = 2 * maxLags;
    
    const fStatistic = ((rssRestricted - rssUnrestricted) / (kUnrestricted - kRestricted)) /
                       (rssUnrestricted / (n - kUnrestricted - 1));
    
    const pValue = 1 - fCDF(fStatistic, kUnrestricted - kRestricted, n - kUnrestricted - 1);
    
    return {
        grangerCause: pValue < 0.05,
        pValue: pValue,
        fStatistic: fStatistic,
        interpretation: pValue < 0.05 
            ? `Series A Granger-causes B (p=${pValue.toFixed(4)})` 
            : `No evidence of Granger causality from A to B (p=${pValue.toFixed(4)})`
    };
}
```

---

## Module 4: Factor Models

### 4.1 Principal Component Analysis (PCA)

**Analytical solution via eigenvalue decomposition:**

```javascript
// File: src/models/factor.js

class FactorExtractor {
    constructor() {
        // No state needed—purely analytical
    }
    
    extractFactors(dataMatrix, k) {
        // dataMatrix: N × T (N series, T timepoints)
        // k: number of factors to extract
        
        // Step 1: Standardize each series (zero mean, unit variance)
        const standardized = this._standardize(dataMatrix);
        
        // Step 2: Compute covariance matrix (N × N)
        const covMatrix = this._covarianceMatrix(standardized);
        
        // Step 3: Eigenvalue decomposition
        const { eigenvalues, eigenvectors } = this._eigenDecomposition(covMatrix);
        
        // Step 4: Select top k eigenvectors (principal components)
        const sortedIndices = this._sortEigenvaluesDesc(eigenvalues);
        const selectedEigenvectors = eigenvectors.slice(0, k);
        const selectedEigenvalues = eigenvalues.slice(0, k);
        
        // Step 5: Compute factor scores (how much each factor influences each observation)
        const factorScores = standardized.transpose().dot(selectedEigenvectors);
        
        return {
            factors: selectedEigenvectors,
            loadings: selectedEigenvectors,  // Same as factors in PCA
            factorScores: factorScores,
            varianceExplained: selectedEigenvalues / sum(selectedEigenvalues),
            cumulativeVariance: this._cumulativeSum(selectedEigenvalues)
        };
    }
    
    reconstruct(series, factors, factorScores) {
        // Reconstruct original series from factors
        return factorScores.dot(factors.transpose());
    }
}
```

### 4.2 Interpretation Helpers

**Automated factor labeling based on variance pattern:**

```javascript
interpretFactors(factorScores, originalData) {
    const interpretations = [];
    
    for (let k = 0; k < factorScores.length; k++) {
        const factor = factorScores[k];
        
        // Check correlation with common patterns
        const trends = {
            overallTrend: this._correlateWithLinearTrend(factor),
            weeklyPattern: this._correlateWithWeeklyDummy(factor),
            holidayEffect: this._correlateWithHolidayIndicator(factor),
            seasonalCycle: this._detectDominantFrequency(factor)
        };
        
        // Label based on strongest correlation
        const dominantPattern = Object.entries(trends)
            .reduce((max, [name, corr]) => Math.abs(corr) > Math.abs(max.value) ? {name, corr} : max, {name: 'unknown', corr: 0});
        
        interpretations.push({
            factorIndex: k,
            varianceExplained: factor.varianceExplained,
            dominantPattern: dominantPattern.name,
            strength: Math.abs(dominantPattern.corr),
            suggestedLabel: this._generateLabel(dominantPattern)
        });
    }
    
    return interpretations;
}
```

---

## CLI Integration

### New Commands

```bash
# Hierarchical reconciliation
forecastlab reconcile --hierarchy config.json --forecasts bottom_up.json --output reconciled.json

# Panel analysis
forecastlab panel --series-dir ./data/ --group-by category --methods holt,snaive,ets

# Spillover detection
forecastlab spillover --series series_a.csv series_b.csv --test granger

# Factor extraction
forecastlab factors --data market_data.csv --factors 5 --output factors.json
```

### JSON Output Extensions

```json
{
  "reconciliation": {
    "method": "optimal_combination",
    "improvementVsBottomUp": 0.15,
    "levels": {
      "country": {"rmse_before": 1200, "rmse_after": 1050},
      "region": {"rmse_before": 850, "rmse_after": 720}
    }
  },
  "panelAnalysis": {
    "methodsRanked": [
      {"method": "holt", "meanRMSE": 234, "rank": 1},
      {"method": "ets", "meanRMSE": 267, "rank": 2}
    ],
    "byCategory": {
      "electronics": {"bestMethod": "holt"},
      "clothing": {"bestMethod": "snaive"}
    }
  }
}
```

---

## Testing Strategy

### Test Dataset Generation

**Synthetic hierarchical data:**
```javascript
function generateHierarchicalTestData(nYears = 3) {
    const months = nYears * 12;
    
    // Base trend + seasonality
    const trend = Array(months).fill(0).map((_, i) => 1000 + i * 5);
    const seasonality = Array(months).fill(0).map((_, i) => 200 * Math.sin(2 * Math.PI * i / 12));
    
    // Total series
    const total = trend.map((t, i) => t + seasonality[i] + gaussianNoise(50));
    
    // Break into regions (adds up to total)
    const eastSplit = 0.6;
    const westSplit = 0.4;
    const east = total.map(v => v * eastSplit + gaussianNoise(30));
    const west = total.map(v => v * westSplit + gaussianNoise(30));
    
    // Break into products within regions
    const electronicsEast = east.map(v => v * 0.7 + gaussianNoise(20));
    const clothingEast = east.map(v => v * 0.3 + gaussianNoise(20));
    const electronicsWest = west.map(v => v * 0.5 + gaussianNoise(20));
    const clothingWest = west.map(v => v * 0.5 + gaussianNoise(20));
    
    return {
        total,
        region_east: east,
        region_west: west,
        region_east_electronics: electronicsEast,
        region_east_clothing: clothingEast,
        region_west_electronics: electronicsWest,
        region_west_clothing: clothingWest
    };
}
```

**Ground Truth Validation:**
- Verify reconciliation satisfies summing constraints exactly
- Confirm factor extraction recovers known latent variables
- Check VAR coefficients match true simulation parameters

---

## Performance Benchmarks

| Task | Series Count | Expected Time |
|------|-------------|---------------|
| Bottom-up forecasting | 10 | <1 sec |
| Optimal reconciliation | 10 | <3 sec |
| Optimal reconciliation | 100 | <15 sec |
| VAR fitting (10 series) | 10 | <5 sec |
| Factor extraction | 100 | <10 sec |
| Panel comparison (10 methods) | 50 series | <30 sec |

**Optimization Goals:**
- Use Web Workers for parallel computation in browser
- Implement sparse matrix operations where possible
- Cache intermediate calculations (covariance matrices, etc.)

---

## Success Criteria

### Functional Completeness ✅
- [ ] Hierarchical reconciliation works for arbitrary tree structures
- [ ] Panel analysis correctly ranks methods by category
- [ ] VAR captures cross-series dynamics accurately
- [ ] Factor extraction identifies meaningful latent variables

### Statistical Validity ✅
- [ ] Reconciliation improves accuracy vs naive bottom-up (tested on synthetic)
- [ ] Panel comparisons use proper statistical tests (DM test)
- [ ] VAR predictions outperform univariate models when spillovers exist
- [ ] Factors explain ≥70% total variance in appropriate scenarios

### User Experience ✅
- [ ] Documentation clear for non-experts
- [ ] Error messages helpful for mis-specified hierarchies
- [ ] Visualizations intuitive (D3/Chart.js integration)
- [ ] CLI commands discoverable and consistent

---

## Next Steps After 4A

Once 4A is complete, Phase 4B (Uncertainty Quantification) can leverage:
- Panel analysis for uncertainty comparison across groups
- VAR residuals for multi-series joint intervals
- Factor model residuals for dimension-reduced density forecasts

**Integration Point:** The `evaluate.js` module will be extended to handle multi-series metrics (average coverage across panel, joint interval success rate, etc.).

---

*This plan is subject to refinement during implementation based on practical challenges and user feedback.*
*Last updated: January 2025*
