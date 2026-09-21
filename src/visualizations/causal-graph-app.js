// Browser application for the causal graph view.
//
// This file is never imported by Node. src/visualizations/causal-graph.js
// reads it as text and inlines it into the HTML page, right after the causal
// module and a small preamble that defines SERIES, OPTIONS, NAMES and
// SEED_EDGES. Keeping it as its own file means escape sequences and regexes
// survive the trip into the browser untouched.

const svg = document.getElementById('canvas');
const svgNS = 'http://www.w3.org/2000/svg';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const state = {
  pos: {},
  edges: SEED_EDGES.map((e) => JSON.parse(JSON.stringify(e))),
  selected: null,
  pending: null,
  drag: null,
};

function size() {
  const r = svg.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function layout() {
  const { w, h } = size();
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.36;
  NAMES.forEach((name, i) => {
    const a = (i / NAMES.length) * Math.PI * 2 - Math.PI / 2;
    if (!state.pos[name]) state.pos[name] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
}

const NODE_W = 132;
const NODE_H = 46;

function nodeShape(g, name) {
  const s = SERIES[name];
  const meanV = s.reduce((a, b) => a + b, 0) / s.length;
  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('x', -NODE_W / 2);
  rect.setAttribute('y', -NODE_H / 2);
  rect.setAttribute('width', NODE_W);
  rect.setAttribute('height', NODE_H);
  rect.setAttribute('rx', 10);
  rect.setAttribute('fill', '#ffffff');
  rect.setAttribute('stroke', '#111827');
  rect.setAttribute('stroke-width', 1.5);
  g.appendChild(rect);
  const t = document.createElementNS(svgNS, 'text');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('y', -2);
  t.setAttribute('font-size', 13);
  t.setAttribute('font-weight', 600);
  t.setAttribute('pointer-events', 'none');
  t.textContent = name;
  g.appendChild(t);
  const v = document.createElementNS(svgNS, 'text');
  v.setAttribute('text-anchor', 'middle');
  v.setAttribute('y', 14);
  v.setAttribute('font-size', 11);
  v.setAttribute('fill', '#6b7280');
  v.setAttribute('pointer-events', 'none');
  v.textContent = 'mean ' + fmtNum(meanV);
  g.appendChild(v);
  // Link handle: drag from here onto another node to test a hypothesis.
  const handle = document.createElementNS(svgNS, 'circle');
  handle.setAttribute('cx', NODE_W / 2 - 2);
  handle.setAttribute('cy', 0);
  handle.setAttribute('r', 7);
  handle.setAttribute('fill', '#10b981');
  handle.setAttribute('stroke', '#ffffff');
  handle.setAttribute('stroke-width', 2);
  handle.style.cursor = 'crosshair';
  const hint = document.createElementNS(svgNS, 'title');
  hint.textContent = 'Drag to another variable to test a relationship';
  handle.appendChild(hint);
  g.appendChild(handle);
}

function edgeColor(e) {
  return e.significant ? '#10b981' : '#9ca3af';
}

function edgeWidth(e) {
  return 1.2 + 4.5 * Math.max(0, Math.min(1, e.confidence || 0));
}

function anchor(from, to) {
  // Trim the line to the node rectangle boundary.
  const a = state.pos[from];
  const b = state.pos[to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const hx = (dx / len) * (NODE_W / 2 + 4);
  const hy = (dy / len) * (NODE_H / 2 + 4);
  return { x1: a.x + hx, y1: a.y + hy, x2: b.x - hx, y2: b.y - hy };
}

function render() {
  svg.innerHTML = '';
  const defs = document.createElementNS(svgNS, 'defs');
  const colors = [['arr', '#10b981'], ['arrMute', '#9ca3af']];
  for (const [id, color] of colors) {
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', 8);
    marker.setAttribute('refY', 5);
    marker.setAttribute('markerWidth', 7);
    marker.setAttribute('markerHeight', 7);
    marker.setAttribute('orient', 'auto-start-reverse');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    path.setAttribute('fill', color);
    marker.appendChild(path);
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  const gEdges = document.createElementNS(svgNS, 'g');
  svg.appendChild(gEdges);
  const gPending = document.createElementNS(svgNS, 'g');
  svg.appendChild(gPending);
  const gNodes = document.createElementNS(svgNS, 'g');
  svg.appendChild(gNodes);

  for (const e of state.edges) {
    if (!state.pos[e.from] || !state.pos[e.to]) continue;
    const p = anchor(e.from, e.to);
    const mx = (p.x1 + p.x2) / 2;
    const my = (p.y1 + p.y2) / 2;
    const dx = p.x2 - p.x1;
    const dy = p.y2 - p.y1;
    const len = Math.hypot(dx, dy) || 1;
    // Curve the link so direction and labels read clearly.
    const bow = Math.min(46, len * 0.18);
    const cxp = mx + (-dy / len) * bow;
    const cyp = my + (dx / len) * bow;
    const d = 'M' + p.x1 + ',' + p.y1 + ' Q' + cxp + ',' + cyp + ' ' + p.x2 + ',' + p.y2;

    const hit = document.createElementNS(svgNS, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', 16);
    hit.style.cursor = 'pointer';
    hit.dataset.edge = e.id;
    hit.addEventListener('click', () => select(e.id));
    gEdges.appendChild(hit);

    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', edgeColor(e));
    line.setAttribute('stroke-width', edgeWidth(e));
    line.setAttribute('marker-end', 'url(#' + (e.significant ? 'arr' : 'arrMute') + ')');
    line.setAttribute('pointer-events', 'none');
    if (state.selected === e.id) line.setAttribute('stroke-dasharray', '7,4');
    gEdges.appendChild(line);

    const labelG = document.createElementNS(svgNS, 'g');
    labelG.setAttribute('pointer-events', 'none');
    const label = 'lag ' + e.lag + ' · r=' + fmtNum(e.correlation);
    const tw = label.length * 6.6 + 16;
    const chip = document.createElementNS(svgNS, 'rect');
    chip.setAttribute('x', cxp - tw / 2);
    chip.setAttribute('y', cyp - 11);
    chip.setAttribute('width', tw);
    chip.setAttribute('height', 20);
    chip.setAttribute('rx', 10);
    chip.setAttribute('fill', '#ffffff');
    chip.setAttribute('stroke', edgeColor(e));
    chip.setAttribute('stroke-width', e.significant ? 1.6 : 1);
    labelG.appendChild(chip);
    const lt = document.createElementNS(svgNS, 'text');
    lt.setAttribute('x', cxp);
    lt.setAttribute('y', cyp + 4);
    lt.setAttribute('text-anchor', 'middle');
    lt.setAttribute('font-size', 11.5);
    lt.setAttribute('fill', e.significant ? '#065f46' : '#4b5563');
    lt.textContent = label;
    labelG.appendChild(lt);
    if (e.feedback) {
      const fb = document.createElementNS(svgNS, 'text');
      fb.setAttribute('x', cxp);
      fb.setAttribute('y', cyp - 16);
      fb.setAttribute('text-anchor', 'middle');
      fb.setAttribute('font-size', 10);
      fb.setAttribute('fill', '#b45309');
      fb.textContent = 'feedback?';
      labelG.appendChild(fb);
    }
    gEdges.appendChild(labelG);
  }

  for (const name of NAMES) {
    const pos = state.pos[name];
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('transform', 'translate(' + pos.x + ',' + pos.y + ')');
    g.dataset.name = name;
    nodeShape(g, name);
    g.style.cursor = 'grab';
    g.addEventListener('pointerdown', (ev) => startDrag(ev, name, g));
    gNodes.appendChild(g);
  }
  renderPending(gPending);
  renderTable();
}

function renderPending(layer) {
  layer.innerHTML = '';
  if (!state.pending) return;
  const from = state.pos[state.pending.from];
  const line = document.createElementNS(svgNS, 'line');
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y);
  line.setAttribute('x2', state.pending.x);
  line.setAttribute('y2', state.pending.y);
  line.setAttribute('stroke', '#10b981');
  line.setAttribute('stroke-width', 2);
  line.setAttribute('stroke-dasharray', '5,5');
  layer.appendChild(line);
}

function svgPoint(ev) {
  const r = svg.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function startDrag(ev, name, g) {
  if (ev.target.classList && ev.target.classList.contains('handle')) {
    state.pending = { from: name, x: state.pos[name].x, y: state.pos[name].y };
    ev.preventDefault();
    return;
  }
  const pt = svgPoint(ev);
  const pos = state.pos[name];
  state.drag = { name, dx: pt.x - pos.x, dy: pt.y - pos.y, moved: false };
  g.style.cursor = 'grabbing';
  ev.preventDefault();
}

svg.addEventListener('pointermove', (ev) => {
  const pt = svgPoint(ev);
  if (state.drag) {
    const pos = state.pos[state.drag.name];
    pos.x = Math.max(NODE_W / 2, Math.min(svg.clientWidth - NODE_W / 2, pt.x - state.drag.dx));
    pos.y = Math.max(NODE_H / 2, Math.min(svg.clientHeight - NODE_H / 2, pt.y - state.drag.dy));
    state.drag.moved = true;
    render();
  } else if (state.pending) {
    state.pending.x = pt.x;
    state.pending.y = pt.y;
    render();
  }
});

window.addEventListener('pointerup', (ev) => {
  if (state.pending) {
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    const g = target && target.closest ? target.closest('g') : null;
    const to = g && g.dataset ? g.dataset.name : null;
    const from = state.pending.from;
    state.pending = null;
    if (to && to !== from) testHypothesis(from, to);
    render();
  }
  if (state.drag) {
    // A click without moving selects the node's strongest link.
    if (!state.drag.moved) {
      const best = state.edges
        .filter((e) => e.from === state.drag.name || e.to === state.drag.name)
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (best) select(best.id);
    }
    state.drag = null;
    render();
  }
});

function testHypothesis(from, to) {
  const graph = new CausalGraph(SERIES);
  const edge = graph.testRelationship(from, to, OPTIONS);
  if (!edge) {
    flash('Not enough data to test ' + from + ' -> ' + to);
    return;
  }
  const existing = state.edges.findIndex((e) => e.id === edge.id);
  if (existing >= 0) state.edges[existing] = edge;
  else state.edges.push(edge);
  state.edges.sort((a, b) => b.confidence - a.confidence);
  select(edge.id);
  flash(
    edge.significant
      ? 'Link tested: ' + from + ' -> ' + to + ' is significant (p=' + fmtP(edge.pValue) + ')'
      : 'Link tested: ' + from + ' -> ' + to + ' is NOT significant (p=' + fmtP(edge.pValue) + ')'
  );
}

function select(id) {
  state.selected = id;
  render();
}

function flash(msg) {
  const el = document.getElementById('flash');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => {
    el.style.opacity = 0;
  }, 3200);
}

function describe(e) {
  if (!e) return '';
  const dir = Number.isFinite(e.effect) ? (e.effect >= 0 ? 'raises' : 'lowers') : 'moves';
  return (
    e.from +
    ' ' +
    dir +
    ' ' +
    e.to +
    ' by ' +
    fmtNum(Math.abs(e.effect)) +
    ' per unit, peaking ' +
    e.lag +
    ' step(s) earlier.'
  );
}

function renderTable() {
  const tbl = document.getElementById('edgeTable');
  const rows = state.edges
    .map((e) => {
      const from = e.direction === 'reverse' ? '(' + e.from + ')' : e.from;
      const conf = Math.round((e.confidence || 0) * 100) + (e.feedback ? '% (feedback?)' : '%');
      return (
        '<tr class="row' +
        (state.selected === e.id ? ' sel' : '') +
        '" data-id="' +
        e.id +
        '"><td>' +
        esc(from) +
        ' → ' +
        esc(e.to) +
        '</td><td>' +
        e.lag +
        '</td><td>' +
        fmtNum(e.correlation) +
        '</td><td>' +
        fmtNum(e.effect) +
        '</td><td>' +
        fmtP(e.pValue) +
        '</td><td>' +
        conf +
        '</td></tr>'
      );
    })
    .join('');
  tbl.innerHTML =
    '<thead><tr><th>Link</th><th>Lag</th><th>r</th><th>Effect</th><th>p</th><th>Conf.</th></tr></thead><tbody>' +
    (rows ||
      '<tr><td colspan="6" class="muted">No links found. Drag from a node&#39;s green handle to another node to test one.</td></tr>') +
    '</tbody>';
  for (const tr of tbl.querySelectorAll('tr.row')) {
    tr.addEventListener('click', () => select(tr.dataset.id));
  }
  renderDetails();
}

function renderDetails() {
  const box = document.getElementById('details');
  const e = state.edges.find((x) => x.id === state.selected);
  if (!e) {
    box.innerHTML =
      '<h2>Link details</h2><p class="muted">Click a link in the graph or a row in the table. ' +
      'Drag from a node&#39;s green handle onto another node to test a hypothesis of your own.</p>';
    return;
  }
  const rows = [
    ['Link', esc(e.from) + ' → ' + esc(e.to)],
    ['Description', describe(e)],
    ['Best lag', e.lag + ' step(s)'],
    ['Correlation', fmtNum(e.correlation)],
    ['Effect per unit', fmtNum(e.effect) + ' (' + e.to + ' per ' + e.from + ')'],
    ['Granger F', fmtNum(e.fStat) + ' (df ' + (e.grangerDf ? e.grangerDf.join(',') : '?') + ')'],
    ['p-value', fmtP(e.pValue)],
    ['Significant', e.significant ? 'yes, at α=' + (e.alpha || 0.05) : 'no'],
    ['Sign stability', Math.round((e.stability || 0) * 100) + '% of sub-periods agree'],
    ['Observations', e.nUsed],
  ];
  box.innerHTML =
    '<h2>Link details</h2>' +
    rows
      .map((r) => '<div class="kv"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>')
      .join('') +
    '<div class="kv"><span>Confidence</span><b>' +
    Math.round((e.confidence || 0) * 100) +
    '%</b></div>' +
    '<div class="bar"><i style="width:' +
    Math.round((e.confidence || 0) * 100) +
    '%"></i></div>' +
    (e.directionNote ? '<p class="muted" style="color:#92400e">' + esc(e.directionNote) + '</p>' : '') +
    lagProfileSvg(e);
}

function lagProfileSvg(e) {
  if (!e.lagProfile || e.lagProfile.length === 0) return '';
  const w = 320;
  const h = 120;
  const pad = 26;
  const n = e.lagProfile.length;
  const bw = (w - pad * 2) / n;
  let bars = '';
  for (let i = 0; i < n; i++) {
    const p = e.lagProfile[i];
    const r = Math.max(-1, Math.min(1, Number.isFinite(p.r) ? p.r : 0));
    const bh = Math.abs(r) * ((h - pad * 2) / 2);
    const x = pad + i * bw + 1;
    const y = r >= 0 ? h / 2 - bh : h / 2;
    const sig = Number.isFinite(p.p) && p.p < (e.alpha || 0.05);
    const fill = i === e.lag ? (sig ? '#10b981' : '#f59e0b') : sig ? '#6ee7b7' : '#d1d5db';
    bars +=
      '<rect x="' +
      x.toFixed(1) +
      '" y="' +
      y.toFixed(1) +
      '" width="' +
      (bw - 2).toFixed(1) +
      '" height="' +
      Math.max(bh, 1).toFixed(1) +
      '" fill="' +
      fill +
      '"/>';
  }
  return (
    '<h2 style="margin-top:14px">Correlation vs lag</h2>' +
    '<svg viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '" style="width:100%;height:auto" aria-label="lag profile">' +
    '<line x1="' +
    pad +
    '" y1="' +
    h / 2 +
    '" x2="' +
    (w - pad) +
    '" y2="' +
    h / 2 +
    '" stroke="#9ca3af"/>' +
    bars +
    '<text x="' +
    pad +
    '" y="14" font-size="10" fill="#6b7280">positive r</text>' +
    '<text x="' +
    pad +
    '" y="' +
    (h - 6) +
    '" font-size="10" fill="#6b7280">negative r</text>' +
    '<text x="' +
    (w - pad) +
    '" y="' +
    (h / 2 - 6) +
    '" font-size="10" fill="#6b7280" text-anchor="end">lag ' +
    (n - 1) +
    '</text></svg>' +
    '<p class="muted">Green = significant at this lag, amber = the selected lag, pale = not significant.</p>'
  );
}

layout();
render();
window.addEventListener('resize', () => {
  layout();
  render();
});
