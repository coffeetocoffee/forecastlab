// @ts-check
/**
 * ForecastLab Plugin SDK v3.0
 * 
 * Type definitions for plugin development
 */

/**
 * Base class for all forecasting models
 */
export class ForecastModel {
  constructor() {}
  
  /**
   * Train model on time series data
   * @param {Array<{date?: string, value: number}>|Array<number>} data - Input data
   * @param {Object} params - Model parameters
   * @returns {this} For chaining
   */
  fit(data, params) { throw new Error('Must implement fit'); }
  
  /**
   * Generate forecasts
   * @param {number} horizon - Steps ahead to forecast
   * @returns {Array<{value: number, lower?: number, upper?: number}>} Predictions
   */
  forecast(horizon) { throw new Error('Must implement forecast'); }
  
  /**
   * Plain-language explanation of the model
   * @returns {string} Markdown formatted explanation
   */
  explain() { return ''; }
}

/**
 * Interface for custom performance metrics
 */
export function PerformanceMetric() {}

/**
 * @typedef {Function} PerformanceMetricFunc
 * @param {Array<number>} actuals - Ground truth values
 * @param {Array<number>} forecasts - Predicted values
 * @param {Object} params - Optional metric parameters
 * @returns {number} Single score (lower is better)
 */

/**
 * Options for model registration
 */
export interface ModelRegistrationOptions {
  name: string;
  version?: string;
  description?: string;
}

/**
 * Registry for managing plugins and extensions
 */
export class PluginRegistry {
  /**
   * Register a forecasting model class
   * @param {string} name - Unique identifier
   * @param {new () => ForecastModel} ModelClass - Model class constructor
   * @param {ModelRegistrationOptions} options - Optional metadata
   */
  registerModel(name, ModelClass, options = {}) {}
  
  /**
   * Get registered model class
   * @param {string} name 
   * @returns {new () => ForecastModel | undefined}
   */
  getModel(name) {}
  
  /**
   * List all registered model names
   * @returns {string[]} Array of model identifiers
   */
  listModels() {}
  
  /**
   * Register a custom performance metric
   * @param {string} name - Metric identifier
   * @param {PerformanceMetricFunc} metricFn - Metric calculation function
   */
  registerMetric(name, metricFn) {}
  
  /**
   * Get custom metric function
   * @param {string} name 
   * @returns {PerformanceMetricFunc | undefined}
   */
  getMetric(name) {}
  
  /**
   * Register a CLI command handler
   * @param {string} name - Command name
   * @param {Function} handler - Command execution function
   */
  registerCommand(name, handler) {}
  
  /**
   * Register a visualization component
   * @param {string} name - Chart type identifier
   * @param {Function} renderer - D3.js rendering function
   */
  registerVisualizer(name, renderer) {}
}

/**
 * Global registry instance
 */
export const registry: PluginRegistry = new PluginRegistry();

/**
 * Auto-register a model when module loads
 * @param {string} name 
 * @param {new () => ForecastModel} ModelClass 
 */
export function registerModel(name, ModelClass) {}

/**
 * Load plugins from directory
 * @param {string} dirPath - Directory containing plugins
 * @param {Object} options - Load options
 */
export async function loadPlugins(dirPath, options = {}) {}
