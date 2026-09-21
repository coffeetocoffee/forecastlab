// Live data feed connectors for ForecastLab streaming.
//
// Every connector speaks the same language: it emits normalized points
//   { seriesId, t (epoch ms), iso, value, source }
// so the incremental engine never cares where data came from.
//
// Zero dependencies: node:fs watch for CSV tails, node:http for webhook
// receivers, the native WebSocket global for metric streams, and a generic
// cursor-based polling connector for database change tracking. True
// PostgreSQL *logical replication* needs a wire-protocol driver; the polling
// connector is the zero-dependency path (e.g. SELECT ... WHERE id > $cursor),
// and docs/streaming.md shows the 10-line adapter for a real driver.

import { watch, statSync, openSync, readSync, closeSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { parseCsv } from '../series.js';

/** Normalize one raw observation into a point. Throws on invalid data. */
export function normalizePoint(raw, defaultSeriesId, source) {
  if (raw === null || raw === undefined) throw new Error('Empty observation');
  const obj = typeof raw === 'number' ? { value: raw } : raw;
  const value = Number(obj.value);
  if (!Number.isFinite(value)) throw new Error(`Invalid value: ${JSON.stringify(obj.value)}`);
  const timeRaw = obj.t ?? obj.time ?? obj.timestamp ?? obj.iso ?? obj.date;
  let t = null;
  if (timeRaw === undefined || timeRaw === null) {
    t = Date.now();
  } else if (typeof timeRaw === 'number') {
    t = timeRaw < 1e12 ? timeRaw * 1000 : timeRaw; // accept epoch seconds too
  } else {
    t = Date.parse(String(timeRaw));
  }
  if (!Number.isFinite(t)) throw new Error(`Invalid timestamp: ${JSON.stringify(timeRaw)}`);
  const seriesId = String(obj.seriesId ?? obj.series ?? defaultSeriesId ?? 'default');
  return { seriesId, t, iso: new Date(t).toISOString(), value, source };
}

/** Base class: subscription management, stats, lifecycle. Subclasses feed emit(). */
export class FeedConnector {
  constructor(options = {}) {
    this.seriesId = options.seriesId ?? 'default';
    this.source = options.source ?? this.constructor.name;
    this.listeners = new Set();
    this.running = false;
    this.stats = { points: 0, errors: 0, startedAt: null, lastPointAt: null };
  }

  onPoint(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(raw) {
    try {
      const point = normalizePoint(raw, this.seriesId, this.source);
      this.stats.points += 1;
      this.stats.lastPointAt = point.iso;
      for (const cb of [...this.listeners]) {
        try {
          cb(point);
        } catch (e) {
          this.stats.errors += 1;
        }
      }
      return point;
    } catch (e) {
      this.stats.errors += 1;
      return null;
    }
  }

  async start() {
    if (this.running) return this;
    this.running = true;
    this.stats.startedAt = new Date().toISOString();
    return this;
  }

  async stop() {
    this.running = false;
    return this;
  }

  status() {
    return { source: this.source, seriesId: this.seriesId, running: this.running, ...this.stats };
  }
}

/**
 * Tail a CSV file: emits rows appended after start (or all rows with fromStart).
 * Reuses the core parseCsv so column detection matches batch mode exactly.
 */
export class FileWatchConnector extends FeedConnector {
  constructor(options = {}) {
    super({ ...options, source: options.source ?? 'file-watch' });
    if (!options.path) throw new Error('FileWatchConnector needs a file path');
    this.path = options.path;
    this.timeColumn = options.timeColumn;
    this.valueColumn = options.valueColumn;
    this.fromStart = options.fromStart ?? false;
    this.debounceMs = options.debounceMs ?? 150;
    this.watcher = null;
    this.offset = 0;
    this.remainder = '';
    this.header = null;
    this.lastT = -Infinity;
    this.timer = null;
  }

  async start() {
    await super.start();
    if (!existsSync(this.path)) throw new Error(`Watched file does not exist: ${this.path}`);
    const text = readFileSync(this.path, 'utf8');
    const parsed = parseCsv(text, { timeColumn: this.timeColumn, valueColumn: this.valueColumn });
    this.header = text.split(/\r?\n/).find((l) => l.trim() !== '');
    this.timeColumn = parsed.timeColumn;
    this.valueColumn = parsed.valueColumn;
    this.offset = Buffer.byteLength(text, 'utf8');
    if (this.fromStart) {
      for (const p of parsed.points) this._accept(p.t, p.value);
    } else if (parsed.points.length > 0) {
      this.lastT = parsed.points[parsed.points.length - 1].t;
    }
    this.watcher = watch(this.path, () => this._scheduleRead());
    return this;
  }

  _scheduleRead() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._readNewBytes().catch(() => {});
    }, this.debounceMs);
  }

  _readNewBytes() {
    return new Promise((resolve) => {
      let size;
      try {
        size = statSync(this.path).size;
      } catch {
        return resolve();
      }
      if (size < this.offset) {
        this.offset = 0; // truncated / rotated
        this.remainder = '';
      }
      if (size === this.offset) return resolve();
      const fd = openSync(this.path, 'r');
      try {
        const len = size - this.offset;
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, this.offset);
        this.offset = size;
        this._ingestChunk(buf.toString('utf8'));
      } finally {
        closeSync(fd);
      }
      resolve();
    });
  }

  _ingestChunk(text) {
    const lines = (this.remainder + text).split(/\r?\n/);
    this.remainder = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        const parsed = parseCsv(`${this.header}\n${line}`, {
          timeColumn: this.timeColumn,
          valueColumn: this.valueColumn,
        });
        for (const p of parsed.points) this._accept(p.t, p.value);
      } catch {
        this.stats.errors += 1;
      }
    }
  }

  _accept(t, value) {
    if (t > this.lastT) {
      this.lastT = t;
      this.emit({ t, value, seriesId: this.seriesId });
    }
  }

  /** Read the rows already in the file (baseline for seeding, no events). */
  readHistory() {
    if (!this.header) throw new Error('Connector not started');
    const text = readFileSync(this.path, 'utf8');
    const parsed = parseCsv(text, { timeColumn: this.timeColumn, valueColumn: this.valueColumn });
    return parsed.points.map((p) => ({
      seriesId: this.seriesId,
      t: p.t,
      iso: new Date(p.t).toISOString(),
      value: p.value,
      source: this.source,
    }));
  }

  async stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    return super.stop();
  }
}

/**
 * HTTP webhook receiver: POST JSON points, get 200/400 back.
 * Accepts a single observation or an array of them.
 */
export class WebhookConnector extends FeedConnector {
  constructor(options = {}) {
    super({ ...options, source: options.source ?? 'webhook' });
    this.port = options.port ?? 0;
    this.host = options.host ?? '127.0.0.1';
    this.path = options.path ?? '/ingest';
    this.token = options.token ?? null;
    this.server = null;
  }

  async start() {
    await super.start();
    this.server = createServer((req, res) => {
      const respond = (code, body) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        return respond(400, { error: 'Malformed request' });
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return respond(200, { ok: true, ...this.status() });
      }
      if (req.method !== 'POST' || url.pathname !== this.path) {
        return respond(404, { error: `POST ${this.path} to ingest points` });
      }
      if (this.token) {
        const auth = req.headers.authorization ?? '';
        const query = url.searchParams.get('token');
        if (auth !== `Bearer ${this.token}` && query !== this.token) {
          return respond(403, { error: 'Missing or invalid token' });
        }
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 1e6) req.destroy(); // 1MB cap: resource limit
      });
      req.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body || 'null');
        } catch {
          return respond(400, { error: 'Body must be JSON' });
        }
        const rows = Array.isArray(payload) ? payload : [payload];
        let accepted = 0;
        let rejected = 0;
        for (const row of rows) {
          if (this.emit(row)) accepted += 1;
          else rejected += 1;
        }
        respond(200, { accepted, rejected });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });
    this.port = this.server.address().port;
    return this;
  }

  async stop() {
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
    return super.stop();
  }
}

/**
 * Live metric streams over WebSocket (native global, Node 22+).
 * Messages are JSON observations (object or array); reconnects with backoff.
 * Pass socketFactory for tests or custom transports.
 */
export class WebSocketFeedConnector extends FeedConnector {
  constructor(options = {}) {
    super({ ...options, source: options.source ?? 'websocket' });
    if (!options.url) throw new Error('WebSocketFeedConnector needs a url');
    this.url = options.url;
    this.protocols = options.protocols;
    this.socketFactory = options.socketFactory ?? null;
    this.maxRetries = options.maxRetries ?? 10;
    this.retryMs = options.retryMs ?? 1000;
    this.socket = null;
    this.retries = 0;
    this.wantStop = false;
  }

  _createSocket() {
    if (this.socketFactory) return this.socketFactory(this.url, this.protocols);
    const WS = globalThis.WebSocket;
    if (typeof WS === 'undefined') {
      throw new Error('No WebSocket global (needs Node 22+); pass socketFactory to inject a transport');
    }
    return new WS(this.url, this.protocols);
  }

  async start() {
    await super.start();
    this.wantStop = false;
    this.retries = 0;
    this._connect();
    return this;
  }

  _connect() {
    if (this.wantStop) return;
    let socket;
    try {
      socket = this._createSocket();
    } catch (e) {
      this.stats.errors += 1;
      return this._scheduleReconnect();
    }
    this.socket = socket;
    socket.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        this.stats.errors += 1;
        return;
      }
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) this.emit(row);
    };
    socket.onerror = () => {
      this.stats.errors += 1;
    };
    socket.onclose = () => {
      this.socket = null;
      this._scheduleReconnect();
    };
    socket.onopen = () => {
      this.retries = 0;
    };
  }

  _scheduleReconnect() {
    if (this.wantStop || !this.running) return;
    if (this.retries >= this.maxRetries) {
      this.running = false;
      return;
    }
    this.retries += 1;
    const delay = Math.min(this.retryMs * 2 ** (this.retries - 1), 30000);
    setTimeout(() => this._connect(), delay);
  }

  async stop() {
    this.wantStop = true;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    return super.stop();
  }
}

/**
 * Cursor-based change tracking: the zero-dependency database path.
 * Provide fetchSince(cursor) resolving to rows newer than cursor
 * (e.g. SELECT value, ts FROM metrics WHERE id > $1 ORDER BY id).
 * True PostgreSQL logical replication needs a wire-protocol driver;
 * this connector is the seam it plugs into (see docs/streaming.md).
 */
export class PollingConnector extends FeedConnector {
  constructor(options = {}) {
    super({ ...options, source: options.source ?? 'polling' });
    if (typeof options.fetchSince !== 'function') {
      throw new Error('PollingConnector needs fetchSince(cursor) returning rows newer than cursor');
    }
    this.fetchSince = options.fetchSince;
    this.intervalMs = options.intervalMs ?? 5000;
    this.cursor = options.initialCursor ?? null;
    this.cursorKey = options.cursorKey ?? 't';
    this.mapRow = options.mapRow ?? ((row) => row);
    this.timer = null;
    this.polling = false;
  }

  async start() {
    await super.start();
    await this.poll();
    this.timer = setInterval(() => {
      this.poll().catch(() => {});
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  async poll() {
    if (this.polling || !this.running) return { accepted: 0, cursor: this.cursor };
    this.polling = true;
    try {
      const rows = (await this.fetchSince(this.cursor)) ?? [];
      let accepted = 0;
      for (const row of rows) {
        try {
          const mapped = this.mapRow(row);
          const point = this.emit(mapped);
          if (point) {
            accepted += 1;
            if (this.cursor === null || point.t > this.cursor) this.cursor = point.t;
          }
        } catch {
          this.stats.errors += 1;
        }
      }
      return { accepted, cursor: this.cursor };
    } finally {
      this.polling = false;
    }
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return super.stop();
  }
}
