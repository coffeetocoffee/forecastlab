/**
 * ForecastLab Plugin System v3.0
 * 
 * Extends ForecastLab with custom models, metrics, and visualizations
 * while maintaining backward compatibility with v2.x workflows.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

/**
 * Plugin Registry - Central hub for loading and managing plugins
 */
export class PluginRegistry {
  constructor() {
    this.plugins = new Map();
    this.models = new Map();
    this.metrics = new Map();
    this.commands = new Map();
    this.visualizers = new Map();
  }

  /**
   * Load a plugin from manifest file
   */
  async loadPlugin(manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    
    // Validate manifest structure
    if (!this.validateManifest(manifest)) {
      throw new Error(`Invalid plugin manifest: ${manifestPath}`);
    }

    // Load plugin module
    const pluginModule = await import(manifest.main);
    
    // Register extensions
    const pluginId = manifest.name;
    this.plugins.set(pluginId, { manifest, module: pluginModule });

    // Register models
    if (manifest.exports?.models) {
      for (const modelName of manifest.exports.models) {
        const ModelClass = pluginModule[modelName];
        if (ModelClass) {
          this.models.set(modelName, ModelClass);
        }
      }
    }

    return { id: pluginId, ...manifest };
  }

  /**
   * Register a model directly (for programmatic use)
   */
  registerModel(name, ModelClass) {
    this.models.set(name, ModelClass);
  }

  /**
   * Register a custom evaluation metric
   */
  registerMetric(name, MetricFunction) {
    this.metrics.set(name, MetricFunction);
  }

  /**
   * Get registered model class
   */
  getModel(name) {
    return this.models.get(name);
  }

  /**
   * Get all available model names
   */
  listModels() {
    return Array.from(this.models.keys());
  }

  /**
   * Get registered metric
   */
  getMetric(name) {
    return this.metrics.get(name);
  }

  /**
   * List all loaded plugins
   */
  listPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description
    }));
  }

  validateManifest(manifest) {
    const required = ['name', 'version', 'main'];
    return required.every(key => manifest[key]);
  }
}

// Global registry instance
export const registry = new PluginRegistry();

/**
 * Helper class for creating custom forecasting models
 */
export class ForecastModelBuilder {
  constructor(name) {
    this.name = name;
    this.methods = {};
    this.explanation = '';
    this.dependencies = [];
  }

  fit(data, params) {
    this.methods.fit = this._wrapMethod('fit', data, params);
    return this;
  }

  forecast(horizon) {
    this.methods.forecast = this._wrapMethod('forecast', horizon);
    return this;
  }

  explain() {
    return this.explanation;
  }

  _wrapMethod(methodName, ...args) {
    return () => {
      console.log(`Executing ${methodName} on ${args.length} arguments`);
      // Placeholder - actual implementation in plugin
      return null;
    };
  }

  build() {
    return this;
  }
}
