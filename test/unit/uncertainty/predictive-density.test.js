// Unit Tests for Predictive Density - ForecastLab Phase 4B

import { test, suite } from 'node:test';
import { PredictiveDensity } from '../../../src/uncertainty.js';
import { strict as assert } from 'node:assert';

suite('PredictiveDensity', () => {
  test('should initialize with default gaussian distribution', () => {
    const density = new PredictiveDensity({ mu: 100, sigma: 10 });
    
    assert.strictEqual(density.distribution, 'gaussian');
    assert.strictEqual(density.mu, 100);
    assert.strictEqual(density.sigma, 10);
  });

  test('should accept custom distribution type', () => {
    const density = new PredictiveDensity({ 
      mu: 100, 
      sigma: 10, 
      distribution: 'student-t' 
    });
    
    assert.strictEqual(density.distribution, 'student-t');
  });

  test('should compute Gaussian PDF correctly', () => {
    const density = new PredictiveDensity({ mu: 0, sigma: 1 });
    
    // At mean, PDF should be maximum
    const pdfAtMean = density.pdf(0);
    const pdfAwayFromMean = density.pdf(2);
    
    assert.ok(pdfAtMean > pdfAwayFromMean);
    assert.ok(pdfAtMean > 0);
    assert.ok(pdfAwayFromMean > 0);
  });

  test('should compute Student-t PDF correctly', () => {
    const density = new PredictiveDensity({ 
      mu: 0, 
      sigma: 1, 
      distribution: 'student-t',
      df: 5 
    });
    
    const pdfValue = density.pdf(0);
    
    assert.ok(typeof pdfValue === 'number');
    assert.ok(pdfValue > 0);
  });

  test('should compute CDF correctly for gaussian', () => {
    const density = new PredictiveDensity({ mu: 0, sigma: 1 });
    
    const cdfAt0 = density.cdf(0);
    const cdfAtZ = density.cdf(1.96);
    
    // Should be approximately correct
    assert.ok(Math.abs(cdfAt0 - 0.5) < 0.05);
    assert.ok(cdfAtZ > 0.9);  // P(Z <= 1.96) ≈ 0.975
  });

  test('should compute quantile correctly', () => {
    const density = new PredictiveDensity({ mu: 0, sigma: 1 });
    
    const median = density.quantile(0.5);
    const q95 = density.quantile(0.95);
    
    assert.ok(Math.abs(median) < 0.1);  // Close to 0
    assert.ok(q95 > 1.5);  // Should be ~1.645
  });

  test('should handle different means', () => {
    const density = new PredictiveDensity({ mu: 100, sigma: 10 });
    
    const median = density.quantile(0.5);
    
    assert.ok(Math.abs(median - 100) < 1);  // Should be close to mean
  });

  test('should handle different standard deviations', () => {
    const densitySmall = new PredictiveDensity({ mu: 0, sigma: 1 });
    const densityLarge = new PredictiveDensity({ mu: 0, sigma: 10 });
    
    const q95_small = densitySmall.quantile(0.95);
    const q95_large = densityLarge.quantile(0.95);
    
    assert.ok(q95_large > q95_small);  // Larger sigma should give larger quantiles
  });

  test('should produce valid probability values', () => {
    const density = new PredictiveDensity({ mu: 0, sigma: 1 });
    
    let sumPDF = 0;
    for (let x = -3; x <= 3; x += 0.5) {
      const pdf = density.pdf(x);
      assert.ok(pdf >= 0 && pdf <= 1);
      sumPDF += pdf;
    }
    
    // Integral approximation should be reasonable
    assert.ok(sumPDF > 0);
  });

  test('should handle extreme values gracefully', () => {
    const density = new PredictiveDensity({ mu: 0, sigma: 1 });
    
    const pdfExtreme = density.pdf(10);
    const cdfExtreme = density.cdf(-10);
    
    assert.ok(pdfExtreme >= 0);
    assert.ok(cdfExtreme >= 0 && cdfExtreme <= 1);
  });
});
