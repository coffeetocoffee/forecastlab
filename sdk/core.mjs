/**
 * ForecastLab Plugin SDK - Core Implementation v3.0
 * Runtime implementation of the plugin system
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Registry for managing plugins and extensions
 */
export class PluginRegistry {
  #models = new Map();
  #metrics = new Map();
  #commands = new Map();
  #visualizers = new Map();
  #plugins = new Map();

  registerModel(name, ModelClass, options = {}) {
    if (typeof ModelClass.prototype.fit !== 'function' ||
        typeof ModelClass.prototype.forecast !== 'function' ||
        typeof ModelClass.prototype.explain !== 'function') {
      throw new Error(`Model ${name} must implement fit(), forecast(), and explain()`);
    }

    this.#models.set(name, {
      class: ModelClass,
      metadata: { name, version: options.version, description: options.description }
    });
    
    console.log(`🔌 Registered model: ${name}`);
    return this;
  }

  getModel(name) {
    const model = this.#models.get(name);
    return model ? model.class : undefined;
  }

  listModels() {
    return Array.from(this.#models.keys());
  }

  hasModel(name) {
    return this.#models.has(name);
  }

  registerMetric(name, metricFn) {
    if (typeof metricFn !== 'function') {
      throw new Error('Metric must be a function');
    }

    this.#metrics.set(name, metricFn);
    console.log(`📊 Registered metric: ${name}`);
    return this;
  }

  getMetric(name) {
    return this.#metrics.get(name);
  }

  registerCommand(name, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Command handler must be a function');
    }

    this.#commands.set(name, handler);
    console.log(`⚡ Registered command: ${name}`);
    return this;
  }

  getCommand(name) {
    return this.#commands.get(name);
  }

  listCommands() {
    return Array.from(this.#commands.keys());
  }

  registerVisualizer(name, renderer) {
    if (typeof renderer !== 'function') {
      throw new Error('Visualizer renderer must be a function');
    }

    this.#visualizers.set(name, renderer);
    console.log(`📈 Registered visualizer: ${name}`);
    return this;
  }

  getVisualizer(name) {
    return this.#visualizers.get(name);
  }

  async loadPlugins(dirPath, options = {}) {
    try {
      const { readdirSync, stat } = await import('fs');
      const files = readdirSync(dirPath);
      
      for (const file of files) {
        if (!file.endsWith('.mjs') && !file.endsWith('.js')) continue;
        
        try {
          const module = await import(`file://${join(dirPath, file)}`);
          
          for (const [key, value] of Object.entries(module)) {
            if (typeof value === 'function' && 
                (key.endsWith('Forecaster') || key.endsWith('Model') || key.endsWith('Predictor'))) {
              this.registerModel(
                key.toLowerCase(),
                value,
                { name: key, version: '1.0.0' }
              );
            }
            
            if (typeof value === 'function' && key.endsWith('Metric')) {
              this.registerMetric(
                key.toLowerCase(),
                value
              );
            }
          }
        } catch (error) {
          if (options.strict) throw error;
        }
      }
    } catch (error) {
      if (options.strict) throw error;
    }
    
    return this;
  }

  listModelsMetadata() {
    const result = [];
    for (const [name, data] of this.#models) {
      result.push({ id: name, ...data.metadata });
    }
    return result;
  }

  getStats() {
    return {
      models: this.#models.size,
      metrics: this.#metrics.size,
      commands: this.#commands.size,
      visualizers: this.#visualizers.size,
      plugins: this.#plugins.size
    };
  }
}

// Global registry instance (singleton)
export const registry = new PluginRegistry();

/** Auto-register functions */
export function registerModel(name, ModelClass, options = {}) {
  return registry.registerModel(name, ModelClass, options);
}

export function registerMetric(name, metricFn) {
  return registry.registerMetric(name, metricFn);
}

export function registerCommand(name, handler) {
  return registry.registerCommand(name, handler);
}

export function registerVisualizer(name, renderer) {
  return registry.registerVisualizer(name, renderer);
}

export class ModelBuilder {
  #class = class {};
  #name = 'custom-model';
  
  constructor(name) { this.#name = name; }
  
  addFitImplementation(fn) { this.#class.prototype.fit = fn; return this; }
  addForecastImplementation(fn) { this.#class.prototype.forecast = fn; return this; }
  addExplainImplementation(text) { this.#class.prototype.explain = () => text; return this; }
  
  build() {
    registerModel(this.#name, this.#class);
    return this.#class;
  }
}
