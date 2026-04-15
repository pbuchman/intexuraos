import { createHmac } from 'node:crypto';
import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { UsageSink, UsageLogParams } from './usageLogger.js';
import { buildUsageEvent } from './buildUsageEvent.js';

/**
 * Configuration for the HTTP webhook usage sink.
 */
export interface HttpWebhookUsageSinkConfig {
  /** Full URL of the webhook endpoint (e.g. code-agent's usage webhook) */
  webhookUrl: string;
  /** Shared secret used to HMAC-sign payloads */
  webhookSecret: string;
  /** Token sent as X-Internal-Auth header (code-agent validates this first, then verifies the HMAC) */
  internalAuthToken: string;
  /** Fills source.service in UsageEventInput */
  service: string;
  /** Fills source.component in UsageEventInput */
  component: string;
  /** Logger for warning on delivery failures */
  logger: Logger;
  /** Optional getter for task ID to populate correlation.taskId per request */
  getCorrelationTaskId?: () => string | null;
}

/**
 * UsageSink that HMAC-signs usage events and POSTs them to a configurable webhook URL.
 *
 * Failures are non-fatal: logged as warnings and swallowed.
 */
export class HttpWebhookUsageSink implements UsageSink {
  private readonly config: HttpWebhookUsageSinkConfig;

  constructor(config: HttpWebhookUsageSinkConfig) {
    this.config = config;
  }

  async log(params: UsageLogParams): Promise<void> {
    const taskId = this.config.getCorrelationTaskId?.() ?? null;
    const event = buildUsageEvent(
      params,
      {
        service: this.config.service,
        component: this.config.component,
      },
      { taskId }
    );

    const body = JSON.stringify({ schemaVersion: 2, events: [event] });
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `${String(timestamp)}.${body}`;
    const signature = createHmac('sha256', this.config.webhookSecret).update(message).digest('hex');

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': String(timestamp),
          'X-Request-Signature': signature,
          'X-Internal-Auth': this.config.internalAuthToken,
        },
        body,
      });

      if (!response.ok) {
        this.config.logger.warn(
          { statusCode: response.status, webhookUrl: this.config.webhookUrl },
          'Usage webhook POST failed with non-2xx status'
        );
      }
    } catch (error) {
      this.config.logger.warn(
        { error: getErrorMessage(error), webhookUrl: this.config.webhookUrl },
        'Usage webhook POST failed with network error'
      );
    }
  }
}
