import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { UsageSink, UsageLogParams } from './usageLogger.js';
import { buildUsageEvent } from './buildUsageEvent.js';

/**
 * Configuration for the HTTP internal-auth usage sink.
 */
export interface HttpInternalAuthUsageSinkConfig {
  /** Base URL of the llm-usage-service (no trailing slash) */
  usageServiceUrl: string;
  /** Token sent as X-Internal-Auth header */
  internalAuthToken: string;
  /** Fills source.service in UsageEventInput */
  service: string;
  /** Fills source.component in UsageEventInput */
  component: string;
  /** Logger for warning on delivery failures */
  logger: Logger;
}

/**
 * UsageSink for in-cluster apps that POST usage events to llm-usage-service directly.
 *
 * Uses X-Internal-Auth for authentication. No HMAC signing.
 * Failures are non-fatal: logged as warnings and swallowed.
 */
export class HttpInternalAuthUsageSink implements UsageSink {
  private readonly config: HttpInternalAuthUsageSinkConfig;

  constructor(config: HttpInternalAuthUsageSinkConfig) {
    this.config = config;
  }

  async log(params: UsageLogParams): Promise<void> {
    const event = buildUsageEvent(params, {
      service: this.config.service,
      component: this.config.component,
    });

    const body = JSON.stringify({ schemaVersion: 1, events: [event] });
    const url = `${this.config.usageServiceUrl}/internal/usage/events`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': this.config.internalAuthToken,
        },
        body,
      });

      if (!response.ok) {
        this.config.logger.warn(
          { statusCode: response.status, url },
          'Usage ingest POST failed with non-2xx status'
        );
      }
    } catch (error) {
      this.config.logger.warn(
        { error: getErrorMessage(error), url },
        'Usage ingest POST failed with network error'
      );
    }
  }
}
