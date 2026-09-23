/**
 * Utility functions for the serve module.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../config.js';

/**
 * Get the directory path where the server module is located.
 */
export const HERE = dirname(fileURLToPath(require.main?.require ? require.main.filename : import.meta.url));

/**
 * Get examples directory path.
 * @returns {string}
 */
export function getExamplesDir() {
  return resolve(HERE, '..', 'examples');
}

/**
 * Parse query parameters to engine options.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Object}
 */
export function parseQueryParams(searchParams, defaults) {
  const opts = {};
  for (const [key, value] of searchParams) {
    if (key === 'token' || value === '') continue;
    // Boolean params
    if (['resample', 'damped'].includes(key)) {
      if (value === 'true' || value === '1') opts[key] = true;
      else if (value === 'false' || value === '0') opts[key] = false;
    } else {
      opts[key] = value;
    }
  }
  return { ...defaults, ...opts };
}
