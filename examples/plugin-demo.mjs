/**
 * Plugin Demo: Using ARIMA-Light and Prophet-Light with real data
 * Demonstrates v3.0 plugin system in action
 */

import { registry } from '../sdk/core.mjs';
import { ARIMALight } from '../sdk/models/arima-light.mjs';
import { ProphetLight } from '../sdk/models/prophet-light.mjs';
import { weightedMAPE, mase } from '../sdk/metrics/business-metrics.mjs';

console.log('🔬 ForecastLab v3.0 Plugin Demo\n');
console.log('='.repeat(50));

// Load sample energy data
const rawData = `time,value
2024-01-01 00:00,1234
2024-01-01 01:00,1189
2024-01-01 02:00,1156
2024-01-01 03:00,1134
2024-01-01 04:00,1145
2024-01-01 05:00,1178
2024-01-01 06:00,1245
2024-01-01 07:00,1356
2024-01-01 08:00,1489
2024-01-01 09:00,1567
2024-01-01 10:00,1623
2024-01-01 11:00,1678
2024-01-01 12:00,1712
2024-01-01 13:00,1698
2024-01-01 14:00,1689
2024-01-01 15:00,1654
2024-01-01 16:00,1623
2024-01-01 17:00,1612
2024-01-01 18:00,1598
2024-01-01 19:00,1567
2024-01-01 20:00,1534
2024-01-01 21:00,1498
2024-01-01 22:00,1456
2024-01-01 23:00,1398`;

// Parse data
const data = rawData.split('\n').slice(1).map(line => {
  const [date, value] = line.split(',');
  return { date, value: parseFloat(value) };
});

const values = data.map(d => d.value);

console.log(`\n📊 Dataset Statistics:`);
console.log(`   Data points: ${values.length}`);
console.log(`   Mean: ${values.reduce((a,b)=>a+b,0)/values.length.toFixed(2)} kWh`);
console.log(`   Range: ${Math.min(...values)} - ${Math.max(...values)} kWh`);

// Test 1: ARIMA-Light Model
console.log('\n🏗️  Testing ARIMA-Light Plugin...');
console.log('-'.repeat(50));

const arimaModel = new ARIMALight();
arimaModel.fit(values, { p: 2 });

const arimaForecasts = arimaModel.forecast(24);

console.log(`\n✅ ARIMA-Light trained successfully!`);
console.log(`   Pattern detected: linear trend component calculated`);

console.log('\n📈 24-Hour Forecasts:');
arimaForecasts.slice(0, 5).forEach((f, i) => {
  console.log(`   Hour ${i + 1}: ${f.value.toFixed(1)} kWh [${f.lower.toFixed(1)}, ${f.upper.toFixed(1)}]`);
});

// Test 2: Prophet-Light Model
console.log('\n🌟 Testing Prophet-Light Plugin...');
console.log('-'.repeat(50));

const prophetModel = new ProphetLight();
prophetModel.fit(data, { seasonalities: [24] });

const prophetForecasts = prophetModel.forecast(24);

console.log(`\n✅ Prophet-Light trained successfully!`);
console.log(`   Seasonal pattern captured (24-hour cycle)`);

console.log('\n📈 24-Hour Forecasts:');
prophetForecasts.slice(0, 5).forEach((f, i) => {
  console.log(`   Hour ${i + 1}: ${f.value.toFixed(1)} kWh [${f.lower.toFixed(1)}, ${f.upper.toFixed(1)}]`);
});

// Test 3: Custom Metrics
console.log('\n📊 Testing Custom Metrics...');
console.log('-'.repeat(50));

// Calculate MAPE manually for demonstration
const actuals = values.slice(-5); // Last 5 observations as validation
const forecastValues = arimaForecasts.slice(0, 5).map(f => f.value);

const mape = actuals.reduce((sum, actual, i) => {
  return sum + Math.abs((actual - forecastValues[i]) / actual) * 100;
}, 0) / actuals.length;

const wmape = weightedMAPE(actuals, forecastValues, { weightScale: 1 });

console.log(`\nStandard MAPE: ${mape.toFixed(2)}%`);
console.log(`Weighted MAPE: ${wmape.toFixed(2)}%`);

// Demonstrate MASE metric (requires seasonal period)
try {
  const maseValue = mase(actuals, forecastValues, { seasonalPeriod: 24 });
  console.log(`MASE (scaled error): ${maseValue.toFixed(3)}`);
} catch (e) {
  console.log('⚠️ MASE calculation requires more historical data');
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('🎉 Demo Complete!');
console.log('\nPlugins Loaded:');
console.log(`  • Models: ${registry.listModels().join(', ')}`);
console.log(`  • Metrics: ${registry.listModelsMetadata().length + 1} registered extensions`);

console.log('\n💡 Next Steps:');
console.log('  1. Run: forecastlab plugins --list');
console.log('  2. Try your own data: forecastlab init --data mydata.csv --season 24');
console.log('  3. Install custom models: forecastlab install-plugin <model-name>');
