# ForecastLab Plugin SDK v3.0
The official SDK for extending ForecastLab with custom models, metrics, and visualizations.

## Installation

```bash
npm install @forecastlab/sdk
```

## Quick Start

Create your first plugin in 5 minutes:

```javascript
// my-forecaster.mjs
import { registerModel } from '@forecastlab/sdk';

export class MyForecaster {
  fit(data, params) {
    this.mean = data.reduce((a, b) => a + b) / data.length;
    return this;
  }
  
  forecast(horizon) {
    return Array(horizon).fill().map(() => ({
      value: this.mean,
      lower: this.mean - 2,
      upper: this.mean + 2
    }));
  }
  
  explain() {
    return "MyForecaster uses historical mean prediction.";
  }
}

registerModel('my-custom', MyForecaster);
```

## Documentation

See [docs/plugins/getting-started.md](../docs/plugins/getting-started.md) for complete tutorial.
