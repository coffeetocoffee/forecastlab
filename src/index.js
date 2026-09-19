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
