/**
 * withObservability — wraps a Pub/Sub `CloudEventHandler` with the unified
 * worker ack/nack contract.
 *
 * Why this exists: Cloud Functions' Pub/Sub trigger uses thrown vs. resolved
 * to decide redelivery. That's a poor fit for "expected schema failures"
 * (parse errors, unexpected event types) — those should NOT redeliver
 * indefinitely; they should be dead-lettered for human review. Today every
 * worker hand-rolls this differently. `withObservability` collapses the
 * decision into a single `AckResult` so handlers can `return { decision:
 * AckDecision.DeadLetter, reason: 'parse_error' }` without knowing how
 * Pub/Sub is wired.
 *
 * Contract enforced here:
 *   - `Ack`         → resolve.
 *   - `Nack`        → throw (Pub/Sub redelivers).
 *   - `DeadLetter`  → publish to `opts.dlqPublish` and resolve. If no
 *                     publisher is configured, degrade to Nack with a WARN
 *                     log — never silently ACK; that would lose the message.
 *   - Handler throws → captured to Sentry (if DSN provided), re-thrown as
 *                     Nack for redelivery.
 *
 * `worker_request_start` / `worker_request_{ack|nack|dlq|...}` lines bracket
 * every invocation for trace-id correlation across logs.
 */
import type { CloudEvent } from '@google-cloud/functions-framework';
import * as Sentry from '@sentry/node';
import type { WorkerLogger } from './logger.js';
import { createWorkerLogger } from './logger.js';

export enum AckDecision {
  Ack = 'ack',
  Nack = 'nack',
  DeadLetter = 'dlq',
}

export interface AckResult {
  readonly decision: AckDecision;
  readonly reason?: string;
}

export type CloudEventHandler<D> = (
  event: CloudEvent<D>,
  logger: WorkerLogger
) => Promise<AckResult>;

export interface ObservabilityOptions {
  readonly sentryDsn?: string;
  readonly dlqPublish?: (payload: unknown, reason: string) => Promise<void>;
  /**
   * Override the logger used by the wrapper. Production callers omit this
   * (a default `createWorkerLogger(handlerName)` is bound at wrap time);
   * tests inject a `createFakeLogger()` so they can assert log entries.
   */
  readonly logger?: WorkerLogger;
}

export function withObservability<D>(
  handlerName: string,
  handler: CloudEventHandler<D>,
  opts: ObservabilityOptions = {}
): (event: CloudEvent<D>) => Promise<void> {
  const logger = opts.logger ?? createWorkerLogger(handlerName);
  const sentryEnabled = opts.sentryDsn !== undefined && opts.sentryDsn !== '';

  return async (event: CloudEvent<D>): Promise<void> => {
    logger.info(
      { event: 'worker_request_start', handlerName, eventId: event.id },
      'worker request start'
    );

    let result: AckResult;
    try {
      result = await handler(event, logger);
    } catch (error) {
      logger.error(
        { event: 'worker_request_error', handlerName, eventId: event.id, error },
        'handler threw'
      );
      if (sentryEnabled) {
        Sentry.captureException(error);
      }
      throw error;
    }

    if (result.decision === AckDecision.Ack) {
      logger.info({ event: 'worker_request_ack', handlerName, eventId: event.id }, 'ack');
      return;
    }

    if (result.decision === AckDecision.Nack) {
      const reason = result.reason ?? 'unspecified';
      logger.warn({ event: 'worker_request_nack', handlerName, eventId: event.id, reason }, 'nack');
      throw new Error(`nack: ${reason}`);
    }

    // DeadLetter
    const reason = result.reason ?? 'unspecified';
    if (opts.dlqPublish !== undefined) {
      await opts.dlqPublish(event.data, reason);
      logger.warn(
        { event: 'worker_request_dlq', handlerName, eventId: event.id, reason },
        'dead-lettered'
      );
      return;
    }

    logger.warn(
      {
        event: 'worker_request_dlq_missing_publisher',
        handlerName,
        eventId: event.id,
        reason,
      },
      'DLQ requested but no publisher configured — degrading to nack'
    );
    throw new Error(`dlq (no publisher): ${reason}`);
  };
}
