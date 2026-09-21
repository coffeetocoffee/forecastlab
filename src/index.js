// Public API surface. The CLI is a thin wrapper around these modules.

export {
  parseCsv,
  loadCsvFile,
  validateSeries,
  summarizeSeries,
  resamplePoints,
  dominantStep,
  splitTrainTest,
  sha256Hex,
  TIME_CANDIDATES,
  VALUE_CANDIDATES,
} from './series.js';

export {
  METHODS,
  METHOD_IDS,
  INTERVAL_Z,
  fit,
  fitGLMForecast,
  methodTitle,
  applicableMethods,
  minPointsFor,
} from './models.js';

export {
  backtest,
  defaultTestSize,
  mae,
  rmse,
  mape,
  smape,
  mase,
  rollingOriginBacktest,
  computeDieboldMarianoTests,
  dieboldMarianoTest,
  ljungBoxTest,
  normCdf,
} from './evaluate.js';

export {
  methodCard,
  allMethodCards,
  describeBacktest,
  describeForecast,
  fmtNum,
} from './explain.js';

export {
  buildHtmlReport,
  buildJsonReport,
  buildForecastCsv,
  buildMarkdownReport,
  buildChartSvg,
  writeReportFiles,
  futureTimes,
  shortLabel,
  escapeHtml,
} from './report.js';

export {
  defaultProject,
  readProjectFile,
  writeProjectFile,
  resolveInput,
  compareVersions,
  versionSatisfies,
} from './project.js';

// Phase 1: Feature utilities
export {
  fourierTerm,
  fourierFeatures,
  fourierForecast,
  detectSeasonality,
  autoFourier,
  validateFourierFeatures,
} from './utils/fourier.js';

export {
  parseFeatureConfig,
  generateFeatures,
  prepareFutureFeatures,
  createFourierConfig,
  dayOfWeekDummies,
  weekendIndicator,
  // Phase 2: Auto-features and recommendations
  autoDetectSeasonality,
  extractSeriesCharacteristics,
  recommendForecastingMethods,
  createEnsembleForecast,
  autoTuneParameters,
  detectAnomalies,
  robustLinearRegression,
  generateOutlierImpactReport,
} from './utils/features.js';

// Phase 1: Batch processing
export {
  batchForecast,
  chunkedReader,
  aggregateBatchResults,
} from './batch.js';

// ==========================================
// Phase 4: Advanced Analytics Modules
// ==========================================

// Multi-Series Modeling (Phase 4A)
export {
  HierarchicalReconciler,
  PanelAnalyzer,
  VARModel,
  FactorExtractor,
} from './multiSeries.js';

// Uncertainty Quantification (Phase 4B)
export {
  MonteCarloSimulator,
  PredictiveDensity,
  ScenarioTreeBuilder,
} from './uncertainty.js';

// Counterfactual Analysis (Phase 4C)
export {
  CounterfactualEngine,
  ScenarioGenerator,
  ParameterSweeper,
} from './counterfactual.js';

// Real-Time Adaptation (Phase 4D)
export {
  UpdateScheduler,
  EventTriggerSystem,
  AdaptiveWeighting,
  SlidingWindow,
} from './scheduler.js';

// ==========================================
// Causal understanding (no machine learning)
// ==========================================

export {
  parseWideCsv,
  betai,
  tTestPValue,
  fTestPValue,
  mean,
  variance,
  stdDev,
  pearson,
  detrend,
  ols,
  fmtP,
  CausalGraph,
  naiveBaseline,
  InterventionSimulator,
  DECAY_KERNELS,
  ExternalFactorIntegrator,
  holidayCalendar,
  CounterfactualAnalyzer,
} from './causal.js';

// Continuous data processing (streaming layer: classical methods inside,
// queue + event loop outside)
export {
  FeedConnector,
  FileWatchConnector,
  WebhookConnector,
  WebSocketFeedConnector,
  PollingConnector,
  normalizePoint,
  Welford,
  IncrementalForecaster,
  JobQueue,
  toPriority,
  AlertManager,
  EventHub,
  StreamingEngine,
} from './streaming/index.js';
