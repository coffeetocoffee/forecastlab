// Hierarchical reconciliation visualization for multi-level forecasting
// Shows forecast relationships across different aggregation levels

/**
 * Hierarchical Reconciliation Visualization Component
 * Displays tree structure of forecasts and reconciliation flows
 */
export class HierarchicalReconciliationChart {
  constructor(options = {}) {
    this.container = options.container;
    this.width = options.width || 800;
    this.height = options.height || 600;
    this.margin = options.margin || { top: 20, right: 30, bottom: 50, left: 150 };
    this.showValues = options.showValues !== false;
    this.methodName = options.methodName || 'bottom-up';
    
    this.svg = null;
    this.treemapData = null;
  }

  /**
   * Render hierarchical reconciliation chart
   */
  render(data) {
    const { hierarchy, forecasts, reconciled } = data;
    
    // Clear existing content
    if (this.svg) {
      this.svg.remove();
    }
    
    // Transform data to treemap format
    this.treemapData = this.transformToTreemap(hierarchy, forecasts, reconciled);
    
    // Create SVG container
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .attr('class', 'hierarchical-reconciliation');
    
    // Create groups
    const gBackground = this.svg.append('g').attr('class', 'background');
    const gNodes = this.svg.append('g').attr('class', 'nodes');
    const gLinks = this.svg.append('g').attr('class', 'links');
    const gLabels = this.svg.append('g').attr('class', 'labels');
    
    // Calculate treemap layout
    const treemapLayout = d3.tree()
      .size([this.width - this.margin.left - this.margin.right, 
            this.height - this.margin.top - this.margin.bottom]);
    
    const rootHierarchy = d3.hierarchy(this.treemapData.root)
      .sum(d => d.value)
      .sort((a, b) => b.value - a.value);
    
    const treemap = d3.treemap()
      .size([this.width - this.margin.left - this.margin.right, 
            this.height - this.margin.top - this.margin.bottom])
      .padding(2);
    
    treemap(rootHierarchy);
    
    // Draw links (parent-child relationships)
    this.drawLinkStructure(gLinks, rootHierarchy);
    
    // Draw nodes (aggregation levels)
    this.drawNodes(gNodes, rootHierarchy);
    
    // Add labels and values
    this.drawLabels(gLabels, rootHierarchy);
    
    // Add method explanation
    this.addMethodExplanation(gLabels);
    
    return this;
  }
  
  transformToTreemap(hierarchy, forecasts, reconciled) {
    // Convert flat hierarchy structure to nested treemap format
    const nodeMap = new Map();
    
    // Create root node
    const root = {
      id: 'root',
      name: 'Total',
      level: 'total',
      children: [],
      value: 0,
      forecast: null,
      reconciled: null
    };
    
    nodeMap.set('root', root);
    
    // Process each series in the hierarchy
    hierarchy.series.forEach(series => {
      const node = {
        id: series.id,
        name: series.name,
        level: series.level,
        children: [],
        value: series.values.reduce((sum, v) => sum + Math.abs(v), 0),
        forecast: forecasts[series.id],
        reconciled: reconciled[series.id]
      };
      
      nodeMap.set(series.id, node);
      
      // Find parent
      if (series.parentId) {
        const parent = nodeMap.get(series.parentId);
        if (parent) {
          parent.children.push(node);
          parent.value += node.value;
        }
      } else {
        root.children.push(node);
      }
    });
    
    return { root };
  }
  
  drawLinkStructure(g, root) {
    const linkGenerator = d3.linkHorizontal()
      .x(d => d.x)
      .y(d => d.y);
    
    const links = root.links();
    
    const linkPath = g.selectAll('.link-path')
      .data(links.filter(l => l.source.data.id !== 'root'))
      .enter()
      .append('path')
      .attr('class', 'link-path')
      .attr('d', d => linkGenerator({
        x: d.target.x,
        y: d.target.y
      }))
      .attr('fill', 'none')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);
  }
  
  drawNodes(g, root) {
    const colorScale = d3.scaleSequential(d3.interpolateBlues)
      .domain([0, Math.max(...root.leaves().map(l => l.data.value))]);
    
    const node = g.selectAll('.node')
      .data(root.leaves())
      .enter()
      .append('rect')
      .attr('class', 'node')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => d.x1 - d.x)
      .attr('height', d => d.y1 - d.y)
      .attr('fill', d => {
        const level = d.data.level;
        if (level === 'total') {
          return '#1e40af'; // darkest blue
        } else if (level === 'aggregate') {
          return '#3b82f6'; // medium blue
        } else {
          return '#93c5fd'; // light blue
        }
      })
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1)
      .style('opacity', 0.9)
      .on('mouseover', (event, d) => {
        this.showNodeTooltip(event, d);
      })
      .on('mouseout', () => {
        this.hideTooltip();
      });
  }
  
  drawLabels(g, root) {
    const label = g.selectAll('.node-label')
      .data(root.leaves())
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('x', d => d.x + 8)
      .attr('y', d => d.y + d.dy / 2)
      .attr('dy', '.35em')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .attr('fill', '#1f2937')
      .text(d => d.data.name);
    
    // Add values at end of each node
    if (this.showValues) {
      const valueLabel = g.selectAll('.node-value')
        .data(root.leaves())
        .enter()
        .append('text')
        .attr('class', 'node-value')
        .attr('x', d => d.x1 - 8)
        .attr('y', d => d.y + 14)
        .attr('font-size', '10px')
        .attr('fill', '#6b7280')
        .text(d => this.formatNumber(d.data.value));
    }
  }
  
  addMethodExplanation(g) {
    const explanations = [
      {
        type: 'bottom-up',
        description: 'Bottom-up: Forecast at most granular level, then sum up'
      },
      {
        type: 'top-down',
        description: 'Top-down: Forecast total, then distribute down'
      },
      {
        type: 'middle-out',
        description: 'Middle-out: Forecast from middle level in both directions'
      },
      {
        type: 'optimal',
        description: 'Optimal: Weighted average of all approaches'
      }
    ];
    
    const currentMethod = explanations.find(m => m.type === this.methodName) || explanations[0];
    
    g.append('text')
      .attr('class', 'method-explanation')
      .attr('x', this.margin.left)
      .attr('y', this.height - this.margin.bottom + 30)
      .attr('font-size', '12px')
      .attr('fill', '#6b7280')
      .text(currentMethod.description);
  }
  
  showNodeTooltip(event, d) {
    const data = d.data;
    let html = `<strong>${data.name}</strong>`;
    
    if (data.forecast && data.reconciled) {
      html += `<br/><br/>Original Forecast: ${this.formatNumber(data.forecast.point[-1])}`;
      html += `<br/>Reconciled: ${this.formatNumber(data.reconciled.point[-1])}`;
      
      const diffPercent = ((data.reconciled.point[-1] - data.forecast.point[-1]) / 
                          Math.abs(data.forecast.point[-1])) * 100;
      
      html += `<br/>Adjustment: ${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%`;
    }
    
    this.tooltip.style('display', 'block')
      .html(html);
  }
  
  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.style('display', 'none');
    }
  }
  
  formatNumber(num) {
    if (Math.abs(num) >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    } else if (Math.abs(num) >= 100) {
      return num.toFixed(0);
    } else {
      return num.toFixed(2);
    }
  }
  
  update(data) {
    this.render(data);
    return this;
  }
}

/**
 * Top-down Tree Chart for hierarchical forecasting
 */
export class TopDownTreeChart {
  constructor(options = {}) {
    this.container = options.container;
    this.data = options.data;
  }
  
  render() {
    const { hierarchy, forecasts } = this.data;
    
    // Parse hierarchy structure
    const root = this.parseHierarchy(hierarchy);
    
    // Draw tree
    const svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.options?.width || 800)
      .attr('height', this.options?.height || 600);
    
    const treeLayout = d3.tree()
      .size([svg.node().width - 60, svg.node().height - 40]);
    
    const hierarchyObj = d3.hierarchy(root)
      .sum(d => d.value);
    
    treeLayout(hierarchyObj);
    
    // Draw links
    const linkGenerator = d3.linkVertical()
      .x(d => d.x)
      .y(d => d.y);
    
    svg.selectAll('.link')
      .data(hierarchyObj.links())
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('d', d => linkGenerator({
        x: d.target.x,
        y: d.target.y
      }))
      .attr('fill', 'none')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);
    
    // Draw nodes
    svg.selectAll('.node')
      .data(hierarchyObj.descendants())
      .enter()
      .append('rect')
      .attr('x', d => d.x - 10)
      .attr('y', d => d.y - 8)
      .attr('width', 20)
      .attr('height', 16)
      .attr('fill', d => d.depth === 0 ? '#1e40af' : '#3b82f6')
      .attr('stroke', '#fff');
    
    return svg;
  }
  
  parseHierarchy(hierarchyData) {
    // Recursively build tree structure
    const buildNode = (nodeData) => {
      const node = {
        id: nodeData.id,
        name: nodeData.name,
        value: nodeData.value || 0,
        children: []
      };
      
      if (nodeData.children && Array.isArray(nodeData.children)) {
        node.children = nodeData.children.map(child => buildNode(child));
      }
      
      return node;
    };
    
    return buildNode(hierarchyData);
  }
}

/**
 * Compute optimal weights for optimal reconciliation
 */
export function computeOptimalWeights(forecasts, covarianceMatrix) {
  const n = Object.keys(forecasts).length;
  
  // Get variance-covariance matrix diagonals (variances)
  const variances = Object.values(covarianceMatrix).flat();
  
  // Optimal weights = inverse of covariance matrix times vector of ones
  // Simplified: use inverse variance weighting
  
  const weights = {};
  let totalWeight = 0;
  
  Object.entries(forecasts).forEach(([id, forecast]) => {
    const variance = varianceOfSeries(forecast);
    const weight = 1 / variance;
    weights[id] = weight;
    totalWeight += weight;
  });
  
  // Normalize weights to sum to 1
  Object.keys(weights).forEach(id => {
    weights[id] /= totalWeight;
  });
  
  return weights;
}

function varianceOfSeries(forecast) {
  const mean = d3.mean(forecast.points);
  const squaredDiffs = forecast.points.map(p => Math.pow(p - mean, 2));
  return d3.mean(squaredDiffs);
}

export default HierarchicalReconciliationChart;
