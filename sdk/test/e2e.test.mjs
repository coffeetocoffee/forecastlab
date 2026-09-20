import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load example dataset
const testData = readFileSync('examples/energy-hourly.csv', 'utf8').split('\n').slice(1).map(line => {
  const [time, value] = line.split(',');
  return { date: time, value: parseFloat(value) };
}).slice(0, 100); // Use first 100 points for quick test

test('ARIMA-Light can forecast energy data', async () => {
  const { ARIMALight } = await import('../../sdk/models/arima-light.mjs');
  
  const model = new ARIMALight();
  model.fit(testData.map(d => d.value), { p: 2 });
  
  const forecasts = model.forecast(24);
  
  assert.strictEqual(forecasts.length, 24, 'Should produce 24-step forecast');
  assert.ok(forecasts[0].value > 0, 'Forecast value should be positive');
  assert.ok(forecasts[0].lower < forecasts[0].value, 'Lower bound should be below prediction');
  assert.ok(forecasts[0].upper > forecasts[0].value, 'Upper bound should be above prediction');
});

test('Prophet-Light captures seasonality', async () => {
  const { ProphetLight } = await import('../../sdk/models/prophet-light.mjs');
  
  const model = new ProphetLight();
  model.fit(testData, { seasonalities: [24] });
  
  const forecasts = model.forecast(48);
  
  assert.strictEqual(forecasts.length, 48);
  assert.ok(typeof model.explain() === 'string');
  assert.ok(model.explain().length > 100);
});
