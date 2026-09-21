// Unit Tests for Update Scheduler - ForecastLab Phase 4D

import { test, suite } from 'node:test';
import { UpdateScheduler, EventTriggerSystem, AdaptiveWeighting, SlidingWindow } from '../../../src/scheduler.js';
import { strict as assert } from 'node:assert';

suite('UpdateScheduler', () => {
  test('should initialize with empty jobs list', () => {
    const scheduler = new UpdateScheduler();
    
    const jobs = scheduler.getJobs();
    assert.ok(Array.isArray(jobs));
    assert.strictEqual(jobs.length, 0);
  });

  test('should register job successfully', () => {
    const scheduler = new UpdateScheduler();
    
    const jobId = scheduler.registerJob({
      modelId: 'test_model',
      schedule: 'daily',
      action: 'refit'
    });
    
    assert.ok(jobId);
    assert(typeof jobId === 'string');
  });

  test('should generate unique job IDs', () => {
    const scheduler = new UpdateScheduler();
    
    const jobId1 = scheduler.registerJob({ modelId: 'm1', schedule: 'daily' });
    const jobId2 = scheduler.registerJob({ modelId: 'm2', schedule: 'daily' });
    
    assert.notStrictEqual(jobId1, jobId2);
  });

  test('should set correct next run time for daily schedule', () => {
    const scheduler = new UpdateScheduler();
    
    const jobId = scheduler.registerJob({
      modelId: 'test',
      schedule: 'daily',
      action: 'refit'
    });
    
    const jobs = scheduler.getJobs();
    const job = jobs[0];
    
    assert.ok(job);
    assert.ok(job.nextRun);
    
    // Next run should be roughly tomorrow
    const now = new Date();
    const nextRun = new Date(job.nextRun);
    const diffDays = (nextRun - now) / (1000 * 60 * 60 * 24);
    
    assert.ok(diffDays >= 0.9 && diffDays <= 1.1);  // Within ~24 hours
  });

  test('should calculate weekly schedule correctly', () => {
    const scheduler = new UpdateScheduler();
    
    scheduler.registerJob({
      modelId: 'test',
      schedule: 'weekly',
      action: 'refit'
    });
    
    const jobs = scheduler.getJobs();
    const job = jobs[0];
    const now = new Date();
    const nextRun = new Date(job.nextRun);
    const diffDays = (nextRun - now) / (1000 * 60 * 60 * 24);
    
    assert.ok(diffDays >= 6.5 && diffDays <= 7.5);  // Around 7 days
  });

  test('should calculate monthly schedule approximately', () => {
    const scheduler = new UpdateScheduler();
    
    scheduler.registerJob({
      modelId: 'test',
      schedule: 'monthly',
      action: 'refit'
    });
    
    const jobs = scheduler.getJobs();
    const job = jobs[0];
    const now = new Date();
    const nextRun = new Date(job.nextRun);
    const diffDays = (nextRun - now) / (1000 * 60 * 60 * 24);
    
    assert.ok(diffDays > 25);  // At least 25 days (varies by month length)
  });

  test('should track job status', async () => {
    const scheduler = new UpdateScheduler();
    
    scheduler.registerJob({
      modelId: 'test',
      schedule: 'daily',
      action: 'refit'
    });
    
    const jobs = scheduler.getJobs();
    assert.ok(jobs[0].status === 'active');
  });
});

suite('EventTriggerSystem', () => {
  test('should initialize with empty triggers', () => {
    const triggerSystem = new EventTriggerSystem({});
    
    assert.ok(triggerSystem.triggers.length === 0);
  });

  test('should add trigger successfully', () => {
    const model = {};
    const triggerSystem = new EventTriggerSystem(model);
    
    const triggerId = triggerSystem.addTrigger({
      eventType: 'error_spike',
      threshold: 2.0,
      callback: async () => {}
    });
    
    assert.ok(triggerId);
    assert(typeof triggerId === 'string');
  });

  test('should detect error spike when threshold exceeded', () => {
    const model = {};
    const triggerSystem = new EventTriggerSystem(model);
    
    triggerSystem.addTrigger({
      eventType: 'error_spike',
      threshold: 2.0,
      callback: async () => console.log('Error spike detected!')
    });
    
    const metrics = {
      currentRMSE: 100,
      baselineRMSE: 50  // Ratio = 2.0
    };
    
    const triggered = triggerSystem._detectErrorSpike(metrics, 2.0);
    
    assert.ok(triggered);
  });

  test('should not trigger below threshold', () => {
    const model = {};
    const triggerSystem = new EventTriggerSystem(model);
    
    const metrics = {
      currentRMSE: 60,
      baselineRMSE: 50  // Ratio = 1.2 < 2.0
    };
    
    const triggered = triggerSystem._detectErrorSpike(metrics, 2.0);
    
    assert.ok(!triggered);
  });

  test('should handle accuracy drop detection', () => {
    const model = {};
    const triggerSystem = new EventTriggerSystem(model);
    
    const metrics = {
      oldAccuracy: 95,
      newAccuracy: 88,
      dropThreshold: 5
    };
    
    const dropped = triggerSystem._detectAccuracyDrop(metrics, 5);
    
    assert.ok(dropped);  // Drop of 7% > 5% threshold
  });
});

suite('AdaptiveWeighting', () => {
  test('should apply exponential decay weights', () => {
    const weighting = new AdaptiveWeighting();
    
    const values = [1, 2, 3, 4, 5];
    const weights = weighting.applyDecayWeights(values, 0.9);
    
    assert.ok(weights.length === 5);
    assert.ok(weights[4] > weights[0]);  // Recent gets higher weight
  });

  test('should compute weighted statistics', () => {
    const weighting = new AdaptiveWeighting();
    
    const values = [10, 20, 30, 40, 50];
    const weights = [0.1, 0.2, 0.3, 0.2, 0.2];
    
    const stats = weighting.computeWeightedStats(values, weights);
    
    assert.ok(stats);
    assert.ok(typeof stats.mean === 'number');
    assert.ok(typeof stats.variance === 'number');
  });

  test('should compute half-life from decay factor', () => {
    const weighting = new AdaptiveWeighting();
    
    const decayFactor = 0.9;
    const halfLife = weighting.computeHalfLife(decayFactor);
    
    assert.ok(halfLife > 0);
    assert.ok(halfLife < 10);  // Should be reasonable
  });

  test('should convert half-life to decay factor', () => {
    const weighting = new AdaptiveWeighting();
    
    const decayFactor = weighting.decayFactorFromHalfLife(14);
    
    assert.ok(decayFactor > 0);
    assert.ok(decayFactor < 1);  // Decay factor should be between 0 and 1
  });

  test('decay factors should sum to approximately 1 after normalization', () => {
    const weighting = new AdaptiveWeighting();
    
    const values = Array.from({ length: 10 }, (_, i) => i + 1);
    const weights = weighting.applyDecayWeights(values, 0.9);
    
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    assert.ok(Math.abs(totalWeight - 1.0) < 0.01);
  });
});

suite('SlidingWindow', () => {
  test('should extract sliding window with numeric size', () => {
    const windowMgr = new SlidingWindow();
    
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const windowData = windowMgr.getWindow(data, 5);
    
    assert.strictEqual(windowData.length, 5);
    assert.strictEqual(windowData[0], 6);  // Last 5 elements
    assert.strictEqual(windowData[4], 10);
  });

  test('should parse string format "last_90_days"', () => {
    const windowMgr = new SlidingWindow();
    
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    const windowData = windowMgr.getWindow(data, "last_90_days");
    
    assert.strictEqual(windowData.length, 90);
  });

  test('should return all data if window larger than dataset', () => {
    const windowMgr = new SlidingWindow();
    
    const data = [1, 2, 3, 4, 5];
    const windowData = windowMgr.getWindow(data, 100);
    
    assert.strictEqual(windowData.length, 5);
  });

  test('should check minimum requirements', () => {
    const windowMgr = new SlidingWindow();
    
    const sufficient1 = windowMgr.checkMinimumRequirements([1, 2, 3], 10);
    assert.ok(!sufficient1.sufficient);
    
    const sufficient2 = windowMgr.checkMinimumRequirements([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
    assert.ok(sufficient2.sufficient);
  });

  test('should recommend window based on seasonality', () => {
    const windowMgr = new SlidingWindow();
    
    const recommendation = windowMgr.recommendWindowSize(24, 0.95);
    
    assert.ok(recommendation);
    assert.ok(recommendation.recommended >= 72);  // 3 seasonal cycles minimum
  });

  test('should handle different window sizes', () => {
    const windowMgr = new SlidingWindow();
    
    const data = Array.from({ length: 1000 }, (_, i) => i);
    
    const weekData = windowMgr.getWindow(data, "last_7_days");
    const monthData = windowMgr.getWindow(data, "last_30_days");
    const quarterData = windowMgr.getWindow(data, "last_3_months");
    
    assert.ok(weekData.length <= monthData.length);
    assert.ok(monthData.length <= quarterData.length);
  });
});
