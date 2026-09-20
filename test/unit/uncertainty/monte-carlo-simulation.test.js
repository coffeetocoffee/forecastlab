// Unit Tests for Monte Carlo Simulation - ForecastLab Phase 4B

import { MonteCarloSimulator } from '../../src/uncertainty.js';
import { strict as assert } from 'node:assert';

suite('MonteCarloSimulator', () => {
  test('should initialize with default parameters', () => {
    const simulator = new MonteCarloSimulator();
    
    assert.strictEqual(simulator.nSims, 10000);
    assert.ok(simulator.seed !== undefined);
  });

  test('should accept custom number of simulations', () => {
    const simulator = new MonteCarloSimulator({ nSims: 5000 });
    
    assert.strictEqual(simulator.nSims, 5000);
  });

  test('should use fixed seed for reproducibility', () => {
    const simulator1 = new MonteCarloSimulator({ nSims: 100, seed: 12345 });
    const simulator2 = new MonteCarloSimulator({ nSims: 100, seed: 12345 });
    
    // First random value should be same
    const rand1a = simulator1._random();
    const rand2a = simulator2._random();
    
    assert.strictEqual(rand1a, rand2a);
  });

  test('should generate normal random variables', () => {
    const simulator = new MonteCarloSimulator({ nSims: 1000, seed: 1 });
    
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      const val = simulator._randomNormal();
      sum += val;
    }
    
    const mean = sum / 100;
    
    // Mean should be close to 0
    assert.ok(Math.abs(mean) < 0.2);
  });

  test('should simulate paths successfully', async () => {
    const simulator = new MonteCarloSimulator({ nSims: 100 });
    
    const model = {
      stdDev: 1,
      lastValue: 100,
      trend: 0.5
    };
    
    const horizon = 10;
    const paths = await simulator.simulatePaths(model, horizon);
    
    assert.ok(Array.isArray(paths));
    assert.strictEqual(paths.length, 100);
    assert.strictEqual(paths[0].length, horizon);
  });

  test('should compute cumulative interval', () => {
    const simulator = new MonteCarloSimulator({ nSims: 1000 });
    
    // Create synthetic paths
    const paths = Array.from({ length: 1000 }, () => 
      Array.from({ length: 30 }, () => Math.random() * 10 + 50)
    );
    
    const interval = simulator.computeCumulativeInterval(paths, 7, 0.95);
    
    assert.ok(interval);
    assert.strictEqual(interval.confidence, 0.95);
    assert.ok(typeof interval.pointEstimate === 'number');
    assert.ok(typeof interval.interval.lower === 'number');
    assert.ok(typeof interval.interval.upper === 'number');
  });

  test('should compute joint bands with simulation method', () => {
    const simulator = new MonteCarloSimulator({ nSims: 1000 });
    
    const paths = Array.from({ length: 1000 }, () => 
      Array.from({ length: 24 }, () => Math.random() * 100)
    );
    
    const bands = simulator.computeJointBands(paths, 0.95, 'simulation');
    
    assert.ok(bands);
    assert.ok(Array.isArray(bands.lower));
    assert.ok(Array.isArray(bands.upper));
    assert.strictEqual(bands.lower.length, 24);
    assert.strictEqual(bands.upper.length, 24);
  });

  test('should compute joint bands with Bonferroni correction', () => {
    const simulator = new MonteCarloSimulator({ nSims: 1000 });
    
    const paths = Array.from({ length: 1000 }, () => 
      Array.from({ length: 12 }, () => Math.random() * 100)
    );
    
    const bands = simulator.computeJointBands(paths, 0.95, 'bonferroni');
    
    assert.ok(bands);
    assert.strictEqual(bands.lower.length, 12);
  });

  test('should compute risk metrics', () => {
    const simulator = new MonteCarloSimulator({ nSims: 10000 });
    
    const paths = Array.from({ length: 10000 }, () => 
      Array.from({ length: 10 }, () => Math.random() * 100)
    );
    
    const metrics = simulator.computeRiskMetrics(paths, 10, 0.95);
    
    assert.ok(metrics);
    assert.ok(typeof metrics.var_95 === 'number');
    assert.ok(typeof metrics.cvar_95 === 'number');
    assert.ok(typeof metrics.downsideProbability === 'number');
  });

  test('should handle very small number of simulations', () => {
    const simulator = new MonteCarloSimulator({ nSims: 10 });
    
    const model = { stdDev: 1, lastValue: 50 };
    const paths = simulator.simulatePaths(model, 5);
    
    assert.strictEqual(paths.length, 10);
  });

  suite('_inverseNormalCDF', () => {
    test('should reject probability <= 0', () => {
      const simulator = new MonteCarloSimulator();
      
      assert.throws(() => simulator._inverseNormalCDF(0), Error);
    });

    test('should reject probability >= 1', () => {
      const simulator = new MonteCarloSimulator();
      
      assert.throws(() => simulator._inverseNormalCDF(1), Error);
    });

    test('should return reasonable values for common probabilities', () => {
      const simulator = new MonteCarloSimulator();
      
      const z05 = simulator._inverseNormalCDF(0.5);
      const z95 = simulator._inverseNormalCDF(0.95);
      
      assert.ok(Math.abs(z05) < 0.01);  // Should be ~0
      assert.ok(z95 > 1.6);  // Should be ~1.645
    });
  });
});
