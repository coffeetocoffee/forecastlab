// External shock events: pandemic, weather, policy changes
// Models low-frequency, high-impact forecasting disruptions

/**
 * External Shock Event Generator
 */
export class ExternalShockScenarios {
  constructor(options = {}) {
    this.shockTypes = options.shockTypes || ['pandemic', 'weather', 'policy'];
    this.baseImpacts = options.baseImpacts || {};
    
    this.eventTemplates = {
      'pandemic': this.pandemicScenario.bind(this),
      'weather-event': this.weatherEvent.bind(this),
      'policy-change': this.policyChange.bind(this),
      'natural-disaster': this.naturalDisaster.bind(this),
      'regulatory-change': this.regulatoryChange.bind(this),
      'geopolitical': this.geopoliticalEvent.bind(this)
    };
  }

  /**
   * Generate all shock scenarios
   */
  generateScenarios(baselineData) {
    const scenarios = [];
    
    this.shockTypes.forEach(type => {
      if (this.eventTemplates[type]) {
        const scenario = this.eventTemplates[type](baselineData);
        if (scenario) {
          scenarios.push(scenario);
        }
      }
    });
    
    return scenarios;
  }

  /**
   * Pandemic scenario - global health crisis impact
   */
  pandemicScenario(data) {
    const { forecast, sector } = data;
    
    const adjustedForecast = [...forecast];
    
    // Different impacts by sector
    let baseImpact = 0;
    let recoveryPattern = 'v-shaped';
    
    switch (sector) {
      case 'retail':
        baseImpact = 0.4; // 40% drop initially
        recoveryPattern = 'U-shaped';
        break;
      case 'travel':
        baseImpact = 0.7; // 70% drop
        recoveryPattern = 'L-shaped';
        break;
      case 'e-commerce':
        baseImpact = 0.1; // Slight increase
        recoveryPattern = 'J-shaped';
        break;
      default:
        baseImpact = 0.3;
        recoveryPattern = 'W-shaped';
    }
    
    // Phase 1: Immediate crash (2 months)
    for (let i = 0; i < 60 && i < adjustedForecast.length; i++) {
      const phase1Decay = Math.min(1, (i + 1) / 60);
      adjustedForecast[i] *= (1 - baseImpact * phase1Decay);
    }
    
    // Phase 2: Stalled recovery or fluctuation
    const basePhaseStart = 60;
    for (let i = basePhaseStart; i < Math.min(basePhaseStart + 90, adjustedForecast.length); i++) {
      // Simulate periodic lockdowns
      const isLockdown = (Math.floor(i / 14) % 3 === 0);
      const lockdownImpact = isLockdown ? 0.3 : 0.1;
      
      if (isLockdown) {
        adjustedForecast[i] *= 0.7;
      }
    }
    
    // Phase 3: Recovery
    const recoveryStart = 150;
    if (recoveryPattern === 'V-shaped') {
      // Rapid recovery
      for (let i = recoveryStart; i < adjustedForecast.length; i++) {
        const recoveryProgress = (i - recoveryStart) / 60;
        const recoverFactor = Math.min(1, recoveryProgress);
        adjustedForecast[i] *= (1 + baseImpact * recoverFactor * 0.5);
      }
    } else {
      // Slow or incomplete recovery
      for (let i = recoveryStart; i < Math.min(recoveryStart + 180, adjustedForecast.length); i++) {
        const slowRecovery = 1 - Math.exp(-0.01 * (i - recoveryStart));
        adjustedForecast[i] *= (1 + baseImpact * slowRecovery * 0.3);
      }
    }
    
    return {
      name: 'Pandemic/Health Crisis',
      id: 'pandemic',
      description: 'Global health emergency with multi-phase impact',
      adjustments: [],
      metadata: {
        type: 'pandemic',
        sector: sector,
        phases: {
          initialCrash: { duration: 60, depth: baseImpact },
          stalling: { duration: 90, volatility: 'high' },
          recovery: { pattern: recoveryPattern, speed: recoveryPattern === 'V-shaped' ? 'fast' : 'slow' }
        },
        vaccinationImpact: recoveryPattern !== 'L-shaped',
        longTermShift: sector === 'e-commerce' ? 'permanent-growth' : 'partial-recovery'
      }
    };
  }

  /**
   * Weather event - extreme conditions affecting demand
   */
  weatherEvent(data) {
    const { forecast, location, season } = data;
    
    const adjustedForecast = [...forecast];
    
    // Determine weather event type
    const eventTypes = [
      { type: 'heatwave', duration: 7, severity: 1.3 },
      { type: 'cold-snap', duration: 10, severity: 1.2 },
      { type: 'flood', duration: 14, severity: 0.7 },
      { type: 'drought', duration: 30, severity: 0.8 }
    ];
    
    const event = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    const startDate = Math.floor(Math.random() * (adjustedForecast.length - event.duration));
    
    // Apply weather impact
    for (let i = 0; i < event.duration && startDate + i < adjustedForecast.length; i++) {
      const decay = Math.pow(0.9, i); // Gradual impact building
      const weatherMultiplier = event.severity * decay;
      
      // Adjust based on event type
      if (event.type === 'heatwave') {
        adjustedForecast[startDate + i] *= (season === 'summer' ? weatherMultiplier : 0.7);
      } else if (event.type === 'cold-snap') {
        adjustedForecast[startDate + i] *= (season === 'winter' ? weatherMultiplier : 0.8);
      } else {
        // Flood/drought reduce overall activity
        adjustedForecast[startDate + i] *= weatherMultiplier;
      }
    }
    
    return {
      name: 'Extreme Weather Event',
      id: 'weather-event',
      description: `${event.type} causing ${event.duration}-day disruption`,
      adjustments: [{ start: startDate, duration: event.duration, impact: event.severity }],
      metadata: {
        type: 'weather',
        subtype: event.type,
        duration: event.duration,
        severity: event.severity,
        seasonalAlignment: season
      }
    };
  }

  /**
   * Policy change - government/regulatory intervention
   */
  policyChange(data) {
    const { policyContext, industry } = data;
    
    const adjustedForecast = [...data.forecast];
    
    // Types of policy changes
    const policyChanges = [
      {
        name: 'Carbon Tax Implementation',
        impact: { multiplier: 0.85, timeline: 'gradual' },
        affectedSectors: ['manufacturing', 'transport']
      },
      {
        name: 'Minimum Wage Increase',
        impact: { laborCostIncrease: 0.15, timeline: 'immediate' },
        affectedSectors: ['retail', 'services']
      },
      {
        name: 'Import Tariff Change',
        impact: { priceIncrease: 0.20, timeline: 'immediate' },
        affectedSectors: ['retail', 'manufacturing']
      },
      {
        name: 'Subsidy Introduction',
        impact: { boostMultiplier: 1.15, timeline: 'staged' },
        affectedSectors: ['renewables', 'agriculture']
      }
    ];
    
    const policy = policyChanges.find(p => 
      p.affectedSectors.includes(industry)
    ) || policyChanges[0];
    
    // Apply policy impact
    if (policy.impact.timeline === 'immediate') {
      for (let i = 0; i < adjustedForecast.length; i++) {
        if (policy.impact.multiplier) {
          adjustedForecast[i] *= policy.impact.multiplier;
        } else if (policy.impact.priceIncrease) {
          // Price elastic response
          adjustedForecast[i] *= (1 - 0.8 * policy.impact.priceIncrease);
        }
      }
    } else if (policy.impact.timeline === 'gradual' || policy.impact.timeline === 'staged') {
      // Phased implementation
      const numPhases = 3;
      const phaseLength = Math.floor(adjustedForecast.length / numPhases);
      
      for (let phase = 0; phase < numPhases; phase++) {
        const phaseStart = phase * phaseLength;
        const phaseImpact = (phase + 1) / numPhases;
        
        for (let i = phaseStart; i < phaseStart + phaseLength && i < adjustedForecast.length; i++) {
          if (policy.impact.boostMultiplier) {
            adjustedForecast[i] *= (1 + policy.impact.boostMultiplier * phaseImpact);
          }
        }
      }
    }
    
    return {
      name: `Policy: ${policy.name}`,
      id: 'policy-change',
      description: `Government/regulatory action with ${policy.impact.timeline} effect`,
      adjustments: [],
      metadata: {
        type: 'policy',
        policyType: policy.name,
        affectedSectors: policy.affectedSectors,
        impactDuration: policy.impact.timeline,
        immediateImpact: policy.impact.timeline === 'immediate'
      }
    };
  }

  /**
   * Natural disaster - earthquake, hurricane, etc.
   */
  naturalDisaster(data) {
    const { forecast, regionRisk } = data;
    
    const adjustedForecast = [...data.forecast];
    
    // Disaster types and their characteristics
    const disasters = [
      { type: 'earthquake', duration: 30, destructionLevel: 0.6 },
      { type: 'hurricane', duration: 14, reconstructionPeriod: 180 },
      { type: 'wildfire', duration: 45, smokeImpact: true }
    ];
    
    const disaster = disasters[Math.floor(Math.random() * disasters.length)];
    const impactStart = Math.floor(Math.random() * Math.max(1, adjustedForecast.length - disaster.duration));
    
    // Immediate impact period
    for (let i = 0; i < disaster.duration && impactStart + i < adjustedForecast.length; i++) {
      const dayOffset = i / disaster.duration;
      const impactDepth = 1 - (disaster.destructionLevel || 0.5) * (1 + dayOffset);
      
      adjustedForecast[impactStart + i] *= Math.max(0.1, impactDepth);
    }
    
    // Optional reconstruction/recovery bump
    if (disaster.reconstructionPeriod) {
      const recoveryStart = impactStart + disaster.duration;
      const recoveryEnd = Math.min(recoveryStart + disaster.reconstructionPeriod, adjustedForecast.length);
      
      for (let i = recoveryStart; i < recoveryEnd; i++) {
        const recoveryProgress = (i - recoveryStart) / disaster.reconstructionPeriod;
        const reconstructionBoost = 1.2 * Math.sin(Math.PI * recoveryProgress / 2);
        adjustedForecast[i] *= reconstructionBoost;
      }
    }
    
    return {
      name: `Natural Disaster: ${disaster.type}`,
      id: 'natural-disaster',
      description: `${disaster.type.toUpperCase()} causing ${disaster.duration}-day disruption`,
      adjustments: [],
      metadata: {
        type: 'natural-disaster',
        subtype: disaster.type,
        duration: disaster.duration,
        reconstructionPeriod: disaster.reconstructionPeriod,
        severity: disaster.destructionLevel
      }
    };
  }

  /**
   * Regulatory change - compliance requirements
   */
  regulatoryChange(data) {
    const { currentCompliance, upcomingRegulations } = data;
    
    const adjustedForecast = [...data.forecast];
    
    // Calculate compliance cost burden
    let complianceCost = 0;
    const timeline = [];
    
    Object.entries(upcomingRegulations).forEach(([regId, reg]) => {
      if (!currentCompliance[regId]) {
        const phaseOutTime = reg.implementationDate - Date.now();
        const phasePercentage = Math.min(1, phaseOutTime / 90 / 252); // ~90 days
        
        complianceCost += reg.complianceCost * phasePercentage;
        
        timeline.push({
          regulation: regId,
          phasedIn: phasePercentage > 0,
          costImpact: reg.complianceCost
        });
      }
    });
    
    // Reduce margins to account for compliance investments
    if (complianceCost > 0) {
      adjustedForecast.forEach((val, idx) => {
        adjustedForecast[idx] *= (1 - complianceCost * 0.1); // Cost reduces growth
      });
    }
    
    return {
      name: 'Regulatory Compliance Requirements',
      id: 'regulatory-change',
      description: 'New compliance requirements increasing operational costs',
      adjustments: timeline,
      metadata: {
        type: 'regulatory',
        totalComplianceCost: complianceCost,
        regulationsAffected: Object.keys(upcomingRegulations).filter(r => !currentCompliance[r]),
        timeHorizon: complianceCost > 0 ? 'short-term' : 'none'
      }
    };
  }

  /**
   * Geopolitical event - trade war, sanctions, conflict
   */
  geopoliticalEvent(data) {
    const { tradePartners, tariffExposure } = data;
    
    const adjustedForecast = [...data.forecast];
    
    // Trade partner risk levels
    const countryRisks = {
      'china': 0.15,  // 15% tariff/tension
      'russia': 0.25, // Sanctions impact
      'iran': 0.20,   // Trade restrictions
      'north-korea': 0.30 // Complete embargo
    };
    
    // Identify which countries are relevant
    let totalTariffImpact = 0;
    const impactedCountries = [];
    
    Object.entries(tradePartners).forEach(([country, share]) => {
      if (countryRisks[country] && share > 0.1) { // Only if significant trade
        totalTariffImpact += countryRisks[country] * share;
        impactedCountries.push(country);
      }
    });
    
    // Apply cascading effects over time
    const cascadeDuration = 90; // Days
    
    for (let i = 0; i < cascadeDuration && i < adjustedForecast.length; i++) {
      const cascadePhase = Math.min(1, i / 30);
      const supplyChainDelay = 1 - 0.05 * cascadePhase;
      const priceImpact = 1 - totalTariffImpact * cascadePhase;
      
      adjustedForecast[i] *= supplyChainDelay * priceImpact;
    }
    
    return {
      name: 'Geopolitical Tensions',
      id: 'geopolitical',
      description: `Trade/partner conflicts impacting ${impactedCountries.join(', ')}`,
      adjustments: [],
      metadata: {
        type: 'geopolitical',
        affectedCountries: impactedCountries,
        tariffExposure: totalTariffImpact,
        supplyChainImpact: 'moderate',
        resolutionUncertainty: 'high'
      }
    };
  }
}

/**
 * Risk Assessment Model
 */
export class RiskAssessment {
  constructor() {
    this.riskMatrix = new Map();
  }

  assessRisk(shockEvent, baselineForecast) {
    const metrics = {
      probability: 0.3, // Base probability
      impactScale: 1.0,
      timingUncertainty: 0.2,
      detectionLeadTime: 7 // days
    };
    
    // Update based on event type
    switch (shockEvent.type) {
      case 'pandemic':
        metrics.probability = 0.1;
        metrics.impactScale = 3.0;
        metrics.timingUncertainty = 0.8;
        break;
      case 'weather':
        metrics.probability = 0.4;
        metrics.impactScale = 1.5;
        metrics.detectionLeadTime = 3;
        break;
      case 'policy':
        metrics.probability = 0.6;
        metrics.impactScale = 1.2;
        metrics.detectionLeadTime = 30;
        break;
      case 'natural-disaster':
        metrics.probability = 0.15;
        metrics.impactScale = 2.0;
        metrics.detectionLeadTime = 1; // Can be unpredictable
        break;
    }
    
    // Expected loss calculation
    const expectedLoss = metrics.probability * 
                         metrics.impactScale * 
                         baselineForecast.reduce((sum, val) => sum + Math.abs(val), 0);
    
    return {
      metrics,
      expectedLoss,
      confidenceInterval: {
        lower: expectedLoss * 0.5,
        upper: expectedLoss * 2.0
      },
      recommendedActions: this.suggestActions(shockEvent, metrics)
    };
  }

  suggestActions(event, metrics) {
    const actions = [];
    
    if (metrics.impactScale > 2.0) {
      actions.push('Activate contingency planning');
      actions.push('Secure alternative suppliers');
    }
    
    if (metrics.detectionLeadTime < 7) {
      actions.push('Implement early warning monitoring');
    }
    
    if (metrics.probability > 0.5) {
      actions.push('Invest in resilience infrastructure');
    }
    
    actions.push('Update insurance coverage');
    actions.push('Maintain higher safety stock');
    
    return actions;
  }
}

export default ExternalShockScenarios;
