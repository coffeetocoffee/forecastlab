#!/usr/bin/env node
// forecastlab CLI: init, check, compare, forecast, report, methods, demo, help.
// Streaming/serve commands live in commands/streaming.js, report utilities in
// commands/reports.js, advanced analytics in commands/advanced.js, plugins in
// commands/plugins.js. Zero dependencies; human-readable stdout,
// machine-readable --json/--html files.

import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCsv,
  loadCsvFile,
  summarizeSeries,
  backtest,
  fit,
  applicableMethods,
  allMethodCards,
  methodCard,
  fmtNum,
  buildHtmlReport,
  buildJsonReport,
  buildForecastCsv,
  buildMarkdownReport,
  writeReportFiles,
  futureTimes,
  shortLabel,
  defaultProject,
  writeProjectFile,
  resolveInput,
  generateFeatures,
  parseFeatureConfig,
} from './index.js';

// Causal understanding (no machine learning)
import { cmdCausal } from './commands/causal.js';
// serve + stream
import { cmdServe, cmdStream } from './commands/streaming.js';
// reproduce, diff, batch
import { cmdReproduce, cmdDiff, cmdBatch } from './commands/reports.js';
// Phase 4 advanced analytics
import {
  cmdReconcile,
  cmdPanel,
  cmdSpillover,
  cmdFactors,
  cmdUncertainty,
  cmdWhatIf,
  cmdSchedule,
  cmdUpdate,
} from './commands/advanced.js';
// Phase 5 plugins
import { cmdPlugins, cmdInstallPlugin } from './commands/plugins.js';
// Shared helpers
import { VERSION, writeJson } from './cli-shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(HERE, '..', 'examples');

const EXAMPLES = {
  energy: { file: 'energy-hourly.csv', project: 'energy.forecast.json', title: 'Hourly building electricity use (kWh)' },
  river: { file: 'river-daily.csv', project: 'river.forecast.json', title: 'Daily river level (m)' },
  temp: { file: 'temp-daily.csv', project: 'temp.forecast.json', title: 'Daily mean temperature (C)' },
  'energy-fourier': { file: 'energy-fourier-hourly.csv', project: 'energy-fourier.forecast.json', title: 'Hourly electricity with Fourier features' },
  causal: { file: 'causal-energy.csv', project: 'causal-factors.json', title: 'Hourly energy market: temperature and price driving demand' },
};

const VALUE_OPTS = new Set([
  'data', 'project', 'time', 'value', 'name', 'unit', 'season', 'horizon',
  'interval', 'method', 'methods', 'test-size', 'json', 'html', 'csv', 'md',
  'out', 'example', 'agg', 'step', 'seasonality', 'port', 'host', 'report',
  'features',
  // causal understanding
  'columns', 'variable', 'target', 'change', 'start', 'duration', 'max-lag',
  'ar-lag', 'significance', 'pre-window', 'post-window', 'event-index',
  'event-date', 'factors', 'holidays', 'k', 'all',
  // streaming
  'feed', 'webhook', 'replay', 'alert-above', 'alert-below',
]);
const BOOL_OPTS = new Set(['help', 'version', 'resample', 'damped', 'open', 'list', 'install', 'once']);

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const storeAs = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // --test-size -> testSize
      if (BOOL_OPTS.has(key)) { opts[storeAs] = true; continue; }
      if (!VALUE_OPTS.has(key)) throw new Error(`Unknown option --${key}. Run: forecastlab help`);
      const val = eq === -1 ? argv[++i] : a.slice(eq + 1);
      if (val === undefined || (eq === -1 && String(val).startsWith('--'))) {
        throw new Error(`Option --${key} needs a value`);
      }
      opts[storeAs] = val;
    } else if (a === '-h') opts.help = true;
    else positional.push(a);
  }
  // A positional after the command names the subcommand and/or the project/data
  // path, e.g. "plugins list" or "check ."
  if (positional[1] !== undefined) {
    opts._ = positional[1];
    if (opts.project === undefined) opts.project = positional[1];
  }
  return { command: positional[0] ?? null, opts, action: positional[1] ?? null, positional };
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

const printHelp = (action) => {
  if (action === 'causal') {
    console.log(`forecastlab ${VERSION} — causal understanding (classical statistics, no machine learning)

Usage: forecastlab causal <action> [options]

Actions:
  graph          Discover how variables affect each other, with lag analysis,
                 confidence scoring and a significance test on every link.
                 Opens a drag-and-drop graph in the browser with --html: drag
                 from a node's green handle to another node to test a
                 hypothesis of your own.
  what-if        "What if we changed X?" — propagate a change through the
                 historical impulse response, with uncertainty bounds. Also
                 reports natural experiments found in the data.
  factors        Measure the effect of known external events (holidays,
                 promotions, weather) on a series, and rank them by impact.
  counterfactual Compare what happened against what would have happened, using
                 a control group of similar periods and difference-in-differences.

Options:
  --data <csv>        Input CSV. graph/what-if want a wide CSV (time + one column
                      per variable); factors/counterfactual want time + one value.
  --variable <col>    (what-if) the column to change
  --target <col>      (what-if) the column that responds
  --change <n>        (what-if) units to add to the variable
  --start <n>         (what-if) step index of the change (default 0)
  --duration <n>      (what-if) how long the change persists (default: whole horizon)
  --horizon <n>       (what-if) steps to simulate (default 24)
  --max-lag <n>       Furthest lag to scan (default 12)
  --ar-lag <n>        Autoregressive terms of the target used as control (default 4)
  --season <n>        Season length; both series are deseasonalized before testing
  --significance <p>  Threshold for a link to count as significant (default 0.05)
  --all               (graph) also show links that failed the significance test
  --event-index <n>   (counterfactual) step where the intervention happened
  --event-date <iso>  (counterfactual) ... or a date, snapped to the nearest observation
  --pre-window <n>    (counterfactual) steps before the event to match on (default 12)
  --post-window <n>   (counterfactual) steps after the event to compare (default 12)
  --k <n>             (counterfactual) control windows to keep (default 3)
  --factors <file>    (factors) events JSON or a wide CSV of covariates
  --holidays <a-b>    (factors) built-in local holiday calendar, e.g. --holidays 2025-2026
  --html <path>       Write an interactive HTML view
  --json <path>       Write machine-readable results

Examples:
  forecastlab causal graph --data examples/causal-energy.csv --html causal.html --season 24
  forecastlab causal what-if --data examples/causal-energy.csv --variable temperature --target demand --change 5 --html what-if.html
  forecastlab causal factors --data examples/causal-energy.csv --value demand --factors examples/causal-factors.json --holidays 2026-2026
  forecastlab causal counterfactual --data examples/causal-sales.csv --event-date 2026-04-01 --html cf.html
`);
    return;
  }
  console.log(`forecastlab ${VERSION} — a local-first forecasting workbench (offline, zero dependencies)

Usage: forecastlab <command> [options]

Commands:
  init       Create a reproducible project file from a CSV
  check      Validate data quality (gaps, duplicates, outliers, missing values)
  compare    Backtest methods on held-out data and rank them
  forecast   Forecast future steps (default: --method auto picks the backtest winner)
  report     Full pipeline: backtest + forecast + HTML/JSON report
  reproduce  Re-run analysis from a report and validate reproducibility
  diff       Compare two reports side by side
  batch      Process multiple series at once (high-volume forecasting)
  stream     Continuous forecasting: tail a CSV, webhook, or websocket feed
  serve      Local browser workbench over the same engine (live settings)
  methods    Explain every forecasting method in plain language
  demo       Copy a built-in example dataset into a folder

   # Phase 4: Advanced Analytics
  reconcile       Hierarchical forecast reconciliation for multi-level structures
  panel           Compare methods across groups of series (panel data analysis)
  spillover       Detect cross-series influence using VAR models
  factors         Extract common latent drivers from correlated series
  uncertainty     Compute advanced uncertainty quantification (cumulative, joint bands)
  what-if         Run counterfactual scenarios ("what would happen if...")
  schedule        Configure automatic model retraining schedules
  update          Trigger model updates based on event detection or schedule

  # Causal understanding (no machine learning)
  causal graph          Discover lagged relationships with significance tests
  causal what-if        Simulate an intervention from historical responses
  causal factors        Measure external events (holidays, promotions, weather)
  causal counterfactual Actual vs "what would have happened" (difference-in-differences)
  causal                Show detailed causal help (also: forecastlab help causal)

  help       Show this text

Common options:
  --data <csv>        Input CSV file (time + value columns)
  --project <json>    Project file created by "init" (CLI flags override it)
  --time <col>        Time column name (auto-detected if omitted)
  --value <col>       Value column name (auto-detected if omitted)
  --season <n>        Season length in steps, e.g. 24 for hourly data with a daily cycle
   --horizon <n>       Steps to forecast (default 24)
   --interval <n>      Prediction interval: 80, 90 or 95 (default 80)
   --method <id>       Method to use: naive | snaive | mean | drift | linear | holt | hw | stl | theta | croston | boxcox | glm | auto (default auto)
   --methods <list>    Comma-separated subset used by compare/report
  --test-size <n>     Held-out tail for backtesting (default: ~20% of data, max 365)
  --resample          Project onto a fixed time grid first (fixes irregular timestamps)
  --agg <id>          Resample aggregation: mean | sum | first | last | min | max (default mean)
  --step <ms>         Grid step for --resample (default: detected dominant spacing)
   --damped            Shrink the trend with horizon (holt/hw): safer long-horizon forecasts
   --seasonality <id>  hw seasonality: additive | multiplicative (default additive)
   --features <json>   Exogenous features configuration in JSON format (e.g., '{"fourier":{"seasonLengths":[24,168],"harmonics":[2]}}')
   --batch <dir>       Process all CSV files in directory (requires --methods and optional --fourier-config)
   --fourier-config <json>  Fourier config for batch mode
   --json <path>       Also write machine-readable JSON to a file
  --csv <path>        Also write the forecast table as CSV (full precision)
  --html <path>       (report) HTML output path (default forecastlab-report.html)
  --md <path>         (report) Markdown report variant (plain text, no chart)
  --out <path>        (init) project file path · (demo) target folder
  --example <id>      (demo) ${Object.keys(EXAMPLES).join(' | ')}
  --name <text>       (init) dataset name
  --unit <text>       (init) unit of the values, e.g. kWh
  --port <n>          (serve) port to listen on (default: a free one is chosen)
  --host <addr>       (serve) bind address (default 127.0.0.1; 0.0.0.0 shares on your network)
  --open              (serve) launch the page in your default browser
  --feed <spec>       (stream) file:<path> | webhook:<port> | ws:<url> (default: tail the project CSV)
  --once              (stream) process current data once, then exit (no tailing)
  --webhook <url>     (stream) POST alerts and job completions to this URL
  --alert-above <n>   (stream) alert when a value exceeds n
  --alert-below <n>   (stream) alert when a value drops below n
  --replay <file>     (stream replay) re-feed recorded events from a JSON file

Examples:
  forecastlab demo --example energy
  forecastlab check --project forecastlab-demo/energy.forecast.json
  forecastlab compare --project forecastlab-demo/energy.forecast.json
  forecastlab report --project forecastlab-demo/energy.forecast.json
  forecastlab reproduce --report out/energy-report.json
  forecastlab diff --old out/old-report.json --new out/new-report.json
  forecastlab causal graph --data examples/causal-energy.csv --html causal.html
  forecastlab help causal          # causal actions, options, and examples
`);
};

function cmdInit(opts) {
  if (!opts.data) throw new Error('init needs --data <file.csv>');
  const dataPath = resolve(process.cwd(), opts.data);
  const { text } = loadCsvFile(dataPath);
  const parsed = parseCsv(text, { timeColumn: opts.time, valueColumn: opts.value });

  // Parse features if provided
  let featureConfig = null;
  if (opts.features) {
    try {
      featureConfig = parseFeatureConfig(JSON.parse(opts.features));
    } catch (e) {
      throw new Error(`Invalid --features JSON: ${e.message}`);
    }
    if (!featureConfig || (typeof featureConfig === 'object' && Object.keys(featureConfig).length === 0)) {
      throw new Error('--features JSON did not configure any features (expected e.g. {"fourier":{"seasonLengths":[24],"harmonics":2}})');
    }
  }

  const project = {
    ...defaultProject(opts.name ?? basename(dataPath, '.csv'), basename(dataPath)),
    data: basename(dataPath),
    timeColumn: parsed.timeColumn,
    valueColumn: parsed.valueColumn,
    ...(opts.unit ? { unit: opts.unit } : {}),
    ...(opts.season ? { seasonLength: Number(opts.season) } : {}),
    ...(opts.horizon ? { horizon: Number(opts.horizon) } : {}),
    ...(opts.interval ? { interval: Number(opts.interval) } : {}),
    ...(opts.resample ? { resample: true } : {}),
    ...(opts.agg ? { agg: opts.agg } : {}),
    ...(opts.step ? { step: Number(opts.step) } : {}),
    ...(opts.damped ? { damped: true } : {}),
    ...(opts.seasonality ? { seasonality: opts.seasonality } : {}),
    ...(featureConfig ? { features: featureConfig } : {}),
    ...(opts.method ? { method: opts.method } : {}),
  };
  const out = resolve(process.cwd(), opts.out ?? 'forecastlab.json');
  writeProjectFile(out, project);
  console.log(`Detected columns: time="${parsed.timeColumn}", value="${parsed.valueColumn}" (${parsed.points.length} points)`);
  console.log(`Wrote project file: ${out}`);
  console.log('Next: forecastlab check --project ' + basename(out));
}

function cmdCheck(opts) {
  const input = resolveInput(opts);
  const summary = summarizeSeries(input.parsed.points, input.validation);
  console.log(`${input.config.name}: ${summary.count} points, ${summary.start} -> ${summary.end}`);
  console.log(`Columns: time="${input.config.timeColumn}", value="${input.config.valueColumn}"${input.config.unit ? `, unit=${input.config.unit}` : ''}`);
  if (input.resampled) {
    console.log(`Resampled to a fixed ${input.resampled.stepMs} ms grid (${input.resampled.agg}): ${summary.count} points`);
  }
  console.log(`Regular grid: ${summary.regular ? `yes (step ${summary.stepMs} ms)` : 'no'}`);
  if (input.validation.issues.length === 0) {
    console.log('Data quality: clean — no duplicates, gaps, outliers, or missing values found.');
  } else {
    console.log(`Data quality: ${input.validation.issues.length} note(s):`);
    for (const iss of input.validation.issues.slice(0, 30)) console.log(`  [${iss.type}] ${iss.message}`);
    if (input.validation.issues.length > 30) {
      console.log(`  ... and ${input.validation.issues.length - 30} more (see --json output)`);
    }
  }
  if (opts.json) {
    writeJson(opts.json, { summary, issues: input.validation.issues });
    console.log(`Wrote ${resolve(opts.json)}`);
  }
}

function runBacktest(input, opts) {
  const testSize = input.config.testSize ?? undefined;

  // Prepare features for GLM if needed
  const featuresConfig = input.config.features ? generateFeatures(input) : null;

  return backtest(input.values, {
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    testSize,
    methods: input.config.methods,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
    features: featuresConfig,
  });
}

function cmdCompare(opts) {
  const input = resolveInput(opts);
  const bt = runBacktest(input, opts);
  console.log(`Backtest on last ${bt.testSize} point(s) of "${input.config.name}" (lower is better):`);
  printTable(
    ['Method', 'RMSE', 'MAE', 'MAPE%', 'sMAPE%', 'MASE'],
    bt.results.map((r, i) => [
      `${i === 0 ? '* ' : ''}${r.title}`,
      fmtNum(r.rmse), fmtNum(r.mae), fmtNum(r.mape), fmtNum(r.smape), fmtNum(r.mase),
    ]),
  );
  console.log(`* Winner: ${bt.best} (lowest RMSE). Use: forecastlab forecast --project <file> --method ${bt.best}`);
  if (opts.json) {
    writeJson(opts.json, { dataset: input.config.name, ...bt });
    console.log(`Wrote ${resolve(opts.json)}`);
  }
}

function pickMethod(input, opts) {
  const wanted = opts.method ?? 'auto';
  if (wanted === 'auto') {
    const bt = runBacktest(input, opts);
    return { methodId: bt.best, backtest: bt };
  }
  return { methodId: wanted, backtest: null };
}

function cmdForecast(opts) {
  const input = resolveInput(opts);

  // Generate features if configured
  const featuresConfig = input.config.features ? generateFeatures(input) : null;

  const { methodId } = pickMethod(input, opts);
  const f = fit(input.values, methodId, {
    horizon: input.config.horizon,
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
    features: featuresConfig,
  });
  const times = futureTimes(input.parsed.points, input.validation.stepMs, f.horizon);
  console.log(`${f.title}: ${f.horizon} step(s) ahead, ${f.interval}% intervals (sigma ${fmtNum(f.sigma)}):`);
  const show = Math.min(f.horizon, 24);
  const rows = [];
  for (let k = 0; k < show; k++) {
    rows.push([`+${k + 1}`, times[k] ? shortLabel(times[k], input.validation.stepMs) : '', fmtNum(f.point[k]), `${fmtNum(f.lower[k])} .. ${fmtNum(f.upper[k])}`]);
  }
  printTable(['Step', 'Time', 'Forecast', `${f.interval}% interval`], rows);
  if (f.horizon > show) console.log(`... ${f.horizon - show} more steps; pass --json <path> for the full series.`);
  if (opts.json) {
    writeJson(opts.json, {
      method: f.method,
      title: f.title,
      horizon: f.horizon,
      interval: f.interval,
      sigma: f.sigma,
      intervalMode: f.intervalMode,
      damped: f.damped,
      seasonality: f.seasonality,
      params: f.params,
      steps: f.point.map((p, k) => ({ step: k + 1, time: times[k], point: p, lower: f.lower[k], upper: f.upper[k] })),
    });
    console.log(`Wrote ${resolve(opts.json)}`);
  }
  if (opts.csv) {
    const csvPath = resolve(process.cwd(), opts.csv);
    writeReportFiles({ csv: { path: csvPath, content: buildForecastCsv({ forecast: f, times }) } });
    console.log(`Wrote ${csvPath}`);
  }
}

function cmdReport(opts) {
  const input = resolveInput(opts);

  // Generate features if configured
  const featuresConfig = input.config.features ? generateFeatures(input) : null;

  const methods = applicableMethods(input.values.length, input.config.seasonLength);
  const bt = methods.length > 0
    ? backtest(input.values, {
      seasonLength: input.config.seasonLength,
      interval: input.config.interval,
      testSize: input.config.testSize ?? undefined,
      methods: input.config.methods ?? methods,
      damped: input.config.damped,
      seasonality: input.config.seasonality,
      features: featuresConfig,
    })
    : null;
  const wanted = opts.method ?? 'auto';
  const methodId = wanted === 'auto' ? (bt ? bt.best : 'naive') : wanted;
  const f = fit(input.values, methodId, {
    horizon: input.config.horizon,
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
    features: featuresConfig,
  });
  const times = futureTimes(input.parsed.points, input.validation.stepMs, f.horizon);
  const labels = input.parsed.points.map((p) => shortLabel(p.iso, input.validation.stepMs));
  const repro = {
    command: `forecastlab ${process.argv.slice(2).join(' ')}`,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    hash: input.dataHash,
  };
  const ctx = {
    title: input.config.name,
    dataset: {
      file: input.config.data,
      labels,
      values: input.values,
      count: input.values.length,
      start: input.parsed.points[0].iso,
      end: input.parsed.points[input.parsed.points.length - 1].iso,
      stepMs: input.validation.stepMs,
      regular: input.validation.regular,
      timeColumn: input.config.timeColumn,
      valueColumn: input.config.valueColumn,
      unit: input.config.unit,
      resampled: input.resampled,
    },
    issues: input.validation.issues,
    backtest: bt,
    forecast: f,
    times,
    card: methodCard(methodId, {
      damped: input.config.damped,
      seasonality: input.config.seasonality,
    }),
    repro,
  };
  const artifacts = {
    html: {
      path: resolve(process.cwd(), opts.html ?? 'forecastlab-report.html'),
      content: buildHtmlReport(ctx),
    },
    json: {
      path: resolve(process.cwd(), opts.json ?? 'forecastlab-report.json'),
      content: JSON.stringify(buildJsonReport(ctx), null, 2) + '\n',
    },
    ...(opts.csv ? { csv: { path: resolve(process.cwd(), opts.csv), content: buildForecastCsv(ctx) } } : {}),
    ...(opts.md ? { md: { path: resolve(process.cwd(), opts.md), content: buildMarkdownReport(ctx) } } : {}),
  };
  writeReportFiles(artifacts);
  console.log(`Method: ${f.title} (${methodId})${wanted === 'auto' ? ' [auto-selected by backtest]' : ''}`);
  console.log(`Forecast: ${f.horizon} steps, ${f.interval}% intervals, sigma ${fmtNum(f.sigma)}`);
  console.log(`Open in a browser: ${artifacts.html.path}`);
  console.log(`Machine-readable:  ${artifacts.json.path}`);
  if (artifacts.csv) console.log(`Forecast table CSV: ${artifacts.csv.path}`);
  if (artifacts.md) console.log(`Markdown report:    ${artifacts.md.path}`);
}

function cmdMethods() {
  for (const card of allMethodCards()) {
    console.log(`\n## ${card.id} — ${card.title}\n${card.summary}\nMath: ${card.math}\nUse when: ${card.useWhen}\nWatch out: ${card.pitfalls}`);
  }
  console.log('\nSeasonal methods (snaive, hw) need --season <steps per cycle>.');
  console.log('Add --damped to holt/hw to shrink the trend with horizon; --seasonality multiplicative for hw when seasonal amplitude grows with the level.');
}

function cmdDemo(opts) {
  const id = opts.example ?? 'energy';
  if (!EXAMPLES[id]) throw new Error(`Unknown example "${id}". Choose: ${Object.keys(EXAMPLES).join(', ')}`);
  const outDir = resolve(process.cwd(), opts.out ?? join('forecastlab-demo', id));
  mkdirSync(outDir, { recursive: true });
  const { file, project } = EXAMPLES[id];
  copyFileSync(join(EXAMPLES_DIR, file), join(outDir, file));
  copyFileSync(join(EXAMPLES_DIR, project), join(outDir, project));
  console.log(`Copied "${id}" example to ${outDir}`);
  if (id === 'causal') {
    console.log('Causal analysis on this dataset:');
    console.log(`  node src/cli.js causal graph --data ${join(basename(outDir), file)} --html causal.html --season 24`);
    console.log(`  node src/cli.js causal what-if --data ${join(basename(outDir), file)} --variable temperature --target demand --change 5 --html what-if.html`);
    console.log(`  node src/cli.js causal factors --data ${join(basename(outDir), file)} --value demand --factors ${join(basename(outDir), project)} --holidays 2026-2026`);
    return;
  }
  console.log('Next:');
  console.log(`  cd ${join(basename(resolve(process.cwd(), 'forecastlab-demo')), id)}`);
  console.log(`  node ../src/cli.js check .`);
  console.log(`  node ../src/cli.js compare .`);
  console.log(`  node ../src/cli.js report --html report.html`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, opts, action } = parseArgs(argv);
  if (opts.version) {
    console.log(VERSION);
    return;
  }
  if (opts.help || !command || command === 'help') {
    printHelp(action);
    return;
  }
  switch (command) {
    case 'init': cmdInit(opts); break;
    case 'check': cmdCheck(opts); break;
    case 'compare': cmdCompare(opts); break;
    case 'forecast': cmdForecast(opts); break;
    case 'report': cmdReport(opts); break;
    case 'reproduce': cmdReproduce(opts); break;
    case 'diff': cmdDiff(opts); break;
    case 'batch': await cmdBatch(opts); break;
    case 'stream': await cmdStream(opts); break;
    case 'methods': cmdMethods(); break;
    case 'demo': cmdDemo(opts); break;
    case 'serve': cmdServe(opts); break;

    // Phase 4: Advanced Analytics Commands
    case 'reconcile': await cmdReconcile(opts); break;
    case 'panel': await cmdPanel(opts); break;
    case 'spillover': await cmdSpillover(opts); break;
    case 'factors': await cmdFactors(opts); break;
    case 'uncertainty': await cmdUncertainty(opts); break;
    case 'what-if': await cmdWhatIf(opts); break;
    case 'schedule': await cmdSchedule(opts); break;
    case 'update': await cmdUpdate(opts); break;

    // Phase 5: Plugin System Commands
    case 'plugins': await cmdPlugins(opts); break;
    case 'install-plugin': await cmdInstallPlugin(opts); break;

    // Causal understanding
    case 'causal': cmdCausal({ ...opts, action }); break;

    default: throw new Error(`Unknown command "${command}". Run: forecastlab help`);
  }
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) {
  main().catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
}
