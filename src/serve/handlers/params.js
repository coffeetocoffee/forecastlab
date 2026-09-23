/**
 * Query parameter handling utilities.
 */

const BOOL_PARAMS = new Set(['resample', 'damped']);
const PROTECTED = new Set(['summary', 'compare', 'forecast']);

/**
 * Convert query params to engine options.
 * The server's CLI defaults (e.g. `serve --project x.forecast.json`) apply where the client sends nothing, so a bare request reproduces the settings the server started with. Flags are sent explicitly by the page: 'false' overrides a project file's setting.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {Object}
 */
export function toOpts(searchParams, defaults) {
  const opts = {};
  for (const [key, value] of searchParams) {
    if (key === 'token' || value === '') continue;
    if (BOOL_PARAMS.has(key)) {
      if (value === 'true' || value === '1') opts[key] = true;
      else if (value === 'false' || value === '0') opts[key] = false;
    } else {
      opts[key] = value;
    }
  }
  return { ...defaults, ...opts };
}

/**
 * Resolve input from search parameters and defaults.
 * @param {URLSearchParams} searchParams 
 * @param {Object} defaults 
 * @returns {*}
 */
export function inputFrom(searchParams, defaults) {
  const { resolveInput } = require('../../index.js');
  return resolveInput(toOpts(searchParams, defaults));
}

/**
 * Check if a protected endpoint requires authentication.
 * @param {string} name 
 * @returns {boolean}
 */
export function isProtected(name) {
  return PROTECTED.has(name);
}
