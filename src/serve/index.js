/**
 * ForecastLab workbench server. Local-first browser workbench over the same engine as the CLI:
 * start it, open the page, and every knob re-runs the real engine against your files.
 * node:http only — no dependencies, no outbound calls, no files written.
 * 
 * This module re-exports from submodules for a clean, modular structure while preserving
 * backward compatibility with the original monolithic serve.js interface.
 */

import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-export from handlers module
export {
  send,
  sendJson,
  toOpts,
  inputFrom,
  isProtected,
  runBacktest,
  handleSummary,
  handleCompare,
  handleForecast,
  handleSimulation,
  handleScenarios,
  handleHierarchy,
  streamStatus,
  streamEvents,
} from './handlers/index.js';

// Re-export from views module
export { getClientScript, workbenchHtml } from './views/index.js';

// Re-export from utils module
export { getExamplesDir, parseQueryParams } from './utils/helpers.js';

// Server configuration
import { VERSION } from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(HERE, '..', 'examples');

/**
 * Get examples list from the examples directory.
 * @returns {Array<{id: string, name: string, project: string}>}
 */
export function listExamples() {
  let files;
  try {
    files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.forecast.json')).sort();
  } catch {
    return [];
  }
  return files.map((f) => {
    const project = join(EXAMPLES_DIR, f);
    let name = basename(f, '.forecast.json');
    try {
      name = JSON.parse(readFileSync(project, 'utf8')).name ?? name;
    } catch {
      // keep the file stem if the project file is unreadable
    }
    return { id: basename(f, '.forecast.json'), name, project };
  });
}

/**
 * Open the default browser with the given URL.
 * @param {string} url 
 */
export function openBrowser(url) {
  try {
    const arg = process.platform === 'win32' ? `"${url}"` : url;
    const [cmd, args] = process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', arg]]
      : process.platform === 'darwin'
        ? ['open', [arg]]
        : ['xdg-open', [arg]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // the printed URL is enough
  }
}

/**
 * Create an HTTP server for the ForecastLab workbench.
 * Every request re-reads the data file and re-runs the engine, so the page always reflects the CSV on disk.
 * Routes under /api that read user data require a token (issued per server start) so a web page on another origin cannot drive this server without it.
 * 
 * Options:
 * - token: Optional authentication token (defaults to random UUID)
 * - defaults: Default configuration options applied when client sends nothing
 * - streaming: Optional streaming engine instance for live updates
 * 
 * @param {Object} options 
 * @returns {import('http').Server}
 */
export function createServer(options = {}) {
  const token = options.token ?? randomUUID();
  const defaults = options.defaults ?? {};
  const streaming = options.streaming ?? null;
  
  // Client-side JavaScript asset cache
  let cachedChartAsset = null;
  
  function getStreamingChartAsset() {
    if (!cachedChartAsset) {
      const { readFileSync } = require('node:fs');
      cachedChartAsset = readFileSync(require('node:path').join(HERE, 'visualizations', 'streaming-chart.js'), 'utf8');
    }
    return cachedChartAsset;
  }

  const server = createHttpServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'Malformed request' });
    }
    const path = url.pathname;
    try {
      if (path === '/') {
        return send(res, 200, 'text/html; charset=utf-8', workbenchHtml({ token, defaults }));
      }
      if (path === '/streaming-chart.js') {
        return send(res, 200, 'application/javascript; charset=utf-8', getStreamingChartAsset());
      }
      if (path === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION });
      if (path === '/api/methods') return sendJson(res, 200, { methods: allMethodCards() });
      if (path === '/api/examples') return sendJson(res, 200, { examples: listExamples() });
      if (path === '/api/stream/status') return sendJson(res, 200, streamStatus(streaming));
      if (path === '/api/stream/events') return streamEvents(req, res, streaming);
      if (!path.startsWith('/api/')) return sendJson(res, 404, { error: `Not found: ${path}` });
      
      const name = path.slice('/api/'.length);
      if (isProtected(name) && url.searchParams.get('token') !== token) {
        if (req.headers.authorization !== `Bearer ${token}`) {
          return sendJson(res, 403, { error: 'Missing or invalid token' });
        }
      }
      
      if (name === 'summary') return sendJson(res, 200, handleSummary(url.searchParams, defaults));
      if (name === 'compare') return sendJson(res, 200, handleCompare(url.searchParams, defaults));
      if (name === 'forecast') return sendJson(res, 200, handleForecast(url.searchParams, defaults));
      if (name === 'simulation') {
        handleSimulation(url.searchParams, defaults)
          .then(r => sendJson(res, 200, r))
          .catch(e => sendJson(res, 400, { error: e.message }));
        return;
      }
      if (name === 'scenarios') {
        handleScenarios(url.searchParams, defaults)
          .then(r => sendJson(res, 200, r))
          .catch(e => sendJson(res, 400, { error: e.message }));
        return;
      }
      if (name === 'hierarchy') {
        handleHierarchy(url.searchParams, defaults)
          .then(r => sendJson(res, 200, r))
          .catch(e => sendJson(res, 400, { error: e.message }));
        return;
      }
      
      return sendJson(res, 404, { error: `Not found: ${path}` });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });
  
  return server;
}

import { allMethodCards } from '../explain.js';
