// Live streaming charts for the ForecastLab workbench.
// Browser-only: requires d3 as a global (loaded from CDN by serve.js,
// same convention as the other visualization components). Importing this
// module in Node is safe; only calling its classes needs d3 + a DOM.

function needD3() {
  if (typeof d3 === 'undefined') throw new Error('StreamingChart needs the d3 global (loaded from CDN by the workbench)');
  return d3;
}

/**
 * Live line chart: history plus a forecast with confidence bands.
 * Call update() as new points arrive; old points scroll out past maxPoints,
 * and the band path re-renders so intervals visibly expand/shrink.
 */
export class StreamingChart {
  constructor(container, options = {}) {
    this.container = container;
    this.width = options.width ?? 720;
    this.height = options.height ?? 260;
    this.margin = options.margin ?? { top: 12, right: 12, bottom: 28, left: 48 };
    this.maxPoints = options.maxPoints ?? 200;
    this.title = options.title ?? 'Live forecast';
    this.svg = null;
  }

  render(state) {
    const d3 = needD3();
    const history = (state.history ?? []).slice(-this.maxPoints);
    const forecast = state.forecast ?? [];
    const lower = state.lower ?? [];
    const upper = state.upper ?? [];
    const horizonTimes = state.horizonTimes ?? [];

    d3.select(this.container).selectAll('*').remove();
    const w = this.width;
    const h = this.height;
    const m = this.margin;
    const iw = w - m.left - m.right;
    const ih = h - m.top - m.bottom;

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', w)
      .attr('height', h)
      .attr('class', 'streaming-chart')
      .attr('role', 'img');

    this.svg.append('text')
      .attr('x', m.left)
      .attr('y', 14)
      .attr('font-size', 13)
      .attr('font-weight', 600)
      .text(this.title);

    const g = this.svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    this.plot = g;
    this._draw(history, forecast, lower, upper, horizonTimes, iw, ih, false);
    return this;
  }

  update(state) {
    if (!this.svg) return this.render(state);
    const d3 = needD3();
    const history = (state.history ?? []).slice(-this.maxPoints);
    const forecast = state.forecast ?? [];
    const lower = state.lower ?? [];
    const upper = state.upper ?? [];
    const horizonTimes = state.horizonTimes ?? [];
    const iw = this.width - this.margin.left - this.margin.right;
    const ih = this.height - this.margin.top - this.margin.bottom;
    this.plot.selectAll('*').remove();
    this._draw(history, forecast, lower, upper, horizonTimes, iw, ih, true);
    return this;
  }

  _draw(history, forecast, lower, upper, horizonTimes, iw, ih, animate) {
    const d3 = needD3();
    const g = this.plot;
    const allX = [...history.map((p) => p.t), ...horizonTimes];
    const allY = [...history.map((p) => p.v), ...forecast, ...lower, ...upper].filter(Number.isFinite);
    if (allX.length === 0 || allY.length === 0) {
      g.append('text').attr('x', 8).attr('y', 20).attr('fill', '#6b7280').text('Waiting for data…');
      return;
    }
    const x = d3.scaleTime().domain(d3.extent(allX)).range([0, iw]);
    const pad = (d3.max(allY) - d3.min(allY)) * 0.08 || 1;
    const y = d3.scaleLinear().domain([d3.min(allY) - pad, d3.max(allY) + pad]).range([ih, 0]);

    g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat('%H:%M')));
    g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.2f')));

    // Confidence band (re-rendered every update so it breathes with the data)
    if (forecast.length > 0 && lower.length === forecast.length && upper.length === forecast.length) {
      const band = d3.area()
        .x((_, i) => x(horizonTimes[i] ?? allX[allX.length - 1]))
        .y0((_, i) => y(lower[i]))
        .y1((_, i) => y(upper[i]))
        .curve(d3.curveMonotoneX);
      const bandSel = g.append('path').datum(forecast).attr('fill', '#93c5fd').attr('opacity', 0.45).attr('d', band);
      if (animate) bandSel.attr('opacity', 0).transition().duration(400).attr('opacity', 0.45);
    }

    if (history.length > 1) {
      const line = d3.line().x((p) => x(p.t)).y((p) => y(p.v)).curve(d3.curveMonotoneX);
      const lineSel = g.append('path').datum(history).attr('fill', 'none').attr('stroke', '#111827').attr('stroke-width', 1.8).attr('d', line);
      if (animate) {
        const total = lineSel.node().getTotalLength();
        lineSel.attr('stroke-dasharray', total).attr('stroke-dashoffset', total)
          .transition().duration(400).attr('stroke-dashoffset', 0).on('end', () => lineSel.attr('stroke-dasharray', null));
      }
    }

    if (forecast.length > 0) {
      const fline = d3.line()
        .x((_, i) => x(horizonTimes[i] ?? allX[allX.length - 1]))
        .y((v) => y(v))
        .curve(d3.curveMonotoneX);
      g.append('path').datum(forecast).attr('fill', 'none').attr('stroke', '#2563eb').attr('stroke-width', 1.8).attr('stroke-dasharray', '5 3').attr('d', fline);
    }

    if (history.length > 0) {
      const last = history[history.length - 1];
      g.append('circle').attr('cx', x(last.t)).attr('cy', y(last.v)).attr('r', 3.5).attr('fill', '#dc2626');
    }
  }
}

/**
 * Sparkline: a tiny trend indicator for dashboards.
 * Colors the last-value dot by recent direction (up green / down red / flat gray).
 */
export class Sparkline {
  constructor(container, options = {}) {
    this.container = container;
    this.width = options.width ?? 120;
    this.height = options.height ?? 32;
    this.maxPoints = options.maxPoints ?? 60;
  }

  update(values) {
    const d3 = needD3();
    const data = (values ?? []).slice(-this.maxPoints);
    d3.select(this.container).selectAll('*').remove();
    const svg = d3.select(this.container).append('svg')
      .attr('width', this.width).attr('height', this.height).attr('class', 'sparkline');
    if (data.length < 2) {
      svg.append('text').attr('x', 4).attr('y', this.height / 2 + 4).attr('font-size', 10).attr('fill', '#9ca3af').text('—');
      return this;
    }
    const x = d3.scaleLinear().domain([0, data.length - 1]).range([2, this.width - 4]);
    const lo = d3.min(data);
    const hi = d3.max(data);
    const span = hi - lo || 1;
    const y = d3.scaleLinear().domain([lo, hi]).range([this.height - 4, 4]);
    const line = d3.line().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX);
    svg.append('path').datum(data).attr('fill', 'none').attr('stroke', '#374151').attr('stroke-width', 1.5).attr('d', line);
    const first = data[0];
    const last = data[data.length - 1];
    const dir = last > first + span * 0.02 ? '#16a34a' : last < first - span * 0.02 ? '#dc2626' : '#9ca3af';
    svg.append('circle').attr('cx', x(data.length - 1)).attr('cy', y(last)).attr('r', 3).attr('fill', dir);
    svg.append('text').attr('x', this.width - 4).attr('y', 10).attr('text-anchor', 'end').attr('font-size', 10).attr('fill', dir)
      .text(last > first ? '▲' : last < first ? '▼' : '●');
    return this;
  }
}

/** Build history/forecast view-model from an engine update event. */
export function eventToViewModel(event, maxHistory = 200) {
  const history = (event.history ?? []).slice(-maxHistory).map((p) => ({ t: p.t, v: p.value }));
  if (event.point) history.push({ t: event.point.t, v: event.point.value });
  const forecast = event.forecast ?? [];
  const lower = event.lower ?? [];
  const upper = event.upper ?? [];
  const lastT = history.length > 0 ? history[history.length - 1].t : Date.now();
  const step = history.length > 1 ? Math.max(1, history[history.length - 1].t - history[history.length - 2].t) : 60000;
  const horizonTimes = forecast.map((_, i) => lastT + (i + 1) * step);
  return { history, forecast, lower, upper, horizonTimes };
}
