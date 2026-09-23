/**
 * Response helpers for HTTP server.
 */

/**
 * Send a response with appropriate headers.
 * @param {import('http').ServerResponse} res 
 * @param {number} status 
 * @param {string} contentType 
 * @param {string|Buffer} body 
 */
export function send(res, status, contentType, body) {
  res.writeHead(status, {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * Send JSON response.
 * @param {import('http').ServerResponse} res 
 * @param {number} status 
 * @param {Object} obj 
 */
export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  send(res, status, 'application/json; charset=utf-8', body);
}
