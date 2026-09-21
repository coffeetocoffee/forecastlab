// Interactive causal relationship builder.
//
// Emits a single self-contained HTML file: an SVG graph whose nodes the user
// can drag around, and whose links can be created by dragging from one node
// to another. Every link - discovered automatically or drawn by hand - is
// tested in the browser with the exact same classical statistics the CLI
// uses, because the causal module and the browser app are both inlined as
// raw text (they have no dependencies, so this needs no bundler and no
// network). Reading them as files rather than through template literals keeps
// escape sequences and regexes intact on the way into the page.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const CAUSAL_SRC = readFileSync(new URL('../causal.js', import.meta.url), 'utf8');
const APP_SRC = readFileSync(new URL('./causal-graph-app.js', import.meta.url), 'utf8');

const CSS = [
  'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;color:#111827;background:#f9fafb}',
  'header{background:#111827;color:#f9fafb;border-radius:12px;padding:20px 24px;margin:24px 24px 16px}',
  'header h1{margin:0 0 6px;font-size:24px}header p{margin:2px 0;color:#d1d5db}',
  'main{display:flex;gap:16px;padding:0 24px 24px;align-items:stretch}',
  '#canvasWrap{flex:1;background:#fff;border:1px solid #e5e7eb;border-radius:12px;position:relative;min-width:0}',
  '#canvas{display:block;width:100%;height:70vh;touch-action:none}',
  '#side{width:380px;flex:none;display:flex;flex-direction:column;gap:16px}',
  '.panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;overflow:auto}',
  '.panel h2{margin:0 0 10px;font-size:16px}',
  'table{border-collapse:collapse;width:100%;font-size:13px}',
  'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb}',
  'th{background:#f3f4f6;position:sticky;top:0}',
  'tr.row{cursor:pointer}tr.row:hover td{background:#f3f4f6}tr.row.sel td{background:#ecfdf5;font-weight:600}',
  '.muted{color:#6b7280;font-size:12.5px}',
  '.hint{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#92400e}',
  '.bar{height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden;margin-top:4px}',
  '.bar>i{display:block;height:100%;border-radius:4px;background:#10b981}',
  '.kv{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px dashed #e5e7eb}',
  '.kv b{font-weight:600}',
  'footer{color:#6b7280;font-size:12.5px;text-align:center;padding:8px 0 20px}',
  '@media(max-width:900px){main{flex-direction:column}#side{width:auto}}',
].join('');

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Build the interactive causal graph page.
 *
 * @param {Object} ctx
 * @param {Object<string, number[]>} ctx.series named series
 * @param {Object[]} ctx.edges edges from CausalGraph.discover()
 * @param {Object} [ctx.options] discovery options (maxLag, arLag, seasonLength, alpha)
 * @param {string} [ctx.title] page title
 * @returns {string} complete HTML document
 */
export function buildCausalGraphHtml(ctx) {
  const { series, edges, options = {}, title = 'Causal relationships' } = ctx;
  const names = Object.keys(series);
  const significant = edges.filter((e) => e.significant).length;

  // The preamble hands the page's data to the inlined app. JSON.stringify
  // never emits backticks or "${", so this is safe to splice into JavaScript.
  const preamble = [
    'const SERIES = ' + JSON.stringify(series) + ';',
    'const OPTIONS = ' + JSON.stringify(options) + ';',
    'const NAMES = ' + JSON.stringify(names) + ';',
    'const SEED_EDGES = ' + JSON.stringify(
      edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        lag: e.lag,
        correlation: e.correlation,
        effect: e.effect,
        pValue: e.pValue,
        fStat: e.fStat,
        significant: e.significant,
        confidence: e.confidence,
        stability: e.stability,
        nUsed: e.nUsed,
        alpha: e.alpha,
        direction: e.direction,
        feedback: e.feedback,
        directionNote: e.directionNote,
        lagProfile: e.lagProfile,
      })),
    ) + ';',
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ForecastLab causal graph</title>
<style>${CSS}</style></head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <p>${names.length} variables · ${edges.length} link(s) discovered · ${significant} statistically significant · all numbers computed in your browser, nothing uploaded</p>
</header>
<main>
  <div id="canvasWrap">
    <svg id="canvas" role="img" aria-label="causal relationship graph"></svg>
    <div id="flash" style="position:absolute;left:12px;bottom:12px;max-width:70%;background:#111827;color:#f9fafb;border-radius:8px;padding:8px 12px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none"></div>
  </div>
  <div id="side">
    <div class="panel"><div class="hint">
      <b>Drag a node</b> to rearrange the graph. <b>Drag from a node&#39;s green handle onto another node</b> to test a
      relationship of your own — the statistics run instantly in the browser. <b>Click a link</b> for its details.
    </div></div>
    <div class="panel" id="details"></div>
    <div class="panel">
      <h2>Detected links</h2>
      <div style="max-height:300px;overflow:auto"><table id="edgeTable"></table></div>
    </div>
  </div>
</main>
<footer>ForecastLab · classical statistics only: detrend, cross-correlate, test with a Granger-style F-test. Correlation suggests causation — it never proves it.</footer>
<script type="module">
${CAUSAL_SRC}
${preamble}
${APP_SRC}
</script>
</body></html>`;
}
