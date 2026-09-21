/**
 * Real-Time Adaptation Module - ForecastLab Phase 4D
 * 
 * Scheduled retraining, event-triggered updates, adaptive weighting,
 * and sliding window refitting for dynamic data environments.
 * 
 * @module scheduler
 */

class UpdateScheduler {
    /**
     * Create update scheduler
     */
    constructor() {
        this.jobs = [];
        this.eventListeners = {};
    }

    /**
     * Register an update job
     */
    registerJob(jobConfig) {
        const job = {
            id: this._generateUUID(),
            modelId: jobConfig.modelId,
            schedule: jobConfig.schedule || 'daily',
            timezone: jobConfig.timezone || 'UTC',
            action: jobConfig.action || 'refit',
            options: jobConfig.options || {},
            createdAt: new Date().toISOString(),
            lastRun: null,
            nextRun: this._calculateNextRun(jobConfig.schedule),
            status: 'active'
        };

        this.jobs.push(job);
        return job.id;
    }

    _calculateNextRun(schedule) {
        const now = new Date();
        
        switch (schedule) {
            case 'daily':
                now.setDate(now.getDate() + 1);
                break;
            case 'weekly':
                now.setDate(now.getDate() + 7);
                break;
            case 'monthly':
                now.setMonth(now.getMonth() + 1);
                break;
            default:
                now.setDate(now.getDate() + 1);
        }
        
        return now.toISOString();
    }

    /**
     * Execute scheduled jobs
     */
    async executeJobs() {
        const now = new Date();
        const executed = [];

        for (const job of this.jobs) {
            if (job.status !== 'active') continue;
            
            if (new Date(job.nextRun) <= now) {
                try {
                    await this._executeJob(job);
                    job.lastRun = now.toISOString();
                    job.nextRun = this._calculateNextRun(job.schedule);
                    executed.push(job.id);
                } catch (error) {
                    console.error(`Job ${job.id} failed:`, error.message);
                }
            }
        }

        return { executed, timestamp: now.toISOString() };
    }

    async _executeJob(job) {
        // Log execution
        console.log(`Executing job ${job.id} for model ${job.modelId}`);
        
        // Perform action based on type
        switch (job.action) {
            case 'refit':
                return this._triggerRefit(job);
            case 'validate':
                return this._triggerValidation(job);
            case 'export':
                return this._triggerExport(job);
            default:
                throw new Error(`Unknown action: ${job.action}`);
        }
    }

    _triggerRefit(job) {
        // Placeholder - would integrate with actual refit logic
        return Promise.resolve({ job, success: true });
    }

    _triggerValidation(job) {
        return Promise.resolve({ job, success: true });
    }

    _triggerExport(job) {
        return Promise.resolve({ job, success: true });
    }

    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Get scheduled jobs
     */
    getJobs() {
        return this.jobs;
    }
}

/**
 * Event-Triggered Update System
 * Automatically trigger updates based on detected events
 */
class EventTriggerSystem {
    constructor(model) {
        this.model = model;
        this.triggers = [];
        this.thresholds = {
            errorSpike: 2.0,  // RMSE multiplier for spike detection
            structuralBreakAlpha: 0.05
        };
    }

    /**
     * Add trigger condition
     */
    addTrigger(triggerConfig) {
        const trigger = {
            id: this._generateUUID(),
            eventType: triggerConfig.eventType,
            threshold: triggerConfig.threshold,
            callback: triggerConfig.callback,
            active: true
        };

        this.triggers.push(trigger);
        return trigger.id;
    }

    /**
     * Monitor and detect events
     */
    async monitorEvents(currentMetrics) {
        const triggered = [];

        for (const trigger of this.triggers) {
            if (!trigger.active) continue;

            const eventDetected = await this._detectEvent(trigger, currentMetrics);
            
            if (eventDetected) {
                try {
                    await trigger.callback();
                    triggered.push({
                        triggerId: trigger.id,
                        eventType: trigger.eventType,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    console.error(`Trigger ${trigger.id} callback failed:`, error);
                }
            }
        }

        return triggered;
    }

    async _detectEvent(trigger, metrics) {
        switch (trigger.eventType) {
            case 'error_spike':
                return this._detectErrorSpike(metrics, trigger.threshold);
            
            case 'structural_break':
                return this._detectStructuralBreak(metrics);
            
            case 'accuracy_drop':
                return this._detectAccuracyDrop(metrics, trigger.threshold);
            
            default:
                return false;
        }
    }

    _detectErrorSpike(metrics, threshold) {
        if (!metrics.currentRMSE || !metrics.baselineRMSE) return false;
        
        const ratio = metrics.currentRMSE / metrics.baselineRMSE;
        return ratio > threshold;
    }

    _detectStructuralBreak(metrics) {
        // Simplified - would use actual CUSUM/Chow test
        if (!metrics.cusumValue || !metrics.threshold) return false;
        
        return Math.abs(metrics.cusumValue) > metrics.threshold;
    }

    _detectAccuracyDrop(metrics, threshold) {
        if (!metrics.oldAccuracy || !metrics.newAccuracy) return false;
        
        const drop = metrics.oldAccuracy - metrics.newAccuracy;
        return drop > threshold;
    }

    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

/**
 * Adaptive Weighting Engine
 * Give recency emphasis during model fitting
 */
class AdaptiveWeighting {
    constructor() {
        // Pure calculation engine
    }

    /**
     * Apply exponential decay weights to observations
     */
    applyDecayWeights(values, decayFactor) {
        const n = values.length;
        const weights = Array(n).fill(0);
        
        // Exponential decay: w_t = ρ^(n-t)
        for (let t = 0; t < n; t++) {
            weights[t] = Math.pow(decayFactor, n - t);
        }
        
        // Normalize weights
        const sumWeights = weights.reduce((sum, w) => sum + w, 0);
        const normalizedWeights = weights.map(w => w / sumWeights);
        
        return normalizedWeights;
    }

    /**
     * Compute weighted statistics
     */
    computeWeightedStats(values, weights) {
        const weightedSum = values.reduce((sum, v, i) => sum + v * weights[i], 0);
        const weightTotal = weights.reduce((sum, w) => sum + w, 0);
        
        const weightedMean = weightedSum / weightTotal;
        
        const weightedVariance = values.reduce((sum, v, i) => {
            return sum + weights[i] * Math.pow(v - weightedMean, 2);
        }, 0) / weightTotal;
        
        return {
            mean: weightedMean,
            variance: weightedVariance,
            stdDev: Math.sqrt(weightedVariance)
        };
    }

    /**
     * Compute half-life from decay factor
     */
    computeHalfLife(decayFactor) {
        // Half-life: when ρ^t = 0.5
        return Math.log(0.5) / Math.log(decayFactor);
    }

    /**
     * Decay factor from desired half-life
     */
    decayFactorFromHalfLife(halfLife) {
        // ρ = 0.5^(1/half-life)
        return Math.pow(0.5, 1 / halfLife);
    }
}

/**
 * Sliding Window Refitting
 * Use only recent N observations for fitting
 */
class SlidingWindow {
    constructor() {
        // Stateless window manager
    }

    /**
     * Extract sliding window from time series
     */
    getWindow(data, windowSize) {
        if (typeof windowSize === 'string') {
            // Parse string format like "last_90_days"
            const match = windowSize.match(/last_(\d+)_?(\w*)/);
            if (match) {
                const numDays = parseInt(match[1]);
                const unit = match[2] || 'days';
                
                switch (unit) {
                    case 'days':
                        windowSize = numDays;
                        break;
                    case 'weeks':
                        windowSize = numDays * 7;
                        break;
                    case 'months':
                        windowSize = numDays * 30;
                        break;
                    default:
                        windowSize = numDays;
                }
            }
        }
        
        if (data.length <= windowSize) {
            return { ...data };
        }
        
        return {
            ...data.slice(-windowSize),
            windowStartIndex: data.length - windowSize,
            windowEndIndex: data.length
        };
    }

    /**
     * Check if window contains enough data for reliable fitting
     */
    checkMinimumRequirements(data, minPoints, seasonalityPeriod) {
        const n = data.length;
        
        // Need at least minPoints observations
        if (n < minPoints) {
            return {
                sufficient: false,
                reason: `Insufficient observations: ${n} < ${minPoints}`
            };
        }
        
        // Need at least 2 full seasons for seasonal models
        if (seasonalityPeriod && n < 2 * seasonalityPeriod) {
            return {
                sufficient: false,
                reason: `Need more history for seasonality: ${n} < ${2 * seasonalityPeriod}`
            };
        }
        
        return { sufficient: true };
    }

    /**
     * Optimal window size recommendation
     */
    recommendWindowSize(seasonalityPeriod, confidenceLevel = 0.95) {
        // Balance between statistical power and recency
        const baseWindowSize = Math.max(
            30,  // Minimum 30 observations
            seasonalityPeriod ? 3 * seasonalityPeriod : 90  // At least 3 seasonal cycles
        );
        
        return {
            recommended: baseWindowSize,
            minimum: confidenceLevel === 0.99 ? baseWindowSize * 1.5 : baseWindowSize,
            rationale: `Based on ${confidenceLevel * 100}% confidence, seasonality=${seasonalityPeriod}, min points=30`
        };
    }
}

// Export modules
export {
    UpdateScheduler,
    EventTriggerSystem,
    AdaptiveWeighting,
    SlidingWindow
};
