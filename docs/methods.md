# Method notes

Short version of `forecastlab methods`, with the mathematics spelled out.
Notation: `y(t)` is the observation at step `t`, `T` the last observed step,
`yhat(T+h)` the forecast `h` steps ahead, `m` the season length.

## Naive — `naive`

`yhat(T+h) = y(T)`

The baseline. Any method that cannot beat naive on held-out data has no
business forecasting this series. Naive is also the right choice for random
walks (stock-like data with no momentum).

## Seasonal naive — `snaive`

`yhat(T+h) = y(T+h-m)`

Copies the observation from one full season ago. Surprisingly strong for
stable seasonal data (yesterday's same hour, last week's same day). Needs
`--season`. Copies noise as well as signal, and cannot extrapolate growth.

## Mean — `mean`

`yhat(T+h) = mean(y)`

A flat line at the historical average. Correct when the series is stationary
around a level; useless with trends or seasons. The prediction interval is
wide because every deviation from the mean counts as noise.

## Drift — `drift`

`yhat(T+h) = y(T) + h * (y(T) - y(1)) / (T-1)`

Naive plus the average per-step change between the first and last observation.
Simple and often effective for short, roughly straight trends — but only the
two endpoints matter, so one bad reading at either end tilts the whole line.

## Linear trend — `linear`

`yhat(T+h) = a + b*(T+h)`, with `a, b` minimising the sum of squared errors.

Ordinary least squares through all points: sturdier than drift, still a
straight line. Fails on curves, saturation, regime changes, and seasons.
Check the residuals in the report — a visible pattern means the line is the
wrong shape.

## Holt's linear trend — `holt`

```
level(t) = a*y(t) + (1-a)*(level(t-1) + trend(t-1))
trend(t) = c*(level(t) - level(t-1)) + (1-c)*trend(t-1)
yhat(T+h) = level(T) + h*trend(T)
```

Exponential smoothing tracks a level and a slope that adapt as new data
arrives. The smoothing constants `a, c` are chosen by grid search to minimise
one-step-ahead squared errors. Good when the trend itself bends; can overreact
to one-off shocks, which is why the intervals widen honestly.

### Damped trend — `--damped`

```
yhat(T+h) = level(T) + (phi + phi^2 + ... + phi^h) * trend(T),   0 < phi < 1
```

Each step multiplies the carried slope by `phi`, so the extrapolated growth
decays and the forecast flattens instead of running away (ETS(A,Ad,N)). `phi`
is grid-searched alongside the smoothing constants. Damping is the honest
default when a trend cannot continue forever — saturation, market share,
capacity limits — and it usually pays off most at long horizons, where a
straight line is a bold claim. It is still an assumption that growth decays:
check the interval, not just the point. Applies to `holt` and `hw`.

## Holt-Winters additive — `hw`

```
yhat(T+h) = level(T) + h*trend(T) + season(T+h-m)
```

Holt plus a repeating seasonal pattern that is *added* to level and trend.
The workhorse for data with both trend and seasons (energy demand, river
levels, retail). Needs `--season` and at least two full cycles.

### Multiplicative seasonality — `--seasonality multiplicative`

```
yhat(T+h) = (level(T) + h*trend(T)) * season(T+h-m)
```

The seasonal indices are *ratios* rather than offsets, so swings scale with
the level (ETS(A,A,M)): peaks double when the series doubles. Use it wherever
seasonal amplitude grows with the level — electricity demand, sales, traffic.
It needs strictly positive data, because ratios of negative values are
meaningless; on constant-amplitude data the additive form is the safer
default and fits just as well. Prediction intervals scale with the forecast
(see below). Combine with `--damped` for both effects.

## Prediction intervals

All methods use `yhat ± z * sigma * sqrt(h)`, where `sigma` is the residual
standard deviation from fitting and `z` is 1.28 / 1.64 / 1.96 for 80 / 90 /
95%. The `sqrt(h)` term is the random-walk assumption: each step adds fresh,
independent noise. Real series often violate independence, so treat bands as
honest approximations, not guarantees.

With `--seasonality multiplicative` the band scales with the forecast instead:
`yhat * (1 ± z * sigma * sqrt(h))`, where `sigma` is the *relative* residual
error (a unitless fraction of the level), reported as a percentage. The lower
bound is clamped at zero — a multiplicative model cannot forecast below it.
