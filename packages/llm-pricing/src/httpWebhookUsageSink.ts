import { createHmac } from 'node:crypto';
import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { UsageLogParams } from './usageLogger.js';
import { UsageSink } from './usageLogger.js';
import { buildUsageEvent, type UsageEventPayload } from './buildUsageEvent.js';
import { registerUsageSink } from './usageSinkRegistry.js';

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
  /** Flush window in milliseconds. Default 500. */
  flushIntervalMs?: number;
  /** Maximum events to buffer before forcing an immediate flush. Default 100. */
  maxBatchSize?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH_SIZE = 100;

/**
 * UsageSink that HMAC-signs usage events and POSTs them to a configurable webhook URL.
 *
 * Failures are non-fatal: logged as warnings and swallowed.
 *
 * Events are coalesced within a configurable flush window (default 500ms) or
 * up to `maxBatchSize` events (default 100), whichever comes first. Call
 * `flushSync()` during graceful shutdown to drain the buffer; unlike `log()`,
 * `flushSync()` rethrows POST failures so callers can react.
 */
export class HttpWebhookUsageSink extends UsageSink {
  private readonly config: HttpWebhookUsageSinkConfig;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;

  private buffer: UsageEventPayload[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(config: HttpWebhookUsageSinkConfig) {
    super();
    this.config = config;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    // Register so shutdown handlers can drain any pending events on
    // SIGTERM/SIGINT. Without this the unref'd flush timer can leave events
    // unsent when the process exits between buffering and the next tick.
    registerUsageSink(this);
  }

  override log(params: UsageLogParams): Promise<void> {
    const sinkTaskId = this.config.getCorrelationTaskId?.() ?? null;
    const event = buildUsageEvent(
      params,
      {
        service: this.config.service,
        component: this.config.component,
      },
      {
        taskId: params.correlation?.taskId ?? sinkTaskId,
        ...(params.correlation?.sessionId !== undefined && {
          sessionId: params.correlation.sessionId,
        }),
        ...(params.correlation?.requestId !== undefined && {
          requestId: params.correlation.requestId,
        }),
        ...(params.correlation?.researchId !== undefined && {
          researchId: params.correlation.researchId,
        }),
      }
    );

    const wasEmpty = this.buffer.length === 0;
    this.buffer.push(event);

    if (this.buffer.length >= this.maxBatchSize) {
      void this.flushBuffered().catch(() => {
        /* logged inside postBatch */
      });
      return Promise.resolve();
    }

    if (wasEmpty && this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flushBuffered().catch(() => {
          /* logged inside postBatch */
        });
      }, this.flushIntervalMs);
      this.flushTimer.unref();
    }

    return Promise.resolve();
  }

  /**
   * Drains the buffer synchronously (one final POST) and rethrows any error.
   *
   * Intended for graceful shutdown — callers can log/abort if the final
   * delivery fails. Resolves cleanly when the buffer is empty.
   */
  async flushSync(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.inFlight !== null) {
      try {
        await this.inFlight;
      } catch {
        // already logged
      }
    }

    if (this.buffer.length === 0) {
      return;
    }

    const events = this.buffer;
    this.buffer = [];
    await this.postBatch(events, { rethrow: true });
  }

  private async flushBuffered(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    const events = this.buffer;
    this.buffer = [];
    // Capture the wrapped promise reference so the finally guard can compare
    // identity correctly. Assigning `this.inFlight = promise.finally(...)` and
    // then comparing `this.inFlight === promise` inside the callback would
    // never match — `inFlight` holds the chained promise, not the original.
    const wrapped: Promise<void> = this.postBatch(events, { rethrow: false }).finally(() => {
      if (this.inFlight === wrapped) {
        this.inFlight = null;
      }
    });
    this.inFlight = wrapped;
    await wrapped;
  }

  private async postBatch(events: UsageEventPayload[], opts: { rethrow: boolean }): Promise<void> {
    const body = JSON.stringify({ schemaVersion: 2, events });
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
          {
            statusCode: response.status,
            webhookUrl: this.config.webhookUrl,
            batchSize: events.length,
          },
          'Usage webhook POST failed with non-2xx status'
        );
        if (opts.rethrow) {
          throw new Error(`Usage webhook POST returned ${String(response.status)}`);
        }
      }
    } catch (error) {
      if (!opts.rethrow) {
        this.config.logger.warn(
          {
            error: getErrorMessage(error),
            webhookUrl: this.config.webhookUrl,
            batchSize: events.length,
          },
          'Usage webhook POST failed with network error'
        );
        return;
      }
      throw error;
    }
  }
}
