/**
 * Publisher for transcription dead-letter events.
 *
 * Extends BasePubSubPublisher to publish parse / schema failures from the
 * transcription worker to a dedicated DLQ topic. Subtask C of the workers
 * layer refactor (docs/plans/2026-04-24-workers-layer-refactor.md §8) replaces
 * the legacy silent-ACK error paths with explicit DLQ publishes so failed
 * messages are inspectable instead of being discarded.
 *
 * The DLQ payload wraps the original Pub/Sub event payload (or whatever the
 * `withObservability` wrapper hands us) plus a stable machine-readable
 * `reason` code for downstream triage.
 */

// Logger is typed as pino.Logger (not the local WorkerLogger interface) because
// BasePubSubPublisher requires a full pino.Logger. The module-level logger
// singleton from index.ts is bootstrapped via `initWorker` and satisfies that
// contract.
import type { Logger } from 'pino';
import { BasePubSubPublisher, type PublishError } from '@intexuraos/infra-pubsub';
import type { Result } from '@intexuraos/common-core';

/**
 * Configuration for {@link TranscriptionDlqPublisher}.
 */
export interface TranscriptionDlqPublisherConfig {
  /** GCP project id (used by the underlying PubSub client). */
  projectId: string;
  /** Resolved DLQ topic name (must already exist). */
  topicName: string;
  /** Pino logger for publish lifecycle logs. */
  logger: Logger;
}

/**
 * Envelope written to the DLQ topic. Captures the original payload (whatever
 * the upstream subscription delivered to the worker) plus the worker-level
 * `reason` code and the source CloudEvent id so DLQ inspectors can link
 * back to the original delivery without re-parsing the inner Pub/Sub
 * envelope.
 */
export interface TranscriptionDlqEvent {
  /** Stable type identifier so multi-source DLQ subscribers can filter. */
  type: 'srt.transcription.dead_letter';
  /** The original payload (e.g. CloudEvent.data) that triggered the failure. */
  payload: unknown;
  /** Machine-readable failure category (e.g. `parse_error`, `invalid_event_schema`). */
  reason: string;
  /** Source CloudEvent id, when known. Optional because some test paths omit it. */
  eventId?: string;
  /** ISO 8601 timestamp the DLQ event was generated. */
  timestamp: string;
}

/**
 * Public interface for publishing transcription DLQ events.
 */
export interface TranscriptionDlqPublisher {
  /**
   * Publish a dead-letter event for an unprocessable message.
   *
   * @param payload - Original payload that failed parsing / validation.
   * @param reason  - Stable failure code (see translation table in plan §8).
   * @param eventId - Optional source CloudEvent id for correlation with the
   *                  worker's `worker_request_*` log lines.
   */
  publish(payload: unknown, reason: string, eventId?: string): Promise<Result<void, PublishError>>;
}

/**
 * Implementation of {@link TranscriptionDlqPublisher}.
 */
class TranscriptionDlqPublisherImpl
  extends BasePubSubPublisher
  implements TranscriptionDlqPublisher
{
  private readonly topicName: string;

  constructor(config: TranscriptionDlqPublisherConfig) {
    super({ projectId: config.projectId, logger: config.logger });
    this.topicName = config.topicName;
  }

  async publish(
    payload: unknown,
    reason: string,
    eventId?: string
  ): Promise<Result<void, PublishError>> {
    const event: TranscriptionDlqEvent = {
      type: 'srt.transcription.dead_letter',
      payload,
      reason,
      timestamp: new Date().toISOString(),
      ...(eventId !== undefined ? { eventId } : {}),
    };
    return await this.publishToTopic(
      this.topicName,
      event,
      eventId !== undefined ? { reason, eventId } : { reason },
      'transcription dead-letter'
    );
  }
}

/**
 * Create a {@link TranscriptionDlqPublisher}.
 */
export function createTranscriptionDlqPublisher(
  config: TranscriptionDlqPublisherConfig
): TranscriptionDlqPublisher {
  return new TranscriptionDlqPublisherImpl(config);
}
