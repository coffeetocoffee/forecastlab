/**
 * Handler exports for the serve module.
 * Backward-compatible re-exports from submodules.
 */

export { send, sendJson } from './response.js';
export { toOpts, inputFrom, isProtected } from './params.js';
export { runBacktest, handleSummary, handleCompare, handleForecast } from './forecast.js';
export { handleSimulation } from './simulation.js';
export { handleScenarios, handleHierarchy } from './advanced.js';
export { streamStatus, streamEvents, getStreamingChartAsset } from './stream.js';
