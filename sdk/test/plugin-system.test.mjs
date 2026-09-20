import { test } from 'node:test';
import assert from 'node:assert';
import { registry } from '../../sdk/core.mjs';
import { ARIMALight } from '../models/arima-light.mjs';

test('PluginRegistry can register models', () => {
  const testModel = class TestModel {
    fit(data) { return this; }
    forecast() { return []; }
    explain() { return ''; }
  };
  
  registry.registerModel('test-model', testModel);
  assert.ok(registry.hasModel('test-model'));
});

test('PluginRegistry throws error on invalid model', () => {
  const badModel = class BadModel {
    fit(data) { return this; }
    // Missing forecast and explain methods
  };
  
  assert.throws(() => {
    registry.registerModel('bad-model', badModel);
  }, Error);
});

test('ARIMALight model fits data successfully', (done) => {
  const testData = [100, 105, 110, 108, 112, 115, 120, 118, 122, 125];
  const model = new ARIMALight();
  
  try {
    model.fit(testData, { p: 1 });
    
    const forecasts = model.forecast(3);
    
    assert.strictEqual(forecasts.length, 3);
    assert.ok(typeof forecasts[0].value === 'number');
    assert.ok(typeof forecasts[0].lower === 'number');
    assert.ok(typeof forecasts[0].upper === 'number');
    
    done();
  } catch (error) {
    done(error);
  }
});

test('ARIMALight provides explanation', () => {
  const model = new ARIMALight();
  const explanation = model.explain();
  
  assert.ok(explanation.includes('autoregressive') || explanation.length > 50);
});

test('Custom metrics are registered', () => {
  const metric = function testMetric(actuals, forecasts) {
    return 0.5;
  };
  
  registry.registerMetric('test-metric', metric);
  const retrieved = registry.getMetric('test-metric');
  
  assert.ok(retrieved !== undefined);
  assert.strictEqual(retrieved(100, 95), 0.5);
});

test('listModels returns registered models', () => {
  const models = registry.listModels();
  assert.ok(Array.isArray(models));
});
