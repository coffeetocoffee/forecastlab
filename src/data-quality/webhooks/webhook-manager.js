/**
 * Webhook Alerts System - v2.0
 * 
 * Features:
 * - Configure webhook endpoints for alerts
 * - Real-time notification on quality issues
 * - Streaming data subscription support
 * - Customizable alert conditions and formatting
 */

import http from 'http';
import https from 'https';

export class WebhookManager {
  constructor() {
    this.webhooks = [];
    this.subscriptions = new Map(); // For streaming data
    this.rateLimits = new Map();
    this.enabled = true;
  }

  /**
   * Register a webhook endpoint
   */
  registerWebhook(config) {
    const webhook = {
      id: this.generateId(),
      url: config.url,
      events: config.events || ['quality_check', 'anomaly_detected', 'snapshot_created'],
      severity: config.severity || ['critical', 'warning', 'info'],
      timeout: config.timeout || 5000,
      authHeader: config.authHeader || null,
      payloadTemplate: config.payloadTemplate || 'standard',
      createdAt: new Date().toISOString(),
      enabled: true
    };

    this.webhooks.push(webhook);
    console.log(`✅ Webhook registered: ${webhook.id} (${webhook.url})`);
    
    return webhook;
  }

  /**
   * Unregister a webhook
   */
  unregisterWebhook(webhookId) {
    const index = this.webhooks.findIndex(w => w.id === webhookId);
    if (index !== -1) {
      const webhook = this.webhooks[index];
      webhook.enabled = false;
      this.webhooks.splice(index, 1);
      console.log(`❌ Webhook unregistered: ${webhookId}`);
      return { success: true };
    }
    throw new Error(`Webhook not found: ${webhookId}`);
  }

  /**
   * Trigger webhook with event data
   */
  async trigger(eventType, eventData, options = {}) {
    if (!this.enabled) {
      console.log('⚠️  Webhooks disabled');
      return { success: false, message: 'Webhooks disabled' };
    }

    // Check rate limiting
    const clientKey = options.clientKey || 'default';
    if (!this.checkRateLimit(clientKey)) {
      console.warn('⚠️  Rate limit exceeded, skipping webhook');
      return { success: false, message: 'Rate limited' };
    }

    const triggered = [];

    for (const webhook of this.webhooks.filter(w => w.enabled)) {
      // Check if event type matches
      if (!webhook.events.includes(eventType)) {
        continue;
      }

      // Check severity filter
      if (options.severity && !webhook.severity.includes(options.severity)) {
        continue;
      }

      // Build payload
      const payload = this.buildPayload(eventType, eventData, webhook.payloadTemplate);

      try {
        await this.sendRequest(webhook, payload, eventType);
        triggered.push(webhook.id);
        
        // Update rate limit
        this.recordActivity(clientKey);
        
      } catch (error) {
        console.error(`❌ Webhook failed (${webhook.id}):`, error.message);
      }
    }

    return {
      success: triggered.length > 0,
      triggeredCount: triggered.length,
      webhookIds: triggered,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Send HTTP request to webhook
   */
  sendRequest(webhook, payload, eventType) {
    return new Promise((resolve, reject) => {
      const url = new URL(webhook.url);
      const isHttps = url.protocol === 'https:';
      
      const postData = JSON.stringify(payload);
      
      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Event-Type': eventType,
          'X-Timestamp': new Date().toISOString()
        }
      };

      if (webhook.authHeader) {
        requestOptions.headers['Authorization'] = webhook.authHeader;
      }

      const client = isHttps ? https : http;
      const req = client.request(requestOptions, (res) => {
        let responseData = '';
        
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body: responseData });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      
      // Timeout handling
      req.setTimeout(webhook.timeout, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Build webhook payload based on template
   */
  buildPayload(eventType, eventData, template) {
    const base = {
      event: eventType,
      timestamp: new Date().toISOString(),
      version: '2.0'
    };

    switch (template) {
      case 'standard':
        return {
          ...base,
          data: eventData,
          metadata: {
            source: 'forecastlab-data-quality',
            platform: 'local'
          }
        };

      case 'slack':
        return {
          text: `[ForecastLab] ${eventType}: ${eventData.summary?.totalIssues || 0} issues detected`,
          attachments: [{
            color: eventData.summary?.overallHealth >= 80 ? 'good' : 
                   eventData.summary?.overallHealth >= 60 ? 'warning' : 'danger',
            fields: [
              { title: 'Health Score', value: `${eventData.summary?.overallHealth}/100`, short: true },
              { title: 'Critical Issues', value: `${eventData.summary?.critical}`, short: true },
              { title: 'Warnings', value: `${eventData.summary?.warnings}`, short: true }
            ],
            footer: 'ForecastLab Data Quality Engine',
            ts: Math.floor(Date.now() / 1000)
          }]
        };

      case 'pagerduty':
        return {
          routing_key: eventData.alertKey || '',
          event_action: 'trigger',
          payload: {
            summary: `${eventType}: ${eventData.summary?.totalIssues || 0} issues`,
            severity: eventData.summary?.critical > 0 ? 'critical' : 
                     eventData.summary?.warnings > 0 ? 'warning' : 'info',
            source: `forecastlab-${eventData.provenanceId || 'unknown'}`,
            custom_details: eventData
          }
        };

      default:
        return {
          ...base,
          eventType,
          data: eventData
        };
    }
  }

  /**
   * Create streaming subscription
   */
  createSubscription(config) {
    const subscription = {
      id: this.generateId(),
      endpoint: config.endpoint,
      streamName: config.streamName,
      filters: config.filters || {},
      batchSize: config.batchSize || 10,
      createdAt: new Date().toISOString(),
      active: true
    };

    this.subscriptions.set(subscription.id, subscription);
    console.log(`📡 Stream subscription created: ${subscription.id}`);
    
    return subscription;
  }

  /**
   * Process streaming data
   */
  processStream(streamName, dataPoint) {
    const subscribers = Array.from(this.subscriptions.values())
      .filter(s => s.streamName === streamName && s.active);

    for (const sub of subscribers) {
      if (!sub.batchBuffer) {
        sub.batchBuffer = [];
      }

      sub.batchBuffer.push(dataPoint);

      // Check batch size
      if (sub.batchBuffer.length >= sub.batchSize) {
        this.triggerBatch(sub.batchBuffer, sub.id);
        sub.batchBuffer = [];
      }
    }
  }

  triggerBatch(batchPoints, subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    const eventData = {
      type: 'stream_batch',
      count: batchPoints.length,
      points: batchPoints,
      subscription_id: subscriptionId
    };

    this.trigger('stream_data', eventData, { clientKey: subscriptionId });
  }

  /**
   * Check rate limiting (simple token bucket)
   */
  checkRateLimit(key) {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const maxCalls = 10; // Max calls per window

    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, []);
      return true;
    }

    const timestamps = this.rateLimits.get(key);
    const recentTimestamps = timestamps.filter(t => now - t < windowMs);

    if (recentTimestamps.length >= maxCalls) {
      return false; // Rate limited
    }

    return true;
  }

  recordActivity(key) {
    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, []);
    }
    this.rateLimits.get(key).push(Date.now());
  }

  generateId() {
    return `wh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get list of registered webhooks
   */
  getWebhooks() {
    return this.webhooks.map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      enabled: w.enabled
    }));
  }

  /**
   * Health check
   */
  healthCheck() {
    return {
      enabled: this.enabled,
      webhookCount: this.webhooks.filter(w => w.enabled).length,
      subscriptionCount: this.subscriptions.size,
      status: 'healthy'
    };
  }
}

// Pre-configured webhook types
const WEBHOOK_TYPES = {
  slack: {
    payloadTemplate: 'slack',
    events: ['quality_check', 'anomaly_detected', 'snapshot_created', 'stream_batch']
  },
  pagerduty: {
    payloadTemplate: 'pagerduty',
    events: ['anomaly_detected', 'quality_critical']
  },
  email: {
    payloadTemplate: 'email_template',
    events: ['quality_check', 'snapshot_restored']
  }
};

export function createSlackWebhook(url) {
  const manager = new WebhookManager();
  manager.registerWebhook({
    url,
    ...WEBHOOK_TYPES.slack
  });
  return manager;
}

export function createPagerDutyWebhook(url, routingKey) {
  const manager = new WebhookManager();
  manager.registerWebhook({
    url,
    ...WEBHOOK_TYPES.pagerduty,
    authHeader: `Routing-Key=${routingKey}`
  });
  return manager;
}

export default WebhookManager;
