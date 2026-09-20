# ForecastLab: Phase 4 Integration Guide 🔗

**Version**: 1.0  
**Status**: Integration Guide  
**Purpose**: Show how Phase 4 features connect to and enhance existing v3.0 capabilities  

---

## Overview

Phase 4 doesn't replace ForecastLab's core engine—it **extends and amplifies** it. This guide maps Phase 4 components to existing v3.0 modules, showing:

1. Which v3.0 features are reused/extended
2. Where new code integrates with old
3. How to think about backward compatibility
4. Migration path for existing users

---

## Architecture Map

```
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 4: Advanced Analytics              │
├─────────────────────────────────────────────────────────────┤
│  Multi-Series ────→ Uses: series.js, evaluate.js            │
│  Uncertainty ──────→ Uses: models/*.js, report.js           │
│  Counterfactuals ──→ Uses: models/regression.js             │
│  Real-Time ────────→ Extends: project.js, cli.js            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                 PHASE 3-2: Core Engine                      │
├─────────────────────────────────────────────────────────────┤
│  Auto-seasonality ──→ Used by: multiSeries.js               │
│  Ensemble ───────────→ Extended by: factorModels.js         │
│  Structural break ───→ Triggers: realTimeUpdate.js          │
│  Anomaly detection ──→ Feeds: uncertaintyQuantifier.js      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                PHASES 1 & 0: Foundation                     │
├─────────────────────────────────────────────────────────────┤
│  Holt-Winters ─────────────────────→ All phases reuse       │
│  Fourier terms ────────────────────→ Exogenous regressors   │
│  Backtesting engine ───────────────→ Evaluation metrics     │
│  Project file format ──────────────→ Versioned storage      │
└─────────────────────────────────────────────────────────────┘
```

---

## Module-by-Module Integration

### 1. Series Module (`src/engine/series.js`)

#### Current v3.0 Capability
```javascript
// Single time series operations
class TimeSeries {
    constructor(data) { /* ... */ }
    
    checkQuality() { /* gaps, outliers, etc. */ }
    resample(interval) { /* irregular → regular */ }
    decompose() { /* trend + seasonality + residual */ }
}
```

#### Phase 4A Extension: Multi-Series Operations

```javascript
// NEW: Multi-series joint operations
class MultiSeriesAnalyzer {
    constructor(seriesMap) { /* Object.<id, TimeSeries> */ }
    
    // Reuses: TimeSeries.checkQuality(), resample()
    async jointQualityCheck() {
        const individual = Object.values(this.seriesMap).map(ts => 
            ts.checkQuality()
        );
        
        // Add cross-series checks
        const missingPatterns = this._detectSystematicGaps(individual);
        const correlatedOutliers = this._findSimultaneousAnomalies(individual);
        
        return { individual, missingPatterns, correlatedOutliers };
    }
    
    // NEW: Joint imputation leveraging correlations
    jointImputation(strategy = 'factor_based') {
        if (strategy === 'factor_based') {
            // Use factor models (Phase 4B) to inform imputation
            const factors = extractFactors(this.extractDataMatrix());
            return this._imputeUsingFactors(factors);
        }
    }
}
```

**Integration Point:** `MultiSeriesAnalyzer` wraps existing `TimeSeries` objects, extending them without modifying core logic.

---

### 2. Models Module (`src/engine/models/*.js`)

#### Current v3.0 Structure

```
models/
├── naive.js           # Baseline methods
├── seasonal_naive.js
├── holt.js
├── holtWinters.js
├── ets.js
├── arima.js           # Limited ARIMA implementation
└── regression.js      # Simple linear regression with exogenous vars
```

#### Phase 4A Additions

**NEW FILE: `src/engine/models/var.js` (Vector Autoregression)**

```javascript
// Leverages existing model interface from Phase 2
class VARModel extends BaseForecastingModel {
    constructor(order = 1) {
        super();
        this.order = order;
        this.coefficients = null;
    }
    
    // Reuses: Base model fitting infrastructure
    async fit(timeSeriesMatrix, options = {}) {
        // timeSeriesMatrix: N × T matrix of related series
        
        // Build design matrices using lag structures
        const X = this._buildLaggedFeatures(timeSeriesMatrix, this.order);
        const Y = this._buildResponseMatrix(timeSeriesMatrix, this.order);
        
        // OLS estimation reusing statistical utilities
        const beta = ordinaryLeastSquares(X, Y);
        
        this.coefficients = beta;
        
        return {
            coefficients: this._formatCoefficients(beta),
            rSquared: this._computeRSquared(Y, predict(X, beta))
        };
    }
    
    // Reuses: forecast propagation logic from single-series models
    forecast(stepsAhead) {
        let currentState = this.getLastObservedState();
        const forecasts = [];
        
        for (let s = 1; s <= stepsAhead; s++) {
            const nextStep = this.coefficients.dot(currentState);
            forecasts.push(nextStep);
            currentState = this.shiftState(currentState, nextStep);
        }
        
        return forecasts;
    }
}
```

**NEW FILE: `src/engine/models/factor.js` (Factor Models)**

```javascript
class FactorModel extends BaseForecastingModel {
    // NEW: Analytical PCA extraction
    async extractLatentFactors(dataMatrix, k) {
        // Standardize each series (reuses statistics module)
        const standardized = standardizeRows(dataMatrix);
        
        // Compute covariance matrix (vectorized operation)
        const covMatrix = computeCovariance(standardized);
        
        // Eigenvalue decomposition (linear algebra utilities)
        const { eigenvalues, eigenvectors } = eigenDecomposition(covMatrix);
        
        // Select top k factors
        const selectedComponents = selectTopKEigenvectors(eigenvectors, k);
        
        return {
            factors: selectedComponents,
            varianceExplained: computeVarianceExplained(eigenvalues),
            loadings: computeLoadings(selectedComponents, standardized)
        };
    }
    
    // NEW: Reconstr uct forecasts from factors
    reconstructFromFactors(factors, factorScores) {
        return factorScores.dot(factors.transpose());
    }
}
```

**Extension Point:** All new models extend `BaseForecastingModel`, ensuring API consistency.

---

### 3. Evaluation Module (`src/engine/evaluate.js`)

#### Current v3.0 Metrics

```javascript
const METRICS = {
    RMSE: (actual, forecast) => sqrt(mean((actual - forecast)²)),
    MAE: (actual, forecast) => mean(abs(actual - forecast)),
    MAPE: (actual, forecast) => mean(abs((actual - forecast) / actual)) * 100,
    Coverage: (actual, lower, upper) => proportionInRange(actual, lower, upper)
};
```

#### Phase 4A Enhancement: Panel-Level Metrics

```javascript
// NEW: Aggregate metrics across panels
const PANEL_METRICS = {
    meanRMSE: (panelResults) => {
        // Average RMSE across all series in panel
        const rmseBySeries = panelResults.map(r => r RMSE);
        return {
            overall: mean(rmseBySeries),
            byCategory: groupBy(panelResults, 'category').map(group => ({
                category: group[0].category,
                meanRMSE: mean(group.map(g => g RMSE))
            }))
        };
    },
    
    // NEW: Diebold-Mariano test for significance
    dmTest: (methodA_forecasts, methodB_forecasts, actual) => {
        const losses_A = squareErrors(methodA_forecasts, actual);
        const losses_B = squareErrors(methodB_forecasts, actual);
        
        const diffLosses = losses_A.map((lA, i) => lA - losses_B[i]);
        
        const meanDiff = mean(diffLosses);
        const varianceDiff = variance(diffLosses);
        const n = diffLosses.length;
        
        // DM statistic
        const dmStat = meanDiff / sqrt(varianceDiff / n);
        
        // P-value from t-distribution
        const pValue = 2 * (1 - tCDF(abs(dmStat), n - 1));
        
        return {
            statistic: dmStat,
            pValue: pValue,
            significant: pValue < 0.05,
            betterMethod: meanDiff > 0 ? methodB : methodA
        };
    }
};
```

**Integration Strategy:** New panel metrics wrap existing single-series evaluation functions.

---

### 4. Report Module (`src/engine/report.js`)

#### Current v3.0 Output Structure

```json
{
  "project": "energy.forecast.json",
  "version": "3.0",
  "inputHash": "sha256:...",
  "forecasts": [...],
  "backtestResults": {...},
  "dataQualityNotes": [...]
}
```

#### Phase 4 Extensions

**Enhanced JSON Output:**

```json
{
  "project": "hierarchical_sales.json",
  "version": "4.0",
  
  "hierarchicalReconciliation": {
    "method": "optimal_combination",
    "improvementVsBottomUp": 0.15,
    "byLevel": {
      "country": { rmse_before: 1200, rmse_after: 1050 },
      "region": { rmse_before: 850, rmse_after: 720 }
    }
  },
  
  "uncertainty": {
    "jointPredictionBands": {
      "confidence": 0.95,
      "lower": [...],
      "upper": [...]
    },
    "cumulativeIntervals": {
      "period_7day": { pointEstimate: 805, interval: { lower: 720, upper: 890 } },
      "period_30day": { pointEstimate: 3200, interval: { lower: 2800, upper: 3600 } }
    }
  },
  
  "counterfactuals": [
    {
      "name": "Price stability scenario",
      "description": "What if price had remained at $10 throughout?",
      "interpretation": "+12.3% sales (+520 units cumulative)",
      "confidence": 0.78,
      "warnings": ["Extrapolation detected"],
      "original_vs_cf": {
        "original_total": 4200,
        "counterfactual_total": 4720,
        "difference": "+520"
      }
    }
  ],
  
  "riskMetrics": {
    "var_95": -300,
    "cvar_95": -520,
    "downsideProbability": 0.15
  }
}
```

**HTML Report Enhancements:**

```html
<!-- NEW Sections added to report.html template -->

<section id="hierarchical-reconciliation">
  <h2>Hierarchical Forecast Reconciliation</h2>
  <div id="reconciliation-chart"></div>
  <table id="reconciliation-table">
    <!-- Dynamic rows from hierarchical JSON output -->
  </table>
</section>

<section id="uncertainty-quantification">
  <h2>Advanced Uncertainty Analysis</h2>
  <div id="joint-bands-chart" class="interactive-line-chart"></div>
  <div id="scenario-tree" class="sankey-diagram"></div>
</section>

<section id="counterfactual-analysis">
  <h2>Counterfactual Scenarios</h2>
  <div id="counterfactual-comparison">
    <button class="scenario-selector" data-scenario="price_stability">
      Price Stability
    </button>
    <button class="scenario-selector" data-scenario="promotion_active">
      Promotion Active
    </button>
  </div>
  <div id="counterfactual-chart"></div>
</section>

<script>
// Integrate D3.js visualizations for new sections
loadD3Chart('#joint-bands-chart', forecastData.jointPredictionBands);
buildSankeyTree('#scenario-tree', scenarioTreeVisualization);
initializeCounterfactualSlider('#counterfactual-chart', counterfactualEngine);
</script>
```

---

### 5. CLI Integration

#### Current v3.0 Commands

```bash
forecastlab init --data data.csv --unit kWh --season 24
forecastlab check --project energy.forecast.json
forecastlab compare --project energy.forecast.json
forecastlab report --project energy.forecast.json --html output.html
```

#### Phase 4 New Commands

```bash
# Multi-series modeling
forecastlab reconcile --hierarchy config.json --forecasts bottom_up.json --output reconciled.json
forecastlab panel --series-dir ./data/ --group-by category --methods holt,snaive,ets
forecastlab spillover --series A.csv B.csv --test granger
forecastlab factors --data market_data.csv --factors 5 --output factors.json

# Uncertainty quantification
forecastlab uncertainty --project sales.forecast.json --type cumulative --period 30days
forecastlab uncertainty --project sales.forecast.json --type joint --confidence 0.95

# Counterfactual analysis
forecastlab what-if --project sales.forecast.json \
  --scenario promotion \
  --parameters lift=1.3,duration=14 \
  --output counterfactual_analysis.json

forecastlab sensitivity --project sales.forecast.json \
  --parameter trend_slope \
  --range -0.8,-0.2 \
  --steps 20

# Real-time adaptation
forecastlab schedule --config update-schedule.json
forecastlab update --model main_forecast --trigger on_break_detection
```

**Backward Compatibility:** All v3.0 commands remain functional and unchanged.

---

## Data Flow Diagram

```
CSV Input (v3.0)
    ↓
[init] → Creates .forecast.json project file ← REUSES v3.0 format
    ↓
[check] → Data quality validation ← REUSES v3.0 pipeline
    ↓
[compare] → Method backtesting ← ENHANCED by: panel analysis
    ↓
[fit_model] → Fits single-series models ← EXTENDED by: VAR, factor models
    ↓
[PHASE 4 MODULES] ← NEW processing layer
    ├─ Hierarchical reconciliation (if hierarchy defined)
    ├─ Uncertainty quantification (new confidence types)
    ├─ Counterfactual simulation (if intervention specified)
    └─ Adaptive updates (if scheduling configured)
    ↓
[report] → HTML/JSON output ← EXTENDED schema for new features
    ↓
Interactive serve mode ← ENHANCED with new visualization components
```

---

## Backward Compatibility Guarantees

### ✅ **What Stays Unchanged**

1. **Project File Format** `.forecast.json`
   - Existing files continue to work
   - Phase 4 features are additive fields
   
2. **Single-Series Forecasting API**
   - `fit(series, 'holt')` works exactly as before
   - No breaking changes to model interfaces
   
3. **Core CLI Commands**
   - `init`, `check`, `compare`, `report` signatures unchanged
   - New features accessed via optional flags or subcommands

4. **Output Schema (Base Case)**
   - Default JSON reports include same core fields
   - Phase 4 extensions opt-in via `--advanced` flag

### 🆕 **What's Added**

1. **New Command Subgroups**
   - `forecastlab multi*` commands
   - `forecastlab uncertainty*` commands
   - `forecastlab what-if` command
   
2. **Extended Output Fields**
   - Optional sections in JSON reports
   - Additional HTML chart containers
   
3. **Configuration Options**
   - New `.forecast.json` fields for hierarchy definitions
   - Scheduling configuration files

### 🔄 **Migration Path**

```javascript
// v3.0 user upgrading to Phase 4: NO CODE CHANGES REQUIRED

// Existing project file (fully compatible)
{
  "data": {"path": "sales.csv"},
  "method": "holt",
  "horizon": 30
}

// Phase 4-enhanced project file (backward compatible additions)
{
  "data": {"path": "sales.csv"},
  "method": "holt",
  "horizon": 30,
  
  // NEW: Hierarchical structure
  "hierarchy": {
    "levels": ["region", "product"],
    "seriesId": "west_electronics"
  },
  
  // NEW: Advanced uncertainty requests
  "uncertainty": {
    "type": "joint_bands",
    "confidence": 0.95
  },
  
  // NEW: Counterfactual query
  "counterfactual": {
    "question": "What if price had been constant?",
    "intervention": {
      "variable": "price",
      "constantValue": 10
    }
  }
}
```

---

## Testing Strategy: Integration Verification

### Test Suite Organization

```
test/
├── unit/
│   ├── models/
│   │   ├── var.test.js         # Phase 4A isolated tests
│   │   └── factor.test.js      # Phase 4A isolated tests
│   └── uncertainty/
│       ├── monte-carlo.test.js # Phase 4B isolated tests
│       └── counterfactual.test.js
├── integration/
│   ├── multiSeries-integration.test.js  # Tests against v3.0 engine
│   └── report-integration.test.js       # Verifies extended outputs
└── e2e/
    ├── full-pipeline-with-phase4.test.js
    └── backward-compatibility.test.js
```

### Key Integration Tests

```javascript
// TEST: Existing workflow continues to work
describe('Backward Compatibility', () => {
    it('processes v3.0 project file without errors', async () => {
        const projectFile = readJson('examples/v3.0-energy.forecast.json');
        const result = await runPipeline(projectFile);
        
        expect(result).toHaveProperty('forecasts');
        expect(result).toHaveProperty('backtestResults');
        expect(result.version).toBe('3.0');
    });
    
    it('generates same single-series results with and without Phase 4 enabled', async () => {
        const project = createSimpleProject('holt');
        
        const result_v3only = await runPipeline(project, {phase4: false});
        const result_with_phase4 = await runPipeline(project, {phase4: true});
        
        expect(result_v3only.forecasts).toEqual(result_with_phase4.forecasts);
        // Phase 4 adds extra fields but doesn't change base forecasts
    });
});

// TEST: Phase 4 correctly leverages v3.0 infrastructure
describe('Phase 4 Integration', () => {
    it('uses v3.0 backtesting engine for panel analysis', async () => {
        const panelData = generatePanelDataset(10, 500);
        
        const panelResults = await comparePanelMethods(panelData, ['holt', 'snaive']);
        
        // Verify it uses same accuracy metrics as v3.0
        expect(Object.keys(panelResults.byCategory['Electronics'])).toContain('RMSE');
        expect(panelResults.byCategory['Electronics'].RMSE).toBeGreaterThanOrEqual(0);
    });
    
    it('applies structural break detection before counterfactual simulation', async () => {
        const project = createCounterfactualProject({
            hasStructuralBreak: true,
            breakPoint: 200
        });
        
        const result = await runCounterfactualAnalysis(project);
        
        // Should warn about break point affecting counterfactual validity
        expect(result.warnings).toContain('Structural break detected at t=200');
    });
});
```

---

## Upgrade Checklist for Maintainers

### Code Changes Required

- [ ] Add `src/engine/multiSeries.js` (Phase 4A)
- [ ] Add `src/engine/reconcile.js` (Phase 4A)
- [ ] Add `src/engine/uncertainty.js` (Phase 4B)
- [ ] Add `src/engine/counterfactual.js` (Phase 4C)
- [ ] Extend `src/engine/report.js` with new JSON/HTML templates
- [ ] Add CLI subcommands in `src/cli.js`
- [ ] Create Phase 4 test suites

### Dependency Updates

- [ ] Verify no new npm dependencies (all pure JS)
- [ ] Update package.json version: `3.0 → 4.0.0` (major bump due to feature additions)
- [ ] Update README.md with Phase 4 features section

### Documentation Updates

- [ ] Write Phase 4 usage tutorials (docs/tutorials/)
- [ ] Update API documentation (JSDoc comments)
- [ ] Create migration guide for v3.0 → v4.0 users
- [ ] Add example datasets with hierarchies

### Quality Assurance

- [ ] Achieve ≥90% test coverage for new modules
- [ ] Performance benchmarks documented
- [ ] Backward compatibility confirmed across 10 sample projects
- [ ] User acceptance testing with pilot customers

---

## Success Criteria

✅ **Seamless Integration**
- v3.0 users upgrade without breaking existing workflows
- New features are opt-in where possible
- Clear documentation on when to use Phase 4 vs classic mode

✅ **Performance Parity**
- Phase 4 features don't slow down default v3.0 operations
- Large Monte Carlo simulations configurable by user preference
- Memory-efficient handling of multi-series data

✅ **Code Quality**
- Consistent style with existing codebase
- Comprehensive JSDoc comments
- Test coverage ≥90% for new functionality

---

*This integration ensures ForecastLab evolves naturally—extending capabilities while honoring its foundational principles.*
*Last updated: January 2025*
