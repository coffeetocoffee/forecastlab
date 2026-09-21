# Continuous forecasting (streaming layer)

Batch mode answers "what will happen given everything so far". The streaming
layer answers "what changed since the last point" — without re-running the
whole pipeline every time. Classical methods inside; a queue plus an event
loop outside. Zero dependencies, fully offline.

## Quick start

```bash
# Tail a CSV: forecasts refresh as rows are appended
node src/cli.js stream --project examples/energy.forecast.json --feed file:examples/energy-hourly.csv

# Process the current file once and exit (scriptable, CI-friendly)
node src/cli.js stream --project examples/energy.forecast.json --feed file:examples/energy-hourly.csv --once

# Receive pushes instead of polling
node src/cli.js stream --project examples/energy.forecast.json --feed webhook:8081

# Subscribe to a live metric stream
node src/cli.js stream --project examples/energy.forecast.json --feed ws:wss://metrics.internal/feed

# Threshold alerts (delivered to stdout and optionally a webhook)
node src/cli.js stream --project examples/energy.forecast.json \
  --feed file:examples/energy-hourly.csv \
  --alert-above 2.0 --alert-below 0.2 --webhook http://localhost:3000/alerts

# Replay recorded events: "what would have happened"
node src/cli.js stream replay --replay events.json --project examples/energy.forecast.json --json replay-out.json
```

## Architecture

```
connector (file | webhook | websocket | polling)
   │  normalized points { seriesId, t, iso, value, source }
   ▼
StreamingEngine.ingest()
   │  stream mode: schedule now · batch mode: accumulate
   ▼
JobQueue  (priority, concurrency + depth limits, timeouts, webhook callbacks)
   │
   ▼
IncrementalForecaster per series
   │  append → Welford stats (O(1)) → drift check → fit() only if invalidated
   ▼
AlertManager (threshold | anomaly | drift, cooldowns, escalation)
   │
   ▼
EventHub ──► stdout (CLI) · Server-Sent Events (workbench) · webhooks
```

### Connectors (`src/streaming/connectors.js`)

| Connector | Source | Notes |
|---|---|---|
| `FileWatchConnector` | CSV auto-update | Tails new bytes only; `fromStart` replays history; `readHistory()` seeds baselines |
| `WebhookConnector` | HTTP push | `POST /ingest` (single or batch JSON), optional bearer token, `/health` |
| `WebSocketFeedConnector` | metric streams | Native `WebSocket` (Node 22+), JSON messages, reconnect with backoff; inject `socketFactory` for custom transports/tests |
| `PollingConnector` | databases, APIs | Cursor-based: you supply `fetchSince(cursor)` (e.g. `SELECT … WHERE id > $1`); `mapRow` shapes rows into points |

**PostgreSQL logical replication.** True logical replication needs a
wire-protocol driver, which would break the zero-dependency rule — so it is
not bundled. The seam is ready: implement `fetchSince` with your driver, or
bridge a replication stream into a `WebhookConnector`:

```js
import { PollingConnector } from 'forecastlab/streaming';
// with node-postgres: SELECT value, ts FROM metrics WHERE id > $1 ORDER BY id
const pgFeed = new PollingConnector({
  seriesId: 'meters',
  intervalMs: 2000,
  initialCursor: lastSeenId,
  fetchSince: async (cursor) => (await pg.query(
    'SELECT value, ts FROM metrics WHERE id > $1 ORDER BY id', [cursor ?? 0])).rows,
  mapRow: (r) => ({ value: Number(r.value), t: new Date(r.ts).getTime() }),
});
```

### Incremental engine (`src/streaming/incremental.js`)

`IncrementalForecaster` keeps a **bounded window** for fitting (memory stays
flat forever) plus **Welford aggregates** over the full history (O(1)).
The core `fit`/`backtest` run only on invalidation:

- `no-fit` — first run
- `new-points` — at least `minNewPoints` arrived (default 1: always fresh)
- `drift` — recent-window mean moved more than `driftThreshold` std-devs from
  baseline; drift also forces method re-selection and auto-recommissioning
- `insufficient-data` — fewer than 10 points (waits, never guesses)

`writeSnapshot(dir)` exports `*.csv` + `*.forecast.json` so `report`,
`reproduce` and `diff` keep working on stream data — the hybrid bridge.

### Queue (`src/streaming/queue.js`)

Priorities (`critical` > `high` > `normal` > `low`, or any number), FIFO
within a priority. Resource limits: `concurrency`, `maxDepth` with
`drop-lowest` (evict the least important waiter) or `reject`, and
`jobTimeoutMs` so one stuck job never stalls the queue. `onComplete`
callbacks and optional per-job `webhook` POSTs report outcomes.

### Alerts (`src/streaming/alerts.js`)

- **threshold** — `value` or `forecast` field, `gt/gte/lt/lte` against a level
- **anomaly** — core `detectAnomalies` on a trailing window; only *new*
  anomalies fire, but a second consecutive anomalous window sets
  `suggestRefit` (the feedback loop)
- **drift** — fires on the forecaster's shift signal, always suggesting a refit

A condition persisting across evaluations escalates `info → warn →
critical`; `cooldownMs` suppresses repeats (level transitions always fire).
Delivery: `onAlert` callback and/or per-rule `webhook`.

### Engine (`src/streaming/engine.js`)

`StreamingEngine` wires it all: `addConnector`, `start`/`stop`,
`setMode('stream' | 'batch')`, `refreshAll()` (batch run-to-completion),
`snapshot()`/`writeSnapshot()`, and `replay(events)` which resets state and
re-feeds history for backtesting against recent stream data. Every update and
alert publishes to the `EventHub` (bounded history included).

### Visualization

`src/visualizations/streaming-chart.js` (browser, global `d3` like the other
components): `StreamingChart` — history line plus forecast with confidence
bands that re-render every update — and `Sparkline` — a tiny trend indicator
(green ▲ / red ▼ / gray ●). The workbench serves the module at
`/streaming-chart.js`; press **Live stream** to attach an `EventSource` to
`/api/stream/events` (enable with `serve --feed …`).

## Serve integration

```bash
node src/cli.js serve --project examples/energy.forecast.json --feed file:examples/energy-hourly.csv
```

- `GET /api/stream/status` — engine stats, or `{ enabled: false, hint }`
- `GET /api/stream/events` — Server-Sent Events (20-event catch-up, then live)
- `GET /streaming-chart.js` — the browser chart module

## Scaling note

One machine handles hundreds of series via the in-process queue. To scale
horizontally, point each instance's `JobQueue.webhook` (or alert webhooks) at
a shared message queue and shard series by id — the connectors, engine, and
alerts are all instance-local and stateless across series.

## What streaming does NOT change

Method selection, intervals, reports, hashes, and project files are the same
batch machinery. Streaming only decides *when* to run it. Reproducibility
holds: `writeSnapshot` + `report` + `reproduce` give the same guarantees on
stream data as on static files.
