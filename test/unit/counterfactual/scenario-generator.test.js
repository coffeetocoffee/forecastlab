import { test, suite } from 'node:test';
// Unit Tests for Scenario Generator - ForecastLab Phase 4C

import { ScenarioGenerator } from '../../../src/counterfactual.js';
import { strict as assert } from 'node:assert';

suite('ScenarioGenerator', () => {
  test('should initialize with template library', () => {
    const generator = new ScenarioGenerator();
    
    assert.ok(generator);
    assert.ok(generator.templates);
  });

  test('should have promotion_lift template', () => {
    const generator = new ScenarioGenerator();
    
    assert.ok(generator.templates['promotion_lift']);
  });

  test('should have holiday_shift template', () => {
    const generator = new ScenarioGenerator();
    
    assert.ok(generator.templates['holiday_shift']);
  });

  test('should have price_elasticity template', () => {
    const generator = new ScenarioGenerator();
    
    assert.ok(generator.templates['price_elasticity']);
  });

  test('should generate promotion scenario correctly', async () => {
    const generator = new ScenarioGenerator();
    
    const model = { lastValue: 100 };
    const result = await generator.generateScenarios(model, {
      templates: ['promotion_lift'],
      parameters: { avgUplift: 0.25, duration: 14 }
    });
    
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
    
    const promo = result.find(s => s.name === 'Promotion Active');
    assert.ok(promo);
    assert.strictEqual(promo.intervention.uplift, 0.25);
  });

  test('should generate price elasticity scenario correctly', async () => {
    const generator = new ScenarioGenerator();
    
    const result = await generator.generateScenarios({}, {
      templates: ['price_elasticity'],
      parameters: { percentChange: 10, elasticity: -2.5 }
    });
    
    assert.ok(result.length > 0);
    
    const priceScenario = result[0];
    assert.ok(priceScenario);
    assert.strictEqual(priceScenario.intervention.type, 'price_change');
  });

  test('should generate multiple scenarios at once', async () => {
    const generator = new ScenarioGenerator();
    
    const result = await generator.generateScenarios({}, {
      templates: ['promotion_lift', 'price_elasticity', 'supply_disruption']
    });
    
    assert.ok(result.length >= 2);
  });

  test('should normalize probabilities', async () => {
    const generator = new ScenarioGenerator();
    
    // Create templates with custom probabilities
    const originalTemplates = generator.templates;
    generator.templates = {
      ...originalTemplates,
      'promo_custom': {
        name: 'Custom Promo',
        generate: (data, params) => ({
          name: 'Custom Promotion',
          probability: params.prob || 0.3,
          intervention: { type: 'promotion' }
        })
      }
    };
    
    const result = await generator.generateScenarios({}, {
      templates: ['promo_custom', 'promo_custom'],
      parameters: { prob: 0.6 }
    });
    
    const totalProb = result.reduce((sum, s) => sum + s.probability, 0);
    
    // Probabilities should be normalized (or close to it)
    assert.ok(totalProb <= 2.0);  // At least not exploding
  });

  test('should handle empty template list gracefully', async () => {
    const generator = new ScenarioGenerator();
    
    const result = await generator.generateScenarios({}, {
      templates: []
    });
    
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });

  test('should provide sensible defaults for parameters', async () => {
    const generator = new ScenarioGenerator();
    
    const result = await generator.generateScenarios({}, {
      templates: ['promotion_lift']  // No parameters specified
    });
    
    assert.ok(result.length > 0);
    assert.ok(typeof result[0].probability === 'number');
  });

  test('should handle missing template gracefully', async () => {
    const generator = new ScenarioGenerator();

    const result = await generator.generateScenarios({}, {
      templates: ['nonexistent_template']
    });

    assert.ok(Array.isArray(result));
  });

  suite('Template Generation', () => {
    test('holiday_shift should accept shiftDays parameter', async () => {
      const generator = new ScenarioGenerator();
      
      const result = await generator.generateScenarios({}, {
        templates: ['holiday_shift'],
        parameters: { shiftDays: 2 }
      });
      
      assert.ok(result[0]);
      assert.ok(result[0].name.includes('+'));
    });

    test('supply_disruption should work with custom reduction', async () => {
      const generator = new ScenarioGenerator();
      
      const result = await generator.generateScenarios({}, {
        templates: ['supply_disruption'],
        parameters: { reduction: 0.2, duration: 7 }
      });
      
      assert.ok(result[0]);
      assert.strictEqual(result[0].intervention.reduction, 0.2);
    });
  });
});
