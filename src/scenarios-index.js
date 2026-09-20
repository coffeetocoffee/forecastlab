// ForecastLab Visualizations and Scenarios Index
// Export all visualization components and scenario generators

// Visualization Components
export { PredictionBandChart, createPredictionBandLegend } from './visualizations/prediction-band-chart.js';
export { ScenarioTreeSankey, createScenarioTreeLegend } from './visualizations/scenario-tree-sankey.js';
export { CounterfactualSliders, getSuggestedScenarios } from './visualizations/counterfactual-sliders.js';
export { HierarchicalReconciliationChart, TopDownTreeChart, computeOptimalWeights } from './visualizations/hierarchical-reconciliation.js';
export { ProgressIndicator, MultiStageProgress, createProgressAwareOperation } from './visualizations/progress-indicators.js';

// Worker Pool for Performance Optimization
export { WorkerPool, MonteCarloTask } from './workers/worker-pool.js';

// Sparse Matrix Operations
export { SparseMatrix, SparseCholesky, VectorOps } from './models/sparse-matrix.js';

// Scenario Templates
export { PromotionLiftScenarios, PromotionCalendar } from './scenarios/promotion-lift.js';
export { PriceElasticityScenarios, ProductCategory, CrossPriceElasticity } from './scenarios/price-elasticity.js';
export { SupplyChainDisruptions, SupplierNetwork } from './scenarios/supply-chain-disruptions.js';
export { ExternalShockScenarios, RiskAssessment } from './scenarios/external-shocks.js';

// Main orchestration class
export class ForecastLabScenarios {
  constructor(options = {}) {
    this.options = options;
    
    // Initialize all scenario generators
    this.promotionScenarios = new PromotionLiftScenarios(options.promotionOptions);
    this.priceElasticityScenarios = new PriceElasticityScenarios(options.priceOptions);
    this.supplyChainDisruptions = new SupplyChainDisruptions(options.supplyChainOptions);
    this.externalShocks = new ExternalShockScenarios(options.shockOptions);
    
    // Visualizations
    this.visualizations = {};
    
    // Workers
    this.workerPool = null;
    if (options.useWorkers) {
      this.workerPool = new WorkerPool({
        size: options.workerCount || 4,
        onTaskComplete: options.onWorkerTaskComplete || null,
        onProgressUpdate: options.onWorkerProgress || null
      });
    }
  }
  
  /**
   * Generate complete scenario analysis
   */
  async generateFullAnalysis(baselineData) {
    const startTime = performance.now();
    
    // Initialize worker pool if needed
    if (this.workerPool && !this.workerPool.initialized) {
      await this.workerPool.initialize();
    }
    
    // Generate all scenarios in parallel where possible
    const [promotionResults, priceResults, supplyChainResults, shockResults] = await Promise.all([
      this.promotionScenarios.generateScenarios(baselineData),
      this.priceElasticityScenarios.generateScenarios(baselineData),
      this.supplyChainDisruptions.generateScenarios(baselineData),
      this.externalShocks.generateScenarios(baselineData)
    ]);
    
    const endTime = performance.now();
    
    return {
      timestamp: new Date().toISOString(),
      baselineTimestamp: startTime,
      generationDurationMs: endTime - startTime,
      scenarios: {
        promotions: promotionResults,
        pricing: priceResults,
        supplyChain: supplyChainResults,
        externalEvents: shockResults
      },
      metadata: {
        totalScenarios: promotionResults.length + priceResults.length + 
                        supplyChainResults.length + shockResults.length,
        workerPoolUsed: !!this.workerPool,
        optimizationEnabled: true
      }
    };
  }
  
  /**
   * Run Monte Carlo simulation with worker pool
   */
  async runMonteCarloSimulation(taskParams) {
    if (!this.workerPool) {
      throw new Error('Worker pool not initialized');
    }
    
    const mcTask = new MonteCarloTask({
      ...taskParams,
      includeProgress: true,
      onProgress: (current, total) => {
        // Real-time progress tracking
        console.log(`MC Progress: ${((current / total) * 100).toFixed(1)}%`);
      }
    });
    
    return this.workerPool.submitTask(mcTask);
  }
  
  /**
   * Create visualization instance
   */
  createVisualization(type, container, data) {
    switch (type) {
      case 'prediction-bands':
        return new PredictionBandChart({ container, ...data });
      case 'sankey':
        return new ScenarioTreeSankey({ container, ...data });
      case 'counterfactual':
        return new CounterfactualSliders({ container, ...data });
      case 'hierarchical':
        return new HierarchicalReconciliationChart({ container, ...data });
      default:
        throw new Error(`Unknown visualization type: ${type}`);
    }
  }
}

export default ForecastLabScenarios;
