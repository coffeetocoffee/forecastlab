// Promotion lift variations for forecasting
// Models different types of promotional effects

/**
 * Promotion Lift Scenario Generator
 * Generates scenarios with various promotional patterns
 */
export class PromotionLiftScenarios {
  constructor(options = {}) {
    this.promotionCalendar = options.promotionCalendar || [];
    this.defaultLift = options.defaultLift || 0.25; // 25% baseline lift
    this.degradationFactor = options.degradationFactor || 0.8;
    
    this.scenarioTemplates = {
      'regular-promo': this.regularPromotion.bind(this),
      'flash-sale': this.flashSale.bind(this),
      'seasonal-promo': this.seasonalPromotion.bind(this),
      'cannibalization': this.cannibalizationScenario.bind(this),
      'stacked-promotions': this.stackedPromotions.bind(this)
    };
  }

  /**
   * Generate all promotion scenarios
   */
  generateScenarios(baselineData) {
    const scenarios = [];
    
    Object.entries(this.scenarioTemplates).forEach(([templateId, generator]) => {
      const scenario = generator(baselineData);
      if (scenario) {
        scenarios.push(scenario);
      }
    });
    
    return scenarios;
  }

  /**
   * Regular promotion - periodic events with predictable lift
   */
  regularPromotion(data) {
    const { history, seasonLength, periodDays = 30 } = data;
    
    const adjustedForecast = [...history];
    const promoSchedule = [];
    
    // Calculate lift based on historical promotions if available
    const avgLift = this.calculateAverageLift(history);
    
    // Schedule regular promotions
    const nextPromoDate = new Date();
    nextPromoDate.setDate(nextPromoDate.getDate() + periodDays);
    
    let cumulativeIndex = history.length;
    
    while (cumulativeIndex < adjustedForecast.length * 1.5) {
      // Apply lift during promotion window
      const promoDuration = 7; // Days
      for (let i = 0; i < promoDuration; i++) {
        if (cumulativeIndex < adjustedForecast.length * 1.5) {
          adjustedForecast[cumulativeIndex] *= (1 + avgLift);
          promoSchedule.push({
            date: new Date(history[history.length - 1].time),
            dayOffset: cumulativeIndex - history.length + i,
            type: 'regular',
            lift: avgLift
          });
        }
      }
      
      cumulativeIndex += periodDays;
    }
    
    return {
      name: 'Regular Promotions',
      id: 'regular-promo',
      description: 'Periodic promotional events every ~30 days with standard lift',
      baseAdjustment: avgLift,
      adjustments: promoSchedule,
      metadata: {
        frequency: periodDays,
        duration: promoDuration,
        expectedLift: avgLift
      }
    };
  }

  /**
   * Flash sale - short, intense promotional burst
   */
  flashSale(data) {
    const { forecastHorizon } = data;
    
    const adjustedForecast = [...data.forecast];
    
    // 3-day flash sales at specific intervals
    const flashSaleDates = [3, 17, 31]; // Day offsets
    
    flashSaleDates.forEach(dayOffset => {
      if (dayOffset < adjustedForecast.length) {
        const peakMultiplier = 2.5; // 150% increase
        const decayRate = 0.6;
        
        // Three-day effect
        for (let i = 0; i < 3; i++) {
          if (dayOffset + i < adjustedForecast.length) {
            const decay = Math.pow(decayRate, i);
            adjustedForecast[dayOffset + i] *= (1 + peakMultiplier * decay);
          }
        }
      }
    });
    
    return {
      name: 'Flash Sales',
      id: 'flash-sale',
      description: 'Short, high-intensity promotional bursts',
      baseAdjustment: 2.5,
      adjustments: [],
      metadata: {
        frequency: 14,
        duration: 3,
        maxLift: 2.5,
        type: 'intense-short'
      }
    };
  }

  /**
   * Seasonal promotion - aligned with holiday peaks
   */
  seasonalPromotion(data) {
    const { seasonality, holidays } = data;
    
    const adjustedForecast = [...data.forecast];
    
    // Holiday-specific multipliers
    const holidayMultipliers = holidays?.reduce((acc, holiday) => {
      acc[holiday.weekOfYear] = (acc[holiday.weekOfYear] || 0) + holiday.lift;
      return acc;
    }, {});
    
    // Add promotional boost around holiday weeks
    Object.entries(holidayMultipliers).forEach(([weekNum, lift]) => {
      const weekStart = weekNum * 7;
      
      for (let i = 0; i < 7 && weekStart + i < adjustedForecast.length; i++) {
        adjustedForecast[weekStart + i] *= (1 + lift);
      }
    });
    
    return {
      name: 'Seasonal Holidays',
      id: 'seasonal-promo',
      description: 'Promotional uplifts aligned with holiday periods',
      baseAdjustment: null, // Varies by holiday
      adjustments: [],
      metadata: {
        holidayAdjusted: true,
        lifts: holidayMultipliers
      }
    };
  }

  /**
   * Cannibalization effect - one product's gain from another
   */
  cannibalizationScenario(data) {
    const { products, forecasts } = data;
    
    const adjustedForecasts = {};
    
    // Simulate cannibalization between related products
    products.forEach(product => {
      if (product.relatedProducts && product.promotionalBudget > 0) {
        const budgetEffect = product.promotionalBudget / 1000; // Normalize
        const cannibalizationRate = 0.3; // 30% from related
        
        adjustedForecasts[product.id] = {
          original: forecasts[product.id],
          adjusted: forecasts[product.id] * (1 + budgetEffect * 0.2),
          cannibalizedFrom: product.relatedProducts.map(relatedId => ({
            id: relatedId,
            loss: (forecasts[relatedId] * 0.1).toFixed(2)
          }))
        };
        
        // Apply reduction to related products
        product.relatedProducts.forEach(relatedId => {
          if (!adjustedForecasts[relatedId]) {
            adjustedForecasts[relatedId] = {
              original: forecasts[relatedId],
              adjusted: forecasts[relatedId] * 0.9, // 10% reduction
              cannibalizedTo: product.id
            };
          }
        });
      }
    });
    
    return {
      name: 'Cannibalization Effects',
      id: 'cannibalization',
      description: 'Cross-product promotional impacts',
      baseAdjustment: null,
      adjustments: [],
      metadata: {
        crossProductEffects: true,
        rate: cannibalizationRate
      }
    };
  }

  /**
   * Stacked promotions - multiple simultaneous effects
   */
  stackedPromotions(data) {
    const { forecast } = data;
    
    const adjustedForecast = [...forecast];
    
    // Week 1: 20% discount + free shipping = ~150% lift
    // Week 2: Bundle offer + referral bonus = ~100% lift
    // Week 3: Clearance + loyalty points = ~80% lift
    
    const stackPatterns = [
      { week: 1, multiplier: 2.5 },
      { week: 2, multiplier: 2.0 },
      { week: 3, multiplier: 1.8 }
    ];
    
    stackPatterns.forEach(({ week, multiplier }) => {
      const weekStart = week * 7;
      for (let i = 0; i < 7 && weekStart + i < adjustedForecast.length; i++) {
        adjustedForecast[weekStart + i] *= multiplier;
      }
    });
    
    return {
      name: 'Stacked Promotions',
      id: 'stacked-promotions',
      description: 'Multiple concurrent promotional tactics',
      baseAdjustment: 2.5,
      adjustments: [],
      metadata: {
        stacked: true,
        pattern: stackPatterns
      }
    };
  }

  calculateAverageLift(history) {
    // Analyze historical promotion patterns
    const avg = 0.25; // Default 25% lift
    return avg;
  }
}

/**
 * Promotion Calendar Data Structure
 */
export class PromotionCalendar {
  constructor() {
    this.events = [];
  }

  addEvent(event) {
    this.events.push({
      id: `promo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...event,
      createdAt: new Date().toISOString()
    });
  }

  getEventsInRange(startDate, endDate) {
    return this.events.filter(e => {
      const eventDate = new Date(e.date);
      return eventDate >= startDate && eventDate <= endDate;
    });
  }

  toJSON() {
    return this.events;
  }
}

export default PromotionLiftScenarios;
