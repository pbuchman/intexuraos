/**
 * Cloud Functions entry point for the transcription worker.
 *
 * Subscribes to the audio-stored Pub/Sub topic and triggers transcription.
 * Registered as a CloudEvent handler for Pub/Sub push subscriptions.
 */
import * as functions from '@google-cloud/functions-framework';
import type { CloudEvent } from '@google-cloud/functions-framework';
import { Storage } from '@google-cloud/storage';
import { err, ok } from '@intexuraos/common-core';
import { initWorker } from '@intexuraos/infra-sentry';
import { loadConfig, type AudioStoredEvent } from './types.js';
import { transcribeAudio } from './main.js';
import { createTranscriptionProvider } from './providers/provider-factory.js';
import { createTranscriptionCompletedPublisher } from './publishers/transcription-completed-publisher.js';
import { extractCorrelation } from './extractCorrelation.js';
import { runWithRequestContext } from './requestContextShim.js';

/**
 * Pub/Sub CloudEvent data structure.
 */
interface PubSubData {
  message: {
    data?: string;
    attributes?: Record<string, string>;
  };
}

/* v8 ignore start -- module-init: bootstrap, config, storage and publisher initialized at cold start @preserve */
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
const publisher = createTranscriptionCompletedPublisher({
  projectId: config.gcpProjectId,
  topicName: config.transcriptionCompletedTopic,
  logger,
});
/* v8 ignore stop @preserve */

/**
 * Fetch user's transcription provider preference from user-service.
 * Defaults to 'speechmatics' if not configured or on error.
 */
async function fetchUserProvider(
  userId: string,
  userServiceUrl: string,
  internalAuthToken: string,
  reqLogger: typeof logger
): Promise<string> {
  try {
    const response = await fetch(
      `${userServiceUrl}/internal/users/${encodeURIComponent(userId)}/settings`,
      {
        headers: { 'X-Internal-Auth': internalAuthToken },
      }
    );

    if (!response.ok) {
      reqLogger.warn(
        { event: 'fetch_provider_error', userId, status: response.status },
        'Failed to fetch user settings, defaulting to speechmatics'
      );
      return 'speechmatics';
    }

    const body = (await response.json()) as {
      success: boolean;
      data: {
        transcriptionPreferences?: {
          provider?: string;
        };
      };
    };

    return body.data.transcriptionPreferences?.provider ?? 'speechmatics';
  } catch {
    reqLogger.warn(
      { event: 'fetch_provider_network_error', userId },
      'Network error fetching user settings, defaulting to speechmatics'
    );
    return 'speechmatics';
  }
}

/**
 * Validate that a parsed Pub/Sub payload has all required AudioStoredEvent fields.
 * Guards against schema drift between whatsapp-service and this worker.
 */
function isAudioStoredEvent(event: { type?: string }): event is AudioStoredEvent {
  const obj = event as Record<string, unknown>;
  return (
    obj['type'] === 'whatsapp.audio.stored' &&
    typeof obj['userId'] === 'string' &&
    typeof obj['messageId'] === 'string' &&
    typeof obj['mediaId'] === 'string' &&
    typeof obj['gcsPath'] === 'string' &&
    typeof obj['mimeType'] === 'string' &&
    typeof obj['timestamp'] === 'string'
  );
}

/**
 * Handle an audio stored event from Pub/Sub.
 */
async function handleAudioStored(event: CloudEvent<PubSubData>): Promise<void> {
  const ctx = extractCorrelation(event.data?.message.attributes);
  await runWithRequestContext(ctx, async () => {
    const reqLogger = logger.child({ requestId: ctx.requestId });

    const messageData = event.data?.message.data;
    if (messageData === undefined) {
      reqLogger.error(
        { event: 'missing_message_data', eventId: event.id },
        'No message data in event'
      );
      return;
    }

    let audioEvent;
    try {
      const decoded = Buffer.from(messageData, 'base64').toString('utf-8');
      audioEvent = JSON.parse(decoded) as { type?: string };
    } catch {
      reqLogger.error(
        { event: 'parse_error', eventId: event.id },
        'Failed to parse Pub/Sub message'
      );
      return;
    }

    // First check: log the actual unexpected type value for debugging. isAudioStoredEvent also
    // checks the type literal, but this explicit guard provides a more targeted log message
    // that captures what wrong type was received.
    if (audioEvent.type !== 'whatsapp.audio.stored') {
      reqLogger.warn(
        { event: 'unexpected_event_type', type: audioEvent.type, eventId: event.id },
        'Unexpected event type, ignoring'
      );
      return;
    }

    // Second check: validate remaining required fields (userId, messageId, mediaId, gcsPath,
    // mimeType, timestamp). After the type guard above, isAudioStoredEvent's type check always
    // passes — this guard only fails when non-type required fields are missing.
    if (!isAudioStoredEvent(audioEvent)) {
      reqLogger.warn(
        { event: 'invalid_event_schema', eventId: event.id },
        'Audio stored event is missing required fields, ignoring'
      );
      return;
    }

    await transcribeAudio(
      audioEvent,
      {
        fetchUserProvider: (userId: string) =>
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
            const message =
              error instanceof Error ? error.message : 'Failed to generate signed URL';
            return err({ message });
          }
        },
        createProvider: (providerName: string) =>
          createTranscriptionProvider(providerName, config.speechmaticsApiKey, reqLogger),
        publishEvent: (e) => publisher.publishCompleted(e),
      },
      reqLogger
    );
  });
}

functions.cloudEvent('transcribeAudio', handleAudioStored);
