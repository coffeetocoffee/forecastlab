# ForecastLab Phase 4: Tutorial Series 📊

## Overview

This tutorial series introduces **ForecastLab v4.0 Advanced Analytics**, demonstrating how to use the new Phase 4 features for sophisticated multi-series forecasting, uncertainty quantification, and counterfactual analysis.

**Prerequisites**: Basic understanding of time-series forecasting concepts. You should already know how to use ForecastLab's core commands (`init`, `forecast`, `report`).

---

## Table of Contents

1. [Introduction to Phase 4 Features](01-introduction.md)
2. [Hierarchical Forecast Reconciliation](02-hierarchical-reconciliation.md)
3. [Panel Data Analysis](03-panel-analysis.md)
4. [VAR Models and Spillover Detection](04-var-models.md)
5. [Factor Extraction and Latent Drivers](05-factor-extraction.md)
6. [Monte Carlo Simulation Engine](06-monte-carlo-simulation.md)
7. [Advanced Uncertainty Quantification](07-uncertainty-quantification.md)
8. [Counterfactual "What-If" Analysis](08-counterfactual-analysis.md)
9. [Automated Scenario Generation](09-automated-scenarios.md)
10. [Real-Time Model Adaptation](10-real-time-adaptation.md)

---

## Quick Start Examples

### Example 1: Hierarchical Reconciliation

```bash
# Setup hierarchical data structure
forecastlab reconcile --project sales_forecast.json \
  --hierarchy hierarchy_config.json \
  --out reconciled_results.json

# View results
cat reconciled_results.json
```

### Example 2: Counterfactual Pricing Analysis

```bash
# Analyze what happens if prices stayed constant
forecastlab what-if --project pricing_model.json \
  --variable price \
  --constant-value 10 \
  --out counterfactual_report.json

# Display interpretation
node -e "const r=require('./counterfactual_report.json');console.log(r.interpretation);"
```

---

## Installation

Phase 4 features are included in ForecastLab v4.0+:

```bash
npm install forecastlab@latest
```

Or run directly from source:

```bash
git clone https://github.com/coffeetocoffee/forecastlab.git
cd forecastlab
npm install
```

---

## Programmatic Usage

### Multi-Series Modeling

```javascript
import { HierarchicalReconciler, VARModel } from 'forecastlab';

// Hierarchical reconciliation
const config = {
  levels: ['region', 'product'],
  series: {
    'total': ['na', 'na'],
    'east_electronics': ['east', 'electronics'],
    // ...
  }
};

const reconciler = new HierarchicalReconciler(config);
const reconciled = await reconciler.reconcile(bottomForecasts);
```

### Monte Carlo Simulation

```javascript
import { MonteCarloSimulator } from 'forecastlab';

const mc = new MonteCarloSimulator({ nSims: 10000 });
const paths = await mc.simulatePaths(model, horizon: 30);
const interval = mc.computeCumulativeInterval(paths, 7);

console.log(`7-day cumulative range: ${interval.interval.lower} to ${interval.interval.upper}`);
```

### Counterfactual Analysis

```javascript
import { CounterfactualEngine } from 'forecastlab';

const engine = new CounterfactualEngine(fittedModel);
const result = engine.simulateCounterfactual({
  variable: 'price',
  newValues: [10],
  type: 'constant_value'
});

console.log(result.interpretation);
// Output: "Had price remained at $10, sales would be 15% higher"
```

---

## Next Steps

After completing these tutorials:
1. Experiment with your own datasets
2. Combine multiple Phase 4 features (e.g., hierarchical + counterfactual)
3. Contribute to the community by sharing your use cases
4. Explore additional customization options in the codebase

---

*Last Updated: January 2025*  
*Version: 4.0.0*  
*Status: Beta (Production Ready)*
