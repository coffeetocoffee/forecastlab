# Tutorial 6: Monte Carlo Simulation Engine

## Overview

Monte Carlo simulation enables sophisticated uncertainty analysis by generating thousands of possible future paths and aggregating their statistics.

---

## Why Monte Carlo?

Traditional prediction intervals assume simple distributions (usually normal). But real forecasting problems often need:
- Summation over periods (cumulative uncertainty)
- Joint coverage across horizons
- Non-Gaussian distributions
- Complex interventions and scenarios

Monte Carlo handles all of these elegantly!

---

## Core Capabilities

1. **Path Simulation**: Generate many possible futures
2. **Cumulative Intervals**: Uncertainty for period totals  
3. **Joint Bands**: Simultaneous coverage guarantees
4. **Risk Metrics**: Value-at-Risk, Expected Shortfall
5. **Density Forecasts**: Full predictive distributions

---

## Step-by-Step Guide

### Step 1: Initialize Simulator

```javascript
import { MonteCarloSimulator } from 'forecastlab';

const mc = new MonteCarloSimulator({
  nSims: 10000,        // Number of simulations
  seed: 12345          // For reproducibility
});
```

### Step 2: Prepare Forecast Model

Extract model parameters:

```javascript
const model = {
  lastValue: 100,      // Current level
  trend: 1.5,          // Slope
  seasonalPattern: [0.9, 1.1, 1.0],  // If applicable
  stdDev: 10           // Residual standard deviation
};
```

### Step 3: Generate Simulation Paths

```javascript
const horizon = 30;    // 30 steps ahead
const paths = await mc.simulatePaths(model, horizon);

console.log('Generated', paths.length, 'paths');
console.log('Each path has', paths[0].length, 'points');
```

### Step 4: Compute Cumulative Interval

```javascript
// Uncertainty for next 7 days total
const weekTotal = mc.computeCumulativeInterval(paths, 7, 0.95);

console.log(`Expected weekly total: ${weekTotal.pointEstimate.toFixed(0)}`);
console.log(`95% interval: [${weekTotal.interval.lower.toFixed(0)}, ${weekTotal.interval.upper.toFixed(0)}]`);
```

### Step 5: Get Joint Prediction Bands

```javascript
// All 24 hours simultaneously covered with 95% confidence
const jointBands = mc.computeJointBands(paths, 0.95, 'simulation');

// Hour-by-hour simultaneous bounds
jointBands.lower.forEach((lower, i) => {
  console.log(`Hour ${i+1}: ${lower.toFixed(1)} to ${jointBands.upper[i].toFixed(1)}`);
});
```

### Step 6: Calculate Risk Metrics

```javascript
const riskMetrics = mc.computeRiskMetrics(paths, horizon, 0.95);

console.log('VaR (95%):', riskMetrics.var_95.toFixed(2));  // Worst 5% threshold
console.log('CVaR (95%):', riskMetrics.cvar_95.toFixed(2)); // Expected loss in worst 5%
console.log('Downside probability:', (riskMetrics.downsideProbability * 100).toFixed(1) + '%');
```

---

## Practical Example: Inventory Planning

**Scenario**: Want to know how much stock to order for next month.

```javascript
async function planInventory(monthlyDemandForecast, targetServiceLevel = 0.95) {
  const mc = new MonteCarloSimulator({ nSims: 5000 });
  
  // Simulate monthly demand
  const paths = await mc.simulatePaths(demandModel, 30);
  
  // Cumulative interval for month
  const cumulative = mc.computeCumulativeInterval(paths, 30, targetServiceLevel);
  
  // Order enough to cover 95% of scenarios
  const orderQuantity = Math.ceil(cumulative.interval.upper);
  
  return {
    expectedDemand: Math.round(cumulative.pointEstimate),
    recommendedOrder: orderQuantity,
    safetyStock: orderQuantity - Math.round(cumulative.pointEstimate),
    serviceLevel: targetServiceLevel
  };
}
```

---

## Performance Optimization

### Adjusting Simulation Count

| Use Case | Suggested N Sims | Time Estimate |
|----------|------------------|---------------|
| Quick exploration | 100-500 | <0.5 sec |
| Standard reporting | 1000-5000 | 1-2 sec |
| Production deployment | 10,000 | 3-5 sec |
| Regulatory-grade | 50,000+ | 10-20 sec |

```javascript
// Tradeoff between speed and accuracy
const mcQuick = new MonteCarloSimulator({ nSims: 500 });   // Fast prototype
const mcProd = new MonteCarloSimulator({ nSims: 10000 });  // Production
```

### Parallel Processing (Future Enhancement)

For very large simulations (>50k):
```javascript
// TODO: Web Workers implementation
const workerPool = await initWorkerPool(nCPUs);
const results = await workerPool.runParallel(simulationTasks);
```

---

## Common Applications

### 1. Portfolio Risk Assessment

```javascript
// VaR for investment portfolio
const portfolioReturns = generatePortfolioReturns(shares, prices);
const paths = await mc.simulatePaths(portfolioReturns, horizon: 252);  // 1 year
const var95 = mc.computeRiskMetrics(paths, 252).var_95;
console.log(`Daily VaR (95%): $${Math.abs(var95).toFixed(2)}`);
```

### 2. Energy Demand Forecasting

```javascript
// Aggregate uncertainty for grid planning
const cityPaths = await mc.simulatePaths(cityDemandModel, horizon: 288); // hourly x 12 days
const peakDemand = mc.computeCumulativeInterval(cityPaths, 24, 0.99);
console.log('Peak hour capacity needed:', Math.ceil(peakDemand.interval.upper));
```

### 3. Supply Chain Planning

```javascript
// Lead time variability modeling
const leadTimeVariability = generateLeadTimeDistribution(supplierData);
const paths = await mc.simulatePaths(leadTimeVariability, 100);
const percentile90 = mc.percentile(paths, 90);
console.log('Plan for 90th percentile lead time:', percentile90 + ' days');
```

---

## Integration with Other Phase 4 Features

### Hierarchical Monte Carlo

```javascript
// Simulate entire hierarchy at once
const hierarchicalPaths = simulateHierarchicalPaths(
  bottomForecasts, 
  aggregationMatrix, 
  nSims: 10000
);

// Reconcile each simulated path
const reconciledPaths = hierarchicalPaths.map(path => 
  reconciler.reconcile(path)
);

// Now uncertainty respects hierarchy!
```

### Counterfactual Monte Carlo

```javascript
// Run counterfactuals through MC engine
const originalPaths = await mc.simulatePaths(originalModel);
const cfPaths = await mc.simulatePaths(counterfactualModel);

const upliftPaths = cfPaths.map((path, i) => 
  path.map((v, t) => v - originalPaths[i][t])
);

const expectedUplift = mc.computeCumulativeInterval(upliftPaths, 30);
console.log('Expected promotion uplift:', expectedUplift.pointEstimate);
```

---

## Troubleshooting

### Q: "Why are my intervals so wide?"
A: This is normal for uncertain forecasts. Try:
- Increasing historical data length
- Checking residual assumptions
- Using adaptive weighting for recent data

### Q: "Simulation is too slow!"
A: Reduce `nSims` or:
- Pre-compute covariance matrices
- Use vectorized operations
- Enable parallel processing (future feature)

### Q: "Results vary between runs"
A: Set a fixed seed for reproducibility:
```javascript
const mc = new MonteCarloSimulator({ seed: 12345 });
```

---

## Next Steps

Explore related tutorials:
- **Tutorial 5**: Factor Extraction (reduce dimensionality before MC)
- **Tutorial 7**: Advanced Uncertainty (combine with density forecasts)
- **Tutorial 8**: Counterfactuals (MC-based scenario analysis)

---

*Previous: [05-factor-extraction.md](05-factor-extraction.md)*  
*Next: [07-uncertainty-quantification.md](07-uncertainty-quantification.md)*

---

*Last Updated: January 2025*  
*Version: 4.0.0 Beta*
