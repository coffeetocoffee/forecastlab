/**
 * Streaming and live update handlers.
 */

import { send as httpResponseSend } from './response.js';

/**
 * Live-update endpoints for the streaming layer (Server-Sent Events).
 * @param {*} engine 
 * @returns {Object}
 */
export function streamStatus(engine) {
  if (!engine) return { enabled: false, hint: 'Restart serve with --feed file:<path> to attach a streaming engine.' };
  return { enabled: true, ...engine.status() };
}

/**
 * Handle streaming events endpoint (SSE).
 * @param {import('http').IncomingMessage} req 
 * @param {import('http').ServerResponse} res 
 * @param {*} engine 
 */
export function streamEvents(req, res, engine) {
  if (!engine) return httpResponseSend(res, 200, { error: 'No streaming engine attached. Restart serve with --feed file:<path>.' });
  
  const send = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {}
  };
  
  for (const e of engine.history(20)) send(e); // catch the client up first
  const unsub = engine.hub.subscribe(send);
  
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {}
  }, 25000);
  
  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
  });
}

/**
 * Cache wrapper for streaming chart asset.
 * @type {string|null}
 */
let cachedChartAsset = null;

/**
 * Get the streaming chart JavaScript asset.
 * @param {string} fsPath Path to src/serve directory
 * @param {Function} fsReadFileSync File read function (readFileSync)
 * @returns {string}
 */
export function getStreamingChartAsset(fsPath, fsReadFileSync) {
  const HERE = fsPath;
  
  if (!cachedChartAsset) {
    cachedChartAsset = fsReadFileSync(require('node:path').join(HERE, '..', 'visualizations', 'streaming-chart.js'), 'utf8');
  }
  return cachedChartAsset;
}
