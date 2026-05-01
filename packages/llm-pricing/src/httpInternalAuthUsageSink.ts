import { getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { UsageLogParams } from './usageLogger.js';
import { UsageSink } from './usageLogger.js';
import { buildUsageEvent, type UsageEventPayload } from './buildUsageEvent.js';

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
  /** Optional getter for task ID to populate correlation.taskId per request */
  getCorrelationTaskId?: () => string | null;
  /** Flush window in milliseconds. Default 500. Set to 0 to flush on every record (legacy single-event behavior). */
  flushIntervalMs?: number;
  /** Maximum events to buffer before forcing an immediate flush. Default 100. */
  maxBatchSize?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH_SIZE = 100;

/**
 * UsageSink for in-cluster apps that POST usage events to llm-usage-service directly.
 *
 * Uses X-Internal-Auth for authentication. No HMAC signing.
 * Failures are non-fatal: logged as warnings and swallowed.
 *
 * Events are coalesced within a configurable flush window (default 500ms) or
 * up to `maxBatchSize` events (default 100), whichever comes first. Call
 * `flushSync()` during graceful shutdown to drain the buffer; unlike `log()`,
 * `flushSync()` rethrows POST failures so callers can react.
 */
export class HttpInternalAuthUsageSink extends UsageSink {
  private readonly config: HttpInternalAuthUsageSinkConfig;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;

  private buffer: UsageEventPayload[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(config: HttpInternalAuthUsageSinkConfig) {
    super();
    this.config = config;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
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
      // Trip the buffer-size flush. Swallow errors here (non-fatal path).
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
      // Don't keep the event loop alive solely for a pending flush.
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

    // Wait for any flush already in flight before draining what's left.
    if (this.inFlight !== null) {
      try {
        await this.inFlight;
      } catch {
        // The in-flight flush already logged its own warning; swallow here so
        // we still attempt to drain whatever arrived after it started.
      }
    }

    if (this.buffer.length === 0) {
      return;
    }

    const events = this.buffer;
    this.buffer = [];
    // Bypass the swallow-on-error wrapper: let shutdown callers see failures.
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
          { statusCode: response.status, url, batchSize: events.length },
          'Usage ingest POST failed with non-2xx status'
        );
        if (opts.rethrow) {
          throw new Error(`Usage ingest POST returned ${String(response.status)}`);
        }
      }
    } catch (error) {
      // Re-throwing path: only log network errors here if we won't rethrow,
      // to avoid duplicate noise (caller sees the thrown error).
      if (!opts.rethrow) {
        this.config.logger.warn(
          { error: getErrorMessage(error), url, batchSize: events.length },
          'Usage ingest POST failed with network error'
        );
        return;
      }
      throw error;
    }
  }
}
