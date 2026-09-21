// Sankey diagram for visualizing scenario trees and probability flows
// Shows transitions between different forecast scenarios
// Requires d3 (loaded as a global by the served workbench UI)

/**
 * Scenario Tree Sankey Diagram Component
 * Visualizes multiple forecast scenarios with their probabilities
 */
export class ScenarioTreeSankey {
  constructor(options = {}) {
    this.container = options.container;
    this.width = options.width || 800;
    this.height = options.height || 600;
    this.margin = options.margin || { top: 20, right: 30, bottom: 50, left: 80 };
    this.showLabels = options.showLabels !== false;
    this.showValues = options.showValues !== true;
    this.colorScale = options.colorScale || d3.scaleOrdinal(d3.schemeCategory10);
    this.onNodeClick = options.onNodeClick || null;
    this.onLinkClick = options.onLinkClick || null;
    
    this.svg = null;
    this.tooltip = null;
  }

  /**
   * Render the scenario tree using historical baseline and future scenarios
   */
  render(data) {
    const { baseline, scenarios, timestamps } = data;
    
    // Clear existing content
    if (this.svg) {
      this.svg.remove();
    }
    
    // Create tooltip
    this.createTooltip();
    
    // Transform data into Sankey format
    const sankeyData = this.transformToSankey(baseline, scenarios, timestamps);
    
    // Create SVG container
    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .attr('class', 'scenario-tree-sankey');
    
    // Create groups
    const gBackground = this.svg.append('g').attr('class', 'background');
    const gLinks = this.svg.append('g').attr('class', 'links');
    const gNodes = this.svg.append('g').attr('class', 'nodes');
    const gLabels = this.svg.append('g').attr('class', 'labels');
    
    // Apply Sankey layout
    const sankeyLayout = d3.linkSankey()
      .nodeWidth(15)
      .nodePadding(20)
      .extent([[this.margin.left, this.margin.top], 
               [this.width - this.margin.right, this.height - this.margin.bottom]]);
    
    const sankey = d3.hierarchy(sankeyData.nodes[0])
      .sum(d => d.value || 0)
      .sort((a, b) => b.value - a.value);
    
    sankeyLayout([sankey]);
    
    // Draw links (flows)
    this.drawLinks(gLinks, sankey.links, sankey.nodes);
    
    // Draw nodes
    this.drawNodes(gNodes, sankey.nodes);
    
    // Add labels if enabled
    if (this.showLabels) {
      this.drawLabels(gLabels, sankey.nodes, sankeyLayout);
    }
    
    // Add event listeners
    this.addEventListeners(gLinks, gNodes);
    
    return this;
  }
  
  createTooltip() {
    if (!this.tooltip) {
      this.tooltip = d3.select('body')
        .append('div')
        .attr('class', 'chart-tooltip sankey-tooltip')
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
  
  transformToSankey(baseline, scenarios, timestamps) {
    const nodes = [];
    const links = [];
    let nodeId = 0;
    
    // Baseline node
    nodes.push({
      id: `node-${nodeId++}`,
      name: 'Historical Baseline',
      type: 'baseline',
      value: 1.0,
      timestamp: timestamps[timestamps.length - 1]
    });
    
    // Create scenario nodes for each scenario type
    scenarios.forEach(scenario => {
      const splitIdx = Math.floor(timestamps.length * 0.8); // Split at 80%
      
      // Connection from baseline to each scenario
      nodes.push({
        id: `node-${nodeId++}`,
        name: scenario.name,
        type: 'scenario',
        value: scenario.probability || 0.2,
        timestamp: timestamps[splitIdx],
        metadata: scenario.metadata
      });
      
      links.push({
        source: `node-0`,
        target: `node-${nodeId - 1}`,
        value: scenario.probability || 0.2
      });
    });
    
    // Create time-based columns in Sankey
    const timeSteps = ['Split Point', ...scenarios.map(s => s.name), 'Final'];
    
    return {
      nodes,
      links,
      timeSteps,
      scenarios
    };
  }
  
  drawLinks(g, links, nodes) {
    const colorScale = this.colorScale;
    
    const link = g.selectAll('.link')
      .data(links)
      .enter()
      .append('path')
      .attr('class', 'link')
      .attr('d', d => {
        const path = d3.linkHorizontal()
          .x(d => d.x + d.xOffset)
          .y(d => d.y);
        return path(d);
      })
      .attr('fill', 'none')
      .attr('stroke-width', d => Math.sqrt(d.value * 10))
      .attr('stroke', d => {
        const sourceNode = nodes.find(n => n.id === d.source.id);
        const targetNode = nodes.find(n => n.id === d.target.id);
        
        if (sourceNode.type === 'baseline') {
          return 'rgba(59, 130, 246, 0.3)';
        }
        return colorScale(targetNode.name);
      })
      .attr('opacity', 0.6)
      .on('mouseover', (event, d) => {
        this.showLinkTooltip(event, d);
      })
      .on('mouseout', () => {
        this.hideTooltip();
      })
      .on('click', (event, d) => {
        if (this.onLinkClick) {
          this.onLinkClick(d);
        }
      });
  }
  
  drawNodes(g, nodes) {
    const node = g.selectAll('.node')
      .data(nodes)
      .enter()
      .append('rect')
      .attr('class', 'node')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('height', d => d.dy)
      .attr('width', d => d.dx)
      .attr('fill', d => {
        if (d.data?.type === 'baseline') {
          return '#3b82f6';
        }
        if (d.data?.type === 'scenario') {
          return this.colorScale(d.data.name);
        }
        return '#9ca3af';
      })
      .attr('opacity', 0.8)
      .style('stroke', '#fff')
      .style('stroke-width', 1)
      .on('mouseover', (event, d) => {
        this.showNodeTooltip(event, d);
      })
      .on('mouseout', () => {
        this.hideTooltip();
      })
      .on('click', (event, d) => {
        if (this.onNodeClick) {
          this.onNodeClick(d.data);
        }
      });
  }
  
  drawLabels(g, nodes, sankeyLayout) {
    const label = g.selectAll('.node-label')
      .data(nodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('x', d => d.x + 8)
      .attr('y', d => d.y + d.dy / 2)
      .attr('dy', '.35em')
      .attr('font-size', '12px')
      .attr('fill', '#374151')
      .text(d => {
        if (d.data?.metadata?.probability) {
          return `${d.data.name} (${(d.data.metadata.probability * 100).toFixed(0)}%)`;
        }
        return d.data.name;
      });
  }
  
  showNodeTooltip(event, d) {
    const data = d.data;
    let html = `<strong>${data.name}</strong>`;
    
    if (data.type === 'scenario' && data.metadata) {
      const meta = data.metadata;
      html += `<br/>Probability: ${(meta.probability * 100).toFixed(1)}%`;
      
      if (meta.liftPercentile) {
        html += `<br/>Expected Lift: ${meta.liftPercentile}% vs baseline`;
      }
      
      if (meta.priceChange) {
        html += `<br/>Price Impact: ${meta.priceChange > 0 ? '+' : ''}${(meta.priceChange * 100).toFixed(1)}%`;
      }
      
      if (meta.shockType) {
        html += `<br/>Shock Type: ${meta.shockType}`;
      }
    } else if (data.type === 'baseline') {
      html += `<br/>Historical Data`;
    }
    
    this.tooltip.style('display', 'block')
      .html(html);
  }
  
  showLinkTooltip(event, d) {
    const percentage = (d.value * 100).toFixed(1);
    this.tooltip.style('display', 'block')
      .html(`
        <strong>Scenario Probability Flow</strong><br/>
        Transition weight: ${percentage}%
      `);
  }
  
  hideTooltip() {
    this.tooltip.style('display', 'none');
  }
  
  addEventListeners(gLinks, gNodes) {
    gNodes.selectAll('.node').on('click', (event, d) => {
      // Highlight related links
      const relatedLinks = gLinks.selectAll('.link')
        .filter(link => link.source.id === d.id || link.target.id === d.id);
      
      relatedLinks.transition().duration(200)
        .style('opacity', 1);
      
      gNodes.selectAll('.node')
        .filter(node => node.id !== d.id)
        .transition().duration(200)
        .style('opacity', 0.3);
    });
  }
  
  update(data) {
    this.render(data);
    return this;
  }
}

/**
 * Helper function to create a legend for the scenario tree
 */
export function createScenarioTreeLegend(container, options = {}) {
  const width = options.width || 300;
  const height = options.height || 150;
  const scenarios = options.scenarios || [];
  
  const legend = d3.select(container)
    .append('div')
    .attr('class', 'scenario-tree-legend');
  
  const table = legend.append('table')
    .attr('class', 'scenario-legend-table');
  
  const tbody = table.append('tbody');
  
  // Baseline entry
  tbody.append('tr')
    .append('td')
    .append('div')
    .style('display', 'flex')
    .style('align-items', 'center')
    .style('gap', '8px')
    .style('margin-bottom', '8px')
    .append('div')
    .style('width', '16px')
    .style('height', '16px')
    .style('background', '#3b82f6')
    .style('border-radius', '4px');
  
  tbody.last()
    .append('td')
    .style('vertical-align', 'middle')
    .text('Historical Baseline');
  
  // Scenario entries
  scenarios.forEach(scenario => {
    const row = tbody.append('tr');
    const cell = row.append('td')
      .append('div')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '8px');
    
    cell.append('div')
      .style('width', '16px')
      .style('height', '16px')
      .style('background', scenario.color || d3.schemeCategory10[scenarios.indexOf(scenario)])
      .style('border-radius', '4px');
    
    cell.append('span')
      .style('font-weight', 'bold')
      .text(scenario.name);
    
    if (scenario.probability) {
      cell.append('span')
        .style('color', '#6b7280')
        .style('font-size', '12px')
        .text(`(${(scenario.probability * 100).toFixed(0)}%)`);
    }
    
    row.append('td')
      .style('vertical-align', 'middle')
      .text(scenario.description || '');
  });
  
  return legend;
}

export default ScenarioTreeSankey;
