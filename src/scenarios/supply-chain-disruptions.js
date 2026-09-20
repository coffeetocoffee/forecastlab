// Supply chain disruption patterns for forecasting
// Models interruptions, delays, and capacity constraints

/**
 * Supply Chain Disruption Scenario Generator
 */
export class SupplyChainDisruptions {
  constructor(options = {}) {
    this.supplierNetwork = options.supplierNetwork || [];
    this.baseLeadTime = options.baseLeadTime || 7; // days
    this.disruptionPatterns = options.disruptionPatterns || [];
    
    this.patternTemplates = {
      'short-delay': this.shortDelay.bind(this),
      'long-outage': this.longOutage.bind(this),
      'capacity-constraint': this.capacityConstraint.bind(this),
      'quality-issue': this.qualityIssue.bind(this),
      'supplier-bankruptcy': this.supplierBankruptcy.bind(this)
    };
  }

  /**
   * Generate all disruption scenarios
   */
  generateScenarios(baselineData) {
    const scenarios = [];
    
    Object.entries(this.patternTemplates).forEach(([patternId, generator]) => {
      const scenario = generator(baselineData);
      if (scenario) {
        scenarios.push(scenario);
      }
    });
    
    return scenarios;
  }

  /**
   * Short delay - temporary supplier delay
   */
  shortDelay(data) {
    const { forecast, horizon } = data;
    
    const adjustedForecast = [...forecast];
    
    // 2-3 day delay starting at random point
    const delayStart = Math.floor(Math.random() * (horizon - 5));
    const delayDuration = 3;
    
    // Reduce supply during delay period
    for (let i = delayStart; i < delayStart + delayDuration && i < adjustedForecast.length; i++) {
      adjustedForecast[i] *= 0.6; // 40% reduction
    }
    
    return {
      name: 'Short-Term Supplier Delay',
      id: 'short-delay',
      description: 'Brief supplier delay causing temporary shortage',
      adjustments: [{ start: delayStart, duration: delayDuration, impact: -0.4 }],
      metadata: {
        type: 'delay',
        duration: delayDuration,
        severity: 'low',
        recoverable: true
      }
    };
  }

  /**
   * Long outage - extended supplier unavailability
   */
  longOutage(data) {
    const { forecast, leadTime } = data;
    
    const adjustedForecast = [...forecast];
    
    // 1-2 week outage
    const outageStart = Math.floor(Math.random() * (Math.floor(horizon / 2)));
    const outageDuration = 14; // 2 weeks
    
    // Zero supply during major outage
    for (let i = outageStart; i < outageStart + outageDuration && i < adjustedForecast.length; i++) {
      adjustedForecast[i] *= 0.2; // 80% reduction
    }
    
    // Recovery period
    const recoveryEnd = Math.min(outageStart + outageDuration + 7, adjustedForecast.length);
    for (let i = recoveryEnd - 7; i < recoveryEnd; i++) {
      adjustedForecast[i] *= 0.6; // 40% recovery
    }
    
    return {
      name: 'Extended Supplier Outage',
      id: 'long-outage',
      description: 'Major supplier outage requiring alternative sourcing',
      adjustments: [],
      metadata: {
        type: 'outage',
        duration: outageDuration,
        severity: 'high',
        requiresAction: true
      }
    };
  }

  /**
   * Capacity constraint - limited production capability
   */
  capacityConstraint(data) {
    const { demand, productionCapacity } = data;
    
    const adjustedForecast = [];
    
    demand.forEach((demandVal, idx) => {
      // Apply capacity constraint
      const constrainedValue = Math.min(demandVal, productionCapacity[idx]);
      adjustedForecast.push(constrainedValue);
    });
    
    // Calculate lost sales
    const lostSales = demand.reduce((sum, d, i) => sum + Math.max(0, d - productionCapacity[i]), 0);
    
    return {
      name: 'Production Capacity Constraint',
      id: 'capacity-constraint',
      description: 'Limited manufacturing/distribution capacity',
      adjustments: [],
      metadata: {
        type: 'constraint',
        lostSales: lostSales,
        utilizationRate: demand.reduce((s, d, i) => s + Math.min(d, productionCapacity[i]) / d, 0) / demand.length
      }
    };
  }

  /**
   * Quality issue - defective batch rejection
   */
  qualityIssue(data) {
    const { forecast, qualityRate = 0.98 } = data;
    
    const adjustedForecast = [...forecast];
    
    // Simulate periodic quality checks with failures
    const inspectionPoints = [10, 25, 40, 55]; // Days
    
    inspectionPoints.forEach(inspectionDay => {
      if (inspectionDay < adjustedForecast.length && Math.random() < 0.2) { // 20% failure rate
        const lotSize = 7; // Week of affected products
        
        // Remove entire lot due to quality issues
        for (let i = 0; i < lotSize && inspectionDay + i < adjustedForecast.length; i++) {
          adjustedForecast[inspectionDay + i] = 0;
        }
      }
    });
    
    return {
      name: 'Quality Control Failures',
      id: 'quality-issue',
      description: 'Batch rejections due to quality control failures',
      adjustments: [],
      metadata: {
        type: 'quality',
        expectedFailureRate: 0.2,
        lotSize: 7
      }
    };
  }

  /**
   * Supplier bankruptcy - complete loss of supply source
   */
  supplierBankruptcy(data) {
    const { suppliers, criticalItems, alternativeSuppliers } = data;
    
    // Identify which items will be affected
    const affectedItems = new Set();
    
    suppliers.forEach(supplier => {
      if (supplier.bankrupt || supplier.interrupted) {
        supplier.items.forEach(itemId => {
          if (!alternativeSuppliers[itemId]) {
            affectedItems.add(itemId);
          }
        });
      }
    });
    
    // Mark impacted forecasts
    const adjustedForecast = [...data.forecast];
    const impactedDays = [];
    
    // Find first occurrence of each affected item and zero out
    affectedItems.forEach(itemId => {
      const firstOccurrence = adjustedForecast.findIndex(v => v > 0);
      
      for (let i = firstOccurrence; i < adjustedForecast.length; i++) {
        adjustedForecast[i] = 0;
        impactedDays.push({ itemId, day: i });
      }
    });
    
    return {
      name: 'Supplier Bankruptcy/Closure',
      id: 'supplier-bankruptcy',
      description: 'Complete loss of supplier requiring immediate action',
      adjustments: Array.from(affectedItems).map(id => ({ itemId: id, status: 'critical' })),
      metadata: {
        type: 'bankruptcy',
        criticality: 'severe',
        affectedItems: Array.from(affectedItems),
        searchRequired: true
      }
    };
  }

  /**
   * Logistics bottleneck - shipping/port congestion
   */
  logisticsBottleneck(data) {
    const { transportRoutes, shipmentSchedule } = data;
    
    const adjustedDeliveryTimes = [];
    
    shipmentSchedule.forEach(shipment => {
      const originalTime = shipment.expectedDelivery;
      
      // Check for route disruptions
      const congestionLevel = transportRoutes[shipment.route]?.congestion || 1.0;
      const weatherImpact = shipment.weather?.severity || 0;
      
      // Adjusted delivery time
      const adjustedTime = originalTime * (1 + congestionLevel + weatherImpact);
      
      adjustedDeliveryTimes.push({
        ...shipment,
        adjustedTime,
        delay: adjustedTime - originalTime
      });
    });
    
    return {
      name: 'Logistics Bottlenecks',
      id: 'logistics-bottleneck',
      description: 'Transportation network delays and congestion',
      adjustments: adjustedDeliveryTimes.map(t => ({ delay: t.delay })),
      metadata: {
        type: 'logistics',
        averageDelay: adjustedDeliveryTimes.reduce((s, t) => s + t.delay, 0) / adjustedDeliveryTimes.length,
        affectedRoutes: Object.keys(transportRoutes).filter(r => transportRoutes[r].congestion > 0.5)
      }
    };
  }
}

/**
 * Supplier Network Model
 */
export class SupplierNetwork {
  constructor() {
    this.suppliers = new Map();
    this.connections = new Map();
    this.criticality = new Map();
  }

  addSupplier(supplier) {
    this.suppliers.set(supplier.id, supplier);
  }

  addConnection(fromSupplier, toSupplier, strength) {
    const key = `${fromSupplier.id}-${toSupplier.id}`;
    this.connections.set(key, { from: fromSupplier, to: toSupplier, strength });
  }

  getCriticalSuppliers(threshold = 0.7) {
    const critical = [];
    
    this.suppliers.forEach(supplier => {
      if (supplier.criticalityScore >= threshold) {
        critical.push(supplier);
      }
    });
    
    return critical;
  }

  simulateDisruptionPathways(initialFailure) {
    const failed = new Set([initialFailure]);
    const cascade = [];
    
    // Recursive propagation
    const propagate = (currentSupplier) => {
      const connected = Array.from(this.connections.values())
        .filter(c => c.from.id === currentSupplier.id && !c.failed);
      
      connected.forEach(connection => {
        const risk = connection.strength * 
                    (1 - this.suppliers.get(currentSupplier.id)?.resilience || 0.5);
        
        if (Math.random() < risk) {
          failed.add(connection.to.id);
          cascade.push({
            from: currentSupplier,
            to: connection.to,
            mechanism: 'supply-chain-propagation'
          });
          
          propagate(connection.to);
        }
      });
    };
    
    propagate(initialFailure);
    
    return {
      initialFailure,
      totalFailed: failed.size,
      cascadeEvents: cascade
    };
  }
}

export default SupplyChainDisruptions;
