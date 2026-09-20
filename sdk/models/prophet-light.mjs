/**
 * Prophet-Light Plugin for ForecastLab v3.0
 * A simplified additive forecasting model with trend and seasonality
 */

import { registerModel } from '../core.mjs';

export class ProphetLight {
  #seasonality = {};
  #dualSeasonality = false;
  #baseLevel = 0;
  #trendSlope = 0;
  
  fit(data, params = {}) {
    const values = Array.isArray(data[0]) ? data : data.map(d => d.value);
    
    this.#baseLevel = this._calculateBaseLevel(values);
    
    const seasonalPeriods = params.seasonalities || [24];
    if (Array.isArray(seasonalPeriods)) {
      this.#dualSeasonality = seasonalPeriods.length > 1;
      this._estimateSeasonality(values, seasonalPeriods);
    }
    
    this._estimateTrend(values);
    
    console.log(`Prophet-Light fitted: level=${this.#baseLevel.toFixed(2)}`);
    return this;
  }
  
  forecast(horizon) {
    const predictions = [];
    const lastDateIndex = this._getLastIndex();
    
    for (let h = 1; h <= horizon; h++) {
      const futureDateIndex = lastDateIndex + h;
      const trendValue = this._projectTrend(futureDateIndex);
      
      let seasonalValue = 0;
      if (this.#dualSeasonality) {
        seasonalValue = this._getSeasonalValue(futureDateIndex, 24) + 
                        this._getSeasonalValue(futureDateIndex, 168);
      } else {
        seasonalValue = this._getSeasonalValue(futureDateIndex, Object.keys(this.#seasonality)[0]);
      }
      
      const forecastValue = this.#baseLevel + trendValue + seasonalValue;
      const uncertainty = this._calculateUncertainty(h);
      
      predictions.push({
        value: forecastValue,
        lower: forecastValue - 1.96 * uncertainty,
        upper: forecastValue + 1.96 * uncertainty
      });
    }
    
    return predictions;
  }
  
  explain() {
    return `Prophet-Light uses an additive decomposition approach:

**Formula:** $\hat{y}_t = \text{level} + \text{trend}_t + \text{seasonality}_t$

This model captures:
- **Trend**: Long-term direction (up/down movement)
- **Seasonality**: Repeating patterns (daily, weekly cycles)
- **Noise**: Random variation around the pattern

Best for series with clear seasonal patterns and moderate trends.`;
  }
  
  _calculateBaseLevel(values) {
    const window = Math.min(7, Math.floor(values.length / 10));
    const recent = values.slice(-window);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }
  
  _estimateTrend(values) {
    const windowSize = Math.min(7, Math.floor(values.length / 10));
    const endValues = values.slice(-windowSize);
    const n = endValues.length;
    const x_mean = (n - 1) / 2;
    const y_mean = endValues.reduce((a, b) => a + b, 0) / n;
    
    const numerator = endValues.reduce((sum, y, i) => sum + (i - x_mean) * (y - y_mean), 0);
    const denominator = endValues.reduce((sum, _, i) => sum + Math.pow(i - x_mean, 2), 0);
    
    this.#trendSlope = denominator !== 0 ? numerator / denominator : 0;
  }
  
  _projectTrend(index) {
    if (index === 0) return 0;
    return index * this.#trendSlope * 0.1;
  }
  
  _estimateSeasonality(values, periods) {
    for (const period of periods) {
      this.#seasonality[period] = new Array(period).fill(0);
      const numCycles = Math.floor(values.length / period);
      
      for (let i = 0; i < period; i++) {
        const cycleValues = [];
        for (let c = 0; c < numCycles; c++) {
          const idx = c * period + i;
          if (idx < values.length) {
            cycleValues.push(values[idx]);
          }
        }
        
        this.#seasonality[period][i] = cycleValues.length > 0 
          ? cycleValues.reduce((a, b) => a + b, 0) / cycleValues.length 
          : 0;
      }
    }
  }
  
  _getSeasonalValue(dateIndex, period) {
    const position = ((dateIndex - 1) % period);
    return this.#seasonality[period]?.[position] || 0;
  }
  
  _getLastIndex() {
    return Object.values(this.#seasonality)[0]?.length || 24;
  }
  
  _calculateUncertainty(horizon) {
    // This would need access to this._mean which isn't set - using placeholder
    return horizon * 0.5 + 1;
  }
}

registerModel('prophet-light', ProphetLight, {
  version: '1.0.0',
  description: 'Additive forecasting with trend and seasonality'
});
