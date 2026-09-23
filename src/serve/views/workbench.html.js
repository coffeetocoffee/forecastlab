import { getClientScript } from './client.js';
import { VERSION } from '../../serve/config.js';

export function workbenchHtml({ token, defaults }) {
  const bootstrap = JSON.stringify({ token, version: VERSION, defaults })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>ForecastLab workbench</title>
<script src="https://d3js.org/d3.v7.min.js"><\/script>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:1040px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb}
header{background:#111827;color:#f9fafb;border-radius:12px;padding:24px;margin-bottom:24px}
header h1{margin:0 0 8px;font-size:28px}header p{margin:4px 0;color:#d1d5db}
header .muted{color:#9ca3af;font-size:13px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:20px}
.card[hidden]{display:none}
h2{margin-top:0;font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#374151}
label.check{flex-direction:row;align-items:center;gap:8px;min-height:38px}
input,select{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;background:#fff;color:#111827;width:100%}
button{padding:8px 16px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#111827;font-size:14px;cursor:pointer}
button.primary{background:#111827;color:#f9fafb;border-color:#111827}
button:disabled{opacity:.6;cursor:wait}
.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.examples{margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:13px;color:#374151;display:flex;gap:8px;align-items:center}
.examples select{width:auto;min-width:220px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
th{background:#f3f4f6}
tr.best td{background:#ecfdf5;font-weight:600}
.scroll{overflow-x:auto}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}
.math{background:#f3f4f6;border-radius:8px;padding:12px 16px;font-family:ui-monospace,monospace;white-space:pre-wrap}
.muted{color:#6b7280;font-size:13px}
.chart{margin:8px 0;position:relative}
.chart.interactive svg{cursor:pointer}
.chart-overlay{position:absolute;top:10px;right:10px;background:white;border:2px solid #374151;border-radius:8px;padding:12px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:300px}
.chart-overlay h3{margin:0 0 8px;font-size:14px}
.chart-overlay table{font-size:12px}
.chart-tooltip{position:fixed;padding:8px 12px;background:#1f2937;color:white;border-radius:6px;font-size:12px;display:none;z-index:1000;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.15)}
.chart-legend{margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between}
#err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:12px;padding:16px 20px;margin-bottom:20px}
#err[hidden]{display:none}
footer{color:#6b7280;font-size:13px;text-align:center;padding:16px}
</style>
</head>
<body>
<header>
  <h1>ForecastLab workbench</h1>
  <p>Local-first forecasting in your browser — the same engine as the CLI, no data leaves this machine.</p>
  <p class="muted" id="serverinfo"></p>
</header>
<main>
  <div id="err" hidden></div>
  <section class="card">
    <h2>Data &amp; settings</h2>
    <form id="form" onsubmit="return false">
      <div class="grid">
        <label>Project file (.forecast.json)<input id="project" placeholder="examples/energy.forecast.json"></label>
        <label>CSV file 
          <input type="file" id="csv-upload" accept=".csv" style="display:none" onchange="handleFileUpload(this.files[0])">
          <button type="button" onclick="$('csv-upload').click()" style="margin-top:2px;">📤 Upload CSV</button>
        </label>
        <input type="hidden" id="data">
        <label>Dataset name<input id="name" placeholder="auto from filename"></label>
        <label>Unit<input id="unit" placeholder="kWh"></label>
        <label>Time column<input id="time" placeholder="auto-detected"></label>
        <label>Value column<input id="value" placeholder="auto-detected"></label>
        <label>Season length (steps)<input id="season" type="number" min="2" placeholder="e.g. 24"></label>
        <label>Horizon (steps)<input id="horizon" type="number" min="1" value="24"></label>
        <label>Interval
          <select id="interval"><option>80</option><option>90</option><option>95</option></select>
        </label>
        <label>Test size<input id="testSize" type="number" min="1" placeholder="auto (~20%)"></label>
        <label>Method
          <select id="method">
            <option value="auto">auto (backtest winner)</option>
            <option value="naive">naive</option>
            <option value="snaive">seasonal naive</option>
            <option value="mean">mean</option>
            <option value="drift">drift</option>
            <option value="linear">linear trend</option>
            <option value="holt">Holt</option>
            <option value="hw">Holt-Winters</option>
          </select>
        </label>
        <label>HW seasonality
          <select id="seasonality"><option value="additive">additive</option><option value="multiplicative">multiplicative</option></select>
        </label>
        <label class="check"><input type="checkbox" id="damped"> Damped trend (holt/hw)</label>
        <label class="check"><input type="checkbox" id="resample"> Resample to fixed grid</label>
        <label>Resample aggregation
          <select id="agg"><option>mean</option><option>sum</option><option>first</option><option>last</option><option>min</option><option>max</option></select>
        </label>
        <label>Grid step (ms)<input id="step" type="number" min="1" placeholder="auto"></label>
      </div>
      <div class="actions">
        <button type="button" id="btn-check">Check quality</button>
        <button type="button" id="btn-compare">Compare methods</button>
        <button type="button" id="btn-forecast">Forecast</button>
        <button type="button" id="btn-all" class="primary">Run all</button>
        <hr style="width:100%;border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
        <button type="button" id="btn-simulation">Monte Carlo Simulation</button>
        <button type="button" id="btn-scenarios">Scenario Analysis</button>
        <button type="button" id="btn-live">Live stream</button>
      </div>
      <div class="examples">
        <span>Load a built-in example:</span>
        <select id="examples" disabled><option value="">(none found)</option></select>
      </div>
    </form>
  </section>
  <section class="card" id="card-quality" hidden><h2>Data quality</h2><div id="quality"></div></section>
  <section class="card" id="card-compare" hidden><h2>Method comparison (backtest)</h2><div id="compare"></div></section>
  <section class="card" id="card-forecast" hidden><h2>Forecast</h2><div id="forecast"></div></section>
  <section class="card" id="card-method" hidden><h2 id="method-title">Method</h2><div id="method-card"></div></section>
  
  <!-- Phase 5 Visualizations -->
  <section class="card" id="card-simulation" hidden><h2>Monte Carlo Simulation</h2><div id="simulation-viz"></div></section>
  <section class="card" id="card-scenarios" hidden><h2>Scenario Analysis</h2><div id="scenarios-viz"></div></section>
  <section class="card" id="card-live" hidden><h2>Live stream</h2><p class="muted" id="live-status">Not connected. Start serve with --feed file:&lt;path&gt; to attach a streaming engine.</p><div class="chart" id="live-chart"></div><div id="live-alerts"></div></section>
</main>
<footer>Built locally with ForecastLab · the page re-reads your file on every request · nothing is uploaded</footer>
<script>
const BOOTSTRAP = ${bootstrap};
${getClientScript(bootstrap)}
</script>
</body>
</html>`;
}
