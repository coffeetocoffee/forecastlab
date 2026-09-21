// Public surface of the ForecastLab streaming layer.
// Classical methods inside; queue + event loop outside.

export {
  FeedConnector,
  FileWatchConnector,
  WebhookConnector,
  WebSocketFeedConnector,
  PollingConnector,
  normalizePoint,
} from './connectors.js';

export { Welford, IncrementalForecaster } from './incremental.js';

export { JobQueue, toPriority } from './queue.js';

export { AlertManager } from './alerts.js';

export { EventHub, StreamingEngine } from './engine.js';
