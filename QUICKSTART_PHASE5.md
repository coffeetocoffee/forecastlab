# Phase 5 Quick Start Guide

## Installation

```bash
# Install dependencies
npm install

# Build and test
npm run build
npm test
```

## Basic Usage

### Run Monte Carlo Simulations with Workers

```javascript
import { WorkerPool, MonteCarloTask } from './src/workers/index.js';

// Create worker pool
const pool = new WorkerPool({ size: 4 });
await pool.initialize();

// Submit task
const mcTask = new MonteCarloTask({
  baseValues: [100, 102, 101, ...],
  horizon: 30,
  numPaths: 1000,
  volatility: 0.3,
  drift: 0.02
});

const result = await pool.submitTask(mcTask);
console.log(result.paths.length); // 1000 paths
```

### Generate Promotion Scenarios

```javascript
import { PromotionLiftScenarios } from './src/scenarios/promotion-lift.js';

const promoGen = new PromotionLiftScenarios({
  defaultLift: 0.25,
  degradationFactor: 0.8
});

const scenarios = promoGen.generateScenarios({
  history: [...data],
  seasonLength: 7,
  forecastHorizon: 90
});

scenarios.forEach(s => {
  console.log(`Scenario: ${s.name}`);
  console.log(`Adjustments:`, s.adjustments);
});
```

### Price Elasticity Analysis

```javascript
import { PriceElasticityScenarios } from './src/scenarios/price-elasticity.js';

const elasticityGen = new PriceElasticityScenarios({
  categories: ['electronics'],
  basePrice: 99.99,
  categoryElasticities: { electronics: -0.8 }
});

const scenarios = elasticityGen.generateScenarios({
  forecast: [...predict],
  elasticity: -0.8,
  products: {...}
});
```

### Visualize Predictions

```html
<!-- HTML -->
<div id="chart" style="width: 800px; height: 400px;"></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
```

```javascript
import { PredictionBandChart } from './src/visualizations/index.js';

const chart = new PredictionBandChart({
  container: '#chart',
  width: 800,
  height: 400
});

chart.render({
  history: historicalData,
  forecast: pointForecasts,
  percentiles: confidenceBands,
  timestamps: times
});
```

### Counterfactual Analysis

```javascript
import { CounterfactualSliders } from './src/visualizations/index.js';

const sliders = new CounterfactualSliders({
  container: '#sliders-panel',
  onSliderChange: (adjustment) => {
    // Trigger reforecasting based on adjustment
    recalculateForecast(adjustment);
  }
});

sliders.render({
  baseline: currentForecast,
  adjustments: suggestedAdjustments
});
```

## Serve Mode Integration

Start the server:

```bash
node src/cli.js serve --project myproject.forecast.json --open
```

The web interface will include:
- Interactive prediction bands with D3.js
- Scenario tree Sankey diagrams
- Counterfactual slider panels
- Hierarchical reconciliation views

## Complete Example

```javascript
// Full analysis pipeline
async function analyzeWithAdvancedFeatures(projectFile) {
  // Load data
  const data = loadProject(projectFile);
  
  // Initialize worker pool for MC
  const pool = new WorkerPool({ size: navigator.hardwareConcurrency || 4 });
  await pool.initialize();
  
  // Generate all scenarios
  const [promoScenarios, priceScenarios, disruptionScenarios] = await Promise.all([
    generatePromotionScenarios(data),
    generatePricingScenarios(data),
    generateDisruptionScenarios(data)
  ]);
  
  // Run parallel Monte Carlo simulations
  const simTasks = [
    new MonteCarloTask({ baseValues: ..., horizon: 30, numPaths: 2000 }),
    new MonteCarloTask({ baseValues: ..., horizon: 60, numPaths: 2000 })
  ];
  
  const results = await pool.executeParallel(simTasks);
  
  // Create visualizations
  const predictions = new PredictionBandChart({ container: '#viz' });
  predictions.render({
    history: data.history,
    forecast: results[0].paths.mean,
    percentiles: results[0].percentiles
  });
  
  return { predictions, scenarios: { promoScenarios, priceScenarios, disruptionScenarios } };
}

// Execute
analyzeWithAdvancedFeatures('examples/energy.forecast.json')
  .then(results => console.log(results));
```

## API Reference

### Monte Carlo Simulation Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| baseValues | Array\<number\> | Required | Historical values to start from |
| horizon | number | Required | Forecast steps ahead |
| numPaths | number | 1000 | Number of simulation paths |
| volatility | number | 0.3 | Volatility coefficient |
| drift | number | 0 | Trend component |
| method | string | 'ar1' | Simulation model ('ar1', 'gbm', 'mult') |

### Promotion Scenario Config

```javascript
{
  promotionCalendar: [],      // Predefined events
  defaultLift: 0.25,          // Typical promotion boost
  degradationFactor: 0.8,     // Diminishing returns rate
  periodDays: 30             // Recurrence interval
}
```

### Visualization Configuration

```javascript
PredictionBandChart options:
{
  container: string,          // CSS selector or DOM element
  width: number,              // Chart width (pixels)
  height: number,             // Chart height
  showConfidenceBands: true,  // Display percentile ranges
  showIndividualPaths: false, // Show sample paths
  numSamplePaths: 50,         // Paths to display if enabled
  colorScale: function        // D3 color scale
}
```

## Troubleshooting

### Worker Pool Issues

**Problem**: "Worker not found" error  
**Solution**: Ensure worker script is accessible via HTTP (not file:// protocol)

**Problem**: Memory exhaustion  
**Solution**: Reduce `numPaths` in MonteCarloTask or increase worker count limit

### Visualization Problems

**Problem**: D3 chart not rendering  
**Solution**: Verify D3.js loaded before initialization (`window.d3`)

**Problem**: Charts don't update on resize  
**Solution**: Add window resize event listener that calls `.update()` method

### Scenario Generation

**Problem**: Empty scenarios returned  
**Solution**: Ensure input data has required fields (`history`, `seasonLength`, etc.)

**Problem**: Unrealistic projections  
**Solution**: Adjust parameters like `degradationFactor` or `volatility`

## Best Practices

1. **Use workers for paths > 1000** - Performance benefit significant above threshold
2. **Cache simulation results** - Avoid redundant recalculations
3. **Limit parallel workers** - Keep under CPU core count to prevent thrashing
4. **Progress reporting** - Enable progress callbacks for long jobs (> 1 sec)
5. **Error handling** - Always wrap Monte Carlo execution in try/catch
6. **Graceful fallbacks** - Handle worker errors by falling back to single-threaded

## Next Steps

See [PHASE5_IMPLEMENTATION.md](./PHASE5_IMPLEMENTATION.md) for:
- Detailed architecture documentation
- Performance benchmarks
- Migration guides
- Future roadmap

---

For support issues, open an issue on GitHub.
