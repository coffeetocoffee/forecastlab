// D3.js-based joint prediction band chart for Monte Carlo simulations
// Shows multiple confidence bands and individual forecast paths
// Requires d3 (loaded as a global by the served workbench UI)

/**
 * Joint Prediction Band Chart Component
 * Visualizes Monte Carlo simulation results with percentile bands
 */
export class PredictionBandChart {
  constructor(options = {}) {
    this.container = options.container;
    this.width = options.width || 800;
    this.height = options.height || 400;
    this.margin = options.margin || { top: 20, right: 30, bottom: 50, left: 70 };
    this.colorScale = options.colorScale || d3.scaleSequential(d3.interpolateBlues);
    this.showConfidenceBands = options.showConfidenceBands !== false;
    this.showIndividualPaths = options.showIndividualPaths || false;
    this.numSamplePaths = options.numSamplePaths || 50;
    this.confidenceLevels = options.confidenceLevels || [50, 80, 95];
    this.onHover = options.onHover || null;
    this.onZoom = options.onZoom || null;
    
    this.svg = null;
    this.tooltip = null;
    this.zoomTransform = null;
  }

  /**
   * Render the chart with historical data and Monte Carlo forecasts
   */
  render(data) {
    const { history, forecast, percentiles, timestamps } = data;
    
    // Clear existing content
    if (this.svg) {
      this.svg.remove();
    }
    
    // Create tooltip
    this.createTooltip();
    
    // Create SVG container
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .attr('class', 'prediction-band-chart');
    
    // Create groups for different layers
    const gBackground = this.svg.append('g').attr('class', 'background-layers');
    const gGrid = this.svg.append('g').attr('class', 'grid-lines');
    const gAxes = this.svg.append('g').attr('class', 'axes');
    const gBands = this.svg.append('g').attr('class', 'confidence-bands');
    const gHistory = this.svg.append('g').attr('class', 'historical-data');
    const gForecast = this.svg.append('g').attr('class', 'forecast-data');
    const gPaths = this.svg.append('g').attr('class', 'individual-paths');
    const gAnnotations = this.svg.append('g').attr('class', 'annotations');
    
    // Calculate scales
    const xScale = d3.scaleTime()
      .domain(d3.extent(timestamps))
      .range([this.margin.left, this.width - this.margin.right]);
    
    const allValues = [
      ...history.map(h => h.value),
      ...forecast.flat(),
      ...percentiles.map(p => p.values)
        .flat()
        .filter(v => v !== null && Number.isFinite(v))
    ];
    
    const yScale = d3.scaleLinear()
      .domain(d3.extent(allValues).map(v => v * 0.99))
      .range([this.height - this.margin.bottom, this.margin.top]);
    
    // Draw grid lines
    this.drawGrid(gGrid, xScale, yScale);
    
    // Draw axes
    this.drawAxes(gAxes, xScale, yScale);
    
    // Draw historical data
    if (history.length > 0) {
      this.drawHistoricalData(gHistory, history, xScale, yScale);
    }
    
    // Draw prediction bands for each confidence level
    if (this.showConfidenceBands) {
      this.drawPredictionBands(gBands, percentiles, xScale, yScale);
    }
    
    // Draw forecast paths
    this.drawForecast(gForecast, forecast, xScale, yScale);
    
    // Draw sample paths if enabled
    if (this.showIndividualPaths && percentiles[0]?.samplePaths?.length) {
      this.drawSamplePaths(gPaths, percentiles[0].samplePaths, xScale, yScale);
    }
    
    // Add annotations (split point between history and forecast)
    if (history.length > 0 && timestampSplitPoint !== undefined) {
      this.addSplitAnnotation(gAnnotations, timestampSplitPoint, xScale);
    }
    
    // Add event listeners
    this.addEventListeners(history, xScale, yScale);
    
    return this;
  }
  
  createTooltip() {
    if (!this.tooltip) {
      this.tooltip = d3.select('body')
        .append('div')
        .attr('class', 'chart-tooltip prediction-band-tooltip')
        .style('position', 'absolute')
        .style('background', '#1f2937')
        .style('color', 'white')
        .style('padding', '12px')
        .style('border-radius', '8px')
        .style('font-size', '13px')
        .style('box-shadow', '0 4px 12px rgba(0,0,0,0.2)')
        .style('pointer-events', 'none')
        .style('z-index', 1000)
        .style('display', 'none');
    }
  }
  
  drawGrid(g, xScale, yScale) {
    const gridSize = 10;
    
    // Vertical grid lines
    g.selectAll('.grid-vertical')
      .data(xScale.ticks(10))
      .enter()
      .append('line')
      .attr('class', 'grid-vertical')
      .attr('x1', d => xScale(d))
      .attr('x2', d => xScale(d))
      .attr('y1', this.margin.top)
      .attr('y2', this.height - this.margin.bottom)
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);
    
    // Horizontal grid lines
    g.selectAll('.grid-horizontal')
      .data(yScale.ticks(6))
      .enter()
      .append('line')
      .attr('class', 'grid-horizontal')
      .attr('x1', this.margin.left)
      .attr('x2', this.width - this.margin.right)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);
  }
  
  drawAxes(g, xScale, yScale) {
    // Y-axis
    g.append('g')
      .attr('class', 'y-axis')
      .attr('transform', `translate(${this.margin.left},0)`)
      .call(d3.axisLeft(yScale)
        .ticks(6)
        .tickFormat(d3.format('.2f')))
      .call(g => g.select('.domain').attr('stroke', '#e5e7eb'))
      .call(g => g.selectAll('.tick line').attr('stroke', '#e5e7eb'));
    
    g.append('text')
      .attr('class', 'y-axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('y', -this.margin.left + 15)
      .attr('x', -this.height / 2)
      .attr('text-anchor', 'middle')
      .text('Value');
    
    // X-axis
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${this.height - this.margin.bottom})`)
      .call(d3.axisBottom(xScale)
        .ticks(10)
        .tickFormat(d3.timeFormat('%Y-%m-%d')))
      .call(g => g.select('.domain').attr('stroke', '#e5e7eb'))
      .call(g => g.selectAll('.tick line').attr('stroke', '#e5e7eb'));
    
    g.append('text')
      .attr('class', 'x-axis-label')
      .attr('x', this.width / 2)
      .attr('y', this.height - this.margin.bottom + 35)
      .attr('text-anchor', 'middle')
      .text('Time');
  }
  
  drawHistoricalData(g, history, xScale, yScale) {
    // Line path
    const linePath = d3.line()
      .x(d => xScale(d.time))
      .y(d => yScale(d.value))
      .curve(d3.curveMonotoneX);
    
    g.append('path')
      .datum(history)
      .attr('fill', 'none')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2)
      .attr('d', linePath);
    
    // Data points
    g.selectAll('.history-point')
      .data(history)
      .enter()
      .append('circle')
      .attr('class', 'history-point')
      .attr('cx', d => xScale(d.time))
      .attr('cy', d => yScale(d.value))
      .attr('r', 4)
      .attr('fill', '#3b82f6')
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5);
  }
  
  drawPredictionBands(g, percentiles, xScale, yScale) {
    const colors = {
      50: 'rgba(59, 130, 246, 0.1)',
      80: 'rgba(59, 130, 246, 0.2)',
      95: 'rgba(59, 130, 246, 0.3)'
    };
    
    const opacity = {
      50: 0.5,
      80: 0.3,
      95: 0.15
    };
    
    percentiles.forEach(p => {
      const level = p.level;
      if (!opacity[level]) return;
      
      // Upper bound area
      const upperArea = d3.area()
        .x(d => xScale(d.time))
        .y0(d => yScale(p.upperBound[d.index]))
        .y1(d => yScale(p.lowerBound[d.index]))
        .curve(d3.curveMonotoneX);
      
      g.append('path')
        .datum(p.values)
        .attr('fill', colors[level] || 'rgba(59, 130, 246, 0.2)')
        .attr('fill-opacity', opacity[level])
        .attr('d', upperArea);
      
      // Upper bound line
      const upperLine = d3.line()
        .x(d => xScale(d.time))
        .y(d => yScale(p.upperBound[d.index]))
        .curve(d3.curveMonotoneX);
      
      g.append('path')
        .datum(p.values)
        .attr('fill', 'none')
        .attr('stroke', `hsl(${210 - level * 2}, 70%, 50%)`)
        .attr('stroke-width', 2)
        .attr('d', upperLine);
      
      // Lower bound line
      const lowerLine = d3.line()
        .x(d => xScale(d.time))
        .y(d => yScale(p.lowerBound[d.index]))
        .curve(d3.curveMonotoneX);
      
      g.append('path')
        .datum(p.values)
        .attr('fill', 'none')
        .attr('stroke', `hsl(${210 - level * 2}, 70%, 50%)`)
        .attr('stroke-width', 2)
        .attr('d', lowerLine);
    });
  }
  
  drawForecast(g, forecast, xScale, yScale) {
    const linePath = d3.line()
      .x(d => xScale(d.time))
      .y(d => yScale(d.mean))
      .curve(d3.curveMonotoneX);
    
    g.append('path')
      .datum(forecast)
      .attr('fill', 'none')
      .attr('stroke', '#10b981')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,3')
      .attr('d', linePath);
    
    // Forecast points
    g.selectAll('.forecast-mean')
      .data(forecast)
      .enter()
      .append('circle')
      .attr('class', 'forecast-mean')
      .attr('cx', d => xScale(d.time))
      .attr('cy', d => yScale(d.mean))
      .attr('r', 4)
      .attr('fill', '#10b981')
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5);
  }
  
  drawSamplePaths(g, samplePaths, xScale, yScale) {
    const alphaPalette = d3.quantize(d3.interpolateOpacity, samplePaths.length);
    
    samplePaths.slice(0, this.numSamplePaths).forEach((path, i) => {
      const linePath = d3.line()
        .x(d => xScale(d.time))
        .y(d => yScale(d.value))
        .curve(d3.curveMonotoneX);
      
      g.append('path')
        .datum(path)
        .attr('fill', 'none')
        .attr('stroke', `rgba(59, 130, 246, ${alphaPalette[i]})`)
        .attr('stroke-width', 1)
        .attr('d', linePath);
    });
  }
  
  addSplitAnnotation(g, splitPoint, xScale) {
    g.append('line')
      .attr('x1', xScale(splitPoint))
      .attr('x2', xScale(splitPoint))
      .attr('y1', this.margin.top)
      .attr('y2', this.height - this.margin.bottom)
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');
    
    g.append('text')
      .attr('x', xScale(splitPoint))
      .attr('y', this.margin.top - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f59e0b')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text('Forecast Start');
  }
  
  addEventListeners(history, xScale, yScale) {
    const svg = this.svg;
    
    svg.on('mousemove', event => {
      const [mx, my] = d3.pointer(event);
      const xScaled = xScale.invert(mx);
      const yScaled = yScale.invert(my);
      
      // Find closest time point
      const allTimes = [...history, ...data.forecast].map(d => d.time);
      const closestTime = d3.min(allTimes, t => Math.abs(t - xScaled));
      
      if (closestTime && this.onHover) {
        const hoveredPoint = {
          time: new Date(closestTime),
          value: yScaled
        };
        
        this.tooltip.style('display', 'block')
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 10) + 'px')
          .html(`
            <div style="font-weight:bold;margin-bottom:4px;">${d3.timeFormat('%Y-%m-%d %H:%M')(hoveredPoint.time)}</div>
            <div style="margin-bottom:2px;">Forecast Value</div>
            <div style="font-size:16px;font-weight:bold;color:#10b981;">${yScaled.toFixed(2)}</div>
            <div style="margin-top:4px;border-top:1px solid #4b5563;padding-top:4px;">
              <span style="color:hsl(${210 - 95 * 2}, 70%, 50%);">95% CI</span><br>
              Upper: ${yScaled * 1.15?.toFixed(2) || 'n/a'}<br>
              Lower: ${yScaled * 0.85?.toFixed(2) || 'n/a'}
            </div>
          `);
        
        this.onHover(hoveredPoint);
      } else {
        this.tooltip.style('display', 'none');
      }
    });
    
    svg.on('mouseleave', () => {
      this.tooltip.style('display', 'none');
    });
  }
  
  update(data) {
    this.render(data);
    return this;
  }
}

/**
 * Helper function to create a legend for the prediction band chart
 */
export function createPredictionBandLegend(container, options = {}) {
  const width = options.width || 300;
  const height = options.height || 100;
  const levels = options.levels || [50, 80, 95];
  
  const legend = d3.select(container)
    .append('div')
    .attr('class', 'prediction-band-legend');
  
  const table = legend.append('table')
    .attr('class', 'band-legend-table');
  
  const tbody = table.append('tbody');
  
  levels.forEach(level => {
    const row = tbody.append('tr');
    row.append('td')
      .style('padding', '6px')
      .style('border-right', '1px solid #e5e7eb');
    
    const color = `hsl(${210 - level * 2}, 70%, 50%)`;
    const opacity = level === 95 ? 0.15 : level === 80 ? 0.3 : 0.5;
    
    row.append('td')
      .style('padding', '6px')
      .style('border-left', `4px solid ${color}`)
      .style('background', `${color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`)
      .style('vertical-align', 'middle');
    
    row.append('td')
      .style('padding', '6px')
      .text(`${level}% Confidence Interval`);
  });
  
  return legend;
}

export default PredictionBandChart;
