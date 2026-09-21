// Zero-dependency SVG charts for causal results: intervention ("what if") and
// difference-in-differences counterfactuals. Plain SVG strings, so they render
// in a browser without JavaScript and survive being emailed or archived.

import { fmtNum, fmtP } from '../causal.js';

const CSS = [
  'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;color:#111827;background:#f9fafb}',
  'header{background:#111827;color:#f9fafb;border-radius:12px;padding:20px 24px;margin:24px 24px 16px}',
  'header h1{margin:0 0 6px;font-size:24px}header p{margin:2px 0;color:#d1d5db}',
  'main{max-width:1040px;margin:0 auto;padding:0 24px 24px}',
  'section{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:20px}',
  'h2{margin-top:0;font-size:19px}table{border-collapse:collapse;width:100%;font-size:14px}',
  'th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}th{background:#f3f4f6}',
  'code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}',
  '.muted{color:#6b7280;font-size:13px}footer{color:#6b7280;font-size:13px;text-align:center;padding:16px}',
  '.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:8px}',
  '@media(max-width:720px){main{padding:0 12px 24px}header{margin:12px}}',
].join('');

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  return (v) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

function pathFor(values, x, y) {
  return values.map((v, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
}

function axes(x, y, opts) {
  const { w, h, margin, xLabel, yLabel, yTicks = 5 } = opts;
  let out = '';
  for (let i = 0; i <= yTicks; i++) {
    const v = opts.yMin + ((opts.yMax - opts.yMin) * i) / yTicks;
    const yy = y(v);
    out += '<line x1="' + margin.left + '" y1="' + yy.toFixed(1) + '" x2="' + (w - margin.right) + '" y2="' + yy.toFixed(1) +
      '" stroke="#e5e7eb"/><text x="' + (margin.left - 6) + '" y="' + (yy + 4).toFixed(1) +
      '" text-anchor="end" font-size="10" fill="#6b7280">' + fmtNum(v, 2) + '</text>';
  }
  const ticks = Math.min(opts.n, 8);
  for (let i = 0; i <= ticks; i++) {
    const idx = Math.round((i / ticks) * (opts.n - 1));
    const xx = x(idx);
    out += '<text x="' + xx.toFixed(1) + '" y="' + (h - margin.bottom + 16) + '" text-anchor="middle" font-size="10" fill="#6b7280">' + idx + '</text>';
  }
  out += '<line x1="' + margin.left + '" y1="' + (h - margin.bottom) + '" x2="' + (w - margin.right) + '" y2="' + (h - margin.bottom) + '" stroke="#9ca3af"/>';
  out += '<text x="' + (w / 2) + '" y="' + (h - 4) + '" text-anchor="middle" font-size="11" fill="#6b7280">' + xLabel + '</text>';
  out += '<text x="14" y="' + (h / 2) + '" text-anchor="middle" font-size="11" fill="#6b7280" transform="rotate(-90 14 ' + (h / 2) + ')">' + yLabel + '</text>';
  return out;
}

function legend(items, w, margin) {
  let out = '<g>';
  items.forEach((it, i) => {
    const lx = margin.left + i * 170;
    const ly = 16;
    out += '<line x1="' + lx + '" y1="' + ly + '" x2="' + (lx + 22) + '" y2="' + ly +
      '" stroke="' + it.color + '" stroke-width="2.5" ' + (it.dashed ? 'stroke-dasharray="6,4"' : '') + '/>';
    out += '<text x="' + (lx + 28) + '" y="' + (ly + 4) + '" font-size="11.5" fill="#374151">' + esc(it.label) + '</text>';
  });
  return out + '</g>';
}

/**
 * SVG chart for an intervention simulation: baseline vs hypothetical, with
 * the uncertainty band and the response function.
 *
 * @param {Object} result result of InterventionSimulator.simulate()
 * @param {Object} [options]
 * @returns {string} SVG markup
 */
export function buildInterventionChartSvg(result, options = {}) {
  const w = options.width ?? 880;
  const h = options.height ?? 380;
  const margin = { top: 34, right: 24, bottom: 44, left: 64 };
  const baseline = result.baseline.map((p) => p.value);
  const cf = result.counterfactual.map((p) => p.value);
  const lo = result.uncertainty.lower;
  const hi = result.uncertainty.upper;
  const n = cf.length;
  const all = [...baseline, ...cf, ...(lo || []), ...(hi || [])].filter(Number.isFinite);
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  const padY = (yMax - yMin) * 0.08 || 1;
  const x = scaleLinear(0, n - 1, margin.left, w - margin.right);
  const y = scaleLinear(yMin - padY, yMax + padY, h - margin.bottom, margin.top);

  let band = '';
  if (lo && hi && lo.length === n) {
    const top = pathFor(hi, x, y);
    const bottom = pathFor([...lo].reverse(), (i) => x(n - 1 - i), y);
    band = '<path d="' + top + ' ' + bottom + ' Z" fill="#10b981" fill-opacity="0.12" stroke="none"/>';
  }
  const startX = x(Math.min(options.start ?? 0, n - 1));
  const intervention = (options.start !== undefined)
    ? '<rect x="' + startX.toFixed(1) + '" y="' + margin.top + '" width="' + Math.max(4, x(Math.min((options.start ?? 0) + (options.duration ?? n), n - 1)) - startX).toFixed(1) +
      '" height="' + (h - margin.top - margin.bottom) + '" fill="#f59e0b" fill-opacity="0.13"/>' +
      '<text x="' + (startX + 4).toFixed(1) + '" y="' + (margin.top + 14) + '" font-size="11" fill="#92400e">intervention</text>'
    : '';

  return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto" role="img" aria-label="intervention simulation chart">' +
    axes(x, y, { w, h, margin, n, yMin: yMin - padY, yMax: yMax + padY, xLabel: 'step ahead', yLabel: esc(result.target) }) +
    legend([
      { label: 'baseline (no change)', color: '#3b82f6' },
      { label: 'hypothetical', color: '#10b981', dashed: true },
    ], w, margin) +
    intervention +
    band +
    '<path d="' + pathFor(baseline, x, y) + '" fill="none" stroke="#3b82f6" stroke-width="2.5"/>' +
    '<path d="' + pathFor(cf, x, y) + '" fill="none" stroke="#10b981" stroke-width="2.5" stroke-dasharray="6,4"/>' +
    '</svg>';
}

/**
 * SVG chart for a difference-in-differences counterfactual: what actually
 * happened vs what would have happened, with the control group behind it.
 *
 * @param {Object} result result of CounterfactualAnalyzer.run()
 * @param {number[]} [result.treatedValues] full treated series (for the pre-period context)
 * @param {number[][]} [result.controlWindows] control windows aligned to the event
 * @param {Object} [options]
 * @returns {string} SVG markup
 */
export function buildCounterfactualChartSvg(result, options = {}) {
  const w = options.width ?? 880;
  const h = options.height ?? 380;
  const margin = { top: 34, right: 24, bottom: 44, left: 64 };
  const pre = result.preWindow;
  const post = result.postWindow;
  const ev = result.eventIndex;
  const treated = options.treated ?? [];
  const controls = options.controls ?? [];

  // x axis: preWindow steps before the event, then postWindow after it
  const x = scaleLinear(-pre, post - 1, margin.left, w - margin.right);
  const values = [];
  const preT = treated.slice(ev - pre, ev);
  const postT = result.actual.map((p) => p.value);
  const cf = result.counterfactual.map((p) => p.value);
  values.push(...preT, ...postT, ...cf);
  for (const c of controls) values.push(...c);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const padY = (yMax - yMin) * 0.08 || 1;
  const y = scaleLinear(yMin - padY, yMax + padY, h - margin.bottom, margin.top);

  let controlPaths = '';
  for (const c of controls) {
    const pts = c.map((v, i) => (i === 0 ? 'M' : 'L') + x(i - pre).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    controlPaths += '<path d="' + pts + '" fill="none" stroke="#9ca3af" stroke-width="1.2" stroke-opacity="0.75"/>';
  }

  const actualPts = postT.map((v, i) => 'L' + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const prePts = preT.map((v, i) => (i === 0 ? 'M' : 'L') + x(i - pre).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const cfPts = cf.map((v, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');

  // Shade the gap between actual and counterfactual.
  const gapArea = cfPts + ' ' + postT.map((v, i) => 'L' + x(post - 1 - i).toFixed(1) + ',' + y(postT[post - 1 - i]).toFixed(1)).join(' ') + ' Z';

  return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto" role="img" aria-label="counterfactual chart">' +
    axes((i) => x(i - pre), y, {
      w, h, margin, n: pre + post, yMin: yMin - padY, yMax: yMax + padY,
      xLabel: 'steps from event', yLabel: 'value',
    }) +
    legend([
      { label: 'actual', color: '#111827' },
      { label: 'counterfactual', color: '#ef4444', dashed: true },
      { label: 'control group', color: '#9ca3af' },
    ], w, margin) +
    '<rect x="' + x(-pre) + '" y="' + margin.top + '" width="' + (x(0) - x(-pre)) + '" height="' + (h - margin.top - margin.bottom) +
    '" fill="#f3f4f6"/>' +
    '<text x="' + (x(-pre / 2)).toFixed(1) + '" y="' + (margin.top + 14) + '" text-anchor="middle" font-size="11" fill="#6b7280">pre-event</text>' +
    controlPaths +
    '<path d="' + gapArea + '" fill="#ef4444" fill-opacity="0.12" stroke="none"/>' +
    '<line x1="' + x(0) + '" y1="' + margin.top + '" x2="' + x(0) + '" y2="' + (h - margin.bottom) +
    '" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5,4"/>' +
    '<text x="' + (x(0) + 4) + '" y="' + (margin.top + 14) + '" font-size="11" fill="#92400e">event</text>' +
    '<path d="' + prePts + actualPts + '" fill="none" stroke="#111827" stroke-width="2.5"/>' +
    '<path d="' + cfPts + '" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="6,4"/>' +
    '</svg>';
}

/**
 * Full HTML page for an intervention simulation.
 */
export function buildInterventionHtml(result, options = {}) {
  const rows = [
    ['Variable changed', esc(result.variable) + ' by ' + fmtNum(result.change) + ' unit(s)'],
    ['Target', esc(result.target)],
    ['Response depth', result.lagDepth + ' lagged term(s)'],
    ['Peak impact', fmtNum(result.peakImpact) + ' at step ' + result.peakStep],
    ['Cumulative impact', fmtNum(result.cumulativeImpact) + ' over ' + result.baseline.length + ' steps'],
    ['Multiplier', fmtNum(result.multiplier) + ' per unit of sustained change'],
    ['Response model fit', 'R² = ' + fmtNum(result.responseFit.r2) + ' on ' + result.responseFit.n + ' observations'],
  ];
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What-if: ${esc(result.variable)} → ${esc(result.target)} — ForecastLab</title>
<style>${CSS}</style></head><body>
<header>
  <h1>What if we changed ${esc(result.variable)}?</h1>
  <p>Counterfactual for ${esc(result.target)}, from the historical impulse response. Computed locally, nothing uploaded.</p>
</header>
<main>
  <section>
    <h2>Actual vs hypothetical</h2>
    ${buildInterventionChartSvg(result, { start: options.start, duration: options.duration })}
    <p class="muted">Blue: the baseline without any change. Green dashed: with the intervention applied. Green band: uncertainty from the response model's residuals. Amber: the intervention window.</p>
    ${(result.warnings ?? []).map((w2) => '<div class="warn"><b>' + esc(w2.type) + ':</b> ' + esc(w2.message) + '</div>').join('')}
  </section>
  <section>
    <h2>Summary</h2>
    <table>${rows.map((r) => '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>').join('')}</table>
    <p style="font-size:15px"><b>Reading:</b> ${esc(result.interpretation)}</p>
  </section>
  <section>
    <h2>Impulse response (effect per unit, by lag)</h2>
    ${responseFunctionSvg(result, options)}
    <p class="muted">Each bar is the fitted effect of ${esc(result.variable)} on ${esc(result.target)} at that lag. The cumulative sum is the long-run multiplier.</p>
  </section>
</main>
<footer>ForecastLab · what-if from a distributed-lag model, not a trained black box.</footer>
</body></html>`;
}

function responseFunctionSvg(result, options) {
  const rf = result.responseFunction ?? [];
  if (rf.length === 0) return '<p class="muted">No response function available.</p>';
  const w = 880, h = 180, margin = { top: 16, right: 24, bottom: 30, left: 48 };
  const maxAbs = Math.max(...rf.map((r) => Math.abs(r.coefficient)), 1e-9);
  const bw = (w - margin.left - margin.right) / rf.length;
  let bars = '';
  for (let i = 0; i < rf.length; i++) {
    const c = rf[i].coefficient;
    const bh = (Math.abs(c) / maxAbs) * ((h - margin.top - margin.bottom) * 0.45);
    const y0 = h / 2;
    const y1 = c >= 0 ? y0 - bh : y0 + bh;
    bars += '<rect x="' + (margin.left + i * bw + 2).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) +
      '" width="' + (bw - 4).toFixed(1) + '" height="' + Math.max(bh, 1).toFixed(1) +
      '" fill="' + (c >= 0 ? '#10b981' : '#ef4444') + '"><title>lag ' + i + ': ' + fmtNum(c) + '</title></rect>';
  }
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto" role="img" aria-label="impulse response">' +
    '<line x1="' + margin.left + '" y1="' + (h / 2) + '" x2="' + (w - margin.right) + '" y2="' + (h / 2) + '" stroke="#9ca3af"/>' +
    bars +
    '<text x="' + (w - margin.right) + '" y="' + (h / 2 - 6) + '" text-anchor="end" font-size="10" fill="#6b7280">lag (steps)</text>' +
    '<text x="' + (margin.left - 6) + '" y="' + (h / 2 + 3) + '" text-anchor="end" font-size="10" fill="#6b7280">0</text></svg>';
}

/**
 * Full HTML page for a difference-in-differences counterfactual.
 *
 * @param {Object} result result of CounterfactualAnalyzer.run()
 * @param {Object} [options]
 * @param {number[]} [options.treated] full treated series
 * @param {number[][]} [options.controls] control windows aligned to the event
 */
export function buildCounterfactualHtml(result, options = {}) {
  const rows = [
    ['Treated: pre → post', fmtNum(result.treated.preMean) + ' → ' + fmtNum(result.treated.postMean) + ' (' + (result.treated.change >= 0 ? '+' : '') + fmtNum(result.treated.change) + ')'],
    ['Control: pre → post', fmtNum(result.control.preMean) + ' → ' + fmtNum(result.control.postMean) + ' (' + (result.control.change >= 0 ? '+' : '') + fmtNum(result.control.change) + ')'],
    ['Difference-in-differences', fmtNum(result.did)],
    ['Standard error', fmtNum(result.se)],
    ['t-statistic', fmtNum(result.tStat)],
    ['p-value', fmtP(result.pValue)],
    ['Verdict', result.significant ? 'significant effect detected' : 'no significant effect'],
    ['Cumulative gap', fmtNum(result.cumulativeGap)],
  ];
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Counterfactual — ForecastLab</title>
<style>${CSS}</style></head><body>
<header>
  <h1>Actual vs "what would have happened"</h1>
  <p>Difference-in-differences at step ${result.eventIndex} · ${result.preWindow} pre / ${result.postWindow} post steps · computed locally</p>
</header>
<main>
  <section>
    <h2>Reality vs counterfactual</h2>
    ${buildCounterfactualChartSvg(result, { treated: options.treated ?? [], controls: options.controls ?? [] })}
    <p class="muted">Black: what actually happened. Red dashed: what the control group implies would have happened without the event. Grey: control units. Shaded red: the gap attributed to the event.</p>
  </section>
  <section>
    <h2>Difference-in-differences</h2>
    <table>${rows.map((r) => '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>').join('')}</table>
    <p style="font-size:15px"><b>Reading:</b> ${esc(result.interpretation)}</p>
  </section>
  <section>
    <h2>Assumptions behind this estimate</h2>
    <ul>${(result.assumptions ?? []).map((a) => '<li>' + esc(a) + '</li>').join('')}</ul>
  </section>
</main>
<footer>ForecastLab · counterfactuals from control groups and difference-in-differences, no machine learning.</footer>
</body></html>`;
}
