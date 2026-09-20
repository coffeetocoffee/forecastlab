// Price elasticity scenarios for different product categories
// Models price sensitivity and demand response

/**
 * Price Elasticity Scenario Generator
 */
export class PriceElasticityScenarios {
  constructor(options = {}) {
    this.categories = options.categories || [];
    this.basePrice = options.basePrice || 100;
    this.priceHistory = options.priceHistory || [];
    
    // Default elasticity by category
    this.categoryElasticities = {
      'grocery': -1.2,
      'electronics': -0.8,
      'clothing': -1.5,
      'luxury': -0.5,
      'basics': -0.3,
      'promotional': -2.0,
      'subscription': -0.4
    };
  }

  /**
   * Generate all price elasticity scenarios
   */
  generateScenarios(baselineData) {
    const scenarios = [];
    
    // Core pricing scenarios
    scenarios.push(this.priceIncreaseScenario(baselineData));
    scenarios.push(this.priceDecreaseScenario(baselineData));
    scenarios.push(this.dynamicPricingScenario(baselineData));
    
    // Category-specific scenarios
    if (baselineData.products || baselineData.categories) {
      scenarios.push(this.categoryPricingScenario(baselineData));
    }
    
    return scenarios;
  }

  /**
   * Price increase scenario - analyze impact of raising prices
   */
  priceIncreaseScenario(data) {
    const { forecast, elasticity } = data;
    const priceIncrement = 0.05; // 5% increments
    
    const adjustedForecast = [...forecast];
    const priceChanges = [];
    
    // Simulate gradual price increases over forecast horizon
    const numIncrements = Math.min(6, Math.floor(data.horizon / 7));
    
    for (let i = 0; i < numIncrements; i++) {
      const cumulativeIncrease = (i + 1) * priceIncrement;
      
      // Apply across a week period
      const weekStart = i * 7;
      const effectiveElasticity = this.getEffectiveElasticity(elasticity, cumulativeIncrease);
      const demandImpact = effectiveElasticity * cumulativeIncrease;
      
      for (let j = 0; j < 7 && weekStart + j < adjustedForecast.length; j++) {
        adjustedForecast[weekStart + j] *= (1 + demandImpact);
        
        priceChanges.push({
          dayOffset: weekStart + j,
          priceChange: cumulativeIncrease,
          demandImpact: demandImpact
        });
      }
    }
    
    return {
      name: 'Price Increase Analysis',
      id: 'price-increase',
      description: 'Gradual price increases and their demand impacts',
      baseAdjustment: null,
      adjustments: priceChanges,
      metadata: {
        type: 'increase',
        totalIncrease: numIncrements * priceIncrement,
        incrementStep: priceIncrement,
        elasticities: {
          initial: elasticity,
          average: effectiveElasticity
        }
      }
    };
  }

  /**
   * Price decrease scenario - competitive pricing or promotions
   */
  priceDecreaseScenario(data) {
    const { forecast, elasticity } = data;
    
    const adjustedForecast = [...forecast];
    const priceChanges = [];
    
    // Simulate discount strategy
    const discountSteps = [-0.05, -0.10, -0.15]; // 5%, 10%, 15% discounts
    
    discountSteps.forEach((discount, idx) => {
      const weekStart = idx * 7;
      const demandImpact = elasticity * discount;
      
      for (let j = 0; j < 7 && weekStart + j < adjustedForecast.length; j++) {
        adjustedForecast[weekStart + j] *= (1 + demandImpact);
        
        priceChanges.push({
          dayOffset: weekStart + j,
          priceChange: discount,
          demandImpact: demandImpact
        });
      }
    });
    
    return {
      name: 'Price Decrease Strategy',
      id: 'price-decrease',
      description: 'Discount-driven sales stimulation',
      baseAdjustment: null,
      adjustments: priceChanges,
      metadata: {
        type: 'decrease',
        maxDiscount: discountSteps[discountSteps.length - 1],
        elasticities: {
          initial: elasticity,
          average: elasticity
        }
      }
    };
  }

  /**
   * Dynamic pricing scenario - real-time price optimization
   */
  dynamicPricingScenario(data) {
    const { forecast, seasonality, peakHours } = data;
    
    const adjustedForecast = [...forecast];
    
    // Simulate dynamic pricing based on demand patterns
    adjustedForecast.forEach((value, index) => {
      // Base demand factor
      let demandFactor = 1.0;
      
      // Seasonal adjustment
      if (seasonality && seasonality[index]) {
        demandFactor *= seasonality[index];
      }
      
      // Peak pricing multiplier
      const isPeak = peakHours?.includes(index % 24) || false;
      const pricingMultiplier = isPeak ? 1.15 : 0.9; // +15% peak, -10% off-peak
      
      // Demand-based pricing (higher demand → higher prices)
      if (index > 0) {
        const trend = value / forecast[index - 1];
        if (trend > 1.05) {
          // High demand: increase prices
          adjustedForecast[index] *= 1.05;
        } else if (trend < 0.95) {
          // Low demand: decrease prices
          adjustedForecast[index] *= 0.95;
        }
      }
      
      // Apply overall effect
      adjustedForecast[index] *= pricingMultiplier;
    });
    
    return {
      name: 'Dynamic Pricing Optimization',
      id: 'dynamic-pricing',
      description: 'Real-time pricing based on demand signals',
      baseAdjustment: 1.15,
      adjustments: [],
      metadata: {
        type: 'dynamic',
        peakMultiplier: 1.15,
        offPeakMultiplier: 0.9,
        threshold: 1.05
      }
    };
  }

  /**
   * Category-specific pricing - different elasticities per product
   */
  categoryPricingScenario(data) {
    const { products, forecasts, elasticityByCategory } = data;
    
    const adjustedForecasts = {};
    const scenarioAdjustments = [];
    
    Object.entries(products).forEach(([productId, product]) => {
      const baseElasticity = this.categoryElasticities[product.category] || -1.0;
      const categoryElasticity = elasticityByCategory?.[product.category] || baseElasticity;
      
      // Simulate promotional pricing for specific categories
      const promoDiscount = product.promoWeeks ? 
        Array(product.promoWeeks).fill(-0.10) : 
        [-0.05]; // Standard 5% discount
      
      const originalForecast = forecasts[productId];
      const adjustedForecast = [...originalForecast];
      
      promoDiscount.forEach((discount, idx) => {
        const weekStart = idx * 7;
        const demandEffect = categoryElasticity * discount;
        
        for (let i = 0; i < 7 && weekStart + i < adjustedForecast.length; i++) {
          adjustedForecast[weekStart + i] *= (1 + demandEffect);
          
          scenarioAdjustments.push({
            productId,
            category: product.category,
            dayOffset: weekStart + i,
            discount,
            demandEffect
          });
        }
      });
      
      adjustedForecasts[productId] = {
        original: originalForecast,
        adjusted: adjustedForecast,
        elasticity: categoryElasticity
      };
    });
    
    return {
      name: 'Multi-Category Pricing Strategy',
      id: 'category-pricing',
      description: 'Category-specific pricing with varied elasticities',
      baseAdjustment: null,
      adjustments: scenarioAdjustments,
      metadata: {
        categoryElasticities: {},
        products: Object.keys(products).length
      }
    };
  }

  getEffectiveElasticity(baseElasticity, priceChange) {
    // Elasticity becomes more extreme at larger price changes
    const k = 0.5; // Sensitivity parameter
    return baseElasticity * (1 + k * Math.abs(priceChange));
  }

  calculateRevenueImpact(prices, quantities, basePrices, baseQuantities) {
    const currentRevenue = prices.reduce((sum, p, i) => sum + p * quantities[i], 0);
    const baseRevenue = basePrices.reduce((sum, p, i) => sum + p * baseQuantities[i], 0);
    
    return {
      absolute: currentRevenue - baseRevenue,
      percent: ((currentRevenue - baseRevenue) / baseRevenue) * 100,
      quantityChange: ((quantities.reduce((s, q) => s + q, 0) - 
                        baseQuantities.reduce((s, q) => s + q, 0)) / 
                       baseQuantities.reduce((s, q) => s + q, 0)) * 100
    };
  }

  findOptimalPrice(basePrice, elasticity, targetQuantityRatio) {
    // Find price that achieves desired quantity change
    // Q_new = Q_base * (P_new/P_base)^elasticity
    // Solve for P_new: P_new = P_base * (Q_new/Q_base)^(1/elasticity)
    
    const requiredQuantityChange = targetQuantityRatio - 1;
    const priceChange = Math.pow(1 + requiredQuantityChange, 1 / elasticity);
    
    return basePrice * priceChange;
  }
}

/**
 * Product Category Data Structure
 */
export class ProductCategory {
  constructor(name, elasticity) {
    this.name = name;
    this.elasticity = elasticity;
    this.products = new Map();
    this.historicalData = [];
  }

  addProduct(product) {
    this.products.set(product.id, product);
  }

  getAverageElasticity() {
    if (this.products.size === 0) return this.elasticity;
    
    const values = Array.from(this.products.values())
      .map(p => p.elasticity || this.elasticity);
    
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

/**
 * Cross-Price Elasticity Calculator
 * Measures how product A's demand responds to product B's price changes
 */
export class CrossPriceElasticity {
  constructor() {
    this.crossElasticities = new Map();
  }

  /**
   * Calculate cross-price elasticity from historical data
   */
  calculateCrossElasticity(priceSeriesA, priceSeriesB, quantitySeriesA) {
    if (priceSeriesA.length !== priceSeriesB.length || 
        priceSeriesA.length !== quantitySeriesA.length) {
      throw new Error('Input arrays must have same length');
    }
    
    const n = priceSeriesA.length;
    
    // Calculate percentage changes
    const dPriceA = [];
    const dPriceB = [];
    const dQtyA = [];
    
    for (let i = 1; i < n; i++) {
      dPriceA.push((priceSeriesA[i] - priceSeriesA[i-1]) / priceSeriesA[i-1]);
      dPriceB.push((priceSeriesB[i] - priceSeriesB[i-1]) / priceSeriesB[i-1]);
      dQtyA.push((quantitySeriesA[i] - quantitySeriesA[i-1]) / quantitySeriesA[i-1]);
    }
    
    // Calculate correlation between %ΔPriceB and %ΔQtyA
    const avgDPriceB = dPriceB.reduce((a, b) => a + b, 0) / dPriceB.length;
    const avgDQtyA = dQtyA.reduce((a, b) => a + b, 0) / dQtyA.length;
    
    let covariance = 0;
    let varianceB = 0;
    
    for (let i = 0; i < dPriceB.length; i++) {
      covariance += (dPriceB[i] - avgDPriceB) * (dQtyA[i] - avgDQtyA);
      varianceB += (dPriceB[i] - avgDPriceB) ** 2;
    }
    
    const crossElasticity = covariance / varianceB;
    
    this.crossElasticities.set(`${priceSeriesA.length}`, crossElasticity);
    
    return crossElasticity;
  }

  /**
   * Get complementary vs substitute relationship
   */
  getRelationshipType(crossElasticity) {
    if (crossElasticity > 0.1) {
      return { type: 'substitute', strength: 'strong' };
    } else if (crossElasticity > 0) {
      return { type: 'substitute', strength: 'weak' };
    } else if (crossElasticity < -0.1) {
      return { type: 'complementary', strength: 'strong' };
    } else if (crossElasticity < 0) {
      return { type: 'complementary', strength: 'weak' };
    } else {
      return { type: 'unrelated', strength: 'none' };
    }
  }
}

export default PriceElasticityScenarios;
