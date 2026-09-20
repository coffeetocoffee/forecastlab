# Tutorial 2: Hierarchical Forecast Reconciliation

## Overview

Hierarchical forecasting ensures that forecasts at different organizational levels sum correctly. Without reconciliation, total forecasts won't equal the sum of their parts.

---

## Problem Statement

Consider a retail company with:
```
Global Sales
├── Region East
│   ├── Product A
│   └── Product B
└── Region West
    ├── Product A
    └── Product B
```

If we forecast each node independently:
- East_A: 100 units
- East_B: 150 units  
- West_A: 80 units
- West_B: 120 units
- **Sum of products = 450**

But if we also forecast Global separately:
- Global: 480 units

**Problem**: 450 ≠ 480! Which is correct?

---

## Solution: Optimal Combination Reconciliation

Phase 4 uses optimal combination method to find weights that minimize error while respecting constraints.

### Mathematical Foundation

**Goal**: Minimize reconstruction error: `||y - ŷ||²` subject to summation constraints.

**Method**: OLS (Ordinary Least Squares) estimation with Lagrange multipliers to enforce hierarchy.

---

## Step-by-Step Guide

### Step 1: Prepare Hierarchy Configuration

Create `hierarchy_config.json`:

```json
{
  "name": "Retail Sales",
  "levels": ["region", "product"],
  "series": {
    "total_sales": ["na", "na"],
    "east_region": ["east"],
    "west_region": ["west"],
    "east_product_a": ["east", "a"],
    "east_product_b": ["east", "b"],
    "west_product_a": ["west", "a"],
    "west_product_b": ["west", "b"]
  },
  "constraints": [
    {
      "parent": "total_sales",
      "children": ["east_region", "west_region"]
    },
    {
      "parent": "east_region", 
      "children": ["east_product_a", "east_product_b"]
    },
    {
      "parent": "west_region",
      "children": ["west_product_a", "west_product_b"]
    }
  ]
}
```

### Step 2: Generate Bottom-Level Forecasts

First, forecast individual leaf nodes:

```bash
node scripts/generate_bottom_forecasts.js \
  --data sales_data.csv \
  --methods holt,snaive \
  --output bottom_forecasts.json
```

### Step 3: Run Reconciliation

```bash
forecastlab reconcile \
  --project sales_project.forecast.json \
  --hierarchy hierarchy_config.json \
  --out reconciled_results.json
```

### Step 4: View Results

Reconciled output includes:
- Adjusted forecasts at all levels
- Improvement metrics vs naive approach
- Consistency verification

```bash
cat reconciled_results.json | jq '.reconciled'
```

Expected output:
```json
{
  "total_sales": [475, 480, 485, ...],  // Adjusted from 480
  "east_region": [220, 225, 230, ...],
  "west_region": [255, 255, 255, ...],
  // East + West now exactly equals Total
}
```

---

## Programmatic Usage

### JavaScript/Node.js

```javascript
import { HierarchicalReconciler } from 'forecastlab';

const config = { /* hierarchy configuration */ };
const reconciler = new HierarchicalReconciler(config);

// Load or generate bottom forecasts
const bottomForecasts = await loadBottomForecasts('bottom_forecasts.json');

// Perform reconciliation
const reconciled = reconciler.reconcile(bottomForecasts);

console.log('Reconciled total:', reconciled.total_sales.forecasts[0]);
console.log('Sum of children:', reconciled.east.sales[0] + reconciled.west.sales[0]);
// These should match!
```

### Using Monte Carlo for Uncertainty

Combine reconciliation with uncertainty quantification:

```javascript
import { HierarchicalReconciler, MonteCarloSimulator } from 'forecastlab';

// Simulate many paths through hierarchy
const mc = new MonteCarloSimulator({ nSims: 10000 });
const simulatedPaths = await mc.simulatePaths(bottomForecastModel, horizon: 30);

// Reconcile each path
const reconciledPaths = simulatedPaths.map(path => 
  reconciler.reconcilePath(path)
);

// Now you have joint intervals that respect hierarchy!
```

---

## Performance Tips

### Memory Optimization
For hierarchies with >1000 nodes:
- Use sparse matrix representations
- Process level-by-level instead of all-at-once
- Enable streaming mode in CLI

### Speed Considerations
- Pre-compute aggregation matrices once
- Cache covariance estimates
- Parallelize across independent branches

---

## Common Pitfalls

### ❌ Wrong Series ID Format
```json
// WRONG: Nested paths not matching structure
"series": {
  "total": ["global"],  // Should be []
  "region_east": ["e"]  // Should be ["east"]
}
```

✅ Correct: Path must reflect true hierarchy depth

### ❌ Missing Constraints
Don't define constraints for every single pair—automated detection works well if structure is clean.

### ❌ Inconsistent Seasonality
Ensure all series in hierarchy have compatible seasonal periods or use multiple seasonality support.

---

## Validation & Testing

Always verify reconciliation worked:

```javascript
// Check summation constraint
function validateConsistency(reconciled) {
  const totalsMatch = reconciled.total === 
    Object.values(reconciled.regions).reduce((sum, r) => sum + r, 0);
  
  return totalsMatch ? '✅ Passed' : '❌ Failed';
}

console.log(validateConsistency(results));
```

---

## Next Steps

Try combining this with:
- **Panel Analysis** to compare methods across regions
- **Factor Models** to extract common drivers across levels
- **Uncertainty Quantification** for hierarchical confidence bands

---

*Previous: [01-introduction.md](01-introduction.md)*  
*Next: [03-panel-analysis.md](03-panel-analysis.md)*

---

*Last Updated: January 2025*  
*Version: 4.0.0 Beta*
