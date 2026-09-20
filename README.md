# ForecastLab

A **local-first forecasting workbench** for developers and researchers. Import a
time-series CSV, check its quality, compare explainable forecasting methods by
backtesting, and publish a reproducible HTML + JSON report. No AI, no network,
no database, no dependencies — just Node.js.

## Why this exists

Most forecasting tools are either expensive SaaS products or ML frameworks that
hide their reasoning. ForecastLab does the opposite: classical statistical
methods (naive, seasonal naive, mean, drift, linear trend, Holt, Holt-Winters —
with damped-trend and multiplicative-seasonality variants),
each with a plain-language explanation, its mathematics, and honest prediction
intervals. Every report records the input file's SHA-256 hash and the exact
command that produced it, so results are reproducible years later.

## Requirements

- Node.js 20 or newer. Nothing else.

## Quickstart

```bash
# 1. Copy a built-in example
node src/cli.js demo --example energy

# 2. Check data quality
node src/cli.js check --project forecastlab-demo/energy.forecast.json

# 3. Compare methods on held-out data
node src/cli.js compare --project forecastlab-demo/energy.forecast.json

# 4. Build the full report (open the HTML file in any browser)
node src/cli.js report --project forecastlab-demo/energy.forecast.json

# 5. Or explore the same engine interactively in your browser
node src/cli.js serve --project forecastlab-demo/energy.forecast.json --open
```

Or work directly with your own CSV:

```bash
node src/cli.js init --data measurements.csv --unit kWh --season 24
node src/cli.js report --project forecastlab.json --html out/report.html --json out/report.json
```

## Commands

| Command    | Purpose |
| ---------- | ------- |
| `init`     | Create a reproducible `.forecast.json` project file from a CSV |
| `check`    | Validate quality: gaps, duplicates, outliers, missing values (`--resample` first fixes irregular timestamps) |
| `compare`  | Backtest every method on the held-out tail and rank by RMSE |
| `forecast` | Forecast `--horizon` steps (`--method auto` picks the backtest winner) |
| `report`   | Full pipeline: backtest + forecast + self-contained HTML/JSON report (add `--csv` for the forecast table, `--md` for a Markdown variant) |
| `serve`    | Interactive browser workbench over the same engine: change a setting, see the chart, backtest, and quality notes re-run live |
| `methods`  | Plain-language guide to every method, with the math |
| `demo`     | Copy a built-in example (`energy`, `river`, `temp`) into a folder |

See `docs/` for the [data format](docs/data-format.md), the
[reproducible workflow](docs/workflow.md), [method notes](docs/methods.md), and
the [roadmap](docs/roadmap.md).

## How forecasting works here

1. **Check** finds data problems before they corrupt results.
2. **Compare** holds out the tail of the series, forecasts it blind, and scores
   each method (RMSE, MAE, MAPE, sMAPE, MASE). The lowest RMSE wins.
3. **Forecast** refits the winner on *all* data and projects forward with a
   prediction interval that widens with horizon — uncertainty compounds.
4. **Report** bundles the chart, the comparison table, the data-quality notes,
   the method's explanation, and the reproducibility record (input hash,
   command, tool version) into one HTML file plus a machine-readable JSON twin.

## Non-goals

- No machine learning, no ARIMA fitting, no external APIs or accounts.
- No real-time streaming (hourly/daily batch data is the target).
- Reports are static files you open or share; `serve` is a loopback-only
  workbench for exploration, never a hosted service.

## Project layout

```
src/        engine: series, models, evaluate, explain, report, project, serve, cli
examples/   three generated datasets + project files (see scripts/make-examples.mjs)
docs/       data format, workflow, method notes
test/       node:test suite (`npm test` or `node --test test/`)
scripts/    deterministic example-data generator
```

## License

MIT — see [LICENSE](LICENSE).
