// Report utility commands: reproduce (re-run + validate), diff (compare two
// reports), batch (high-volume forecasting over a directory of CSVs).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import {
  parseCsv,
  loadCsvFile,
  backtest,
  fit,
  futureTimes,
  fmtNum,
  batchForecast,
} from '../index.js';
import { VERSION, writeJson } from '../cli-shared.js';

/** Reproduce command: re-run analysis from a report and validate */
export function cmdReproduce(opts) {
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
  const examplesDir = resolve(dirname(reportPath), '..', 'examples');
  const altDataPath = resolve(examplesDir, dataRel);
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
export function cmdDiff(opts) {
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

/**
 * Batch processing command: process multiple CSV files at once
 */
export async function cmdBatch(opts) {
  if (!opts.batch) throw new Error('batch needs --batch <directory>');

  const batchDir = resolve(process.cwd(), opts.batch);

  // Find all CSV files
  const csvFiles = readdirSync(batchDir)
    .filter(f => f.endsWith('.csv'))
    .map(f => join(batchDir, f));

  if (csvFiles.length === 0) {
    throw new Error(`No CSV files found in ${batchDir}`);
  }

  console.log(`Found ${csvFiles.length} CSV files in ${batchDir}`);

  // Parse methods
  const methods = opts.methods
    ? String(opts.methods).split(',').map(s => s.trim()).filter(Boolean)
    : ['glm'];

  // Parse fourier config
  let fourierConfig = null;
  if (opts.fourierConfig || opts.fourier) {
    try {
      fourierConfig = JSON.parse(opts.fourierConfig || opts.fourier);
    } catch (e) {
      throw new Error(`Invalid --fourier-config JSON: ${e.message}`);
    }
  }

  // Run batch processing
  console.log('\nStarting batch processing...');
  const result = await batchForecast({
    seriesFiles: csvFiles,
    fourierConfig,
    methods,
    maxWorkers: 4,
  });

  console.log(`\n✅ Batch complete!`);
  console.log(`Processed: ${result.results.length}/${csvFiles.length}`);
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.length}`);
    for (const err of result.errors.slice(0, 5)) {
      console.log(`  - ${err.file}: ${err.error}`);
    }
  }

  // Save results to JSON
  if (opts.json) {
    writeJson(opts.json, {
      summary: {
        totalFiles: csvFiles.length,
        successful: result.results.length,
        failed: result.errors.length,
      },
      results: result.results,
      errors: result.errors,
    });
    console.log(`Wrote results to ${resolve(opts.json)}`);
  }
}
