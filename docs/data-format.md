# Data format

ForecastLab reads **CSV files with a time column and a value column**. JSON
project files (`.forecast.json`) record the settings so a forecast can be
reproduced exactly.

## CSV

```csv
timestamp,value
2026-01-01T00:00:00.000Z,3.412
2026-01-01T01:00:00.000Z,3.105
```

Rules:

- The first non-empty line is the header. Column names are case-insensitive.
- The time column is auto-detected from `timestamp, time, date, datetime, dt`;
  the value column from `value, observation, y, reading, level, demand, temp,
  temperature, flow, usage, count`. Two-column files fall back to first = time,
  second = value. Otherwise pass `--time` / `--value`.
- Timestamps accept ISO 8601 (`2026-01-01`, `2026-01-01T00:00:00Z`) or epoch
  seconds/milliseconds (plain integers).
- Quoted fields (`"a, b"`) and `""` escapes are supported.
- **Empty value cells are skipped and counted** as missing values in the
  quality report. Malformed timestamps or non-numeric values are errors with
  line numbers — fix the file, don't silently drop rows.
- Rows are sorted by time automatically.
- **Timestamps need not be perfectly spaced**, but seasonal methods assume a
  regular grid. If timestamps are irregular, run any command with
  `--resample` to project onto a fixed grid first (see
  [workflow](workflow.md)); empty windows are reported as gaps, never filled.

## Project files

Created by `forecastlab init`, edited by hand afterwards:

```json
{
  "name": "Building electricity use",
  "description": "Hourly meter data, Jan 2026.",
  "data": "energy-hourly.csv",
  "timeColumn": "timestamp",
  "valueColumn": "value",
  "unit": "kWh",
  "seasonLength": 24,
  "horizon": 48,
  "interval": 80,
  "testSize": 72,
  "resample": false,
  "agg": "mean",
  "step": null
}
```

- `data` is resolved relative to the project file, so moving the pair of files
  together keeps them working.
- Any CLI flag (`--season`, `--horizon`, ...) overrides the file, and the
  report records the exact command used.
- Commit the CSV and the project file together: that pair *is* the experiment.

## Choosing a season length

The season is the number of steps per repeating cycle: `24` for hourly data
with a daily pattern, `7` for daily data with a weekly pattern, `12` for
monthly data with a yearly pattern. Seasonal methods (`snaive`, `hw`) need at
least two full cycles. When in doubt, run `compare` with and without `--season`
and let the backtest decide.
