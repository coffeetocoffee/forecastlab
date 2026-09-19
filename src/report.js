// Reproducible reports: a self-contained HTML page (open it in any browser,
// no server or network needed), a machine-readable JSON document, a CSV
// forecast table, and a Markdown variant for plain-text workflows.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describeBacktest, describeForecast, fmtNum, methodCard } from './explain.js';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Short axis label for an ISO timestamp, depending on the sampling step. */
export function shortLabel(iso, stepMs) {
  if (!iso) return '';
  if (stepMs && stepMs < 12 * 3600 * 1000) return iso.slice(0, 13).replace('T', ' ') + ':00';
  return iso.slice(0, 10);
}

/** Future timestamps when the grid is regular, else nulls. */
export function futureTimes(points, stepMs, horizon) {
  if (!stepMs) return new Array(horizon).fill(null);
  const end = points[points.length - 1].t;
  return Array.from({ length: horizon }, (_, k) => new Date(end + (k + 1) * stepMs).toISOString());
}

/** Inline SVG line chart: history, optional test split, forecast, interval band. */
export function buildChartSvg({ labels, values, splitIndex = null, forecast = null, lower = null, upper = null, interval = 80 }) {
  const W = 960;
  const H = 380;
  const L = 64;
  const R = 16;
  const T = 24;
  const B = 48;
  const n = values.length;
  const h = forecast ? forecast.length : 0;
  const total = n + h;
  const all = [...values, ...(lower ?? []), ...(upper ?? []), ...(forecast ?? [])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (!(lo < hi)) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const X = (i) => L + (total <= 1 ? 0 : (i * (W - L - R)) / (total - 1));
  const Y = (v) => T + ((1 - (v - lo) / (hi - lo)) * (H - T - B));

  const stride = Math.max(1, Math.ceil(n / 400));
  let hist = '';
  for (let i = 0; i < n; i += stride) hist += `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(values[i]).toFixed(1)}`;
  if ((n - 1) % stride !== 0) hist += `L${X(n - 1).toFixed(1)},${Y(values[n - 1]).toFixed(1)}`;

  let band = '';
  let line = '';
  if (forecast) {
    let top = `M${X(n).toFixed(1)},${Y(upper[0]).toFixed(1)}`;
    for (let k = 1; k < h; k++) top += `L${X(n + k).toFixed(1)},${Y(upper[k]).toFixed(1)}`;
    let bottom = `L${X(n + h - 1).toFixed(1)},${Y(lower[h - 1]).toFixed(1)}`;
    for (let k = h - 2; k >= 0; k--) bottom += `L${X(n + k).toFixed(1)},${Y(lower[k]).toFixed(1)}`;
    band = top + bottom + 'Z';
    line = `M${X(n - 1).toFixed(1)},${Y(values[n - 1]).toFixed(1)}`;
    for (let k = 0; k < h; k++) line += `L${X(n + k).toFixed(1)},${Y(forecast[k]).toFixed(1)}`;
  }

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = lo + ((hi - lo) * g) / 4;
    const y = Y(v).toFixed(1);
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>` +
      `<text x="${L - 8}" y="${Number(y) + 4}" text-anchor="end" font-size="11" fill="#6b7280">${escapeHtml(fmtNum(v))}</text>`;
  }

  const first = escapeHtml(labels[0] ?? '');
  const last = escapeHtml(labels[n - 1] ?? '');
  let xlabels = `<text x="${X(0)}" y="${H - 24}" font-size="11" fill="#6b7280">${first}</text>` +
    `<text x="${X(n - 1)}" y="${H - 24}" text-anchor="end" font-size="11" fill="#6b7280">${last}</text>`;
  if (h > 0) {
    xlabels += `<text x="${X(n + h - 1)}" y="${H - 8}" text-anchor="end" font-size="11" fill="#b45309">+${h} steps</text>`;
  }
  const split = splitIndex !== null && splitIndex > 0 && splitIndex < n
    ? `<line x1="${X(splitIndex).toFixed(1)}" y1="${T}" x2="${X(splitIndex).toFixed(1)}" y2="${H - B}" stroke="#9ca3af" stroke-dasharray="5 4" stroke-width="1"/>` +
      `<text x="${X(splitIndex).toFixed(1)}" y="${T - 6}" text-anchor="middle" font-size="11" fill="#6b7280">test split</text>`
    : '';

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="History and forecast chart" style="width:100%;height:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px">` +
    `<title>History and forecast</title>${grid}${split}` +
    (band ? `<path d="${band}" fill="#f59e0b" opacity="0.22"/>` : '') +
    `<path d="${hist}" fill="none" stroke="#2563eb" stroke-width="2"/>` +
    (line ? `<path d="${line}" fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="7 4"/>` : '') +
    `${xlabels}` +
    `<g font-size="12"><circle cx="${L}" cy="${H - 2}" r="4" fill="#2563eb"/><text x="${L + 10}" y="${H + 2}" fill="#374151">history</text>` +
    (line ? `<circle cx="${L + 110}" cy="${H - 2}" r="4" fill="#d97706"/><text x="${L + 120}" y="${H + 2}" fill="#374151">forecast</text>` +
      `<rect x="${L + 210}" y="${H - 8}" width="14" height="10" fill="#f59e0b" opacity="0.4"/><text x="${L + 230}" y="${H + 2}" fill="#374151">${interval}% interval</text>` : '') +
    `</g></svg>`;
}

function table(headers, rows) {
  const th = headers.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow-x:auto"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

const CSS = `body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:1000px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb}` +
  `header{background:#111827;color:#f9fafb;border-radius:12px;padding:24px;margin-bottom:24px}` +
  `header h1{margin:0 0 8px;font-size:28px}header p{margin:4px 0;color:#d1d5db}` +
  `section{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:20px}` +
  `h2{margin-top:0;font-size:20px}table{border-collapse:collapse;width:100%;font-size:14px}` +
  `th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb}` +
  `th{background:#f3f4f6}tr.best td{background:#ecfdf5;font-weight:600}` +
  `code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}` +
  `.math{background:#f3f4f6;border-radius:8px;padding:12px 16px;font-family:ui-monospace,monospace}` +
  `.muted{color:#6b7280;font-size:13px}footer{color:#6b7280;font-size:13px;text-align:center;padding:16px}`;

/**
 * Build the full HTML report string.
 * ctx: { title, dataset, issues, backtest|null, forecast, times, card, repro }.
 */
export function buildHtmlReport(ctx) {
  const { title, dataset, issues, backtest, forecast, times, card, repro } = ctx;
  const labels = dataset.labels;
  const values = dataset.values;
  const chart = buildChartSvg({
    labels,
    values,
    splitIndex: backtest ? backtest.splitIndex : null,
    forecast: forecast.point,
    lower: forecast.lower,
    upper: forecast.upper,
    interval: forecast.interval,
  });

  const issueRows = issues.length === 0
    ? '<p>No duplicates, gaps, outliers, or missing values detected.</p>'
    : table(['#', 'Type', 'Detail'], issues.slice(0, 50).map((iss, i) =>
      [String(i + 1), escapeHtml(iss.type), escapeHtml(iss.message)])) +
      (issues.length > 50 ? `<p class="muted">Showing 50 of ${issues.length} notes.</p>` : '');

  const backtestSection = backtest
    ? `<section><h2>Method comparison (backtest)</h2><p>${escapeHtml(describeBacktest(backtest))}</p>` +
      table(['Method', 'RMSE', 'MAE', 'MAPE %', 'sMAPE %', 'MASE'],
        backtest.results.map((r, i) =>
          [`${i === 0 ? '★ ' : ''}${escapeHtml(r.title)}`, fmtNum(r.rmse), fmtNum(r.mae), fmtNum(r.mape), fmtNum(r.smape), fmtNum(r.mase)]
            .map((c) => (i === 0 ? `<strong>${c}</strong>` : c)))) +
      `<p class="muted">★ lowest RMSE on held-out data. Lower is better for every metric.</p></section>`
    : '';

  const rowCount = Math.min(forecast.point.length, 24);
  const frows = [];
  for (let k = 0; k < rowCount; k++) {
    frows.push([
      String(k + 1),
      escapeHtml(times[k] ? shortLabel(times[k], dataset.stepMs) : `+${k + 1}`),
      fmtNum(forecast.point[k]), fmtNum(forecast.lower[k]), fmtNum(forecast.upper[k]),
    ]);
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)} — ForecastLab report</title><style>${CSS}</style></head><body>` +
    `<header><h1>${escapeHtml(title)}</h1>` +
    `<p>ForecastLab reproducible report · ${escapeHtml(forecast.title)} · ${forecast.horizon} steps ahead</p>` +
    `<p>Data: <code>${escapeHtml(dataset.file)}</code> · ${dataset.count} points · ${escapeHtml(dataset.start ?? '')} → ${escapeHtml(dataset.end ?? '')}` +
    (dataset.unit ? ` · unit: ${escapeHtml(dataset.unit)}` : '') +
    (dataset.resampled ? ` · resampled to a ${dataset.resampled.stepMs} ms grid (${dataset.resampled.agg})` : '') +
    `</p></header>` +
    `<section><h2>Forecast</h2><p>${escapeHtml(describeForecast(forecast))}</p>${chart}` +
    table(['Step', 'Time', 'Forecast', `Lower ${forecast.interval}%`, `Upper ${forecast.interval}%`], frows) +
    (forecast.point.length > rowCount ? `<p class="muted">Showing first ${rowCount} of ${forecast.point.length} steps; the full series is in the JSON companion file.</p>` : '') +
    `</section>` + backtestSection +
    `<section><h2>Data quality</h2>${issueRows}</section>` +
    `<section><h2>Method: ${escapeHtml(card.title)}</h2><p>${escapeHtml(card.summary)}</p>` +
    `<p class="math">${escapeHtml(card.math)}</p>` +
    `<p><strong>Use when:</strong> ${escapeHtml(card.useWhen)}</p>` +
    `<p><strong>Watch out:</strong> ${escapeHtml(card.pitfalls)}</p></section>` +
    `<section><h2>Reproducibility</h2>` +
    `<p>Input SHA-256: <code>${escapeHtml(repro.hash)}</code></p>` +
    `<p>Command: <code>${escapeHtml(repro.command)}</code></p>` +
    `<p class="muted">Generated ${escapeHtml(repro.generatedAt)} with forecastlab ${escapeHtml(repro.version)}. ` +
    `Re-run the command above on the same input file to reproduce these numbers.</p></section>` +
    `<footer>Built locally with ForecastLab · no data left your machine.</footer></body></html>`;
}

/** Build the machine-readable companion document (full forecast arrays included). */
export function buildJsonReport(ctx) {
  const { title, dataset, issues, backtest, forecast, repro } = ctx;
  return {
    title,
    tool: { name: 'forecastlab', version: repro.version },
    generatedAt: repro.generatedAt,
    command: repro.command,
    dataset: {
      file: dataset.file,
      hash: repro.hash,
      count: dataset.count,
      start: dataset.start,
      end: dataset.end,
      stepMs: dataset.stepMs,
      regular: dataset.regular,
      timeColumn: dataset.timeColumn,
      valueColumn: dataset.valueColumn,
      unit: dataset.unit ?? null,
      resampled: dataset.resampled ?? null,
    },
    dataQuality: { issueCount: issues.length, issues },
    backtest,
    forecast: {
      method: forecast.method,
      title: forecast.title,
      horizon: forecast.horizon,
      interval: forecast.interval,
      sigma: forecast.sigma,
      intervalMode: forecast.intervalMode,
      damped: forecast.damped,
      seasonality: forecast.seasonality,
      params: forecast.params,
      steps: forecastRows(ctx),
    },
  };
}

/** Full forecast table: one row per horizon step (shared by CSV and JSON). */
function forecastRows(ctx) {
  const { forecast, times } = ctx;
  return forecast.point.map((p, k) => ({
    step: k + 1,
    time: times[k] ?? null,
    point: p,
    lower: forecast.lower[k],
    upper: forecast.upper[k],
  }));
}

/** RFC 4180-ish cell: quote fields that could break a CSV reader. */
function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Machine-readable forecast table, full precision: a twin of the JSON steps. */
export function buildForecastCsv(ctx) {
  const { forecast } = ctx;
  const header = ['step', 'time', 'point', `lower_${forecast.interval}pct`, `upper_${forecast.interval}pct`];
  const lines = [header.map(csvCell).join(',')];
  for (const r of forecastRows(ctx)) {
    lines.push([r.step, r.time ?? '', r.point, r.lower, r.upper].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

/** Escape a cell for Markdown tables (a bare pipe would split the column). */
function mdCell(v) {
  return String(v ?? '').replace(/\|/g, '\\|');
}

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.map(mdCell).join(' | ')} |`;
  return [
    line(headers),
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

/**
 * Text-only report variant: the same sections as the HTML report (no chart —
 * the forecast table and the JSON companion carry the numbers).
 */
export function buildMarkdownReport(ctx) {
  const { title, dataset, issues, backtest, forecast, card, repro } = ctx;
  const rows = forecastRows(ctx);
  const show = Math.min(rows.length, 24);
  const frows = rows.slice(0, show).map((r) => [
    r.step,
    r.time ? shortLabel(r.time, dataset.stepMs) : `+${r.step}`,
    fmtNum(r.point),
    fmtNum(r.lower),
    fmtNum(r.upper),
  ]);

  const out = [
    `# ${title}`,
    '',
    `> ForecastLab reproducible report · ${forecast.title} · ${forecast.horizon} step(s) ahead`,
    `> Data: \`${dataset.file}\` · ${dataset.count} points · ${dataset.start ?? ''} → ${dataset.end ?? ''}` +
      (dataset.unit ? ` · unit: ${dataset.unit}` : '') +
      (dataset.resampled ? ` · resampled to a ${dataset.resampled.stepMs} ms grid (${dataset.resampled.agg})` : ''),
    '',
    '## Forecast',
    '',
    describeForecast(forecast),
    '',
    mdTable(
      ['Step', 'Time', 'Forecast', `Lower ${forecast.interval}%`, `Upper ${forecast.interval}%`],
      frows,
    ),
    '',
  ];

  if (rows.length > show) {
    out.push(`Showing the first ${show} of ${rows.length} steps; the full series is in the JSON companion file (and in the CSV export).`, '');
  }

  if (backtest) {
    out.push(
      '## Method comparison (backtest)',
      '',
      describeBacktest(backtest),
      '',
      mdTable(
        ['Method', 'RMSE', 'MAE', 'MAPE %', 'sMAPE %', 'MASE'],
        backtest.results.map((r, i) =>
          [`${i === 0 ? '★ ' : ''}${r.title}`, fmtNum(r.rmse), fmtNum(r.mae), fmtNum(r.mape), fmtNum(r.smape), fmtNum(r.mase)]
            .map((c) => (i === 0 ? `**${c}**` : c))),
      ),
      '',
      '★ lowest RMSE on held-out data. Lower is better for every metric.',
      '',
    );
  }

  out.push(
    '## Data quality',
    '',
    issues.length === 0
      ? 'No duplicates, gaps, outliers, or missing values detected.'
      : mdTable(['#', 'Type', 'Detail'], issues.slice(0, 50).map((iss, i) => [i + 1, iss.type, iss.message])) +
          (issues.length > 50 ? `\n\nShowing 50 of ${issues.length} notes.` : ''),
    '',
    `## Method: ${card.title}`,
    '',
    card.summary,
    '',
    '```',
    card.math,
    '```',
    '',
    `**Use when:** ${card.useWhen}`,
    '',
    `**Watch out:** ${card.pitfalls}`,
    '',
    '## Reproducibility',
    '',
    `- Input SHA-256: \`${repro.hash}\``,
    `- Command: \`${repro.command}\``,
    `- Generated ${repro.generatedAt} with forecastlab ${repro.version}. Re-run the command above on the same input file to reproduce these numbers.`,
    '',
    '---',
    '',
    'Built locally with ForecastLab · no data left your machine.',
    '',
  );

  return out.join('\n');
}

/**
 * Write report artifacts to disk. Each argument is `{ path, content }` for the
 * formats you want; any format left out (or with a null path) is skipped, so
 * callers request exactly the outputs they need.
 */
export function writeReportFiles({ html, json, csv, md } = {}) {
  for (const item of [html, json, csv, md]) {
    if (!item?.path) continue;
    mkdirSync(dirname(item.path), { recursive: true });
    writeFileSync(item.path, item.content, 'utf8');
  }
}
