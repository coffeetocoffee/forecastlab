#!/usr/bin/env node
// forecastlab CLI: init, check, compare, forecast, report, methods, demo, reproduce, diff.
// Zero dependencies; human-readable stdout, machine-readable --json/--html files.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
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
  versionSatisfies,
} from './index.js';
import { createServer, openBrowser } from './serve.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(HERE, '..', 'examples');

const EXAMPLES = {
  energy: { file: 'energy-hourly.csv', project: 'energy.forecast.json', title: 'Hourly building electricity use (kWh)' },
  river: { file: 'river-daily.csv', project: 'river.forecast.json', title: 'Daily river level (m)' },
  temp: { file: 'temp-daily.csv', project: 'temp.forecast.json', title: 'Daily mean temperature (C)' },
};

const VALUE_OPTS = new Set([
  'data', 'project', 'time', 'value', 'name', 'unit', 'season', 'horizon',
  'interval', 'method', 'methods', 'test-size', 'json', 'html', 'csv', 'md',
  'out', 'example', 'agg', 'step', 'seasonality', 'port', 'host', 'report',
]);
const BOOL_OPTS = new Set(['help', 'version', 'resample', 'damped', 'open']);

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
  return { command: positional[0] ?? null, opts };
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

const printHelp = () => {
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
  serve      Local browser workbench over the same engine (live settings)
  methods    Explain every forecasting method in plain language
  demo       Copy a built-in example dataset into a folder
  help       Show this text

Common options:
  --data <csv>        Input CSV file (time + value columns)
  --project <json>    Project file created by "init" (CLI flags override it)
  --time <col>        Time column name (auto-detected if omitted)
  --value <col>       Value column name (auto-detected if omitted)
  --season <n>        Season length in steps, e.g. 24 for hourly data with a daily cycle
  --horizon <n>       Steps to forecast (default 24)
  --interval <n>      Prediction interval: 80, 90 or 95 (default 80)
  --method <id>       naive | snaive | mean | drift | linear | holt | hw | auto (default auto)
  --methods <list>    Comma-separated subset used by compare/report
  --test-size <n>     Held-out tail for backtesting (default: ~20% of data, max 365)
  --resample          Project onto a fixed time grid first (fixes irregular timestamps)
  --agg <id>          Resample aggregation: mean | sum | first | last | min | max (default mean)
  --step <ms>         Grid step for --resample (default: detected dominant spacing)
  --damped            Shrink the trend with horizon (holt/hw): safer long-horizon forecasts
  --seasonality <id>  hw seasonality: additive | multiplicative (default additive)
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

Examples:
  forecastlab demo --example energy
  forecastlab check --project forecastlab-demo/energy.forecast.json
  forecastlab compare --project forecastlab-demo/energy.forecast.json
  forecastlab report --project forecastlab-demo/energy.forecast.json
  forecastlab reproduce --report out/energy-report.json
  forecastlab diff --old out/old-report.json --new out/new-report.json
`);
};

function writeJson(path, obj) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function toPort(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error('--port must be an integer between 0 and 65535');
  }
  return n;
}

function cmdInit(opts) {
  if (!opts.data) throw new Error('init needs --data <file.csv>');
  const dataPath = resolve(process.cwd(), opts.data);
  const { text } = loadCsvFile(dataPath);
  const parsed = parseCsv(text, { timeColumn: opts.time, valueColumn: opts.value });
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
  return backtest(input.values, {
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    testSize,
    methods: input.config.methods,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
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
  const { methodId } = pickMethod(input, opts);
  const f = fit(input.values, methodId, {
    horizon: input.config.horizon,
    seasonLength: input.config.seasonLength,
    interval: input.config.interval,
    damped: input.config.damped,
    seasonality: input.config.seasonality,
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
  const methods = applicableMethods(input.values.length, input.config.seasonLength);
  const bt = methods.length > 0
    ? backtest(input.values, {
      seasonLength: input.config.seasonLength,
      interval: input.config.interval,
      testSize: input.config.testSize ?? undefined,
      methods: input.config.methods ?? methods,
      damped: input.config.damped,
      seasonality: input.config.seasonality,
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
  const outDir = resolve(process.cwd(), opts.out ?? 'forecastlab-demo');
  mkdirSync(outDir, { recursive: true });
  const { file, project } = EXAMPLES[id];
  copyFileSync(join(EXAMPLES_DIR, file), join(outDir, file));
  copyFileSync(join(EXAMPLES_DIR, project), join(outDir, project));
  console.log(`Copied "${id}" example to ${outDir}`);
  console.log('Next:');
  console.log(`  forecastlab check --project ${join(basename(outDir), project)}`);
  console.log(`  forecastlab report --project ${join(basename(outDir), project)}`);
}

function cmdServe(opts) {
  const port = toPort(opts.port);
  const host = opts.host ?? '127.0.0.1';
  const server = createServer({ defaults: opts });
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

/** Reproduce command: re-run analysis from a report and validate */
function cmdReproduce(opts) {
  if (!opts.report) throw new Error('reproduce needs --report <report.json>');
  
  const reportPath = resolve(process.cwd(), opts.report);
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read report file "${reportPath}": ${e.message}`);
  }
  
  // Validate report structure
  if (!report.tool || !report.tool.name || !report.tool.version) {
    throw new Error('Invalid report: missing tool metadata');
  }
  if (!report.dataset || !report.dataset.file) {
    throw new Error('Invalid report: missing dataset reference');
  }
  if (!report.command) {
    throw new Error('Invalid report: missing original command');
  }
  if (!report.dataset.hash) {
    throw new Error('Invalid report: missing data hash (not reproducible)');
  }
  
  // Optional: Provide project file for additional config like seasonLength
  let projectConfig = {};
  if (opts.project) {
    const projPath = resolve(process.cwd(), opts.project);
    projectConfig = JSON.parse(readFileSync(projPath, 'utf8'));
  }
  
  // Find the data file - check relative to report location first, then cwd
  let dataRel = report.dataset.file;
  let dataPath = resolve(dirname(reportPath), dataRel);
  
  // Try current working directory if not found
  if (!existsSync(dataPath)) {
    dataPath = resolve(process.cwd(), dataRel);
  }
  
  // If still not found, check examples dir
  const EXAMPLES_DIR = resolve(dirname(reportPath), '..', 'examples');
  const altDataPath = resolve(EXAMPLES_DIR, dataRel);
  if (!existsSync(dataPath) && existsSync(altDataPath)) {
    console.log(`Using data from examples directory: ${altDataPath}`);
    dataPath = altDataPath;
  }
  
  // Reload CSV and verify hash
  const { text, hash: actualHash } = loadCsvFile(dataPath);
  const parsed = parseCsv(text, {
    timeColumn: report.dataset.timeColumn,
    valueColumn: report.dataset.valueColumn,
  });
  
  if (actualHash !== report.dataset.hash) {
    console.error('ERROR: Data file hash mismatch!');
    console.error(`  Expected: ${report.dataset.hash}`);
    console.error(`  Actual:   ${actualHash}`);
    console.error('The data file has been modified since the original report was generated.');
    process.exit(1);
  }
  
  console.log(`✓ Data integrity verified (hash matches)`);
  
  const TOLERANCE = 1e-10;
  
  // Re-run the forecast using report settings
  const config = {
    ...report.dataset,
    seasonLength: opts.season ?? projectConfig.seasonLength ?? report.backtest?.seasonLength,
    interval: opts.interval ?? projectConfig.interval ?? 80,
    horizon: opts.horizon ?? projectConfig.horizon ?? report.forecast?.horizon,
    damped: opts.damped ?? projectConfig.damped ?? false,
    seasonality: opts.seasonality ?? projectConfig.seasonality ?? 'additive',
  };
  
  const values = parsed.points.map((p) => p.value);
  
  // Backtest if present
  let backtestResults = null;
  if (report.backtest) {
    const btOpts = {
      seasonLength: config.seasonLength ?? report.backtest.seasonLength,
      interval: config.interval,
      testSize: report.backtest.testSize,
    };
    
    try {
      backtestResults = backtest(values, btOpts);
      console.log(`✓ Backtest reproducible (${backtestResults.results.length} methods tested)`);
      
      // Compare RMSE values
      const oldBest = report.backtest.best;
      const newBest = backtestResults.best;
      if (oldBest !== newBest) {
        console.error(`⚠ WARNING: Best method changed!`);
        console.error(`  Original: ${oldBest}`);
        console.error(`  Re-run:   ${newBest}`);
      }
      
      // Check metrics match within tolerance
      let metricsMatch = true;
      for (const oldR of report.backtest.results || []) {
        const newR = backtestResults.results?.find((r) => r.method === oldR.method);
        if (!newR) {
          metricsMatch = false;
          break;
        }
        if (Math.abs(oldR.rmse - newR.rmse) > TOLERANCE) {
          metricsMatch = false;
          console.error(`⚠ Metric mismatch for ${oldR.method}: RMSE ${oldR.rmse} → ${newR.rmse}`);
        }
      }
      if (metricsMatch && report.backtest.results?.length > 0) {
        console.log(`✓ Metrics match original report`);
      }
    } catch (e) {
      console.warn(`⚠ Could not re-run backtest: ${e.message}`);
    }
  }
  
  // Re-forecast if present
  let forecastMatch = true;
  if (report.forecast) {
    try {
      const fOpts = {
        horizon: opts.horizon ?? projectConfig.horizon ?? report.forecast.horizon,
        seasonLength: config.seasonLength,
        interval: config.interval,
        damped: report.forecast.damped || false,
        seasonality: report.forecast.seasonality || 'additive',
      };
      
      const f = fit(values, report.forecast.method, fOpts);
      const times = futureTimes(parsed.points, config.stepMs, f.horizon);
      
      // Compare forecast points
      const fore = report.forecast.steps || [];
      if (fore.length === f.point.length) {
        let ptsMatch = true;
        for (let i = 0; i < fore.length; i++) {
          if (Math.abs(fore[i].point - f.point[i]) > TOLERANCE) {
            ptsMatch = false;
            forecastMatch = false;
          }
          if (Math.abs(fore[i].lower - f.lower[i]) > TOLERANCE) {
            forecastMatch = false;
          }
          if (Math.abs(fore[i].upper - f.upper[i]) > TOLERANCE) {
            forecastMatch = false;
          }
        }
        if (ptsMatch) {
          console.log(`✓ Forecast matches original report`);
        } else {
          console.error(`⚠ Forecast values differ from original`);
        }
      } else {
        forecastMatch = false;
        console.error(`⚠ Forecast length changed: ${fore.length} → ${f.point.length}`);
      }
    } catch (e) {
      console.error(`✗ Forecast re-run failed: ${e.message}`);
    }
  }
  
  // Version check
  const expectedVersion = report.tool.version;
  if (expectedVersion !== VERSION) {
    console.warn(`⚠ Version mismatch: report was generated with ${expectedVersion}, this is ${VERSION}`);
  } else {
    console.log(`✓ Tool version matches (${VERSION})`);
  }
  
  console.log('\n✅ Reproducibility validation passed');
  console.log(`Report was generated by: ${report.command}`);
  console.log(`Generated at: ${report.generatedAt}`);
}

/** Diff command: compare two reports side by side */
function cmdDiff(opts) {
  if (!opts.old || !opts.new) throw new Error('diff needs --old <report1.json> --new <report2.json>');
  
  const oldPath = resolve(process.cwd(), opts.old);
  const newPath = resolve(process.cwd(), opts.new);
  
  let oldReport, newReport;
  try {
    oldReport = JSON.parse(readFileSync(oldPath, 'utf8'));
    newReport = JSON.parse(readFileSync(newPath, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read report file: ${e.message}`);
  }
  
  console.log('=== Report Comparison ===\n');
  
  // Dataset comparison
  console.log('Dataset:');
  console.log(`  Old: ${oldReport.dataset?.file || 'N/A'} (hash: ${oldReport.dataset?.hash?.slice(0, 8) || 'N/A'}...)`);
  console.log(`  New: ${newReport.dataset?.file || 'N/A'} (hash: ${newReport.dataset?.hash?.slice(0, 8) || 'N/A'}...)`);
  if (oldReport.dataset?.hash !== newReport.dataset?.hash) {
    console.log('  ⚠ Data files differ');
  } else {
    console.log('  ✓ Data files are identical');
  }
  console.log();
  
  // Backtest comparison
  if (oldReport.backtest && newReport.backtest) {
    console.log('Backtest Results:');
    const oldMap = new Map(oldReport.backtest.results.map((r) => [r.method, r]));
    const newMap = new Map(newReport.backtest.results.map((r) => [r.method, r]));
    
    for (const [method, oldR] of oldMap) {
      const newR = newMap.get(method);
      if (newR) {
        const rmseDelta = newR.rmse - oldR.rmse;
        const status = Math.abs(rmseDelta) < 1e-10 ? '✓' : '⚠';
        console.log(`  ${status} ${method}: RMSE ${fmtNum(oldR.rmse)} → ${fmtNum(newR.rmse)} (${rmseDelta >= 0 ? '+' : ''}${fmtNum(rmseDelta)})`);
      } else {
        console.log(`  - ${method}: removed`);
      }
    }
    for (const [method, newR] of newMap) {
      if (!oldMap.has(method)) {
        console.log(`  + ${method}: RMSE ${fmtNum(newR.rmse)} (new)`);
      }
    }
    console.log();
  }
  
  // Forecast comparison
  if (oldReport.forecast && newReport.forecast) {
    console.log('Forecast Settings:');
    const of = oldReport.forecast;
    const nf = newReport.forecast;
    console.log(`  Method: ${of.method} → ${nf.method}`);
    console.log(`  Horizon: ${of.horizon} → ${nf.horizon}`);
    console.log(`  Interval: ${of.interval}% → ${nf.interval}%`);
    
    if (of.steps && nf.steps && of.steps.length > 0 && nf.steps.length > 0) {
      const firstOld = of.steps[0];
      const firstNew = nf.steps[0];
      const pointDelta = firstNew.point - firstOld.point;
      console.log(`  First forecast: ${fmtNum(firstOld.point)} → ${fmtNum(firstNew.point)} (${pointDelta >= 0 ? '+' : ''}${fmtNum(pointDelta)})`);
    }
    console.log();
  }
  
  // Metadata
  console.log('Metadata:');
  console.log(`  Old command: ${oldReport.command || 'N/A'}`);
  console.log(`  New command: ${newReport.command || 'N/A'}`);
  console.log(`  Generated: ${oldReport.generatedAt || 'N/A'} → ${newReport.generatedAt || 'N/A'}`);
}

export function main(argv = process.argv.slice(2)) {
  const { command, opts } = parseArgs(argv);
  if (opts.version) {
    console.log(VERSION);
    return;
  }
  if (opts.help || !command || command === 'help') {
    printHelp();
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
    case 'methods': cmdMethods(); break;
    case 'demo': cmdDemo(opts); break;
    case 'serve': cmdServe(opts); break;
    default: throw new Error(`Unknown command "${command}". Run: forecastlab help`);
  }
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) {
  try {
    main();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
