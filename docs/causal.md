# Causal understanding (without machine learning)

ForecastLab's causal tools answer **why** a series moves, not just what it will do
next. Everything here is classical statistics you can audit line by line: Pearson
cross-correlation, Granger-style F-tests, distributed-lag regression, and
difference-in-differences. No model is trained on your data, and nothing leaves
your machine.

```
forecastlab causal graph          # how do variables affect each other?
forecastlab causal what-if        # what if we changed X?
forecastlab causal factors        # how much did known events matter?
forecastlab causal counterfactual # what would have happened?
```

Run `forecastlab help causal` for the full option reference, or
`forecastlab demo --example causal` to get a ready-made dataset.

---

## 1. Causal relationship builder

```bash
forecastlab causal graph --data examples/causal-energy.csv --season 24 --html causal.html
```

`--data` is a **wide CSV**: one time column, then one column per variable.

```
timestamp,temperature,price,demand
2026-07-01T00:00:00.000Z,12.34,0.1134,402.1
...
```

For every ordered pair of variables the engine:

1. **Detrends** both series (least-squares) and, when `--season <n>` is given,
   **removes the seasonal profile** so a shared cycle cannot masquerade as a link.
2. **Scans lags** 0..`--max-lag`, correlating `a[t-L]` with `b[t]`.
3. Runs a **Granger-style F-test**: do lags 0..L of `a` predict `b` beyond `b`'s
   own autoregressive past? The p-value comes from the exact incomplete beta
   function, so it is a real test, not an approximation.
4. Reports the **effect** (`correlation × sd(b) / sd(a)`) in units of `b` per unit
   of `a`, at the strongest lag.
5. Scores **confidence** = `0.6·|r| + 0.4·sign-stability` across sub-periods — a
   link that flips sign halfway through the data scores low even with a high `r`.

A link whose reverse direction also tests significant is marked **feedback?**:
either genuine two-way causation or a hidden common cause, and the test cannot
tell those apart. Correlation is never proof of causation — treat every link as a
hypothesis to check with the tools below.

### The drag-and-drop graph

`--html causal.html` writes a self-contained page (no server, no network):

- **Drag a node** to rearrange the graph.
- **Drag from a node's green handle onto another node** to test a hypothesis of
  your own. The statistics re-run instantly in the browser — the same module the
  CLI uses is inlined into the page, so the numbers match exactly.
- **Click a link** for its lag, correlation, effect, F-statistic, p-value and a
  bar chart of correlation versus lag (green = significant at that lag, amber =
  the selected lag).

> **Why `--season` matters.** Two series that share a daily cycle correlate
> strongly just from the phase between their peaks, and the "effect" reported
> without deseasonalizing is inflated by that artifact. With `--season 24` the
> cycle is removed from both series and the reported effect is the honest one.
> Compare the table with and without the flag on the example data to see the
> difference — it is a good demonstration of why causal claims need controls.

---

## 2. Intervention simulator

```bash
forecastlab causal what-if --data examples/causal-energy.csv \
  --variable temperature --target demand --change 5 --season 24 --html what-if.html
```

Rather than applying an unexplained multiplier, the simulator fits a
**distributed-lag (impulse) response** of the target to the variable: how much
does `demand` move per unit of `temperature`, at lag 0, 1, 2, …? Your change is
then **convolved with that response**, so a one-step pulse decays back to the
baseline while a sustained shift produces the cumulative multiplier.

Output includes the baseline path, the hypothetical path, per-step differences,
an uncertainty band (baseline band widened by the response model's residual
sigma), and the peak and cumulative impact. Two warnings are computed rather than
assumed: `EXTRAPOLATION` when the requested change exceeds anything observed, and
`WEAK_RESPONSE_MODEL` when the historical response explains little of the
target's variance.

`--start <step>` and `--duration <steps>` place the intervention in the future
window (step 1 is the first forecast step).

### Natural experiments

The same command scans history for points where the variable jumped sharply
(more than `--min-magnitude` MADs of its differences) and reports the target's
measured response over the following window, against a drift-extrapolated
counterfactual, with a t-test. Each candidate is an **observed** response you can
promote to a full counterfactual analysis:

```bash
forecastlab causal counterfactual --data examples/causal-energy.csv --event-index 288
```

---

## 3. External factor integration

```bash
forecastlab causal factors --data examples/causal-energy.csv --value demand \
  --factors examples/causal-factors.json --holidays 2026-2026 --season 24
```

Register known events and let the regression measure them:

- **Event factors** with a temporal decay kernel:
  `box` (on/off), `exponential` (sharp onset, decay over `duration/3`),
  `triangular` (ramp up to a peak and down), `gaussian` (bell),
  `step` (a permanent level shift approached smoothly).
- **Series factors**: any aligned numeric covariate (weather, price, a competitor
  series), imported from a wide CSV with `--factors file.csv`.
- **Holiday calendar**: a built-in local calendar for a year range
  (`--holidays 2025-2026`) covering fixed and US floating holidays plus a few
  retail events. Pure date arithmetic — no network, no timezone assumptions, and
  deliberately incomplete. Add your own events to the same model.

The model is a plain regression with Fourier controls for the cycle
(`--season`), so factor effects are measured **against a seasonal baseline**
instead of raw noise. Factors are ranked by **impact magnitude**
(`|coefficient| × sd(factor)`), each with its t-statistic and p-value.

Events outside the observation window are **reported, not estimated**: they would
otherwise be clamped onto the first observation or silently dropped. Factors that
are exactly collinear (two events on the same steps) are flagged as
ridge-regularized — the model still fits, but the split between them is
arbitrary, so read their individual coefficients with care.

Factor file format (JSON):

```json
{
  "events": [
    { "name": "heatwave", "start": "2026-07-12", "duration": 72, "decay": "exponential" },
    { "name": "promotion", "start": 400, "duration": 5, "decay": "box" }
  ]
}
```

`start` accepts a date or a step index; `effect` is an optional prior scale (the
regression always estimates its own coefficient).

---

## 4. Counterfactual analysis (difference-in-differences)

```bash
forecastlab causal counterfactual --data examples/causal-sales.csv \
  --event-date 2026-04-01 --pre-window 14 --post-window 14 --html cf.html
```

Given an event (`--event-index <step>` or `--event-date <iso>`, snapped to the
nearest observation), the analyzer:

1. **Builds a control group** from similar periods, matching on the pre-window's
   normalized shape, slope and volatility. Candidates are other windows of the
   same series by default; pass a wide CSV with several units and they are used
   as external controls (`--value` selects the treated column).
2. Constructs the counterfactual: the treated series starts at its pre-event
   level and grows like the average control deviated from its own pre-level.
3. Computes **difference-in-differences** with a standard error and t-test, plus
   the per-step gap and the cumulative gap over the post window.
4. Lists the **assumptions** the estimate rests on — parallel trends, no
   spillover, and a caveat that the standard error ignores autocorrelation, which
   makes it optimistic for smooth series.

Without external controls the counterfactual falls back to the treated series'
own pre-period trend, the weakest of these designs; the output says so.

---

## Programmatic use

```js
import { CausalGraph, InterventionSimulator, ExternalFactorIntegrator,
         CounterfactualAnalyzer, holidayCalendar } from 'forecastlab/causal.js';

const graph = new CausalGraph({ temperature, demand, price });
const edges = graph.discover({ maxLag: 12, seasonLength: 24, alpha: 0.05 });
const top = edges[0]; // { from, to, lag, correlation, effect, pValue, confidence, ... }

const sim = new InterventionSimulator({ temperature, demand });
const result = await sim.simulate({
  variable: 'temperature', target: 'demand', change: 5, horizon: 24,
});
result.cumulativeImpact; result.uncertainty.lower; result.interpretation;

const integ = new ExternalFactorIntegrator(times);
integ.importEvents(holidayCalendar({ from: 2026, to: 2026 }));
integ.addEventFactor('promo', { start: '2026-08-01', duration: 5, decay: 'box' });
integ.fit(demand, { seasonLength: 24 }).factors; // coefficients, t, p, impact
integ.rankFactors();                             // sorted by impact magnitude

const cf = new CounterfactualAnalyzer();
const group = cf.buildControlGroup({ treated: sales, eventIndex: 31, k: 3 });
const verdict = cf.run({ treated: sales, controls: group.controls, eventIndex: 31 });
verdict.did; verdict.pValue; verdict.counterfactual; verdict.assumptions;
```

Every number is a pure function of the input arrays — no randomness except the
seed you control, no hidden state, no training step.

---

## What this does not do

- It does not prove causation. Each link is a tested hypothesis; the intervention
  and counterfactual tools exist to check them.
- It does not learn from data. There is no fitting beyond classical regression,
  and no parameter is tuned by an objective the tool does not show you.
- It does not call any network. The holiday calendar is local arithmetic; the
  interactive graph runs entirely in your browser.

## Method summary

| Question | Method |
|---|---|
| Does `a` affect `b`? | Detrend (+ deseasonalize), lagged cross-correlation, Granger-style F-test |
| By how much? | Effect = `r · sd(b)/sd(a)` at the strongest lag; distributed-lag OLS for the response |
| Is the link durable? | Sign-stability of the correlation across sub-periods |
| What if we changed X? | Convolve the change with the fitted impulse response; band from residual sigma |
| Did a known event matter? | OLS on decay-kernel regressors with Fourier seasonal controls |
| What would have happened? | Matched control group + difference-in-differences with a t-test |
