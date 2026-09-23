/**
 * Client-side JavaScript for the workbench interface.
 */

export function getClientScript(BOOTSTRAP) {
  return `
const BOOT = BOOTSTRAP;
const $ = (id) => document.getElementById(id);
const num = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
};
const shortLabel = (iso, stepMs) => {
  if (!iso) return '';
  if (stepMs && stepMs < 12 * 3600 * 1000) return iso.slice(0, 13).replace('T', ' ') + ':00';
  return iso.slice(0, 10);
};
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};

// File upload handler for CSV parsing (client-side, no server round-trip)
async function handleFileUpload(file) {
  if (!file) return;
  $('project').value = '';
  $('data').value = file.name;
  
  try {
    const text = await file.text();
    // Parse CSV to get columns
    const lines = text.trim().split('\\n');
    if (lines.length < 2) throw new Error('CSV must have at least a header and one row');
    
    const headers = lines[0].split(',').map(h => h.trim());
    const valuesLine = lines[1].split(',');
    
    // Auto-detect columns
    let timeCol = headers.find(h => /time|date|ts|t/i.test(h)) || headers[0];
    let valueCol = headers.find((h, i) => i !== headers.indexOf(timeCol) && /value|val|v/i.test(h)) || 
                   headers.find((h, i) => i !== headers.indexOf(timeCol)) || headers[1];
    
    $('time').value = timeCol;
    $('value').value = valueCol;
    $('name').value = file.name.replace(/\\.csv$/i, '');
    
    alert('Loaded ' + file.name + '. Columns auto-detected. Click "Run all" to analyze.');
  } catch (e) {
    showError('Error reading CSV: ' + e.message);
  }
}

function table(headers, rows, rowClass) {
  const t = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of headers) headRow.appendChild(el('th', h));
  thead.appendChild(headRow);
  const tbody = el('tbody');
  rows.forEach((r, i) => {
    const tr = el('tr');
    if (rowClass && rowClass(r, i)) tr.className = 'best';
    for (const c of r) tr.appendChild(el('td', c));
    tbody.appendChild(tr);
  });
  t.append(thead, tbody);
  const wrap = el('div');
  wrap.className = 'scroll';
  wrap.appendChild(t);
  return wrap;
}
function params(pristine) {
  const o = {};
  const set = (k, v) => { v = String(v).trim(); if (v !== '') o[k] = v; };
  set('data', $('data').value); set('project', $('project').value);
  set('name', $('name').value); set('unit', $('unit').value);
  set('time', $('time').value); set('value', $('value').value);
  set('season', $('season').value); set('horizon', $('horizon').value);
  set('interval', $('interval').value); set('testSize', $('testSize').value);
  set('method', $('method').value); set('seasonality', $('seasonality').value);
  set('agg', $('agg').value); set('step', $('step').value);
  // A pristine load lets the project file's own flags win; after that the
  // checkboxes are the user's explicit choice and override the file.
  if (!pristine) {
    o.damped = $('damped').checked ? 'true' : 'false';
    o.resample = $('resample').checked ? 'true' : 'false';
  }
  return o;
}
async function api(name, pristine) {
  const url = new URL('api/' + name, location.href);
  for (const [k, v] of Object.entries(params(pristine))) url.searchParams.set(k, v);
  url.searchParams.set('token', BOOT.token);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  let body;
  try { body = await res.json(); } catch { body = { error: 'Bad response from the server' }; }
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
}
const buttons = () => document.querySelectorAll('.actions button');
function busy(on) { buttons().forEach((b) => { b.disabled = on; }); }
function clearError() { $('err').hidden = true; $('err').textContent = ''; }
function showError(msg) { $('err').textContent = msg; $('err').hidden = false; }
function show(id) { $(id).hidden = false; }

// URL State Management - Shareable view state via URL hash
function getState() {
  const state = {};
  const inputs = ['project', 'data', 'name', 'unit', 'time', 'value', 'season', 'horizon', 
                  'interval', 'testSize', 'method', 'seasonality', 'agg', 'step'];
  inputs.forEach(id => {
    const val = $(id).value;
    if (val !== '') state[id] = val;
  });
  if ($('damped').checked) state.damped = true;
  if ($('resample').checked) state.resample = true;
  return state;
}

function setState(state) {
  Object.entries(state).forEach(([key, value]) => {
    if (key === 'damped' || key === 'resample') {
      $(key).checked = value === true || value === 'true';
    } else {
      $(key).value = value;
    }
  });
}

function loadStateFromHash() {
  if (!location.hash) return;
  try {
    const encoded = decodeURIComponent(location.hash.slice(1));
    const state = JSON.parse(encoded);
    if (state && typeof state === 'object') {
      setState(state);
      console.log('Loaded state from URL hash');
    }
  } catch (e) {
    console.warn('Failed to parse URL state:', e);
  }
}

function saveStateToHash() {
  const state = getState();
  if (Object.keys(state).length === 0) {
    history.replaceState(null, '', location.pathname);
  } else {
    const encoded = encodeURIComponent(JSON.stringify(state));
    history.replaceState(null, '', '#' + encoded);
  }
}

// Download project file as JSON
function downloadProjectFile() {
  const project = {
    name: $('name').value || 'Unnamed',
    description: '',
    data: $('data').value,
    timeColumn: $('time').value || null,
    valueColumn: $('value').value || null,
    unit: $('unit').value || null,
    seasonLength: $('season').value ? parseInt($('season').value, 10) : null,
    horizon: $('horizon').value ? parseInt($('horizon').value, 10) : 24,
    interval: parseInt($('interval').value, 10),
    testSize: $('testSize').value ? parseInt($('testSize').value, 10) : null,
    resample: $('resample').checked,
    agg: $('agg').value,
    step: $('step').value ? parseInt($('step').value, 10) : null,
    damped: $('damped').checked,
    seasonality: $('seasonality').value,
    requiresVersion: '0.1.0',
  };
  
  const blob = new Blob([JSON.stringify(project, null, 2) + '\\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = project.name + '.forecast.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  alert('Project file downloaded: ' + project.name + '.forecast.json');
}

// Update state on any change
function updateStateOnChange() {
  saveStateToHash();
}

// Add change listeners to all inputs
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const inputs = ['project', 'data', 'name', 'unit', 'time', 'value', 'season', 'horizon',
                    'interval', 'testSize', 'method', 'seasonality', 'agg', 'step'];
    inputs.forEach(id => {
      $(id).addEventListener('input', updateStateOnChange);
    });
    $('damped').addEventListener('change', updateStateOnChange);
    $('resample').addEventListener('change', updateStateOnChange);
    
    // Load initial state from URL hash
    loadStateFromHash();
  }, 0);
});

function renderSummary(d, apply) {
  const cfg = d.config, s = d.summary;
  if (apply) applyConfig(cfg);
  const box = $('quality');
  box.innerHTML = '';
  box.appendChild(el('p', cfg.name + ': ' + s.count + ' points, ' + (s.start ?? '?') + ' to ' + (s.end ?? '?')));
  const cols = 'Columns: time="' + cfg.timeColumn + '", value="' + cfg.valueColumn + '"'
    + (cfg.unit ? ', unit: ' + cfg.unit : '')
    + (cfg.resampled ? ' · resampled to a ' + cfg.resampled.stepMs + ' ms grid (' + cfg.resampled.agg + ')' : '');
  box.appendChild(el('p', cols)).className = 'muted';
  box.appendChild(el('p', 'Regular grid: ' + (s.regular ? 'yes (' + s.stepMs + ' ms)' : 'no — check timestamps or resample')
    + ' · applicable methods: ' + (d.applicable.join(', ') || 'none'))).className = 'muted';
  if (d.issues.length === 0) {
    box.appendChild(el('p', 'Clean — no duplicates, gaps, outliers, or missing values.'));
  } else {
    box.appendChild(el('p', d.issues.length + ' quality note(s):'));
    box.appendChild(table(
      ['#', 'Type', 'Detail'],
      d.issues.slice(0, 50).map((iss, i) => [i + 1, iss.type, iss.message]),
    ));
    if (d.issues.length > 50) box.appendChild(el('p', 'Showing 50 of ' + d.issues.length + ' notes.')).className = 'muted';
  }
  show('card-quality');
}

function renderCompare(d) {
  const box = $('compare');
  box.innerHTML = '';
  if (!d.backtest) {
    box.appendChild(el('p', 'No method applies to this data (too short, or set a season length).')).className = 'muted';
    show('card-compare');
    return;
  }
  const bt = d.backtest;
  box.appendChild(el('p', d.reading));
  box.appendChild(table(
    ['Method', 'RMSE', 'MAE', 'MAPE %', 'sMAPE %', 'MASE'],
    bt.results.map((r) => [r.title, num(r.rmse), num(r.mae), num(r.mape), num(r.smape), num(r.mase)]),
    (r, i) => i === 0,
  ));
  const note = box.appendChild(el('p', 'Held out the last ' + bt.testSize + ' points and forecast them blind. Lowest RMSE wins; MASE below 1 beats a naive baseline.'));
  note.className = 'muted';
  show('card-compare');
}
function renderForecast(d) {
  const f = d.forecast;
  const box = $('forecast');
  box.innerHTML = '';
  const head = el('p');
  head.textContent = d.reading;
  if (d.autoSelected) {
    const tag = el('span', ' · method: ' + f.title + ' (auto-selected by backtest)');
    head.appendChild(tag);
  }
  box.appendChild(head);
  
  // Interactive chart with hover and toggles
  const chartContainer = el('div');
  chartContainer.className = 'chart interactive';
  chartContainer.id = 'interactive-chart';
  
  // Method comparison toggle overlay
  const overlay = el('div');
  overlay.className = 'chart-overlay';
  overlay.id = 'method-overlay';
  overlay.hidden = true;
  
  const overlayTitle = el('h3', 'Compare Methods');
  overlay.appendChild(overlayTitle);
  
  const compareTable = table(
    ['Method', 'RMSE', 'MAE', 'Status'],
    d.backtest?.results.map((r) => [
      r.title, 
      num(r.rmse),
      d.backtest.best === r.method ? '<strong>Winner</strong>' : '✗'
    ])
  );
  overlay.appendChild(compareTable);
  
  const closeOverlay = el('button', 'Close');
  closeOverlay.onclick = () => { overlay.hidden = true; };
  overlay.appendChild(closeOverlay);
  
  chartContainer.appendChild(overlay);
  chartContainer.innerHTML = d.chart;
  box.appendChild(chartContainer);
  
  // Make chart interactive with hover tooltips
  makeChartInteractive(chartContainer, d.stepMs, f.steps);
  
  const showRows = f.steps.slice(0, 100);
  box.appendChild(table(
    ['Step', 'Time', 'Forecast', 'Lower ' + f.interval + '%', 'Upper ' + f.interval + '%'],
    showRows.map((s) => [s.step, s.time ? shortLabel(s.time, d.stepMs) : '+' + s.step, num(s.point), num(s.lower), num(s.upper)]),
  ));
  if (f.steps.length > showRows.length) {
    const more = box.appendChild(el('p', 'Showing first ' + showRows.length + ' of ' + f.steps.length + ' steps.'));
    more.className = 'muted';
  }
  show('card-forecast');

  const c = d.card;
  $('method-title').textContent = 'Method: ' + c.title;
  const m = $('method-card');
  m.innerHTML = '';
  m.appendChild(el('p', c.summary));
  const math = el('p');
  math.className = 'math';
  math.textContent = c.math;
  m.appendChild(math);
  const useWhen = el('p');
  useWhen.appendChild(el('b', 'Use when: '));
  useWhen.appendChild(document.createTextNode(c.useWhen));
  m.appendChild(useWhen);
  const watch = el('p');
  watch.appendChild(el('b', 'Watch out: '));
  watch.appendChild(document.createTextNode(c.pitfalls));
  m.appendChild(watch);
  show('card-method');
  
  // Add download button if we have data
  if ($('data').value) {
    const downloadBtn = $('forecast').appendChild(el('button', 'Download Project File'));
    downloadBtn.className = 'primary';
    downloadBtn.style.marginTop = '16px';
    downloadBtn.onclick = downloadProjectFile;
  }
}

// Make SVG chart interactive with hover tooltips and method comparison toggle
function makeChartInteractive(container, stepMs, forecastSteps) {
  const svg = container.querySelector('svg');
  if (!svg) return;
  
  // Get dimensions
  const rect = svg.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 300;
  
  // Create tooltip
  const tooltip = el('div');
  tooltip.className = 'chart-tooltip';
  tooltip.style.cssText = 'position:absolute;background:#1f2937;color:white;padding:8px 12px;border-radius:6px;font-size:12px;display:none;z-index:1000;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
  document.body.appendChild(tooltip);
  
  // Add hover functionality
  svg.addEventListener('mousemove', (e) => {
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Find closest data point
    const timePoints = svg.querySelectorAll('.time-point');
    let closest = null;
    let minDist = Infinity;
    
    timePoints.forEach((tp) => {
      const tpX = parseFloat(tp.getAttribute('cx'));
      const dist = Math.abs(x - tpX);
      if (dist < minDist && dist < 30) {
        minDist = dist;
        closest = tp;
      }
    });
    
    if (closest) {
      const dataIndex = parseInt(closest.getAttribute('data-index'), 10);
      const pointVal = closest.getAttribute('data-value');
      const timeISO = closest.getAttribute('data-time');
      
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 10) + 'px';
      tooltip.style.top = (e.clientY - 10) + 'px';
       const timeText = timeISO ? shortLabel(timeISO, stepMs) : 'n/a';
       tooltip.innerHTML = '&lt;strong&gt;Time:&lt;/strong&gt; ' + timeText + '&lt;br&gt;' + '&lt;strong&gt;Value:&lt;/strong&gt; ' + num(pointVal);
    } else {
      tooltip.style.display = 'none';
    }
  });
  
  svg.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
  
  // Add legend with method toggles
  const legend = el('div');
  legend.className = 'chart-legend';
  legend.style.cssText = 'margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;';
  
  const leftSide = el('div');
  leftSide.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;';
  
  const methods = [
    { key: 'history', label: 'Historical Data', color: '#3b82f6' },
    { key: 'forecast', label: 'Forecast', color: '#10b981' },
    { key: 'lower', label: 'Lower Bound', color: '#fbbf24' },
    { key: 'upper', label: 'Upper Bound', color: '#fbbf24' },
  ];
  
  methods.forEach(m => {
    const item = el('label');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;';
    
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.visible = m.key;
    checkbox.onchange = () => toggleChartSeries(svg, m.key, checkbox.checked);
    
    const swatch = el('span');
    swatch.style.cssText = 'width:12px;height:12px;border-radius:2px;background:' + m.color;
    
    item.appendChild(swatch);
    item.appendChild(checkbox);
    item.appendChild(document.createTextNode(m.label));
    leftSide.appendChild(item);
  });
  
  const rightSide = el('div');
  rightSide.style.cssText = 'display:flex;gap:8px;';
  
  const compareBtn = el('button');
  compareBtn.textContent = 'Compare Methods';
  compareBtn.onclick = () => {
    overlay.hidden = !overlay.hidden;
  };
  rightSide.appendChild(compareBtn);
  
  legend.appendChild(leftSide);
  legend.appendChild(rightSide);
  container.parentNode.appendChild(legend);
}

function toggleChartSeries(svg, seriesKey, visible) {
  const selector = '.' + seriesKey;
  svg.querySelectorAll(selector).forEach(el => {
    el.style.display = visible ? 'block' : 'none';
  });
}

function applyConfig(cfg) {
  const set = (id, v) => {
    if (v !== null && v !== undefined && String(v) !== '') $(id).value = v;
  };
  set('name', cfg.name); set('unit', cfg.unit);
  set('time', cfg.timeColumn); set('value', cfg.valueColumn);
  set('season', cfg.seasonLength); set('horizon', cfg.horizon);
  set('interval', cfg.interval); set('testSize', cfg.testSize);
  set('seasonality', cfg.seasonality); set('agg', cfg.agg); set('step', cfg.step);
  $('damped').checked = !!cfg.damped;
  $('resample').checked = !!cfg.resample;
}

async function action(name, fn) {
  clearError();
  busy(true);
  try { fn(await api(name, false)); } catch (e) { showError(e.message); }
  finally { busy(false); }
}

async function runAll(apply) {
  clearError();
  busy(true);
  try {
    const s = await api('summary', apply); renderSummary(s, apply);
    const c = await api('compare', false); renderCompare(c);
    const f = await api('forecast', false); renderForecast(f);
  } catch (e) { showError(e.message); }
  finally { busy(false); }
}

async function loadExamples() {
  let body;
  try {
    const res = await fetch(new URL('api/examples', location.href), { headers: { accept: 'application/json' } });
    body = await res.json();
  } catch { return; }
  const sel = $('examples');
  for (const ex of body.examples) {
    const o = el('option', ex.name);
    o.value = ex.project;
    sel.appendChild(o);
  }
  sel.disabled = body.examples.length === 0;
}

function prefill() {
  const d = BOOT.defaults;
  const set = (id, v) => { if (v !== undefined && v !== null && String(v) !== '') $(id).value = v; };
  set('data', d.data); set('project', d.project);
  set('name', d.name); set('unit', d.unit);
  set('time', d.time); set('value', d.value);
  set('season', d.season); set('horizon', d.horizon);
  set('interval', d.interval); set('testSize', d.testSize);
  set('method', d.method); set('seasonality', d.seasonality);
  set('agg', d.agg); set('step', d.step);
  $('damped').checked = d.damped === true || d.damped === 'true';
  $('resample').checked = d.resample === true || d.resample === 'true';
}

$('btn-check').onclick = () => action('summary', (d) => renderSummary(d, false));
$('btn-compare').onclick = () => action('compare', renderCompare);
$('btn-forecast').onclick = () => action('forecast', renderForecast);
$('btn-all').onclick = () => runAll(false);
// Phase 5 Visualizations
$('btn-simulation').onclick = async () => { try { const u=new URL('api/simulation',location.href);u.searchParams.set('token',BOOT.token);const r=await fetch(u,{headers:{accept:'application/json'}});const d=await r.json();$('card-simulation').hidden=false;const c=$('simulation-viz');c.innerHTML='';if(d.error){c.appendChild(el('p','Error:'+d.error));return} if(!d.simulation){c.appendChild(el('p','No data'));return} c.appendChild(el('p',d.simulation.numPaths+' paths')).style.marginTop='12px'; }; catch(e) { showError(e.message) } };

$('btn-scenarios').onclick = async () => { try { const u=new URL('api/scenarios',location.href);u.searchParams.set('token',BOOT.token);const r=await fetch(u,{headers:{accept:'application/json'}});const d=await r.json();$('card-scenarios').hidden=false;const c=$('scenarios-viz');c.innerHTML='';if(d.error){c.appendChild(el('p','Error:'+d.error));return} const s=d.scenarios||{};if(Object.keys(s).length===0){c.appendChild(el('p','No templates'));}else{Object.entries(s).forEach(([t,n])=>{c.appendChild(el('p',t+':'+(Array.isArray(n)?n.length:'?')))});}}catch(e){showError(e.message)} };
$('examples').onchange = (e) => {
  const project = e.target.value;
  if (!project) return;
  $('project').value = project;
  $('data').value = '';
  runAll(true);
};

$('project').onchange = () => {
  $('csv-upload').value = '';
  $('data').value = '';
};

$('serverinfo').textContent = 'Listening on ' + location.host + ' · forecastlab ' + BOOT.version + ' · re-reads your file on every request';
let liveSource=null;
$('btn-live').onclick = async () => { try {
  const st = await (await fetch(new URL('api/stream/status',location.href),{headers:{accept:'application/json'}})).json();
  $('card-live').hidden=false;
  const box=$('live-status');
  if(!st.enabled){ box.textContent = st.hint || 'Streaming disabled.'; return; }
  box.textContent = 'Live: ' + ((st.series||[]).join(', ')||'no series yet') + ' · mode ' + st.mode;
  if(liveSource) liveSource.close();
  const mod = await import(new URL('streaming-chart.js',location.href).href);
  const chart = new mod.StreamingChart($('live-chart'),{title:'Live forecast'});
  const hist=[];
  liveSource = new EventSource(new URL('api/stream/events',location.href).href);
  liveSource.onmessage = (e) => { try {
    const ev=JSON.parse(e.data);
    if(ev.type==='update'&&ev.point){
      hist.push({t:ev.point.t,v:ev.point.value}); if(hist.length>200)hist.shift();
      const fc=ev.forecast||[]; const lastT=hist.length?hist[hist.length-1].t:Date.now();
      const step=hist.length>1?Math.max(1,hist[hist.length-1].t-hist[hist.length-2].t):60000;
      chart.update({history:hist,forecast:fc,lower:ev.lower||[],upper:ev.upper||[],horizonTimes:fc.map((_,i)=>lastT+(i+1)*step)});
      box.textContent='Live: '+ev.seriesId+' · '+(ev.method||'?')+' · '+(ev.recomputed?('recomputed ('+ev.reason+')'):'cached')+' · '+((ev.alerts||[]).length)+' alerts';
    }
    if(ev.type==='alert'&&ev.alert){ const c=$('live-alerts'); const p=el('p','['+ev.alert.level+'] '+ev.alert.message); p.style.margin='4px 0'; c.prepend(p); while(c.children.length>8)c.lastChild.remove(); }
  } catch(err){} };
  liveSource.onerror=()=>{ box.textContent='Live connection lost. Press Live stream to reconnect.'; };
} catch(e){ showError(e.message) } };
prefill();
loadExamples();
if (BOOT.defaults.data || BOOT.defaults.project) runAll(true);
`;
}
