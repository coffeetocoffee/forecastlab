// CLI handlers for causal understanding: graph, what-if, factors, counterfactual.
// Thin wrappers over src/causal.js; every number printed here is reproducible
// from the data file alone.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

import {
  parseWideCsv,
  CausalGraph,
  InterventionSimulator,
  ExternalFactorIntegrator,
  CounterfactualAnalyzer,
  holidayCalendar,
  fmtNum,
  fmtP,
} from '../causal.js';
import { buildCausalGraphHtml } from '../visualizations/causal-graph.js';
import {
  buildInterventionHtml,
  buildCounterfactualHtml,
} from '../visualizations/counterfactual-chart.js';

function writeJson(path, obj) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function writeHtml(path, html) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, html, 'utf8');
}

function loadWideCsv(path, valueColumns) {
  const text = readFileSync(resolve(path), 'utf8');
  return parseWideCsv(text, { valueColumns });
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

function seasonOf(opts) {
  const s = num(opts.season, null);
  return s && s >= 2 ? s : null;
}

/**
 * causal graph --data <wide.csv> [--max-lag N] [--season N] [--html out.html] [--json out.json]
 *
 * Discover and display lagged relationships between variables.
 */
export function cmdCausalGraph(opts) {
  if (!opts.data) throw new Error('causal graph needs --data <wide.csv> (one time column + one column per variable)');
  const parsed = loadWideCsv(opts.data, opts.columns ? String(opts.columns).split(',').map((s) => s.trim()) : undefined);
  const maxLag = num(opts.maxLag, 12);
  const options = {
    maxLag,
    arLag: num(opts.arLag, 4),
    seasonLength: seasonOf(opts),
    alpha: num(opts.significance, 0.05),
    includeAll: Boolean(opts.all),
  };
  const graph = new CausalGraph(parsed.columns);
  const edges = graph.discover(options);
  const names = Object.keys(parsed.columns);

  console.log(`Causal graph: ${names.length} variables, ${parsed.times.length} aligned points (${parsed.skipped} incomplete row(s) skipped)`);
  console.log(`Detected ${edges.length} relationship(s): ${edges.filter((e) => e.significant).length} statistically significant.`);
  if (edges.length === 0) {
    console.log('No significant relationships found. Try a larger --max-lag, a different --season, or --all to see the rejected links too.');
  } else {
    printTable(
      ['From', 'To', 'Lag', 'Corr.', 'Effect', 'p-value', 'Conf.'],
      edges.map((e) => [
        (e.direction === 'reverse' ? '(' : '') + e.from + (e.direction === 'reverse' ? ')' : ''),
        e.to, String(e.lag),
        fmtNum(e.correlation), fmtNum(e.effect), fmtP(e.pValue),
        Math.round(e.confidence * 100) + (e.feedback ? '% (feedback?)' : '%'),
      ]),
    );
    if (edges.some((e) => e.feedback)) {
      console.log('Note: links marked "(feedback?)" have both directions significant - either real feedback or a hidden common cause.');
    }
  }
  if (opts.json) {
    writeJson(opts.json, {
      variables: names,
      points: parsed.times.length,
      options,
      edges,
      method: graph.explain(),
    });
    console.log(`Wrote ${resolve(opts.json)}`);
  }
  if (opts.html) {
    writeHtml(opts.html, buildCausalGraphHtml({
      series: parsed.columns,
      edges,
      options: { maxLag: options.maxLag, arLag: options.arLag, seasonLength: options.seasonLength, alpha: options.alpha },
      title: `Causal relationships (${basename(opts.data)})`,
    }));
    console.log(`Open in a browser: ${resolve(opts.html)}`);
  }
  console.log('Reminder: every link is a tested hypothesis, not proof of causation. Verify with "causal what-if" or "causal counterfactual".');
}

/**
 * causal what-if --data <wide.csv> --variable <name> --target <name> --change <n>
 *                 [--start N] [--duration N] [--horizon N] [--html] [--json]
 *
 * Predict what a change in one variable does to another, from history.
 */
export async function cmdCausalWhatIf(opts) {
  if (!opts.data) throw new Error('causal what-if needs --data <wide.csv>');
  if (!opts.variable) throw new Error('causal what-if needs --variable <column>');
  if (!opts.target) throw new Error('causal what-if needs --target <column>');
  if (opts.change === undefined || !Number.isFinite(Number(opts.change))) {
    throw new Error('causal what-if needs a numeric --change (units to add to the variable)');
  }
  const parsed = loadWideCsv(opts.data);
  if (!parsed.columns[opts.variable]) throw new Error(`Column "${opts.variable}" not found; have: ${Object.keys(parsed.columns).join(', ')}`);
  if (!parsed.columns[opts.target]) throw new Error(`Column "${opts.target}" not found; have: ${Object.keys(parsed.columns).join(', ')}`);

  const seasonLength = seasonOf(opts);
  const sim = new InterventionSimulator(parsed.columns);
  const result = await sim.simulate({
    variable: opts.variable,
    target: opts.target,
    change: Number(opts.change),
    start: num(opts.start, 0),
    duration: num(opts.duration, null),
    horizon: num(opts.horizon, 24),
    maxLag: num(opts.maxLag, 12),
    seasonLength,
  });

  console.log(`What if ${opts.variable} changed by ${fmtNum(Number(opts.change))}? Effect on ${opts.target}:`);
  printTable(
    ['Step', 'Baseline', 'Hypothetical', 'Difference', '95% band'],
    result.baseline.map((b, i) => [
      b.step, fmtNum(b.value, 2), fmtNum(result.counterfactual[i].value, 2),
      fmtNum(result.difference[i].delta, 2),
      fmtNum(result.uncertainty.lower[i], 2) + ' .. ' + fmtNum(result.uncertainty.upper[i], 2),
    ]).slice(0, Math.min(result.baseline.length, 15)),
  );
  if (result.baseline.length > 15) console.log(`... ${result.baseline.length - 15} more steps (use --json for the full table).`);
  console.log(`Cumulative impact: ${fmtNum(result.cumulativeImpact)} (peak ${fmtNum(result.peakImpact)} at step ${result.peakStep})`);
  console.log(result.interpretation);
  for (const w of result.warnings) console.log(`Warning [${w.type}]: ${w.message}`);

  if (opts.json) {
    writeJson(opts.json, { ...result, start: num(opts.start, 0), duration: num(opts.duration, result.baseline.length) });
    console.log(`Wrote ${resolve(opts.json)}`);
  }
  if (opts.html) {
    writeHtml(opts.html, buildInterventionHtml(result, {
      start: num(opts.start, 0),
      duration: num(opts.duration, result.baseline.length),
    }));
    console.log(`Open in a browser: ${resolve(opts.html)}`);
  }

  const experiments = sim.findNaturalExperiments({ variable: opts.variable, target: opts.target, seasonLength });
  if (experiments.length > 0) {
    console.log(`\nNatural experiments found in history (observed jumps in ${opts.variable}):`);
    printTable(
      ['At step', 'Change in X', 'Response of Y', 'Per unit', 'p-value'],
      experiments.map((e) => [e.index, fmtNum(e.changeInX), fmtNum(e.response), fmtNum(e.responsePerUnit), fmtP(e.pValue)]),
    );
    console.log('Re-run "causal counterfactual --data <file> --event-index <step>" on the most striking one for a full analysis.');
  }
}

/**
 * causal factors --data <series.csv> [--value <col>] [--factors <events.json|wide.csv>]
 *                [--holidays <fromYear-toYear>] [--html] [--json]
 *
 * Measure the effect of known external events on a series.
 */
export function cmdCausalFactors(opts) {
  if (!opts.data) throw new Error('causal factors needs --data <series.csv> (time + value)');
  const text = readFileSync(resolve(opts.data), 'utf8');
  // A single-series CSV is just a wide CSV with one value column.
  const parsed = parseWideCsv(text, {
    valueColumns: opts.value ? [String(opts.value)] : undefined,
  });
  const valueColumn = parsed.valueColumns[0];
  const target = parsed.columns[valueColumn];

  const integrator = new ExternalFactorIntegrator(parsed.times);
  let externalCount = 0;

  if (opts.factors) {
    const factorPath = resolve(opts.factors);
    const factorText = readFileSync(factorPath, 'utf8');
    if (/\.json$/i.test(factorPath)) {
      const json = JSON.parse(factorText);
      integrator.importEventsJson(json);
      externalCount += Array.isArray(json) ? json.length : (json.events ? json.events.length : 0);
    } else {
      const before = integrator.factorNames().length;
      integrator.importCsv(factorText);
      externalCount += integrator.factorNames().length - before;
    }
  }
  if (opts.holidays) {
    const [from, to] = String(opts.holidays).split('-').map((s) => Number(s));
    const events = holidayCalendar({
      from: Number.isFinite(from) ? from : new Date().getUTCFullYear(),
      to: Number.isFinite(to) ? to : (Number.isFinite(from) ? from : new Date().getUTCFullYear()),
    });
    integrator.importEvents(events);
    externalCount += events.length;
  }
  if (externalCount === 0) {
    throw new Error('No factors given. Pass --factors <events.json|wide.csv> and/or --holidays <fromYear-toYear>, e.g. --holidays 2025-2026');
  }

  const fit = integrator.fit(target, { trend: true, seasonLength: seasonOf(opts) });
  const ranking = integrator.rankFactors();

  console.log(`Factor model for "${valueColumn}": ${fit.n} points, R² = ${fmtNum(fit.r2)}${fit.regularized ? ' (ridge-regularized: some factors overlap)' : ''}`);
  if ((fit.dropped ?? []).length > 0) {
    console.log(`Outside the observation window (no effect to estimate): ${fit.dropped.join(', ')}`);
  }
  console.log(`Factors ranked by impact magnitude (${ranking.filter((f) => f.significant).length} of ${ranking.length} significant):`);
  printTable(
    ['Factor', 'Coefficient', 'Impact', 't-stat', 'p-value', 'Significant'],
    ranking.map((f) => [f.name, fmtNum(f.coefficient), fmtNum(f.impact), fmtNum(f.tStat), fmtP(f.pValue), f.significant ? 'yes' : 'no']),
  );
  const top = ranking[0];
  if (top) console.log(`Largest single effect: ${top.name} moves the target by ${fmtNum(top.impact)} across its observed range.`);

  if (opts.json) {
    writeJson(opts.json, { valueColumn, points: fit.n, fit: { r2: fit.r2, sigma: fit.sigma, regularized: fit.regularized }, factors: ranking });
    console.log(`Wrote ${resolve(opts.json)}`);
  }
  if (opts.html) {
    const rows = ranking.map((f) => `<tr><th>${f.name}</th><td>${fmtNum(f.coefficient)}</td><td>${fmtNum(f.impact)}</td><td>${fmtP(f.pValue)}</td><td>${f.significant ? 'yes' : 'no'}</td></tr>`).join('');
    writeHtml(opts.html, `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>External factors — ForecastLab</title>
<style>body{font-family:system-ui,sans-serif;margin:0;color:#111827;background:#f9fafb}header{background:#111827;color:#f9fafb;border-radius:12px;padding:20px 24px;margin:24px 24px 16px}main{max-width:1000px;margin:0 auto;padding:0 24px 24px}section{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}th{background:#f3f4f6}</style></head>
<body><header><h1>External factor effects on ${valueColumn}</h1><p>${fit.n} points · R² = ${fmtNum(fit.r2)} · computed locally</p></header>
<main><section><h2>Factor importance</h2><table><tr><th>Factor</th><th>Coefficient</th><th>Impact</th><th>p-value</th><th>Significant</th></tr>${rows}</table></section></main></body></html>`);
    console.log(`Open in a browser: ${resolve(opts.html)}`);
  }
}

/**
 * causal counterfactual --data <series.csv> [--value <col>] --event-index <n>|--event-date <iso>
 *                       [--pre-window N] [--post-window N] [--k N] [--html] [--json]
 *
 * Compare what happened against what would have happened.
 */
export function cmdCausalCounterfactual(opts) {
  if (!opts.data) throw new Error('causal counterfactual needs --data <series.csv> (time + value)');
  const text = readFileSync(resolve(opts.data), 'utf8');
  const parsed = parseWideCsv(text, { valueColumns: opts.value ? [String(opts.value)] : undefined });
  const valueColumn = parsed.valueColumns[0];
  const treated = parsed.columns[valueColumn];

  let eventIndex = null;
  if (opts.eventIndex !== undefined) eventIndex = num(opts.eventIndex, null);
  else if (opts.eventDate) {
    const ms = Date.parse(String(opts.eventDate));
    if (!Number.isFinite(ms)) throw new Error(`Cannot parse --event-date "${opts.eventDate}"`);
    // Snap to the closest observation time.
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < parsed.times.length; i++) {
      const d = Math.abs(parsed.times[i] - ms);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    eventIndex = best;
    console.log(`--event-date ${opts.eventDate} snapped to step ${eventIndex} (closest observation).`);
  }
  if (eventIndex === null) throw new Error('causal counterfactual needs --event-index <step> or --event-date <iso>');

  const analyzer = new CounterfactualAnalyzer();
  const group = analyzer.buildControlGroup({
    treated,
    eventIndex,
    preWindow: num(opts.preWindow, 12),
    postWindow: num(opts.postWindow, 12),
    k: num(opts.k, 3),
  });
  const result = analyzer.run({
    treated,
    controls: group.controls,
    eventIndex,
    preWindow: group.preWindow,
    postWindow: group.postWindow,
  });

  console.log(`Counterfactual at step ${eventIndex}: ${group.preWindow} pre / ${group.postWindow} post steps, ${group.controls.length} control window(s).`);
  for (const c of group.chosen) console.log(`  control: ${c.label} (distance ${fmtNum(c.distance)})`);
  printTable(
    ['', 'Pre-event mean', 'Post-event mean', 'Change'],
    [
      ['Treated', fmtNum(result.treated.preMean), fmtNum(result.treated.postMean), fmtNum(result.treated.change)],
      ['Control', fmtNum(result.control.preMean), fmtNum(result.control.postMean), fmtNum(result.control.change)],
      ['Difference-in-differences', '', '', fmtNum(result.did)],
    ],
  );
  console.log(`DiD = ${fmtNum(result.did)} ± ${fmtNum(result.se)} (t=${fmtNum(result.tStat)}, p=${fmtP(result.pValue)}): ${result.significant ? 'significant' : 'not significant'}`);
  console.log(`Cumulative gap over the post window: ${fmtNum(result.cumulativeGap)}`);
  console.log(result.interpretation);
  console.log('Assumptions:');
  for (const a of result.assumptions) console.log(`  - ${a}`);

  if (opts.json) {
    writeJson(opts.json, { valueColumn, eventIndex, controlGroup: group.chosen, result });
    console.log(`Wrote ${resolve(opts.json)}`);
  }
  if (opts.html) {
    writeHtml(opts.html, buildCounterfactualHtml(result, { treated, controls: group.controls }));
    console.log(`Open in a browser: ${resolve(opts.html)}`);
  }
}

export function cmdCausal(opts) {
  const action = opts.action ?? 'graph';
  switch (action) {
    case 'graph': return cmdCausalGraph(opts);
    case 'what-if': return cmdCausalWhatIf(opts);
    case 'factors': return cmdCausalFactors(opts);
    case 'counterfactual': return cmdCausalCounterfactual(opts);
    default: throw new Error(`Unknown causal action "${action}". Try: forecastlab help causal`);
  }
}
