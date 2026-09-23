/**
 * ForecastLab Causal Module - Main Entry Point (Backward Compatibility Layer)
 * 
 * Re-exports all causal functionality from modular files while maintaining the
 * original API surface. This ensures src/commands/causal.js and other importers
 * continue working without modification.
 * 
 * All functional code lives in separate files under src/causal/:
 *   - csv-parse.js     : CSV parsing utilities
 *   - math.js          : Statistical primitives (OLS, t-tests, F-tests, etc.)
 *   - causal-graph.js  : CausalGraph class for relationship discovery
 *   - intervention.js  : InterventionSimulator class & DECAY_KERNELS
 *   - factors.js       : ExternalFactorIntegrator & holidayCalendar
 *   - counterfactual.js: CounterfactualAnalyzer class
 */

// Core statistical functions (re-exported for backward compatibility)
export {
  gammaln,
  betacf,
  betai,
  tTestPValue,
  fTestPValue,
  normCdf,
  mean,
  variance,
  stdDev,
  pearson,
  detrend,
  removeSeasonality,
  ols,
  fmtNum,
  fmtP,
} from './causal/math.js';

// CSV parsing utilities
export {
  splitCsvLine,
  parseTimestamp,
  parseWideCsv,
} from './causal/csv-parse.js';

// CausalGraph class for discovering lagged relationships
export {
  CausalGraph,
  DEFAULT_ALPHA,
} from './causal/causal-graph.js';

// InterventionSimulator class and decay kernels
export {
  naiveBaseline,
  DECAY_KERNELS,
  InterventionSimulator,
} from './causal/intervention.js';

// ExternalFactorIntegrator class and holiday calendar
export {
  ExternalFactorIntegrator,
  holidayCalendar,
} from './causal/factors.js';

// CounterfactualAnalyzer class for difference-in-differences
export {
  buildControlGroup,
  CounterfactualAnalyzer,
} from './causal/counterfactual.js';
