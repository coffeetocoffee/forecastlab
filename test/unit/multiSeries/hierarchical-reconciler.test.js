import { test, suite } from 'node:test';
// Unit Tests for HierarchicalReconciler - ForecastLab Phase 4A

import { HierarchicalReconciler } from '../../../src/multiSeries.js';
import { strict as assert } from 'node:assert';

const VERSION = await import('node:os').then(os => os.platform());

suite('HierarchicalReconciler', () => {
  test('should initialize with valid hierarchy config', () => {
    const config = {
      levels: ['region', 'product'],
      series: {
        'total': ['na', 'na'],
        'east_electronics': ['east', 'electronics'],
        'east_clothing': ['east', 'clothing'],
        'west_electronics': ['west', 'electronics'],
        'west_clothing': ['west', 'clothing']
      }
    };

    const reconciler = new HierarchicalReconciler(config);
    
    assert.ok(reconciler);
    assert.strictEqual(reconciler.hierarchy.levels.length, 2);
    assert.strictEqual(reconciler.hierarchy.nodes.length, 5);
  });

  test('should build correct aggregation matrix', () => {
    const config = {
      levels: ['level1', 'level2'],
      series: {
        'total': [],
        'l1a': ['l1a'],
        'l1b': ['l1b'],
        'l1a_l2_1': ['l1a', 'l2_1']
      }
    };

    const reconciler = new HierarchicalReconciler(config);
    const matrix = reconciler.buildAggregationMatrix();
    
    // total should include all children
    assert.strictEqual(matrix[0]['l1a'], 1);
    assert.strictEqual(matrix[0]['l1b'], 1);
  });

  test('should identify base level nodes correctly', () => {
    const config = {
      levels: ['region', 'product'],
      series: {
        'total': ['na', 'na'],
        'east': ['east'],
        'east_electronics': ['east', 'electronics']
      }
    };

    const reconciler = new HierarchicalReconciler(config);
    
    assert.ok(reconciler._isBaseLevel('east_electronics'));
    assert.ok(!reconciler._isBaseLevel('east'));
    assert.ok(!reconciler._isBaseLevel('total'));
  });

  test('should detect descendant relationships', () => {
    const config = {
      levels: ['region'],
      series: {
        'total': [],
        'east': ['east'],
        'west': ['west']
      }
    };

    const reconciler = new HierarchicalReconciler(config);
    
    // 'total' is ancestor of everything
    assert.ok(reconciler._isDescendant(['east'], []));
    assert.ok(reconciler._isDescendant(['west'], []));
    
    // But not vice versa
    assert.ok(!reconciler._isDescendant([], ['east']));
  });

  test('should handle empty hierarchy gracefully', () => {
    const config = {
      levels: [],
      series: {}
    };

    const reconciler = new HierarchicalReconciler(config);
    
    assert.strictEqual(reconciler.hierarchy.nodes.length, 0);
  });

  test('should parse multi-level hierarchy', () => {
    const config = {
      levels: ['country', 'region', 'product'],
      series: {
        'total': ['na', 'na', 'na'],
        'usa': ['usa'],
        'usa_east': ['usa', 'east'],
        'usa_east_elec': ['usa', 'east', 'elec']
      }
    };

    const reconciler = new HierarchicalReconciler(config);
    
    assert.strictEqual(reconciler.hierarchy.levels.length, 3);
    assert.strictEqual(reconciler.hierarchy.seriesMap['usa_east_elec'].length, 3);
  });
});
