/**
 * Cloud Functions entry point for the transcription worker.
 *
 * Subscribes to the audio-stored Pub/Sub topic and triggers transcription.
 * Registered as a CloudEvent handler for Pub/Sub push subscriptions.
 *
 * Pure handler logic lives in `handler.ts` so it can be unit-tested with
 * fake dependencies. This file only wires the real dependencies together
 * and registers the handler with `withObservability`, which translates the
 * handler's `AckResult` into Pub/Sub Ack / Nack / DeadLetter semantics —
 * parse and schema failures publish to the DLQ topic instead of being
 * silently ACKed (Subtask C of `docs/plans/2026-04-24-workers-layer-refactor.md`).
 */
import * as functions from '@google-cloud/functions-framework';
import { Storage } from '@google-cloud/storage';
import { initWorker } from '@intexuraos/infra-sentry';
import { loadConfig } from './types.js';
import { createTranscriptionProvider } from './providers/provider-factory.js';
import { createTranscriptionCompletedPublisher } from './publishers/transcription-completed-publisher.js';
import { createTranscriptionDlqPublisher } from './publishers/transcription-dlq-publisher.js';
import {
  createAudioStoredHandler,
  err,
  fetchUserProvider,
  ok,
  type PubSubData,
} from './handler.js';
import { withObservability, type WorkerLogger } from './__shims__/common-worker.js';

const release = process.env['K_REVISION'] ?? 'unknown';
const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
const { logger: baseLogger, flush } = initWorker({
  serviceName: 'transcription',
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  ...(sentryDsn !== undefined ? { sentryDsn } : {}),
  release,
});
const logger = baseLogger.child({ service: 'transcription', release });

process.on('SIGTERM', () => {
  void flush();
});

const config = loadConfig();
const storage = new Storage({ projectId: config.gcpProjectId });
const completedPublisher = createTranscriptionCompletedPublisher({
  projectId: config.gcpProjectId,
  topicName: config.transcriptionCompletedTopic,
  logger,
});
const dlqPublisher = createTranscriptionDlqPublisher({
  projectId: config.gcpProjectId,
  topicName: config.transcriptionDlqTopic,
  logger,
});

const handler = createAudioStoredHandler({
  baseLogger: logger as unknown as WorkerLogger,
  fetchUserProvider: (userId, reqLogger) =>
    fetchUserProvider(userId, config.userServiceUrl, config.internalAuthToken, reqLogger),
  generateSignedUrl: async (gcsPath: string) => {
    try {
      const bucket = storage.bucket(config.mediaBucket);
      const file = bucket.file(gcsPath);
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 4 * 3600 * 1000,
      });
      return ok(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate signed URL';
      return err({ message });
    }
  },
  createProvider: (providerName, reqLogger) =>
    createTranscriptionProvider(providerName, config.speechmaticsApiKey, reqLogger),
  publishCompleted: (event) => completedPublisher.publishCompleted(event),
});

/**
 * Forward dead-letter requests from `withObservability` to the DLQ publisher.
 *
 * Throws if the publish itself fails so the wrapper degrades to Nack
 * (Pub/Sub redelivers and the subscription's dead-letter policy eventually
 * routes the message to the platform-managed DLQ). Silently swallowing a
 * publish failure here would re-introduce the silent-ACK bug this subtask
 * is fixing.
 */
async function publishDeadLetter(payload: unknown, reason: string): Promise<void> {
  const result = await dlqPublisher.publish(payload, reason);
  if (!result.ok) {
    logger.error(
      { event: 'dlq_publish_error', reason, error: result.error },
      'Failed to publish dead-letter event'
    );
    throw new Error(`DLQ publish failed: ${result.error.message}`);
  }
}

// `withObservability` constructs its own logger for the `worker_request_*`
// envelope lines (per §3.3) — that logger is intentionally separate from the
// Sentry-integrated `initWorker` logger above, which the handler uses for
// domain logs via `deps.baseLogger`. Sentry is initialized at module scope
// by `initWorker`, so warn/error lines on either logger flow through the
// same DSN configured below.
functions.cloudEvent<PubSubData>(
  'transcribeAudio',
  withObservability<PubSubData>('transcription', handler, {
    dlqPublish: publishDeadLetter,
    ...(sentryDsn !== undefined ? { sentryDsn } : {}),
  })
);
