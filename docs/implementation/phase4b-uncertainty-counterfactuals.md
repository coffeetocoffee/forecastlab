# ForecastLab: Phase 4B - Uncertainty & Counterfactuals Technical Specs 🔮

**Version**: 1.0  
**Status**: Technical Specifications  
**Timeline**: Months 2-5 of Phase 4 (overlaps with 4A)  

---

## Overview

Phase 4B transforms ForecastLab from a **point-estimate forecasting tool** into a **full probabilistic decision-support platform**, providing:

1. **Enhanced uncertainty quantification** - Beyond simple intervals to full distributions
2. **Counterfactual analysis** - "What would have happened if..." scenario planning
3. **Risk metrics** - Value-at-Risk, tail expectations, downside probabilities
4. **Scenario trees** - Multi-path branching forecasts for strategic planning

All methods remain transparent classical statistics with zero ML black boxes.

---

## Part 1: Advanced Uncertainty Quantification

### Current Limitations

**v3.0 Prediction Intervals:**
```javascript
{
    "forecasts": [100, 105, 110, ...],
    "interval_95": {lower: [...], upper: [...]}  // ±1.96σ at each point independently
}
```

**Problems:**
1. ❌ Marginal coverage only (each point individually 95%)
2. ❌ Doesn't account for summation uncertainty (monthly totals)
3. ❌ Assumes Gaussian distribution (may not fit)
4. ❌ No joint guarantees (all points simultaneously covered?)

---

### 4B.1 Cumulative Prediction Intervals

**Use Case:** Inventory planners care about total demand over next 30 days, not individual daily forecasts.

#### Mathematical Foundation

**Single horizon:** If `Y_t ~ N(μ_t, σ_t²)` then `P(Y_t ∈ [L_t, U_t]) = 0.95`

**Sum over H periods:** Let `S_H = Σ_{t=1}^{H} Y_t`

**If independent:** `S_H ~ N(Σμ_t, Σσ_t²)`  
**But:** Time series are autocorrelated → use Monte Carlo

#### Implementation

```javascript
// File: src/engine/uncertainty.js

class UncertaintyQuantifier {
    constructor(forecastModel) {
        this.model = forecastModel;
        this.nSimulations = 10000;
    }
    
    // Generate prediction interval for cumulative sum
    async computeCumulativeInterval(horizon, confidence = 0.95) {
        // Step 1: Simulate many paths over the horizon
        const simulations = await this._simulatePaths(horizon, this.nSimulations);
        
        // Step 2: Sum each path across the cumulative period
        const cumulativeSums = simulations.map(path => 
            path.slice(0, horizon).reduce((sum, val) => sum + val, 0)
        );
        
        // Step 3: Extract percentiles from empirical distribution
        const lowerPercentile = (1 - confidence) / 2;
        const upperPercentile = 1 - (1 - confidence) / 2;
        
        const sortedSums = cumulativeSums.sort((a, b) => a - b);
        const lowerIndex = Math.floor(sortedSums.length * lowerPercentile);
        const upperIndex = Math.floor(sortedSums.length * upperPercentile);
        
        return {
            pointEstimate: cumulativeSums.reduce((a, b) => a + b, 0) / cumulativeSums.length,
            interval: {
                lower: sortedSums[lowerIndex],
                upper: sortedSums[upperIndex]
            },
            confidence: confidence,
            method: 'monte_carlo_simulations'
        };
    }
    
    _async simulatePaths(horizon, nPaths) {
        const paths = [];
        
        // Get model parameters and residual structure
        const params = this.model.getParameters();
        const residualCovariance = this.model.estimateResidualCovariance();
        
        for (let p = 0; p < nPaths; p++) {
            let currentPath = [];
            let currentState = this.model.getLastState();
            
            for (let t = 1; t <= horizon; t++) {
                // Draw random error term with correct covariance structure
                const error = this._drawCorrelatedError(residualCovariance);
                
                // Propagate state forward
                const nextValue = this.model.propagate(currentState, error);
                currentPath.push(nextValue);
                currentState = this.model.updateState(currentState, nextValue);
            }
            
            paths.push(currentPath);
        }
        
        return paths;
    }
}
```

#### Example Usage

```javascript
const forecast = await fitAndForecast(seriesData, 'holt');

const cumulatives = new UncertaintyQuantifier(forecast);

// Point forecast for next 7 days
console.log(forecast.forecasts);  // [100, 105, 110, 115, 120, 125, 130]

// But what's the total demand over next week with 95% confidence?
const weeklyTotal = await cumulatives.computeCumulativeInterval(7, 0.95);

console.log(weeklyTotal);
/*
{
  pointEstimate: 805,  // sum([100, 105, ..., 130])
  interval: {
    lower: 720,
    upper: 890
  },
  confidence: 0.95,
  method: 'monte_carlo_simulations'
}
*/
```

#### Output Format Extension

```json
{
  "forecast": {
    "points": [100, 105, 110, 115, 120],
    "marginalIntervals_95": {
      "lower": [95, 100, 105, 110, 115],
      "upper": [105, 110, 115, 120, 125]
    },
    "cumulativeIntervals": {
      "period_7day": {
        "pointEstimate": 805,
        "interval": {"lower": 720, "upper": 890},
        "confidence": 0.95
      },
      "period_30day": {
        "pointEstimate": 3200,
        "interval": {"lower": 2800, "upper": 3600},
        "confidence": 0.95
      }
    }
  }
}
```

---

### 4B.2 Joint Prediction Bands

**Problem:** 95% interval at each hour doesn't mean 95% chance ALL 24 hours are covered!

**Bonferroni Correction:** To ensure simultaneous 95% coverage across H horizons:
```math
α_adj = α / H = 0.05 / 24 = 0.00208

Use z_{1-α_adj/2} = z_{0.99896} ≈ 3.0 instead of 1.96
```

#### Implementation

```javascript
class JointPredictionBands {
    constructor(marginalForecasts) {
        this.forecasts = marginalForecasts;  // Array of {value, sigma} per horizon
        this.horizon = marginalForecasts.length;
    }
    
    computeJointBounds(confidence = 0.95, method = 'bonferroni') {
        if (method === 'bonferroni') {
            return this._bonferroniCorrection(confidence);
        } else if (method === 'simulation') {
            return this._simulationBased(confidence);
        }
    }
    
    _bonferroniCorrection(confidence) {
        const alpha = 1 - confidence;
        const alphaAdj = alpha / this.horizon;
        const zScore = this._inverseNormalCDF(1 - alphaAdj / 2);
        
        const bounds = {
            lower: [],
            upper: []
        };
        
        for (const point of this.forecasts) {
            bounds.lower.push(point.mean - zScore * point.stdDev);
            bounds.upper.push(point.mean + zScore * point.stdDev);
        }
        
        return bounds;
    }
    
    _simulationBased(confidence) {
        // Simulate entire trajectory paths
        const nPaths = 20000;
        const trajectories = this._simulateTrajectories(nPaths);
        
        // At each horizon, take the min/max across all paths
        const jointLower = [];
        const jointUpper = [];
        
        for (let t = 0; t < this.horizon; t++) {
            const valuesAtT = trajectories.map(path => path[t]);
            const sorted = valuesAtT.sort((a, b) => a - b);
            
            const lowerIdx = Math.floor(sorted.length * (1 - confidence) / 2);
            const upperIdx = Math.ceil(sorted.length * (1 + confidence) / 2);
            
            jointLower.push(sorted[lowerIdx]);
            jointUpper.push(sorted[upperIdx]);
        }
        
        return { lower: jointLower, upper: jointUpper };
    }
}
```

#### Visualization Component

```javascript
generateJointBandPlot(jointBounds, meanForecast) {
    // For D3.js rendering
    
    const data = {
        mean: meanForecast.map(v => ({x: v.time, y: v.value})),
        lower: jointBounds.lower.map((v, i) => ({
            x: meanForecast[i].time,
            y: v,
            fill: 'rgba(255, 0, 0, 0.1)'
        })),
        upper: jointBounds.upper.map((v, i) => ({
            x: meanForecast[i].time,
            y: v,
            fill: 'rgba(255, 0, 0, 0.1)'
        }))
    };
    
    return d3.select('#chart')
        .append('svg')
        .datum(data)
        .call(this._renderMeanLine())
        .call(this._renderConfidenceArea());
}
```

**Visual representation:**
```
         ┌─────────────┐  Upper joint band (95% simultaneous)
      ┌──┤█████████████┤──┐
      │  └─────────────┘  │
──────┤     Mean          ├──────
      │  ┌─────────────┐  │
      └──┤█████████████┤──┘
         └─────────────┘  Lower joint band
```

---

### 4B.3 Density Forecasts

**Beyond intervals:** Full predictive distribution at each horizon.

#### Distribution Families

**Supported:**
1. **Gaussian** (default, symmetric)
   ```math
   f(y) = (1/(σ√(2π))) · exp(-(y-μ)²/(2σ²))
   ```

2. **Student-t** (heavier tails for robustness)
   ```math
   f(y) ∝ (1 + (y-μ)²/(νσ²))^{-(ν+1)/2}
   ```
   where ν = degrees of freedom (typically 4-10)

3. **Skewed-t** (asymmetric uncertainty)
   ```math
   Uses extended skew-normal formulation
   ```

#### API Design

```javascript
class PredictiveDensity {
    constructor(model, distribution = 'gaussian', params) {
        this.model = model;
        this.distribution = distribution;
        this.params = params;  // {mu, sigma, df?, skew?}
    }
    
    // Probability density function evaluation
    pdf(value, horizon) {
        if (this.distribution === 'gaussian') {
            return this._gaussianPDF(value, this.params.muhorizon, this.params.sigmahorizon);
        } else if (this.distribution === 'student-t') {
            return this._studentTPDF(value, this.params, this.params.df);
        }
    }
    
    // Cumulative distribution function
    cdf(value, horizon) {
        if (this.distribution === 'gaussian') {
            return normalCDF(value, this.params.muHorizon, this.params.sigmaHorizon);
        }
    }
    
    // Quantile function (inverse CDF)
    quantile(probability, horizon) {
        if (this.distribution === 'gaussian') {
            return this.params.muHorizon + 
                   this.params.sigmaHorizon * inverseNormalCDF(probability);
        }
    }
}

// Usage
const forecast = await fitAndForecast(data, 'ets');
const density = new PredictiveDensity(forecast, 'gaussian');

// Query at specific horizon
console.log(density.pdf(105, horizon: 5));      // probability density
console.log(density.cdf(100, horizon: 5));      // P(Y ≤ 100 | h=5)
console.log(density.quantile(0.95, horizon: 5)); // 95th percentile
```

#### Risk Metrics from Distributions

```javascript
computeRiskMetrics(density, horizon) {
    const VaR_95 = density.quantile(0.05, horizon);  // Value-at-Risk
    const CVaR_95 = this._expectedShortfall(density, 0.05, horizon);  // Conditional VaR
    
    return {
        var_95: VaR_95,  // Worst 5% threshold
        cvar_95: CVaR_95,  // Expected loss given we're in worst 5%
        skewness: this._computeSkewness(density, horizon),
        kurtosis: this._computeKurtosis(density, horizon)
    };
}
```

---

### 4B.4 Scenario Trees

**Multi-path branching scenarios for strategic planning.**

#### Data Structure

```javascript
class ScenarioTree {
    constructor(baseForecast) {
        this.base = baseForecast;
        this.scenarios = [];
        this.treeNodes = [];
    }
    
    addScenario(name, probability, intervention) {
        this.scenarios.push({
            id: generateUUID(),
            name,
            probability,  // Must sum to 1.0 across all scenarios
            intervention,  // {type: 'multiplicative', factor: 1.2}
            forecast: this._applyIntervention(intervention)
        });
    }
    
    buildVisualization() {
        // Generate D3 tree layout
        return {
            root: {
                name: 'Base Case',
                children: this.scenarios.map(s => ({
                    name: s.name,
                    probability: s.probability,
                    forecast: s.forecast.points
                }))
            }
        };
    }
}

// Usage
const tree = new ScenarioTree(baseForecast);

tree.addScenario('Base case', 0.6, {});

tree.addScenario('Promotion active', 0.25, {
    type: 'promotion',
    upliftFactor: 1.3,
    duration: 14  // days
});

tree.addScenario('Supply disruption', 0.15, {
    type: 'supply_shock',
    reduction: 0.3,  // -30% capacity
    duration: 21
});

console.log(tree.buildVisualization());
```

#### Visualization Schema

```javascript
const visualizationData = {
    type: 'scenario_tree',
    baseForecast: baseForecast.points,
    branches: [
        {
            name: 'Base case',
            probability: 0.6,
            trajectory: [100, 105, 110, ...]
        },
        {
            name: 'Promotion (+30%)',
            probability: 0.25,
            trajectory: [130, 136, 143, ...]
        },
        {
            name: 'Disruption (-30%)',
            probability: 0.15,
            trajectory: [70, 73, 77, ...]
        }
    ],
    weightedExpectedValue: /* Σ prob_i × forecast_i */
};
```

---

## Part 2: Counterfactual Analysis Engine

### 4C.1 Regression-Based Counterfactuals

**Concept:** Use fitted coefficients as causal multipliers (with appropriate disclaimers).

#### Core Algorithm

```javascript
// File: src/engine/counterfactual.js

class CounterfactualEngine {
    constructor(fittedModel) {
        this.model = fittedModel;
        this.coefficients = fittedModel.getCoefficients();
    }
    
    simulateCounterfactual(intervention) {
        /*
        Intervention specification:
        {
            variable: 'price',           // Which regressor
            newValues: [...],            // Alternative values
            startTime: timestamp,        // When change begins
            endTime: timestamp           // When it ends (or undefined for permanent)
        }
        */
        
        const originalForecast = this.model.forecast();
        const counterfactualForecast = this._applyIntervention(intervention);
        
        return {
            original: originalForecast,
            counterfactual: counterfactualForecast,
            difference: this._computeDifference(originalForecast, counterfactualForecast),
            interpretation: this._interpretImpact(intervention, counterfactualForecast)
        };
    }
    
    _applyIntervention(intervention) {
        // Modify regressor values according to intervention
        const modifiedRegressors = {...this.model.regressors};
        
        if (intervention.variable === 'price') {
            modifiedRegressors.price = this._constructPricePath(intervention.newValues);
        }
        
        // Re-predict using modified regressors
        return this.model.predict(modifiedRegressors);
    }
    
    _computeDifference(original, counterfactual) {
        const differences = [];
        
        for (let t = 0; t < original.length; t++) {
            differences.push({
                time: original[t].time,
                pointDifference: counterfactual[t].value - original[t].value,
                cumulativeImpact: this._sumDifferences(differences.slice(0, t + 1))
            });
        }
        
        return differences;
    }
}
```

#### Example: Price Elasticity Counterfactual

```javascript
// Original fit: sales = β₀ + β₁·price + ε, with β₁ = -2.5 (elastic)

const engine = new CounterfactualEngine(model);

const result = engine.simulateCounterfactual({
    variable: 'price',
    newValues: Array(30).fill(10),  // What if price stayed at $10?
    startTime: Date.now(),
    endTime: Date.now() + 30*24*60*60*1000
});

console.log(result);
/*
{
  original: [...],              // Actual forecast with price hikes
  counterfactual: [...],        // Forecast if price had remained stable
  difference: [
    {time: day1, pointDifference: 15, cumulativeImpact: 15},
    {time: day2, pointDifference: 18, cumulativeImpact: 33},
    ...
  ],
  interpretation: "Had price remained at $10, cumulative sales would be 520 units higher (+12.3%)"
}
*/
```

#### Safety Checks & Disclaimers

```javascript
addSafetyChecks(counterfactualResult) {
    const warnings = [];
    
    // Check for extrapolation
    const priceRange = {min: Math.min(...originalPrice), max: Math.max(...originalPrice)};
    const cfPriceRange = {min: Math.min(...intervention.newValues), max: Math.max(...intervention.newValues)};
    
    if (cfPriceRange.min < priceRange.min || cfPriceRange.max > priceRange.max) {
        warnings.push({
            type: 'EXTRAPOLATION',
            message: 'Counterfactual values outside observed range—interpret with caution'
        });
    }
    
    // Check R² for explanatory power
    if (this.model.rSquared < 0.3) {
        warnings.push({
            type: 'LOW_EXPLANATORY_POWER',
            message: 'Model explains <30% variance—regression-based counterfactuals may be unreliable'
        });
    }
    
    counterfactualResult.warnings = warnings;
    return counterfactualResult;
}
```

---

### 4C.2 Automated What-If Generator

**Template library for common business scenarios.**

#### Template Registry

```javascript
const SCENARIO_TEMPLATES = {
    'promotion_lift': {
        name: 'Historical promotion uplift',
        description: 'Apply similar promotion effects seen in past campaigns',
        generate: function(historicalData, promotionType) {
            const pastUplifts = findSimilarPromotions(historicalData, promotionType);
            const averageUplift = mean(pastUplifts.uptick);
            
            return {
                intervention: {
                    type: 'multiplicative',
                    factor: 1 + averageUplift  // e.g., 1.25 for +25% uplift
                },
                confidence: computeConfidenceInterval(pastUplifts),
                sampleSize: pastUplifts.length
            };
        }
    },
    
    'holiday_shift': {
        name: 'Holiday moved earlier/later',
        description: 'Simulate effect of moving promotional event by N days',
        generate: function(historicalData, shiftDays) {
            const historicalPattern = extractHolidayPattern(historicalData);
            
            return {
                intervention: {
                    type: 'temporal_shift',
                    lag: shiftDays,
                    pattern: historicalPattern.peakShape
                },
                notes: 'Assumes same peak shape, just shifted in time'
            };
        }
    },
    
    'price_sensitivity': {
        name: 'Price change elasticity',
        description: 'Test impact of price increase/decrease',
        generate: function(model, priceChangePercent) {
            const elasticity = model.coefficients.elasticity;
            
            return {
                intervention: {
                    type: 'price_change',
                    percentChange: priceChangePercent,
                    cascadeEffect: calculateDemandResponse(elasticity, priceChangePercent)
                },
                assumptions: ['Linear demand curve', 'No competitor response']
            };
        }
    }
};

// Usage
async function generateAutomatedScenarios(seriesData, options) {
    const scenarios = [];
    
    for (const templateId of options.templates || Object.keys(SCENARIO_TEMPLATES)) {
        const template = SCENARIO_TEMPLATES[templateId];
        const generated = await template.generate(seriesData, options.parameters);
        
        scenarios.push({
            id: templateId,
            ...generated,
            generationTimestamp: Date.now()
        });
    }
    
    return scenarios;
}
```

---

### 4C.3 Monte Carlo Simulation Engine

**Complex counterfactuals requiring integration over uncertainty.**

#### Architecture

```javascript
class MonteCarloSimulator {
    constructor(forecastModel, options = {}) {
        this.model = forecastModel;
        this.nSimulations = options.nSims || 10000;
        this.seed = options.seed || Date.now();
        this_rng = new SeededRandom(this.seed);
    }
    
    simulateCounterfactual(intervention, options = {}) {
        const results = [];
        
        for (let sim = 0; sim < this.nSimulations; sim++) {
            // Step 1: Draw random errors from estimated distribution
            const errors = this._drawRandomErrors();
            
            // Step 2: Apply intervention to regressors
            const modifiedRegressors = this._applyInterventionToRegessors(intervention);
            
            // Step 3: Propagate through model
            const simulatedPath = this._propagateThroughModel(errors, modifiedRegressors);
            
            results.push(simulatedPath);
        }
        
        // Step 4: Aggregate results into distribution
        return this._aggregateResults(results, options.summaryMetrics || ['median', 'conf_interval']);
    }
    
    _aggregateResults(allPaths, metrics) {
        const horizon = allPaths[0].length;
        const aggregated = {};
        
        for (let t = 0; t < horizon; t++) {
            const valuesAtT = allPaths.map(path => path[t]);
            
            if (metrics.includes('median')) {
                aggregated[t] = { median: median(valuesAtT) };
            }
            
            if (metrics.includes('conf_interval')) {
                const sorted = valuesAtT.sort((a, b) => a - b);
                aggregated[t] = {
                    ...aggregated[t],
                    conf_interval: {
                        lower: sorted[Math.floor(sorted.length * 0.025)],
                        upper: sorted[Math.floor(sorted.length * 0.975)]
                    }
                };
            }
            
            if (metrics.includes('worst_case')) {
                aggregated[t] = {
                    ...aggregated[t],
                    worst_case_10: sorted[Math.floor(sorted.length * 0.10)]
                };
            }
        }
        
        return aggregated;
    }
}
```

#### Output Format

```javascript
{
    "simulation_summary": {
        "n_simulations": 10000,
        "seed": 12345,
        "intervention": {
            "type": "promotion",
            "strength": 1.2
        }
    },
    "results_by_horizon": {
        "day_1": {
            "median": 1200,
            "conf_interval": {"lower": 1050, "upper": 1350},
            "p_positive_impact": 0.97
        },
        "day_7": {
            "median": 8400,
            "conf_interval": {"lower": 7200, "upper": 9600},
            "p_positive_impact": 0.94
        }
    },
    "risk_metrics": {
        "expected_gain": 1250,
        "var_95": -300,  // 5% chance gain is worse than -300
        "cvar_95": -520   // Expected loss in worst 5% cases
    }
}
```

---

### 4C.4 Sensitivity Analysis Sweeps

**Parameter uncertainty exploration.**

```javascript
class ParameterSweeper {
    constructor(model) {
        this.model = model;
    }
    
    sweepParameter(parameterName, minValue, maxValue, steps = 20) {
        const parameterValues = this._generateGrid(minValue, maxValue, steps);
        const results = [];
        
        for (const value of parameterValues) {
            const modifiedModel = this._modifyModelParameter(this.model, parameterName, value);
            const forecast = modifiedModel.forecast();
            
            results.push({
                parameter: parameterName,
                value: value,
                forecast: forecast,
                accuracy_metrics: this._evaluateOnHoldout(modifiedModel)
            });
        }
        
        return results;
    }
    
    generateHeatmap(sweepResults, metric = 'RMSE') {
        // For 2D parameter sweeps
        const heatmap = {};
        
        for (const result of sweepResults) {
            const key = `${result.param1}_${result.value1}`;
            heatmap[key] = result[metric];
        }
        
        return heatmap;
    }
}
```

**Example output:**
```javascript
{
    "swept_parameter": "trend_slope",
    "range": [-0.8, -0.2],
    "steps": 20,
    "results": [
        {"slope": -0.8, "forecast": [...], "RMSE": 234},
        {"slope": -0.77, "forecast": [...], "RMSE": 228},
        {"slope": -0.74, "forecast": [...], "RMSE": 225},
        // ...
        {"slope": -0.2, "forecast": [...], "RMSE": 298}
    ],
    "optimal_value": -0.74,
    "sensitivity_note": "Forecast changes moderately with slope variations"
}
```

---

## Integration with Existing Features

### Enhanced Reporting

```javascript
// Extended JSON report format
const enhancedReport = {
    ...standardForecastReport,
    
    uncertainty: {
        joint_bands: {lower: [...], upper: [...]},
        cumulative_intervals: {
            "7_day": {"lower": 720, "upper": 890},
            "30_day": {"lower": 2800, "upper": 3600}
        },
        density_forecast: {
            distribution: "gaussian",
            pdf_table: [{horizon: 1, pdf_at_100: 0.023}, ...]
        }
    },
    
    counterfactuals: [
        {
            name: "Price stability scenario",
            interpretation: "+12.3% sales if price hadn't increased",
            confidence: 0.78,
            warnings: ["Extrapolation detected"]
        }
    ],
    
    risk_metrics: {
        var_95: -300,
        cvar_95: -520,
        downside_probability: 0.15
    }
};
```

### Serve Mode Visualization

```javascript
// Interactive dashboard components
{
    "components": [
        {
            id: "joint_band_chart",
            type: "line_with_area",
            data: jointPredictionBands,
            title: "95% Simultaneous Confidence Bands"
        },
        {
            id: "scenario_tree",
            type: "sankey_diagram",
            data: scenarioTreeVisualization,
            interactive: true
        },
        {
            id: "counterfactual_slider",
            type: "parameter_controller",
            label: "Adjust price change (%):",
            min: -20, max: 20, step: 1,
            on_slide: regenerating_counterfactual_forecast
        }
    ]
}
```

---

## Testing Strategy

### Synthetic Test Cases

```javascript
function createSyntheticCounterfactualDataset() {
    // Known ground truth: We know exactly what "caused" the change
    const nPeriods = 365;
    
    // Base trend
    const trend = Array(nPeriods).fill(0).map((_, i) => 100 + i * 0.1);
    
    // Add seasonal component
    const seasonality = Array(nPeriods).fill(0).map((_, i) => 
        20 * Math.sin(2 * Math.PI * i / 365)
    );
    
    // Price history (random walk)
    const prices = [10];
    for (let i = 1; i < nPeriods; i++) {
        prices.push(prices[i-1] + gaussianNoise(0.5));
    }
    
    // True demand model: Demand = 500 - 2.5·Price + Trend + Seasonality + ε
    const epsilon = Array(nPeriods).fill(0).map(() => gaussianNoise(10));
    const demand = prices.map((p, i) => 
        500 - 2.5*p + trend[i] + seasonality[i] + epsilon[i]
    );
    
    return {
        actual_demand: demand,
        price_history: prices,
        true_model: { intercept: 500, price_elasticity: -2.5, trend: 0.1 },
        counterfactual_query: {
            question: "What if price had remained at initial $10 throughout?",
            intervention: {
                price_constant: 10
            }
        }
    };
}

// Verify counterfactual recovers true effect!
const dataset = createSyntheticCounterfactualDataset();
const model = fitRegression(dataset.demand, {price: dataset.price_history});
const counterfactual = new CounterfactualEngine(model).simulateCounterfactual({
    variable: 'price',
    newValues: Array(365).fill(10)
});

// Should match: Δsales = -2.5 × (actual_avg_price - 10) × 365
expect(counterfactual.cumulative_impact).toBeCloseTo(expected_true_impact, 2);
```

---

## Performance Goals

| Operation | Complexity | Target Time |
|-----------|------------|-------------|
| Cumulative interval (N=30, M=10000 sims) | O(M×N) | <3 sec |
| Joint bands (N=24, Bonferroni) | O(N) | <0.1 sec |
| Monte Carlo counterfactual (N=30, M=10000) | O(M×N) | <5 sec |
| Sensitivity sweep (20 steps) | O(20×N) | <2 sec |

**Optimization strategies:**
- Parallelize Monte Carlo simulations using Web Workers
- Use vectorized operations where possible
- Implement adaptive sampling (fewer sims for early stopping)

---

## Success Metrics

✅ **Statistical Accuracy**
- Cumulative intervals achieve nominal coverage rates (tested on synthetic data)
- Joint bands maintain simultaneous coverage ≥95%
- Counterfactuals recover true effects in controlled experiments

✅ **User Trust**
- Clear disclaimers prevent misuse
- Warnings surface when assumptions violated
- Educational content helps proper interpretation

✅ **Performance**
- All computations complete in reasonable time (<10 sec typical)
- Scalable to enterprise datasets (100s of series)

---

*This specification enables ForecastLab to compete directly with enterprise analytics platforms while maintaining classical statistics transparency.*
*Last updated: January 2025*
