/**
 * Test module for serve handlers.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { toOpts, isProtected } from '../../../src/serve/handlers/index.js';

test('toOpts handles boolean params', () => {
  const params = new URLSearchParams([
    ['resample', 'true'],
    ['damped', 'false'],
    ['horizon', '24']
  ]);
  const opts = toOpts(params, {});
  assert.strictEqual(opts.resample, true);
  assert.strictEqual(opts.damped, false);
  assert.strictEqual(opts.horizon, '24');
});

test('toOpts applies defaults', () => {
  const params = new URLSearchParams([['season', '12']]);
  const opts = toOpts(params, { horizon: '24' });
  assert.strictEqual(opts.horizon, '24');
  assert.strictEqual(opts.season, '12');
});

test('isProtected identifies protected endpoints', () => {
  assert.strictEqual(isProtected('summary'), true);
  assert.strictEqual(isProtected('compare'), true);
  assert.strictEqual(isProtected('forecast'), true);
  assert.strictEqual(isProtected('examples'), false);
  assert.strictEqual(isProtected('health'), false);
});
