import { test, suite } from 'node:test';
// Unit Tests for VAR Model - ForecastLab Phase 4A

import { VARModel } from '../../../src/multiSeries.js';
import { strict as assert } from 'node:assert';

suite('VARModel', () => {
  test('should initialize with default order', () => {
    const model = new VARModel();
    
    assert.strictEqual(model.order, 1);
    assert.ok(model.coefficients === null);
  });

  test('should initialize with custom order', () => {
    const model = new VARModel(2);
    
    assert.strictEqual(model.order, 2);
  });

  test('should build design matrix correctly', async () => {
    // Create simple bivariate series
    const timeSeriesMatrix = [
      [1, 2, 3, 4, 5],  // Series A
      [10, 20, 30, 40, 50]  // Series B
    ];

    const model = new VARModel(1);
    const result = await model.fit(timeSeriesMatrix);
    
    assert.ok(result.coefficients);
    assert.ok(result.rSquared !== undefined);
  });

  test('should handle small datasets', async () => {
    const timeSeriesMatrix = [
      [1, 2, 3, 4],
      [10, 20, 30, 40]
    ];

    const model = new VARModel(1);
    const result = await model.fit(timeSeriesMatrix);
    
    assert.ok(result);
    assert.strictEqual(typeof result.rSquared, 'number');
  });

  test('should compute R-squared', async () => {
    const timeSeriesMatrix = [
      [1, 2, 3, 4, 5],
      [2, 4, 6, 8, 10]  // Perfect linear relationship
    ];

    const model = new VARModel(1);
    const result = await model.fit(timeSeriesMatrix);
    
    // Should be very high for perfect correlation
    assert.ok(result.rSquared >= 0.9);
    assert.ok(result.rSquared <= 1.0);
  });

  test('should forecast ahead steps', () => {
    const model = new VARModel(1);
    
    // Mock coefficients for testing
    model.coefficients = [0.5, 0.3];
    
    // Test forecast method doesn't throw (actual values depend on implementation)
    const forecasts = model.forecast(3);
    
    assert.ok(Array.isArray(forecasts));
    assert.strictEqual(forecasts.length, 3);
  });

  test('should handle different lag orders', async () => {
    const timeSeriesMatrix = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    ];

    const model = new VARModel(3);
    const result = await model.fit(timeSeriesMatrix);
    
    assert.ok(result);
  });
});
