// serve + stream commands: the local workbench and continuous forecasting.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveInput } from '../index.js';
import { createServer, openBrowser } from '../serve.js';
import { writeJson, toPort } from '../cli-shared.js';
import {
  StreamingEngine,
  FileWatchConnector,
  WebhookConnector,
  WebSocketFeedConnector,
} from '../streaming/index.js';

export function cmdServe(opts) {
  const port = toPort(opts.port);
  const host = opts.host ?? '127.0.0.1';
  let streaming = null;
  if (opts.feed) {
    const input = resolveInput(opts);
    const cfg = input.config;
    const engine = new StreamingEngine({
      seasonLength: cfg.seasonLength,
      horizon: cfg.horizon,
      interval: cfg.interval,
      method: cfg.method ?? 'auto',
      damped: cfg.damped ?? false,
      seasonality: cfg.seasonality ?? 'additive',
    });
    engine.addConnector(buildFeedConnector(opts.feed, {
      seriesId: cfg.name,
      timeColumn: cfg.timeColumn,
      valueColumn: cfg.valueColumn,
      fromStart: true,
    }));
    engine.start().catch((e) => console.error(`Streaming engine failed to start: ${e.message}`));
    streaming = engine;
  }
  const server = createServer({ defaults: opts, streaming });
  server.on('error', (e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const addr = server.address();
    const url = `http://${addr.address}:${addr.port}/`;
    console.log(`ForecastLab workbench: ${url}`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.log('Warning: bound outside the loopback interface — the workbench is reachable from your network.');
    }
    console.log('Same engine as the CLI; every request re-reads your file. Press Ctrl+C to stop.');
    if (opts.open) openBrowser(url);
  });
}

/**
 * Stream command: continuous forecasting alongside batch mode.
 *   forecastlab stream --project x.forecast.json --feed file:data.csv
 *   forecastlab stream --project x.forecast.json --feed webhook:8081 --once
 *   forecastlab stream replay --events events.json --project x.forecast.json
 */
export async function cmdStream(opts) {
  if (opts._ === 'replay' || opts.replay) return cmdStreamReplay(opts);
  const input = resolveInput(opts);
  const cfg = input.config;

  const rules = [];
  if (opts.alertAbove !== undefined) {
    rules.push({ id: 'cli-above', kind: 'threshold', field: 'value', op: 'gt', level: Number(opts.alertAbove), webhook: opts.webhook ?? null, message: `value above ${opts.alertAbove}` });
  }
  if (opts.alertBelow !== undefined) {
    rules.push({ id: 'cli-below', kind: 'threshold', field: 'value', op: 'lt', level: Number(opts.alertBelow), webhook: opts.webhook ?? null, message: `value below ${opts.alertBelow}` });
  }
  // Always watch for drift so auto-recommissioning is visible.
  rules.push({ id: 'cli-drift', kind: 'drift', webhook: opts.webhook ?? null });

  const engine = new StreamingEngine({
    seasonLength: cfg.seasonLength,
    horizon: cfg.horizon,
    interval: cfg.interval,
    method: cfg.method ?? 'auto',
    methods: cfg.methods ?? null,
    damped: cfg.damped ?? false,
    seasonality: cfg.seasonality ?? 'additive',
    rules,
  });

  const feedSpec = opts.feed ?? `file:${input.dataPath}`;
  const connector = buildFeedConnector(feedSpec, {
    seriesId: cfg.name,
    timeColumn: cfg.timeColumn,
    valueColumn: cfg.valueColumn,
    fromStart: Boolean(opts.once),
  });
  engine.addConnector(connector);

  engine.hub.subscribe((event) => {
    if (event.type === 'update') {
      console.log(JSON.stringify({
        series: event.seriesId,
        t: event.point.iso,
        value: event.point.value,
        recomputed: event.recomputed,
        reason: event.reason,
        method: event.method,
        alerts: event.alerts,
      }));
    } else if (event.type === 'alert') {
      console.log(JSON.stringify({ alert: event.alert }));
    }
  });

  await engine.start();
  console.log(`Streaming "${cfg.name}" from ${feedSpec} (mode: stream, Ctrl+C to stop)`);

  // Seed the baseline from the file so fresh starts forecast with full context.
  // Later rows arrive as live events; timestamp dedupe makes overlap harmless.
  if (!opts.once && typeof connector.readHistory === 'function') {
    try {
      const history = connector.readHistory();
      const seeded = await engine.seed(cfg.name, history);
      console.log(JSON.stringify({ seeded: history.length, method: seeded.result?.method ?? null }));
    } catch (e) {
      console.log(JSON.stringify({ seedWarning: e.message }));
    }
  }

  if (opts.once) {
    const drained = await engine.drain(30000);
    await engine.stop();
    const summary = { drained, status: engine.status(), snapshots: engine.snapshot() };
    if (opts.json) {
      writeJson(opts.json, summary);
      console.log(`Wrote ${resolve(opts.json)}`);
    } else {
      console.log(JSON.stringify(summary.status, null, 2));
    }
    return;
  }

  await new Promise((resolve) => {
    const shutdown = async () => {
      await engine.stop();
      const summary = { status: engine.status() };
      if (opts.json) {
        writeJson(opts.json, { ...summary, snapshots: engine.snapshot() });
        console.log(`Wrote ${resolve(opts.json)}`);
      } else {
        console.log(JSON.stringify(summary.status, null, 2));
      }
      resolve();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

export function buildFeedConnector(spec, defaults) {
  const idx = spec.indexOf(':');
  const kind = idx === -1 ? 'file' : spec.slice(0, idx);
  const rest = idx === -1 ? spec : spec.slice(idx + 1);
  if (kind === 'file') {
    return new FileWatchConnector({ path: resolve(process.cwd(), rest), seriesId: defaults.seriesId, timeColumn: defaults.timeColumn, valueColumn: defaults.valueColumn, fromStart: defaults.fromStart });
  }
  if (kind === 'webhook') {
    return new WebhookConnector({ port: Number(rest) || 0, seriesId: defaults.seriesId });
  }
  if (kind === 'ws' || kind === 'websocket') {
    return new WebSocketFeedConnector({ url: rest, seriesId: defaults.seriesId });
  }
  throw new Error(`Unknown feed "${kind}". Use file:<path> | webhook:<port> | ws:<url>`);
}

/** Replay recorded events to answer "what would have happened". */
async function cmdStreamReplay(opts) {
  if (!opts.replay) throw new Error('replay needs --replay <events.json>');
  const eventsPath = resolve(process.cwd(), opts.replay);
  let events;
  try {
    events = JSON.parse(readFileSync(eventsPath, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read events file "${eventsPath}": ${e.message}`);
  }
  const rows = Array.isArray(events) ? events : events.events ?? [];
  // The subcommand word ('replay') lands in opts.project via positional mapping; ignore it.
  const projectPath = opts.project && opts.project !== 'replay' ? opts.project : null;
  const input = projectPath ? resolveInput({ ...opts, project: projectPath }) : null;
  const cfg = input?.config ?? {};
  const engine = new StreamingEngine({
    seasonLength: cfg.seasonLength ?? null,
    horizon: cfg.horizon ?? 24,
    interval: cfg.interval ?? 80,
    method: cfg.method ?? 'auto',
  });
  const out = await engine.replay(rows, { seriesId: cfg.name });
  const summary = { processed: out.processed, snapshots: out.snapshots };
  if (opts.json) {
    writeJson(opts.json, summary);
    console.log(`Wrote ${resolve(opts.json)}`);
  } else {
    for (const s of summary.snapshots) {
      console.log(`${s.seriesId}: ${s.points} points, method=${s.result?.method ?? 'none'}, refreshes=${s.refreshCount}`);
    }
  }
}
