# ForecastLab: Phase 4 Advanced Analytics Specification 📊

**Version**: 1.0  
**Date**: January 2025  
**Status**: Proposed  
**Priority**: High  

---

## Overview

Phase 4 represents ForecastLab's evolution from a **single-series forecasting workbench** to an **advanced analytics platform**. While staying true to our classical statistics roots, we push into territory typically reserved for expensive enterprise tools or ML black boxes—except every method remains explainable, reproducible, and dependency-free.

### Core Philosophy (Unchanged)

✅ **No machine learning** - All methods based on classical statistical theory  
✅ **No external dependencies** - Pure JavaScript/Node.js only  
✅ **No network calls** - Everything runs locally  
✅ **Fully explainable** - Every calculation documented with mathematics  
✅ **Reproducible** - SHA-256 hashes, exact commands logged  

---

## Phase 4A: Multi-Series Modeling

### 4A.1 Hierarchical Reconciliation

**Problem:** Sales data is often structured hierarchically:
```
Total Sales
├── Region East
│   ├── Product A
│   └── Product B
├── Region West
│   ├── Product A
│   └── Product B
```

**Challenge:** Forecasts at different levels don't add up correctly. Total ≠ sum of regions ≠ sum of products.

**Solution:** Minimize reconciliation error while preserving individual series accuracy.

#### Approach: Bottom-Up + Top-Down Hybrid

```javascript
// Step 1: Forecast all base-level series independently
const productForecasts = await forecastAll(products, {method: 'auto'});

// Step 2: Calculate reconciliation weights using OLS
const weights = solveOptimalWeights(productForecasts, hierarchy);

// Step 3: Project bottom forecasts to top level
const reconciled = reconcileBottomUp(productForecasts, weights);

// Step 4: Coherence adjustment (optional)
const final = applyMinimization(reconciled, lossFunction: 'squared');
```

**Mathematical Foundation:**
- Normal equations: `β = (X'X)⁻¹X'y`
- Minimize: `Σ(yᵢ - ŷᵢ)²` subject to `y_total = Σ y_level`
- Constraints enforced via Lagrange multipliers

**Use Cases:**
- Retail inventory planning across stores/products
- Energy demand aggregation (city → state → national)
- Finance revenue breakdown (division → department → line item)

---

### 4A.2 Panel Data Analysis

**Problem:** Comparing forecasting performance across groups of series.

**Example:** How do different methods perform across 100 SKUs? Do some methods systematically outperform others for certain categories?

#### Features

```javascript
// Compare methods across panel
const panelResults = comparePanel(seriesGroup, {
    methods: ['naive', 'snaive', 'ets', 'xgb'],
    metrics: ['RMSE', 'MAE', 'Coverage'],
    groupBy: 'category'  // analyze by product type
});

// Output:
{
    "category": "Electronics",
    "methodRankings": [
        {"method": "holt", "meanRMSE": 234, "rank": 1},
        {"method": "ets", "meanRMSE": 287, "rank": 2}
    ],
    "statisticalSignificance": {
        "winner": "holt",
        "pValue": 0.032,  // significant difference
        "test": "Diebold-Mariano"
    }
}
```

**Analysis Outputs:**
- Heatmap: Methods × Categories (color = relative RMSE)
- Pairwise comparisons with p-values (DM test)
- Confidence intervals on mean differences
- Outlier series identification (performs opposite to category trend)

---

### 4A.3 Spillover Effects

**Problem:** Series influence each other (price affects demand, sun hours affect solar generation).

**Approach:** Simplified Vector Autoregression (VAR) without MCMC complexity.

#### VAR(1) Implementation

```math
Y_t = A·Y_{t-1} + ε_t

Where:
- Y_t = vector of all series at time t
- A = coefficient matrix (N×N)
- ε_t = error term (assumed Gaussian)
```

**Estimation:**
```javascript
const varModel = fitVAR([seriesA, seriesB, seriesC], {lags: 1});

// Output coefficient matrix with interpretation
{
    "coefficients": {
        "A_on_A": 0.85,  // A tends to persist
        "B_on_A": 0.23,  // A influences B (spillover!)
        "C_on_A": 0.02   // No measurable effect
    },
    "significance": {
        "B_on_A": {pValue: 0.008, significant: true},
        "C_on_A": {pValue: 0.45, significant: false}
    }
}
```

**Applications:**
- Pricing elasticity (price → demand spillover)
- Marketing attribution (ads → sales in multiple channels)
- Supply chain ripple effects (supplier delay → production impact)

**Limitations:**
- Only captures linear relationships
- Limited to short-term dynamics (1-3 lags)
- Assumes stationarity (use differencing if needed)

---

### 4A.4 Factor Models

**Problem:** Many correlated series share common underlying drivers (economic cycles, weather patterns, seasonal trends).

**Goal:** Extract latent factors without MCMC—use analytical PCA-like solutions.

#### Principal Components Approach

```javascript
// Input: Matrix of N series × T timepoints
const factorModel = extractFactors(seriesMatrix, {k: 5});

// Output: k common factors driving variation
{
    "factors": [
        {id: 1, variance: 42, interpretation: "Overall trend"},
        {id: 2, variance: 18, interpretation: "Weekly seasonality"},
        {id: 3, variance: 12, interpretation: "Holiday spike"}
    ],
    "loadings": {  // how much each series loads on each factor
        "product_A": [0.89, 0.12, 0.03],
        "product_B": [0.91, 0.08, 0.01]
    }
}
```

**Usage:**
1. Fit models on factors instead of raw series (reduced dimensionality)
2. Reconstruct forecasts: `Ŷ = F·L'` (factors × loadings)
3. Identify anomalous series (don't follow common factors)

**Efficiency Gain:**
- Instead of modeling 100 series separately → model 5 factors + loadings
- Much faster, more stable estimates
- Easier to detect unusual behavior per series

---

## Phase 4B: Uncertainty Quantification Upgrade

### Current State vs. Target

**Current:** Simple prediction intervals (±1.96σ at each horizon)  
**Target:** Full probabilistic forecasting with joint coverage guarantees

---

### 4B.1 Cumulative Prediction Intervals

**Problem:** Users often care about totals over periods (monthly total), not just single-point forecasts.

**Solution:** Propagate uncertainty through summation.

```javascript
const hourlyForecast = forecast(series, {horizon: 7*24, method: 'snaive'});

const monthlyTotal = computeCumulativeInterval(hourlyForecast, {
    period: 'month',  // sum next 30 days
    confidence: 0.95
});

// Output:
{
    "pointEstimate": 10500,
    "interval": {lower: 9200, upper: 11800},
    "distribution": "approximated via Monte Carlo",
    "notes": "Uncertainty grows with period length"
}
```

**Math:**
- If `Y_t ~ N(μ_t, σ_t²)` independent
- Then `ΣY_t ~ N(Σμ_t, Σσ_t²)`
- In practice: use Monte Carlo to handle dependence structures

---

### 4B.2 Joint Prediction Bands

**Problem:** Single-interval coverage doesn't guarantee *all* horizons are correct simultaneously.

**Example:** 95% interval at each hour, but probability that ALL 24 hours are covered might be only 60%!

**Solution:** Simultaneous confidence bands via Bonferroni correction or simulation.

```javascript
const jointInterval = computeJointIntervals(forecast, {
    horizon: 24,
    familyWiseConfidence: 0.95  // all 24 hours together
});

// This requires wider individual intervals to ensure simultaneous coverage
```

**Visualization:**
```
         ┌─────────────┐  Upper band (joint 95%)
      ┌──┤█████████████┤──┐
      │  └─────────────┘  │
──────┤     Mean          ├──────
      │  ┌─────────────┐  │
      └──┤█████████████┤──┘
         └─────────────┘  Lower band (joint 95%)
```

**Technical:**
- Bonferroni: divide α by number of horizons (conservative)
- Simulation-based: draw 10,000 paths, take min/max at each step (more accurate)
- Process inequality bounds (Cornish-Fisher expansion) for analytic approximation

---

### 4B.3 Density Forecasts

**Beyond intervals:** Return full predictive distribution at each horizon.

```javascript
const density = getPredictiveDensity(forecast, {horizon: 7});

// Evaluate at specific points
const pdfAt_100 = density.pdf(100);  // probability density
const cdfAt_100 = density.cdf(100);  // P(Y ≤ 100)
const quantile95 = density.quantile(0.95);  // 95th percentile
```

**Distribution Families Supported:**
- Gaussian (default, symmetric)
- Student-t (heavier tails, robust to outliers)
- Skewed-t (asymmetric uncertainty)

**Applications:**
- Risk management (Value-at-Risk calculations)
- Inventory optimization (balance overstock vs. stockout costs)
- Decision analysis (expected utility maximization)

---

### 4B.4 Scenario Trees

"What-if" branching scenarios for decision support.

```javascript
const tree = buildScenarioTree(baseForecast, {
    scenarios: [
        {
            name: "Base case",
            probability: 0.6,
            adjustments: {}
        },
        {
            name: "Promotion active",
            probability: 0.25,
            adjustments: { 
                multiplicativeFactor: 1.3  // +30% uplift
            }
        },
        {
            name: "Supply disruption",
            probability: 0.15,
            adjustments: {
                additiveShock: -200,  // -200 units/day
                duration: 14  // days
            }
        }
    ]
});
```

**Output Structure:**
```
                    Base Forecast
                       |
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    Base Case    Promotion    Supply Disruption
   (60% prob.)    (25%)         (15%)
   ┌────────┐     ┌────────┐    ┌────────┐
   │▓▓▓▓▓▓│     │▓▓▓▓▓▓▓▓│    │▓▓▓▓▓▓│   
   └────────┘     └────────┘    └────────┘
```

**Use Cases:**
- Capacity planning (prepare for multiple futures)
- Financial contingency planning
- Strategic decision support (which scenario do we hedge against?)

---

## Phase 4C: Counterfactual Analysis

### What Is Counterfactual Analysis?

Answering questions like:
- "What would demand have been if we hadn't raised prices?"
- "How much better/worse would we do without that structural break?"
- "If we move the holiday from Friday to Thursday, what happens?"

**Philosophy:** Use fitted regression coefficients as causal multipliers (with appropriate caveats).

---

### 4C.1 Regression-Based Counterfactuals

**Concept:** If price change explains 30% of sales drop, then reversing the price change should reverse that effect.

```javascript
// Original fit included price as regressor
const originalFit = fit(model, {
    target: salesData,
    regressors: { price, competitorPrice, promotion }
});

// Counterfactual: what if price stayed constant?
const counterfactual = simulateCounterfactual(originalFit, {
    intervention: {
        variable: 'price',
        newValues: Array(salesData.length).fill(previousMonthPrice)
    }
});

console.log(counterfactual.gain);  
// e.g., "+15% higher sales if price had remained stable"
```

**Mathematical Form:**
- Model: `Y = β₀ + β₁·X₁ + β₂·X₂ + ε`
- Actual: `Ŷ_actual = β₀ + β₁·X₁_actual + β₂·X₂_actual`
- Counterfactual: `Ŷ_cf = β₀ + β₁·X₁_cf + β₂·X₂_actual`
- Effect: `Δ = Ŷ_cf - Ŷ_actual = β₁·(X₁_cf - X₁_actual)`

**Safety Checks Implemented:**
- Warn if correlation ≠ causation (grain-of-salt disclaimer)
- Flag extrapolation (counterfactual outside observed range)
- Sensitivity analysis (what if coefficient is wrong by ±20%?)

---

### 4C.2 Structural Break Scenarios

**Question:** "How much did this structural break cost us?"

```javascript
const analysis = analyzeBreakImpact(forecast, {
    breakPoint: timestamp_of_break,
    comparison: "no-break scenario"
});

// Projects forward both actual (with break) and counterfactual (without break)
// Quantifies divergence over time
```

**Outputs:**
- Cumulative deviation curve (break impact accumulation)
- Breakeven date (when recovery occurs, if ever)
- Statistical significance of divergence

---

### 4C.3 Automated What-If Generator

**Idea:** Automatically suggest plausible scenarios based on historical patterns.

```javascript
const suggestedScenarios = generateScenarios(historicalSeries, {
    consider: [
        'previous_promotions',     // similar promotions in history
        'holiday_shifts',          # holiday moved compared to last year
        'extreme_weather',         # analogous weather events
        'competitor_actions'       # past price wars
    ]
});
```

**Template Library:**
- Price elasticity templates (vary price ±5%, ±10%, ±15%)
- Promotion lift templates (apply historical uplift patterns)
- Seasonal shift templates (move peak week ±1, ±2 weeks)
- Trend acceleration templates (if trend changes slope by ±X%)

---

### 4C.4 Monte Carlo Simulation Engine

For complex counterfactuals requiring integration over uncertainty.

```javascript
const simulator = new MonteCarloSimulator(forecastModel, {
    nSims: 10000,        // number of simulated paths
    seed: 12345          // reproducibility
});

// Simulate counterfactual trajectory
const result = simulator.simulateCounterfactual({
    intervention: { type: 'promotion', strength: 1.2 },
    horizon: 30,
    includeUncertainty: true
});

// Result includes distribution over possible outcomes
const summary = {
    medianGain: 12.5,
    confInterval: [8.2, 17.3],
    pBetterThanZero: 0.97,  // 97% chance of positive effect
    worstCase10: -3.1,      // 10th percentile (risk metric)
    bestCase90: 28.4        // 90th percentile (opportunity)
};
```

**Applications:**
- ROI estimation for marketing campaigns
- Risk assessment for strategic decisions
- A/B test power analysis (before experiment runs)

---

### 4C.5 Sensitivity Analysis Sweeps

**Question:** "How sensitive is our conclusion to parameter uncertainty?"

```javascript
const sensitivity = sweepParameters(forecastModel, {
    parameters: ['trend_slope', 'seasonal_factor'],
    ranges: {
        trend_slope: [-0.8, -0.2],   // vary between these values
        seasonal_factor: [0.85, 1.15]
    },
    steps: 20  // grid search resolution
});
```

**Output:** Heatmaps showing how forecast changes under parameter variations.

**Insights Gained:**
- Which parameters matter most (prioritize accurate estimation)
- Robustness of conclusions (if results hold across wide range, more confident)
- Critical thresholds (e.g., "if trend > -0.3, forecast flips from decline to growth")

---

## Phase 4D: Real-Time Adaptation

### Clarifying the Scope

**What We Are NOT Building:**
- ❌ Continuous streaming pipeline
- ❌ Sub-second update latency requirements
- ❌ Kafka/pub-sub message queue integration

**What We ARE Building:**
- ✅ Scheduled retraining (daily, weekly, monthly)
- ✅ Event-triggered updates after detecting change points
- ✅ Adaptive weighting schemes (recent data emphasized)
- ✅ Sliding window refitting options

---

### 4D.1 Update Scheduling System

```javascript
const scheduler = new UpdateScheduler({
    schedule: 'weekly',           // daily | weekly | monthly | custom
    timezone: 'America/New_York',
    dayOfWeek: 1,                 // Monday
    timeOfDay: '02:00',           // 2 AM
    autoTriggerOnChange: true     // also trigger on structural break detection
});

await scheduler.registerTask({
    modelId: 'sales_forecast_main',
    action: 'refit',
    options: { 
        retrainWindow: 'last_90_days',  // sliding window
        incremental: false               // full refit (or true for speed)
    }
});
```

**Output:** Cron-like job logs with timestamps, execution times, success/failure status.

---

### 4D.2 Event-Triggered Updates

**Automatic triggers:**
1. **Structural break detected** - CUSUM test exceeds threshold
2. **Error spike** - RMSE suddenly jumps above baseline
3. **New data pattern** - ACF changes significantly
4. **Manual override** - user explicitly requests update

```javascript
// Auto-update when error exceeds 2x baseline
model.on('error_spike', {threshold: 2.0}, async () => {
    console.log('Detected model degradation, refitting...');
    await model.refit({window: 'last_6_months'});
});
```

---

### 4D.3 Adaptive Weighting

Give more weight to recent observations during fitting.

**Exponential Decay:**
```math
L_t = L_{t-1} · ρ + log-likelihood(data_t)

Where ρ ∈ [0, 1] controls memory:
- ρ = 1.0 : All history equally weighted (standard MLE)
- ρ = 0.9 : Recent data gets 2x weight vs 10 periods ago
- ρ = 0.8 : Strong recency bias (good for non-stationary data)
```

**Implementation:**
```javascript
const fitResult = fit(model, data, {
    decayFactor: 0.95  // half-life ~14 periods
});
```

**When to Use:**
- Changing business conditions (growth, decline, new competition)
- Gradual concept drift (customer preferences evolving)
- Avoid when structural breaks present (use sliding window instead)

---

### 4D.4 Sliding Window Refitting

Alternative to exponential decay: only use last N observations.

```javascript
const result = fit(model, data, {
    windowSize: 'last_180_days',  // or numeric: 180
    overlap: 'full'  // or 'incremental' for speed
});
```

**Pros:**
- Clean boundary (no old data contamination)
- Fast computation (less data)
- Adapts quickly to regime changes

**Cons:**
- Less statistical power (fewer observations)
- Can miss long-cycle patterns (yearly seasonality needs yearly data)

**Best Practice:** Combine approaches!
```javascript
fit(model, data, {
    windowSize: 'last_2_years',    // enough for yearly cycle
    decayFactor: 0.97,             // emphasize recent months within window
    robust: true                   // outlier resistant
});
```

---

## Implementation Roadmap

### Phase 4A: Multi-Series (Months 1-3)

**Priority Order:**
1. **Hierarchical reconciliation** (clearest immediate ROI)
2. **Panel analysis utilities** (support for existing features)
3. **Simple VAR implementation** (educational value + practical uses)
4. **Factor extraction** (nice-to-have for large-scale deployments)

**Deliverables:**
- New CLI command: `forecastlab multi --hierarchy config.json`
- API extension: `MultiSeries.fit()` and `MultiSeries.reconcile()`
- Documentation: Hierarchical forecasting tutorial
- Tests: Synthetic hierarchical datasets with known ground truth

---

### Phase 4B: Uncertainty Quantification (Months 2-4)

**Dependency:** Requires Phase 4A foundation (factor models benefit from multi-series)

**Priority Order:**
1. **Cumulative intervals** (high demand from inventory planners)
2. **Monte Carlo engine** (foundation for everything else)
3. **Joint bands** (statistical rigor)
4. **Density forecasts** (research/professional users)

**Deliverables:**
- New report sections showing uncertainty visualizations
- JSON output extensions with full distributions
- Interactive dashboard components (via serve mode)
- Examples with risk/inventory applications

---

### Phase 4C: Counterfactual Analysis (Months 3-5)

**This is the crown jewel feature**—differentiates ForecastLab from everything else.

**Priority Order:**
1. **Regression-based counterfactuals** (simplest to implement + most intuitive)
2. **Automated scenario generator** (immediate value)
3. **Monte Carlo simulator** (enables complex queries)
4. **Sensitivity sweeps** (advanced but critical for trust)

**Deliberative Design:**
- Extensive documentation on limitations (correlation ≠ causation)
- Prominent disclaimers in outputs
- Educational content on causal inference basics
- Case studies showing proper use

**Deliverables:**
- CLI command: `forecastlab what-if --scenario promotion`
- Report section: Counterfactual scenarios
- Tutorial: "Answering business questions with forecasting"
- Integration tests with synthetic causal data

---

### Phase 4D: Real-Time Adaptation (Months 4-6)

**Parallel development track** (doesn't depend heavily on other phases)

**Priority Order:**
1. **Update scheduler** (foundation for automation)
2. **Sliding window refitting** (most straightforward technique)
3. **Event-triggered updates** (adds intelligence)
4. **Adaptive weighting** (most sophisticated)

**Deliverables:**
- Configuration file format for scheduling (`update-schedule.json`)
- CLI command: `forecastlab update --schedule weekly`
- Logging system for update history
- Monitoring dashboard (in serve mode)

---

## Success Metrics for Phase 4

### Accuracy Improvements
- [ ] Hierarchical reconciliation reduces total forecast error by ≥15% vs naive bottom-up
- [ ] Joint intervals achieve true 95% simultaneous coverage (not just marginal)
- [ ] Counterfactual analyses produce predictions within 10% of actual post-hoc

### Performance Benchmarks
- [ ] Panel analysis of 100 series completes in <30 seconds
- [ ] Monte Carlo with 10,000 sims finishes in <5 seconds (optimized)
- [ ] Hierarchical model with 10 levels reconciles in <2 seconds

### User Adoption Indicators
- [ ] 30% of production reports include counterfactual scenarios
- [ ] Users request multi-series modeling support in issues/PRs
- [ ] Academic citations mention Phase 4 features

### Code Quality Goals
- [ ] Test coverage ≥90% for new modules
- [ ] Zero breaking API changes (additive-only extensions)
- [ ] Documentation completeness score ≥95% (measured)

---

## Non-Goals for Phase 4 (Explicitly Out of Scope)

❌ **Deep learning variants** (LSTM, Transformers, etc.) — still classical stats only  
❌ **Real-time streaming ingestion** — batch-oriented philosophy maintained  
❌ **AutoML hyperparameter search** (beyond existing smart tuning) — manual control preferred  
❌ **Cloud deployment orchestration** (Kubernetes, containers) — local-first stays core  
❌ **Natural language query interface** ("show me next month's forecast") — CLI/programmatic only  
❌ **Mobile app** — desktop/web-focused  

---

## Integration Points with Existing v3.0 Features

| v3.0 Feature | Phase 4 Enhancement |
|--------------|---------------------|
| Auto-seasonality detection | Extended to multi-series common patterns |
| Method recommendation | Panel-level recommendations (category-specific advice) |
| Ensemble forecasting | Hierarchical ensembles (coherent across levels) |
| Structural break detection | Used to trigger adaptive updates & counterfactuals |
| Missing value imputation | Multi-series joint imputation (leverage correlations) |
| Parameter tuning | Bayesian optimization extended to factor models |
| Anomaly detection | Hierarchical anomalies (local + system-wide) |

---

## Risks & Mitigations

### Risk 1: Scope Creep
**Concern:** Phase 4 expands too far, delaying delivery indefinitely.

**Mitigation:**
- Strict prioritization within each sub-phase (4A vs 4B vs 4C)
- Timeboxed sprints (max 3 months per major component)
- MVP-first approach: get working version out, iterate

### Risk 2: Computational Complexity
**Concern:** Monte Carlo simulations, factor models become slow with many series.

**Mitigation:**
- Implement progressive refinement (quick estimate → accurate later)
- Offer sampling control (users choose tradeoff speed/accuracy)
- Optimize core algorithms (vectorized operations, web workers)

### Risk 3: Misinterpretation
**Concern:** Users treat counterfactuals as causal truths when they're not.

**Mitigation:**
- Prominent disclaimers everywhere
- Educational materials on limitations
- Built-in sanity checks (flag extrapolations, weak correlations)
- Require explicit acknowledgment before generating counterfactual reports

### Risk 4: Testing Complexity
**Concern:** Hard to create ground-truth datasets for evaluation.

**Mitigation:**
- Synthetic data generators with known properties
- Public benchmark datasets with established baselines
- Community validation (users submit real-case results)

---

## Glossary of Terms

**Hierarchical Reconciliation:** Adjusting forecasts so sums match across organizational levels.

**Panel Data:** Multiple time series grouped by category (products, regions, customers).

**VAR (Vector Autoregression):** Linear model capturing cross-series dynamics (A affects B affects C).

**Factor Model:** Latent variables explaining correlation structure across many series.

**Bonferroni Correction:** Statistical technique adjusting confidence levels for multiple comparisons.

**Joint Prediction Bands:** Confidence intervals ensuring simultaneous coverage across all horizons.

**Monte Carlo Simulation:** Numerical integration via random sampling to approximate distributions.

**Counterfactual:** Hypothetical scenario answering "what would have happened if..."

**Sliding Window:** Using only recent N observations for fitting (ignoring older history).

**Exponential Smoothing in Time:** Giving recency weight to observations (recent = more important).

---

*This specification will evolve based on user feedback and practical implementation experience.*
*Last updated: January 2025*
