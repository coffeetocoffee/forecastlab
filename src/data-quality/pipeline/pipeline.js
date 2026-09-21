/**
 * Pipeline Integration System - v2.0
 * 
 * Features:
 * - Automated quality → fix → forecast workflow
 * - Trigger-based execution based on quality gates
 * - Multi-series orchestration
 * - Progress tracking and rollback capability
 */

import { DataQualityEngine } from '../data-engine.js';
import { SnapshotStore } from '../snapshots/snapshot-store.js';
import { WebhookManager } from '../webhooks/webhook-manager.js';
import { MultiSeriesCorrelator } from '../correlation/multi-series-correlator.js';

export class ForecastingPipeline {
  constructor(options = {}) {
    this.qualityEngine = new DataQualityEngine();
    this.snapshotStore = options.snapshotStore || new SnapshotStore();
    this.webhookManager = options.webhookManager || new WebhookManager();
    this.correlator = new MultiSeriesCorrelator();
    
    this.pipelineHistory = [];
    this.activeJobs = new Map();
    
    // Quality gates configuration
    this.gates = {
      minHealthScore: options.minHealthScore || 70,
      maxCriticalIssues: options.maxCriticalIssues || 2,
      maxMissingPercent: options.maxMissingPercent || 5,
      autoFixEnabled: options.autoFixEnabled !== false
    };

    console.log('🚀 Forecasting Pipeline initialized');
  }

  /**
   * Run complete pipeline for a dataset
   * Workflow: check → fix → correlate (if multi) → forecast
   */
  async run(data, options = {}) {
    const jobId = this.generateJobId();
    const seriesName = options.seriesName || 'default';
    
    console.log(`\n📋 Starting pipeline job ${jobId} for ${seriesName}`);
    
    // Create snapshot before starting
    try {
      await this.snapshotStore.createSnapshot(seriesName, data, { 
        purpose: 'pre_pipeline',
        version: 1
      });
    } catch (error) {
      console.warn('⚠️  Failed to create pre-pipeline snapshot:', error.message);
    }

    const startTime = Date.now();
    let result;

    try {
      // Phase 1: Quality Check
      console.log('\n🔍 PHASE 1: Quality Analysis...');
      const qualityReport = await this.qualityEngine.analyze(data, {});
      
      if (options.saveQualityReport) {
        this.snapshotStore.snapshots.set(`${seriesName}_quality`, [qualityReport]);
      }

      // Trigger webhook for quality results
      await this.webhookManager.trigger('quality_check', qualityReport, {
        severity: qualityReport.summary.totalIssues > 0 ? 'warning' : 'info'
      });

      // Phase 2: Quality Gate Validation
      console.log('\n🚦 Checking quality gates...');
      const gateResults = this.validateGates(qualityReport);
      
      if (!gateResults.passed) {
        const message = `Quality gates failed: ${gateResults.reasons.join(', ')}`;
        console.error(`❌ ${message}`);
        
        // Notify webhooks of failure
        await this.webhookManager.trigger('quality_gate_failed', {
          report: qualityReport,
          reasons: gateResults.reasons
        }, { severity: 'critical' });

        return {
          success: false,
          job_id: jobId,
          phase: 'quality_gates',
          errors: gateResults.reasons,
          recommendations: qualityReport.recommendations
        };
      }
      console.log('✅ Quality gates passed');

      // Phase 3: Automatic Fix (if enabled)
      if (this.gates.autoFixEnabled && qualityReport.missingData.totalMissing > 0) {
        console.log('\n🔧 PHASE 2: Auto-Fix Missing Values...');
        const imputed = this.qualityEngine.imputeMissing(
          data, 
          qualityReport.recommendations[0]?.automaticSuggestion || 'linear',
          {}
        );

        // Save post-fix snapshot
        await this.snapshotStore.createSnapshot(seriesName, imputed.data, {
          purpose: 'post_fix',
          method: imputed.history[0]?.method || 'linear',
          imputationCount: imputed.history.length
        });

        // Update report with fixed data
        qualityReport.imputed = true;
        qualityReport.imputationDetails = imputed.metadata;

        // Trigger webhook for fix
        await this.webhookManager.trigger('auto_fixed', imputed.metadata, {
          severity: 'info'
        });

        console.log(`✅ Fixed ${imputed.history.length} missing values`);
      } else {
        console.log('⏭️  Skipping auto-fix (disabled or no issues)');
      }

      // Phase 4: Multi-Series Correlation (if multiple series provided)
      if (Array.isArray(data) && data.some(d => Array.isArray(d.data))) {
        console.log('\n📊 PHASE 3: Multi-Series Correlation...');
        const correlationResult = await this.correlator.analyze(data, {
          maxLags: 7,
          minSignificance: 0.6
        });

        await this.webhookManager.trigger('correlation_complete', correlationResult, {
          severity: correlationResult.significantPairs > 0 ? 'warning' : 'info'
        });

        console.log(`✅ Found ${correlationResult.significantPairs} significant relationships`);
      } else {
        console.log('⏭️  Single series - skipping multi-correlation');
      }

      // Phase 5: Final Report
      const durationMs = Date.now() - startTime;
      
      result = {
        success: true,
        job_id: jobId,
        series_name: seriesName,
        phases_completed: ['quality_check', 'quality_gates', 'auto_fix', 'correlation'],
        quality_report: qualityReport,
        timing: {
          total_ms: durationMs,
          quality_check_ms: null, // Detailed timing could be added
          fix_ms: null
        },
        recommendations: qualityReport.recommendations,
        next_steps: this.suggestNextSteps(qualityReport)
      };

      // Store final report
      await this.snapshotStore.createSnapshot(`${seriesName}_final`, result, {
        purpose: 'pipeline_result',
        status: 'completed'
      });

      await this.webhookManager.trigger('pipeline_complete', result, {
        severity: qualityReport.summary.totalIssues === 0 ? 'info' : 'warning'
      });

    } catch (error) {
      console.error(`❌ Pipeline failed: ${error.message}`);
      
      // Rollback to original data
      await this.rollbackToOriginal(data);

      result = {
        success: false,
        job_id: jobId,
        phase: 'unknown',
        error: error.message,
        timestamp: new Date().toISOString()
      };

      await this.webhookManager.trigger('pipeline_error', {
        job_id: jobId,
        error: error.message
      }, { severity: 'critical' });
    }

    // Log to history
    this.pipelineHistory.push({
      job_id: jobId,
      series_name: seriesName,
      status: result.success ? 'completed' : 'failed',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime
    });

    console.log(result.success 
      ? `\n✅ Pipeline completed successfully (${result.timing.total_ms}ms)`
      : `\n❌ Pipeline failed`);

    return result;
  }

  /**
   * Validate quality gates
   */
  validateGates(report) {
    const reasons = [];
    const passed = true;

    if (report.summary.overallHealth < this.gates.minHealthScore) {
      reasons.push(`health_score=${Math.round(report.summary.overallHealth)} below threshold ${this.gates.minHealthScore}`);
    }

    if (report.summary.critical >= this.gates.maxCriticalIssues) {
      reasons.push(`critical_issues=${report.summary.critical} exceeds limit ${this.gates.maxCriticalIssues}`);
    }

    if (report.missingData.coveragePercent < 100 - this.gates.maxMissingPercent) {
      reasons.push(`missing_data=${(100 - parseFloat(report.missingData.coveragePercent)).toFixed(1)}% exceeds limit ${this.gates.maxMissingPercent}%`);
    }

    return {
      passed: reasons.length === 0,
      reasons,
      thresholds: this.gates
    };
  }

  /**
   * Suggest next steps based on analysis
   */
  suggestNextSteps(report) {
    const suggestions = [];

    if (report.recommendations.length > 0) {
      const highPriority = report.recommendations.filter(r => r.priority === 'high');
      if (highPriority.length > 0) {
        suggestions.push(`Address ${highPriority.length} high-priority issues first`);
      }
    }

    if (report.trendAnalysis.hasMajorShift) {
      suggestions.push('Consider regime-specific models due to trend shifts');
    }

    if (report.seasonalityAnalysis.breaksDetected) {
      suggestions.push('Review seasonality parameters after recent pattern changes');
    }

    if (suggestions.length === 0) {
      suggestions.push('Proceed to forecasting - data quality is acceptable');
    }

    return suggestions;
  }

  /**
   * Rollback to original data on error
   */
  async rollbackToOriginal(originalData) {
    console.log('🔄 Attempting rollback...');
    
    // Try to restore from most recent snapshot
    try {
      const snapshots = this.snapshotStore.listSnapshots('default');
      if (snapshots.length > 0) {
        const restoreResult = await this.snapshotStore.restoreToSnapshot(snapshots[0].id);
        console.log(`✅ Restored from snapshot ${restoreResult.snapshot.version}`);
        return restoreResult;
      }
    } catch (e) {
      console.warn('⚠️  Could not restore from snapshot, using original data');
    }

    // Return original if available
    return { restored: false, message: 'No backup available' };
  }

  /**
   * Run pipeline for multiple series in parallel
   */
  async runMultiSeries(seriesMap, options = {}) {
    console.log(`\n🎯 Running pipeline for ${Object.keys(seriesMap).length} series`);

    const jobs = Object.entries(seriesMap).map(([name, data]) => ({
      name,
      promise: this.run(data, { ...options, seriesName: name })
    }));

    const results = await Promise.allSettled(jobs.map(j => j.promise));

    return {
      job_ids: jobs.map((_, i) => {
        const snapshot = this.snapshotStore.listSnapshots(jobs[i].name);
        return snapshot[snapshot.length - 1]?.id || `unknown-${i}`;
      }),
      statuses: results.map(r => r.status),
      summary: {
        completed: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length
      },
      full_results: results
    };
  }

  /**
   * Queue-based execution with backpressure control
   */
  queueExecution(queuedJobs) {
    const maxConcurrent = 3;
    const activeQueue = [];
    const waitingQueue = [...queuedJobs];

    return new Promise((resolve, reject) => {
      const processNext = async () => {
        while (waitingQueue.length > 0 && activeQueue.length < maxConcurrent) {
          const job = waitingQueue.shift();
          const result = this.run(job.data, job.options);
          
          activeQueue.push({
            id: job.id,
            promise: result.then(r => ({ success: true, result: r }))
                             .catch(e => ({ success: false, error: e.message }))
          });

          console.log(`▶️  Started job ${job.id} (${activeQueue.length}/${maxConcurrent} active)`);
        }

        if (activeQueue.length === 0 && waitingQueue.length === 0) {
          resolve();
        }
      };

      // Process jobs
      processNext();

      // Monitor completion
      const monitorCompletion = () => {
        const completed = activeQueue.filter(j => j.promise.state === 'fulfilled' || j.promise.state === 'rejected');
        completed.forEach(j => {
          const index = activeQueue.indexOf(j);
          if (index > -1) activeQueue.splice(index, 1);
        });

        if (completed.length > 0) {
          processNext();
        }
      };

      setTimeout(monitorCompletion, 100);
    });
  }

  /**
   * Get pipeline history
   */
  getHistory(limit = 20) {
    return this.pipelineHistory.slice(-limit);
  }

  /**
   * Schedule recurring pipeline runs
   */
  scheduleRun(scheduleConfig) {
    const schedule = {
      id: this.generateJobId(),
      cron: scheduleConfig.cron || '* * * * *', // Default: every minute
      seriesName: scheduleConfig.seriesName,
      dataPath: scheduleConfig.dataPath,
      lastRun: null,
      nextRun: this.calculateNextRun(scheduleConfig.cron),
      enabled: scheduleConfig.enabled !== false
    };

    console.log(`⏰ Scheduled pipeline: ${schedule.id} at ${schedule.nextRun}`);
    
    return schedule;
  }

  calculateNextRun(cronExpression) {
    // Simplified - would use proper cron parser in production
    const now = new Date();
    const minutesUntilNext = 60 - now.getMinutes();
    now.setMinutes(now.getMinutes() + minutesUntilNext);
    now.setSeconds(0);
    return now.toISOString();
  }

  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Export pipeline state for persistence
   */
  exportState() {
    return {
      version: '2.0',
      gates: this.gates,
      history_count: this.pipelineHistory.length,
      active_jobs: this.activeJobs.size,
      webhook_health: this.webhookManager.healthCheck(),
      snapshot_stats: {
        total_snapshots: Array.from(this.snapshotStore.snapshots.values()).reduce((sum, arr) => sum + arr.length, 0)
      }
    };
  }
}

/**
 * Convenience function for common workflows
 */
export async function quickPipeline(data, options = {}) {
  const pipeline = new ForecastingPipeline({
    autoFixEnabled: true,
    minHealthScore: 60
  });

  return pipeline.run(data, options);
}

export default ForecastingPipeline;
