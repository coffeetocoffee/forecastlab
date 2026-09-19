# Roadmap

Where ForecastLab could go next, and why. Everything here is classical
statistics and offline — no machine learning, no network calls — because the
project's whole point is forecasting you can understand and reproduce.

## The guiding problem

The differentiator is three words: **honest, explainable, reproducible**. The
plan below deepens those rather than widening the surface. Almost every item
earns its place by making an existing *claim* into a *measured* result.

## Tier 1 — make the core promise true

The current backtest holds out one tail (`evaluate.js`) and crowns the lowest
RMSE. On a 500-point series with a 72-point test window that is a single roll
of the dice: a method can win by luck.

- **Rolling-origin backtesting** — score each method over K expanding-window
  folds and average the RMSE. The highest-value change in this plan; without
  it, method selection is noisy and everything built on top of it is shaky.
  `backtest()` already returns a clean shape, so this is a fold-aware sibling.
- **Interval coverage check** — in backtest, count how often the 80% band
  actually contained the observed value, and report the empirical coverage
  beside the promised one. Intervals are currently a claim; this makes them a
  measured result, and it directly delivers the "honest prediction intervals"
  motto.
- **Do not crown noise** — when two methods' RMSEs sit inside their fold-to-fold
  spread, say "no significant difference" instead of pretending there is a
  winner. A Diebold-Mariano-style test is feasible with zero dependencies via a
  rational normal-CDF approximation, the same trick as the hardcoded
  `INTERVAL_Z` values.
- **Residual diagnostics** — a Ljung-Box-style autocorrelation check that says
  "this model left signal on the table". Pure teaching value for the `methods`
  command and the report.

## Tier 2 — method gaps that stay classical

- **STL decomposition** (trend + seasonal + remainder) — explainable by
  construction, and the report gains three small charts instead of one. Pairs
  naturally with the existing Holt-Winters.
- **Theta method** — a competition winner that still fits in one paragraph of
  explanation.
- **Croston's method** for intermittent demand (series that are mostly zeros).
  The docs already concede that MAPE is meaningless near zero; this is the
  honest answer for that data.
- **Log / Box-Cox transform** — makes multiplicative seasonality's
  strict-positivity requirement natural rather than a special case, and tames
  skewed series such as energy spikes and river surges.
- Grow `--method auto`'s candidate set to include all of the above, selected by
  the Tier-1 multi-fold backtest rather than a single split.

Deliberately absent: ARIMA (a stated non-goal, and ETS/STL covers similar ground
more readably) and anything that learns from data.

## Tier 3 — turn "reproducible" into a tested property

The report records the input hash, the command, and the tool version — but
nothing ever checks them.

- **`reproduce` command** — given a `report.json` and the input CSV, re-run the
  analysis and assert the numbers match, or show the diff. Converts
  reproducibility from a claim into a test that can actually fail.
- **Version pinning in the project file** — a project that requires
  `forecastlab 0.1.0` warns or refuses on a version mismatch.
- **Report diffing** — `report --diff other.json` answering "what did `--damped`
  actually change?", side by side on metrics and forecast paths.
- **Golden-file tests on the three examples** — the datasets are already
  deterministic (`scripts/make-examples.mjs`), so pinning their numbers catches
  silent model regressions. Cheap insurance for a tool whose pitch is numbers
  you can trust.

## Tier 4 — the `serve` workbench

- **Upload and parse a CSV in the browser** — typing a file path is the main
  friction left. Client-side parsing keeps it local-first with no round trips.
- **Shareable view state** — settings in the URL hash so a link reproduces the
  exact chart, no server needed.
- **Download the project file from the page** — the workbench writes nothing by
  design; a Blob download closes the loop from exploring back to the
  reproducible artifact.
- **Interactive chart** — hover values, and toggling methods on and off in the
  backtest overlay.

## The one strategic fork

**Exogenous regressors** — Fourier terms plus a local holiday calendar. This is
the single biggest forecast-quality lever for real data: the `energy` example's
weekend dip is practically begging for a day-type feature, and it is a
classical GLM, not machine learning. But it complicates the story. Project files
grow a features section, and "no external data" needs careful framing — a local
calendar file is fine, an API is not. Worth taking, but it is a change of scope
rather than an incremental addition, so it deserves a deliberate decision.

## If only one thing gets built

**Rolling-origin backtesting.** Method selection, coverage measurement, and
significance testing are all meaningless when the evaluation underneath them is
one lucky split. Everything else in this plan stands on it.
