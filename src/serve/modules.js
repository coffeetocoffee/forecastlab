/**
 * Serve module exports.
 * Re-exports everything from submodules for backward compatibility.
 */

export * from './handlers/index.js';
export * from './views/index.js';
export * from './utils/helpers.js';
export { VERSION } from './config.js';
export { createServer, openBrowser, listExamples } from './index.js';
