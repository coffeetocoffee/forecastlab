# Reproducible workflow

A ForecastLab analysis is three files: **input CSV + project JSON + report**.
Anyone with those files and the recorded command can reproduce your numbers.

## The loop

1. **Collect** — put observations in a CSV (see [data format](data-format.md)).
2. **Describe** — `forecastlab init --data x.csv` writes a project file naming
   the columns, units, season, and horizon. This file is your lab notebook.
3. **Check** — `forecastlab check` lists gaps, duplicates, outliers, and
   missing values. Fix sensor problems *before* forecasting, and note what you
   changed. Every flag is a *candidate*, not a verdict: a single-point spike
   with no physical explanation (the river example's day-100 glitch) is almost
   certainly an error, while a multi-day excursion that matches external
   records (its rain surges) is a real event to keep. Shape and corroboration
   decide — the tool surfaces, you judge. If timestamps are irregular, add
   `--resample` to project onto a fixed grid first (`--step <ms>` to choose it,
   `--agg mean|sum|first|last|min|max` to choose how bins collapse; empty bins
   are dropped and reported as gaps, never filled with invented data).
4. **Compare** — `forecastlab compare` backtests every applicable method on
   data it never saw and ranks them by RMSE. Trust this table more than any
   single forecast. Variant flags refine the trend/seasonal methods: re-run
   with `--damped` (trend flattens with horizon) or
   `--seasonality multiplicative` (seasons scale with the level) and let the
   backtest decide which variant you should trust.
5. **Report** — `forecastlab report` refits the winner on all data, forecasts,
   and writes `report.html` + `report.json`. Add `--csv forecast.csv` for a
   full-precision forecast table to pipe into other tools, and
   `--md report.md` for a plain-text variant (same sections, no chart). The
   HTML embeds the input's SHA-256 hash, the command, and the tool version.
6. **Share** — publish the CSV, the project file, and the report together.
   A result without its input data is an anecdote.

## Interactive workbench

`forecastlab serve --project x.forecast.json --open` runs the same loop in a
browser: a form for every setting, and every change re-runs the real engine
against the file on disk (nothing is cached, nothing is uploaded). It is the
fastest way to feel out `--season`, `--damped`, `--seasonality multiplicative`,
or a longer `--horizon` before committing to a report. Built-in examples are a
select-box away.

The page binds to 127.0.0.1 and its data routes require a token issued at
startup, so a web page from another origin cannot drive this server or read
your files; pass `--host 0.0.0.0` only if you mean to share it on your network.
When you find the settings you trust, note them and produce the reproducible
artifact with `forecastlab report` — the workbench is exploration, the report
is the record.

## Reading the metrics

- **RMSE** (root mean squared error): the selection metric. Punishes large
  misses hardest; in the data's own units.
- **MAE**: average miss size, robust and easy to explain.
- **MAPE / sMAPE**: percentage errors. Ignore MAPE when values approach zero
  (division by ~zero); sMAPE is bounded but harder to interpret.
- **MASE**: error relative to a naive baseline on the training data. Below 1
  means the method beats "tomorrow equals today". If nothing beats 1, say so —
  that is a finding, not a failure.

## Reading the intervals

The band is an approximate 80/90/95% prediction interval under the assumption
that future noise resembles past residuals. It widens with horizon because
uncertainty compounds. A method can be *right on average* and still have wide
bands — report both, never just the center line. With `--seasonality
multiplicative` the band is a share of the point forecast (sigma is a relative
error), so it scales with the level instead of sitting at a constant width.
