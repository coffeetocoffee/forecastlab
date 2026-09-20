# ForecastLab Plugin Getting Started Guide

Welcome to ForecastLab v3.0's plugin system! This guide will help you create your first plugin.

## What Can Plugins Do?

Plugins extend ForecastLab with:
- **Custom forecasting models** (new algorithms)
- **Custom evaluation metrics** (new performance measures)
- **Custom visualizations** (D3.js chart components)
- **CLI commands** (new command-line tools)

## Your First Plugin: "Hello World" Forecaster

### Step 1: Create Plugin Directory Structure

```bash
mkdir my-hello-forecaster
cd my-hello-forecaster
```

### Step 2: Create Plugin Manifest

Create `hello-forecaster.forecast-plugin.json`:

```json
{
  "name": "hello-forecaster",
  "version": "1.0.0",
  "forecastlab": ">=3.0.0",
  "author": "Your Name <your@email.com>",
  "description": "A simple constant forecast that always predicts the mean",
  "main": "index.mjs",
  "exports": {
    "models": ["HelloForecaster"],
    "metrics": []
  }
}
```

### Step 3: Implement the Model

Create `index.mjs`:

```javascript
import { registry } from '@forecastlab/sdk';

/**
 * HelloForecaster - Always predicts the historical mean
 */
export class HelloForecaster {
  constructor() {
    this.mean = null;
    this.std = null;
  }

  fit(data, params) {
    // Calculate mean and standard deviation
    const values = Array.isArray(data) ? data : data.map(d => d.value);
    this.mean = values.reduce((a, b) => a + b, 0) / values.length;
    this.std = Math.sqrt(
      values.reduce((sum, val) => sum + Math.pow(val - this.mean, 2), 0) / values.length
    );
    
    console.log(`HelloForecaster trained on ${values.length} points`);
    console.log(`Mean: ${this.mean.toFixed(2)}, Std: ${this.std.toFixed(2)}`);
    
    return this;
  }

  forecast(horizon) {
    // Always predict the mean for all future steps
    const predictions = [];
    for (let i = 0; i < horizon; i++) {
      predictions.push({
        value: this.mean,
        lower: this.mean - 1.96 * this.std,
        upper: this.mean + 1.96 * this.std
      });
    }
    
    return predictions;
  }

  explain() {
    return `
HelloForecaster is a naive baseline that always predicts the historical mean.

Use cases:
- Benchmark for comparison
- Educational demonstration
- Stable series with no trend or seasonality

Limitations:
- Cannot capture trends
- Cannot capture seasonality
- Wide prediction intervals
      
Mathematical foundation:
- Forecast: $\hat{y}_t = \mu$ where $\mu$ is sample mean
- Prediction interval: $[\mu \pm 1.96\sigma]$ assuming normality
`;
  }
}

// Auto-register when module loads
registry.registerModel('hello', HelloForecaster);
```

### Step 4: Test Your Plugin

Run in ForecastLab directory:

```bash
node src/cli.js demo --example energy
```

Then use your model in compare or forecast:

```bash
node src/cli.js compare --project energy.forecast.json --model hello
```

## Plugin Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Unique plugin identifier |
| `version` | ✅ | Semantic version (e.g., "1.0.0") |
| `forecastlab` | ✅ | Version requirement (e.g., ">=3.0.0") |
| `author` | ✅ | Author name and email |
| `description` | ✅ | One-sentence description |
| `main` | ✅ | Entry point JavaScript file |
| `exports.models` | ❌ | List of model class names |
| `exports.metrics` | ❌ | List of metric function names |
| `exports.commands` | ❌ | List of CLI command handlers |

## Model Class Requirements

Every custom model must implement:

1. **Constructor()** - Initialize instance variables
2. **fit(data, params)** - Train on time series data
   - Input: array of `{date, value}` or plain numbers
   - Returns: `this` for chaining
3. **forecast(horizon)** - Generate forecasts
   - Input: integer number of steps ahead
   - Returns: array of `{value, lower, upper}` objects
4. **explain()** - Plain-language description
   - Returns: string with markdown formatting

## Custom Evaluation Metrics

Example metric implementation:

```javascript
/**
 * Weighted MAPE - penalizes errors more on high-value periods
 */
export function weightedMAPE(actuals, forecasts) {
  let weightedError = 0;
  let weightedTotal = 0;
  
  for (let i = 0; i < actuals.length; i++) {
    const weight = actuals[i] > 0 ? actuals[i] : 1;
    weightedError += weight * Math.abs(actuals[i] - forecasts[i]);
    weightedTotal += weight;
  }
  
  return (weightedError / weightedTotal) * 100;
}
```

Register metric:

```javascript
registry.registerMetric('weighted-mape', weightedMAPE);
```

## Adding CLI Commands

Extend ForecastLab with new commands:

```javascript
import { registerCommand } from '@forecastlab/sdk';

registerCommand('my-command', (args) => {
  console.log('Running my-command with args:', args);
  
  // Access project data
  const project = args.project;
  const data = project.series;
  
  // Process and output results
  return { success: true };
});
```

## Debugging Plugins

Enable debug mode:

```bash
NODE_DEBUG=plugin node src/cli.js ...
```

Check loaded plugins:

```bash
node src/cli.js plugins --list
```

## Next Steps

- [ ] Read [Plugin API Reference](./api-reference.md)
- [ ] Study [Model Zoo Examples](./examples/model-zoo.md)
- [ ] Submit your plugin to the [Model Zoo](https://github.com/coffeetocoffee/forecastlab-models)
- [ ] Join community discussions on GitHub Issues

---

*Need help? Open an issue on the ForecastLab repository.*
