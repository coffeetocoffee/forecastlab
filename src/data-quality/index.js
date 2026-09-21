/**
 * ForecastLab Data Quality Engine - Main Entry Point v2.0
 * 
 * All features unified in one interface
 */

import { DataQualityEngine, checkDataQuality } from './data-engine.js';
import { SnapshotStore, createSnapshot } from './snapshots/snapshot-store.js';
import { MultiSeriesCorrelator } from './correlation/multi-series-correlator.js';
import { WebhookManager, createSlackWebhook, createPagerDutyWebhook } from './webhooks/webhook-manager.js';
import { ForecastingPipeline, quickPipeline } from './pipeline/pipeline.js';

/**
 * Full-featured factory for creating complete data quality workflows
 */
export class DataQualityFactory {
  static createFullStack(options = {}) {
    return {
      engine: new DataQualityEngine(),
      snapshots: new SnapshotStore({ 
        path: options.snapshotPath || './snapshots/'
      }),
      webhooks: new WebhookManager(),
      correlation: new MultiSeriesCorrelator(),
      pipeline: new ForecastingPipeline({
        snapshotStore: new SnapshotStore(),
        webhookManager: new WebhookManager(),
        ...options.pipelineOptions
      })
    };
  }

  /**
   * Quick setup with predefined configurations
   */
  static createQuickSetup(type) {
    switch (type) {
      case 'minimal':
        return {
          engine: new DataQualityEngine()
        };

      case 'with_snapshots':
        return {
          engine: new DataQualityEngine(),
          snapshots: new SnapshotStore()
        };

      case 'with_alerts':
        return {
          engine: new DataQualityEngine(),
          webhooks: new WebhookManager()
        };

      case 'production':
        return this.createFullStack({
          pipelineOptions: {
            autoFixEnabled: true,
            minHealthScore: 75,
            maxCriticalIssues: 1
          }
        });

      default:
        return this.createFullStack();
    }
  }
}

// Export all components
export {
  DataQualityEngine,
  checkDataQuality,
  SnapshotStore,
  createSnapshot,
  MultiSeriesCorrelator,
  WebhookManager,
  createSlackWebhook,
  createPagerDutyWebhook,
  ForecastingPipeline,
  quickPipeline
};

// Default export
export default {
  DataQualityEngine,
  checkDataQuality,
  SnapshotStore,
  MultiSeriesCorrelator,
  WebhookManager,
  ForecastingPipeline,
  DataQualityFactory,
  quickPipeline
};

console.log('🚀 ForecastLab Data Quality Engine v2.0 loaded');
console.log('   Components: Engine, Snapshots, Correlator, Webhooks, Pipeline');
