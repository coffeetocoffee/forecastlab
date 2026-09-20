// Interactive counterfactual sliders for "what-if" scenario analysis
// Allows users to adjust assumptions and see real-time forecast changes

/**
 * Counterfactual Slider Component
 * Enables interactive scenario building with visual feedback
 */
export class CounterfactualSliders {
  constructor(options = {}) {
    this.container = options.container;
    this.scenarios = options.scenarios || [];
    this.onSliderChange = options.onSliderChange || null;
    this.onScenarioApply = options.onScenarioApply || null;
    
    this.sliderElements = [];
    this.activeScenario = null;
  }

  /**
   * Render sliders based on available scenarios and parameters
   */
  render(data) {
    const { baseline, adjustments } = data;
    
    // Clear existing content
    this.clear();
    
    // Create container
    const container = d3.select(this.container)
      .append('div')
      .attr('class', 'counterfactual-sliders');
    
    // Add title
    container.append('h3')
      .text('Counterfactual Analysis - What-If Scenarios')
      .style('font-size', '16px')
      .style('font-weight', 'bold')
      .style('margin-bottom', '16px')
      .style('color', '#1f2937');
    
    // Add description
    container.append('p')
      .text('Adjust the sliders below to explore different scenarios and their impact on your forecast.')
      .style('font-size', '14px')
      .style('color', '#6b7280')
      .style('margin-bottom', '20px');
    
    // Create slider group for each adjustment type
    adjustments.forEach((adjustment, idx) => {
      this.createSliderGroup(container, adjustment, idx, baseline);
    });
    
    // Add reset and apply buttons
    this.createActionButtons(container);
    
    return this;
  }
  
  clear() {
    const container = d3.select(this.container).datum(null);
    container.selectAll('*').remove();
    this.sliderElements = [];
  }
  
  createSliderGroup(container, adjustment, idx, baseline) {
    const group = container.append('div')
      .attr('class', 'slider-group')
      .style('margin-bottom', '24px')
      .style('padding', '16px')
      .style('background', '#f9fafb')
      .style('border-radius', '8px');
    
    // Label section
    const labelSection = group.append('div')
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('margin-bottom', '12px');
    
    labelSection.append('label')
      .style('font-weight', 'bold')
      .style('font-size', '14px')
      .style('color', '#374151')
      .text(adjustment.label);
    
    const valueDisplay = labelSection.append('span')
      .attr('class', 'value-display')
      .style('font-weight', 'bold')
      .style('color', '#10b981')
      .style('font-size', '14px')
      .text(`${this.formatValue(adjustment.value)}${adjustment.unit || ''}`);
    
    // Range info
    const rangeInfo = labelSection.append('span')
      .attr('class', 'range-info')
      .style('font-size', '12px')
      .style('color', '#6b7280')
      .text(`(${this.formatValue(adjustment.min)}${adjustment.unit || ''} to ${this.formatValue(adjustment.max)}${adjustment.unit || ''})`);
    
    // Slider container
    const sliderContainer = group.append('div')
      .attr('class', 'slider-container')
      .style('padding', '12px 0');
    
    // Create slider input
    const slider = sliderContainer.append('input')
      .attr('type', 'range')
      .attr('min', adjustment.min)
      .attr('max', adjustment.max)
      .attr('step', adjustment.step || (adjustment.max - adjustment.min) / 20)
      .attr('value', adjustment.value)
      .attr('data-adjustment-type', adjustment.type)
      .attr('class', 'counterfactual-slider')
      .style('width', '100%')
      .style('height', '8px')
      .style('appearance', 'none')
      .style('background', '#d1d5db')
      .style('border-radius', '4px')
      .on('input', () => this.handleSliderInput(slider, valueDisplay, adjustment))
      .on('change', () => this.handleSliderChange(slider, adjustment));
    
    // Style the slider thumb
    slider.style.setProperty('--thumb-color', adjustment.color || '#10b981');
    slider.style.setProperty('--thumb-size', '20px');
    
    this.addCustomSliderStyles(slider.node());
    
    // Store reference
    this.sliderElements.push({
      element: slider.node(),
      adjustmentType: adjustment.type,
      display: valueDisplay.node(),
      current: adjustment.value
    });
    
    // Add delta visualization
    const deltaVisualization = this.createDeltaVisualization(group, adjustment);
    
    // Show expected impact
    const impactText = group.append('div')
      .attr('class', 'impact-text')
      .style('font-size', '13px')
      .style('color', '#6b7280')
      .style('margin-top', '12px');
    
    this.updateImpactText(impactText, adjustment, baseline);
    
    return group;
  }
  
  addCustomSliderStyles(slider) {
    if (!slider) return;
    
    // Webkit (Chrome, Safari, newer Opera)
    const style = document.createElement('style');
    style.innerHTML = `
      .counterfactual-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: var(--thumb-size, 20px);
        height: var(--thumb-size, 20px);
        background: var(--thumb-color, #10b981);
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        border: 2px solid white;
      }
      
      .counterfactual-slider::-webkit-slider-runnable-track {
        width: 100%;
        height: 8px;
        cursor: pointer;
        background: linear-gradient(to right, var(--thumb-color, #10b981) calc(var(--thumb-value, 50%) * 1%), #d1d5db);
        border-radius: 4px;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  createDeltaVisualization(group, adjustment) {
    const visualization = group.append('div')
      .attr('class', 'delta-visualization')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '12px');
    
    const deltaArrow = visualization.append('div')
      .attr('class', 'delta-arrow')
      .style('display', 'inline-flex')
      .style('align-items', 'center')
      .style('gap', '4px');
    
    deltaArrow.append('svg')
      .attr('width', '24')
      .attr('height', '24')
      .attr('viewBox', '0 0 24 24')
      .style('fill', '#10b981');
    
    deltaArrow.append('path')
      .attr('d', 'M16.015 13.536L15.023 12.545l-4.318 4.318c-.049.049-.129.049-.178 0l-2.172-2.173a.25.25 0 0 1 0-.354l3.541-3.541c.049-.049.129-.049.178 0l2.172 2.172c.392.392 1.029.39 1.418-.002l3.513-3.514a.75.75 0 0 1 1.061 1.061l-3.514 3.514a1.25 1.25 0 0 1-.389.277m1.63-5.913l-2.172-2.173a.25.25 0 0 0-.354 0l-3.541 3.541a.25.25 0 0 0 0 .354l2.172 2.172c.049.049.129.049.178 0l2.173-2.172a.25.25 0 0 0 0-.354l-3.542-3.541a.75.75 0 0 0-1.06 1.06l3.541 3.542a1.25 1.25 0 0 0 .277.389l3.514 3.514a.75.75 0 0 0 1.061-1.061l-3.513-3.514a1.25 1.25 0 0 0-.277-.389z')
      .style('fill', '#10b981');
    
    deltaArrow.append('span')
      .attr('class', 'delta-value')
      .style('font-weight', 'bold')
      .style('color', '#10b981')
      .style('font-size', '18px')
      .text('+0%');
    
    return visualization;
  }
  
  updateImpactText(element, adjustment, baseline) {
    const currentValue = parseFloat(adjustment.value);
    const baselineValue = adjustment.baselineValue || baseline[adjustment.type] || 0;
    const delta = ((currentValue - baselineValue) / baselineValue) * 100;
    const deltaSign = delta > 0 ? '+' : '';
    
    element.text(`Expected impact: ${deltaSign}${delta.toFixed(1)}% relative to baseline`);
  }
  
  handleSliderInput(slider, display, adjustment) {
    const newValue = parseFloat(slider.value);
    adjustment.value = newValue;
    
    // Update display
    display.textContent = `${this.formatValue(newValue)}${adjustment.unit || ''}`;
    
    // Update delta arrow
    const deltaArrow = slider.parentNode.parentNode.querySelector('.delta-value');
    const baselineValue = adjustment.baselineValue || 0;
    const delta = ((newValue - baselineValue) / baselineValue) * 100;
    const color = delta >= 0 ? '#10b981' : '#ef4444';
    const sign = delta > 0 ? '+' : '';
    
    deltaArrow.textContent = `${sign}${delta.toFixed(1)}%`;
    deltaArrow.style.color = color;
    
    // Trigger callback
    if (this.onSliderChange) {
      this.onSliderChange({
        type: adjustment.type,
        oldValue: adjustment.current,
        newValue: newValue,
        delta: delta
      });
      
      adjustment.current = newValue;
    }
  }
  
  handleSliderChange(slider, adjustment) {
    // Finalize change - could trigger full recalculation here
    console.log('Counterfactual adjustment changed:', {
      type: adjustment.type,
      value: parseFloat(slider.value)
    });
  }
  
  formatValue(value) {
    if (Math.abs(value) >= 100) {
      return value.toFixed(1);
    } else if (Math.abs(value) >= 10) {
      return value.toFixed(2);
    } else if (Math.abs(value) >= 1) {
      return value.toFixed(3);
    } else {
      return value.toFixed(4);
    }
  }
  
  createActionButtons(container) {
    const buttonGroup = container.append('div')
      .attr('class', 'action-buttons')
      .style('display', 'flex')
      .style('gap', '12px')
      .style('margin-top', '24px')
      .style('justify-content', 'center');
    
    // Reset button
    const resetBtn = buttonGroup.append('button')
      .attr('class', 'reset-btn')
      .style('padding', '10px 24px')
      .style('border', '1px solid #d1d5db')
      .style('border-radius', '8px')
      .style('background', 'white')
      .style('cursor', 'pointer')
      .style('font-size', '14px')
      .text('Reset to Baseline')
      .on('click', () => this.resetToBaseline());
    
    // Apply scenario button
    const applyBtn = buttonGroup.append('button')
      .attr('class', 'apply-btn')
      .style('padding', '10px 24px')
      .style('border', 'none')
      .style('border-radius', '8px')
      .style('background', '#10b981')
      .style('color', 'white')
      .style('cursor', 'pointer')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .text('Apply Scenario')
      .on('click', () => this.applyCurrentScenario());
    
    // Save preset button
    const savePresetBtn = buttonGroup.append('button')
      .attr('class', 'save-preset-btn')
      .style('padding', '10px 24px')
      .style('border', '1px solid #d1d5db')
      .style('border-radius', '8px')
      .style('background', 'white')
      .style('cursor', 'pointer')
      .style('font-size', '14px')
      .text('Save Preset')
      .on('click', () => this.saveCurrentPreset());
  }
  
  resetToBaseline() {
    this.sliderElements.forEach(({ element, adjustmentType }) => {
      const adjustment = this.adjustments.find(a => a.type === adjustmentType);
      if (adjustment) {
        element.value = adjustment.baselineValue || adjustment.value;
        element.dispatchEvent(new Event('input'));
      }
    });
    
    if (this.onSliderChange) {
      this.onSliderChange({
        type: 'reset',
        values: {}
      });
    }
  }
  
  applyCurrentScenario() {
    const scenarioData = {
      name: `Counterfactual-${new Date().toISOString().slice(0, 10)}`,
      timestamp: new Date().toISOString(),
      adjustments: {}
    };
    
    this.sliderElements.forEach(({ element, adjustmentType }) => {
      scenarioData.adjustments[adjustmentType] = parseFloat(element.value);
    });
    
    if (this.onScenarioApply) {
      this.onScenarioApply(scenarioData);
    }
  }
  
  saveCurrentPreset() {
    // Generate preset name
    const presetName = prompt('Enter a name for this preset:', 'My Custom Scenario');
    if (presetName) {
      const presetData = {
        name: presetName,
        timestamp: new Date().toISOString(),
        sliders: {}
      };
      
      this.sliderElements.forEach(({ element, adjustmentType }) => {
        presetData.sliders[adjustmentType] = parseFloat(element.value);
      });
      
      // In a real implementation, this would save to localStorage
      console.log('Saving preset:', presetData);
      alert('Preset "' + presetName + '" saved!');
    }
  }
  
  loadScenario(scenario) {
    Object.entries(scenario).forEach(([adjustmentType, value]) => {
      const sliderElement = this.sliderElements.find(el => el.adjustmentType === adjustmentType);
      if (sliderElement && sliderElement.element) {
        sliderElement.element.value = value;
        sliderElement.element.dispatchEvent(new Event('input'));
      }
    });
  }
  
  getAdjustedValues() {
    const adjusted = {};
    this.sliderElements.forEach(({ element, adjustmentType }) => {
      adjusted[adjustmentType] = parseFloat(element.value);
    });
    return adjusted;
  }
}

/**
 * Helper function to create counterfactual suggestions based on common business scenarios
 */
export function getSuggestedScenarios(data) {
  const { baseline } = data;
  
  return [
    {
      type: 'promotional_lift',
      label: 'Promotional Lift',
      min: 0,
      max: 50,
      step: 1,
      baselineValue: baseline.promotional_lift?.avg || 15,
      value: baseline.promotional_lift?.avg || 15,
      unit: '%',
      color: '#3b82f6',
      description: 'Increase during promotional periods'
    },
    {
      type: 'price_elasticity',
      label: 'Price Elasticity Impact',
      min: -30,
      max: 20,
      step: 1,
      baselineValue: 0,
      value: 0,
      unit: '%',
      color: '#ef4444',
      description: 'Price change impact on demand'
    },
    {
      type: 'seasonal_adjustment',
      label: 'Seasonal Peak Adjustment',
      min: 0,
      max: 40,
      step: 1,
      baselineValue: baseline.seasonal_strength || 20,
      value: baseline.seasonal_strength || 20,
      unit: '%',
      color: '#8b5cf6',
      description: 'Additional seasonal boost'
    },
    {
      type: 'market_shock',
      label: 'External Shock Factor',
      min: -50,
      max: 0,
      step: 1,
      baselineValue: 0,
      value: 0,
      unit: '%',
      color: '#f59e0b',
      description: 'Negative market events impact'
    },
    {
      type: 'competitor_action',
      label: 'Competitive Pressure',
      min: -30,
      max: 10,
      step: 1,
      baselineValue: -10,
      value: -10,
      unit: '%',
      color: '#ec4899',
      description: 'Competitor pricing/actions impact'
    }
  ];
}

export default CounterfactualSliders;
