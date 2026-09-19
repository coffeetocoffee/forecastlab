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
} from './utils/features.js';

// Phase 1: Batch processing
export {
  batchForecast,
  chunkedReader,
  aggregateBatchResults,
} from './batch.js';
