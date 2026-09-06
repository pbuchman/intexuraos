/**
 * Pure handler for audio-stored Pub/Sub events.
 *
 * Exposes `createAudioStoredHandler(deps)` so the runtime entry point in
 * `index.ts` and the unit tests can both produce a handler with the same
 * shape but different injected dependencies (real GCS / publishers in
 * production, in-memory fakes in tests). Returning an `AckResult` lets the
 * `withObservability` wrapper translate outcomes into Pub/Sub Ack / Nack /
 * DeadLetter semantics — see the translation table in plan §8.
 */

import type { CloudEvent } from '@google-cloud/functions-framework';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { PublishError } from '@intexuraos/infra-pubsub';
import { transcribeAudio } from './main.js';
import type { PollingConfig } from './polling.js';
import type { TranscriptionCompletedEvent, TranscriptionRequestEvent } from './types.js';
import { extractCorrelation } from './extractCorrelation.js';
import { runWithRequestContext } from './requestContextShim.js';
import {
  AckDecision,
  type AckResult,
  type CloudEventHandler,
  type WorkerLogger,
} from './__shims__/common-worker.js';
import type { SpeechTranscriptionPort } from './providers/transcription-provider.js';

/**
 * Pub/Sub CloudEvent payload data shape.
 */
export interface PubSubData {
  message: {
    data?: string;
    attributes?: Record<string, string>;
  };
}

/**
 * Dependencies required by the audio-stored handler. Mirrors the boundaries
 * the runtime cold-start code in `index.ts` already crosses (HTTP fetches,
 * GCS signed URLs, transcription providers, Pub/Sub publishes), so tests can
 * substitute every external interaction with an in-memory fake.
 */
export interface AudioStoredHandlerDeps {
  /** Module-level logger; the handler creates a request-scoped child from it. */
  baseLogger: WorkerLogger;
  /** Returns the user's preferred transcription provider, defaults to speechmatics on error. */
  fetchUserProvider: (userId: string, log: WorkerLogger) => Promise<string>;
  /** Generate a signed GCS URL for the audio file referenced by the event. */
  generateSignedUrl: (gcsPath: string) => Promise<Result<string, { message: string }>>;
  /** Create a transcription provider for the resolved provider name. */
  createProvider: (providerName: string, log: WorkerLogger) => SpeechTranscriptionPort;
  /** Publish a TranscriptionCompletedEvent to Pub/Sub. */
  publishCompleted: (event: TranscriptionCompletedEvent) => Promise<Result<void, PublishError>>;
  /**
   * Optional polling-config override forwarded to {@link transcribeAudio}.
   * Tests pass `{ initialDelayMs: 0, ... }` so polling completes immediately;
   * production leaves this unset so the orchestrator uses the documented
   * exponential-backoff defaults.
   */
  pollConfig?: Partial<PollingConfig>;
  /**
   * Optional `sleep` override forwarded to {@link transcribeAudio}. Tests
   * inject a no-op so polling does not block on real timers.
   */
  sleep?: (ms: number) => Promise<void>;
}

export type IdentityTokenProvider = (audience: string) => Promise<string>;

const HETZNER_PUBLIC_ORIGIN = 'https://intexuraos.cloud';
const HETZNER_PUBLIC_USER_SERVICE_BASE = `${HETZNER_PUBLIC_ORIGIN}/api/user`;
const GCP_METADATA_IDENTITY_ENDPOINT =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';

/**
 * Validate a parsed Pub/Sub payload has every required transcription request
 * field. Guards against schema drift between whatsapp-service (the producer)
 * and this worker.
 */
function isSupportedTranscriptionEventType(type: unknown): boolean {
  return type === 'whatsapp.audio.stored' || type === 'whatsapp.media.transcription.requested';
}

function isTranscriptionRequestEvent(event: { type?: string }): event is TranscriptionRequestEvent {
  const obj = event as Record<string, unknown>;
  if (
    typeof obj['userId'] !== 'string' ||
    typeof obj['messageId'] !== 'string' ||
    typeof obj['mediaId'] !== 'string' ||
    typeof obj['gcsPath'] !== 'string' ||
    typeof obj['mimeType'] !== 'string' ||
    typeof obj['timestamp'] !== 'string'
  ) {
    return false;
  }
  if (obj['type'] === 'whatsapp.media.transcription.requested') {
    return obj['mediaKind'] === 'audio' || obj['mediaKind'] === 'video';
  }
  // The caller rejects unsupported type literals before this structural guard.
  return true;
}

/**
 * Build the audio-stored CloudEvent handler.
 *
 * Returns an `AckResult` describing how `withObservability` should translate
 * the outcome to Pub/Sub:
 * - Parse / schema failures → DeadLetter (caller publishes to DLQ).
 * - Successful publish path → Ack.
 * - Anything thrown inside `transcribeAudio` propagates so the wrapper
 *   converts it to a Nack and Pub/Sub redelivers.
 */
export function createAudioStoredHandler(
  deps: AudioStoredHandlerDeps
): CloudEventHandler<PubSubData> {
  return async (
    event: CloudEvent<PubSubData>,
    _wrapperLogger: WorkerLogger
  ): Promise<AckResult> => {
    // `_wrapperLogger` (provided by `withObservability`) is intentionally
    // ignored: the Sentry-integrated pino logger threaded through `deps`
    // already carries the `service` / `release` bindings cold-start wired
    // in `index.ts`. Re-binding via the wrapper logger would discard those.
    const ctx = extractCorrelation(event.data?.message.attributes);
    return await runWithRequestContext(ctx, async (): Promise<AckResult> => {
      const reqLogger = deps.baseLogger.child({ requestId: ctx.requestId });

      const messageData = event.data?.message.data;
      if (messageData === undefined) {
        reqLogger.error(
          { event: 'missing_message_data', eventId: event.id },
          'No message data in event'
        );
        return { decision: AckDecision.DeadLetter, reason: 'missing_message_data' };
      }

      let transcriptionEvent: { type?: string };
      try {
        const decoded = Buffer.from(messageData, 'base64').toString('utf-8');
        transcriptionEvent = JSON.parse(decoded) as { type?: string };
      } catch {
        reqLogger.error(
          { event: 'parse_error', eventId: event.id },
          'Failed to parse Pub/Sub message'
        );
        return { decision: AckDecision.DeadLetter, reason: 'parse_error' };
      }

      // Explicit type guard before structural validation so we can log the
      // wrong type value for triage before structural validation.
      if (!isSupportedTranscriptionEventType(transcriptionEvent.type)) {
        reqLogger.warn(
          { event: 'unexpected_event_type', type: transcriptionEvent.type, eventId: event.id },
          'Unexpected event type, dead-lettering'
        );
        return { decision: AckDecision.DeadLetter, reason: 'unexpected_event_type' };
      }

      // Structural validation of the remaining required fields. After the
      // type-literal guard above, this branch only fails on missing
      // userId / messageId / mediaId / gcsPath / mimeType / timestamp / mediaKind.
      if (!isTranscriptionRequestEvent(transcriptionEvent)) {
        reqLogger.warn(
          { event: 'invalid_event_schema', eventId: event.id },
          'Transcription request event is missing required fields, dead-lettering'
        );
        return { decision: AckDecision.DeadLetter, reason: 'invalid_event_schema' };
      }

      await transcribeAudio(
        transcriptionEvent,
        {
          fetchUserProvider: (userId: string) => deps.fetchUserProvider(userId, reqLogger),
          generateSignedUrl: deps.generateSignedUrl,
          createProvider: (providerName: string) => deps.createProvider(providerName, reqLogger),
          publishEvent: deps.publishCompleted,
          ...(deps.pollConfig !== undefined ? { pollConfig: deps.pollConfig } : {}),
          ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
        },
        reqLogger
      );

      return { decision: AckDecision.Ack };
    });
  };
}

/**
 * Default user-service "fetch transcription provider" helper used by the
 * runtime entry point. Lives here so the same default is reachable from
 * tests that want to exercise the wiring without re-implementing the
 * fallback semantics ("network/HTTP error → speechmatics").
 *
 * @param userId           - User to look up.
 * @param userServiceUrl   - Base URL of user-service (no trailing slash).
 * @param internalAuthToken - Raw internal auth token (NOT `Bearer` prefixed).
 * @param reqLogger        - Request-scoped logger for warn lines on fallback.
 */
export async function fetchUserProvider(
  userId: string,
  userServiceUrl: string,
  internalAuthToken: string,
  reqLogger: WorkerLogger,
  identityTokenProvider: IdentityTokenProvider = fetchGoogleIdentityToken
): Promise<string> {
  try {
    const request = await buildUserSettingsRequest(
      userId,
      userServiceUrl,
      internalAuthToken,
      identityTokenProvider
    );
    const response = await fetch(request.url, { headers: request.headers });

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

async function buildUserSettingsRequest(
  userId: string,
  userServiceUrl: string,
  internalAuthToken: string,
  identityTokenProvider: IdentityTokenProvider
): Promise<{ url: string; headers: Record<string, string> }> {
  const encodedUserId = encodeURIComponent(userId);
  const normalizedUserServiceUrl = userServiceUrl.replace(/\/+$/, '');

  if (normalizedUserServiceUrl === HETZNER_PUBLIC_USER_SERVICE_BASE) {
    const token = await identityTokenProvider(HETZNER_PUBLIC_ORIGIN);
    return {
      url: `${HETZNER_PUBLIC_ORIGIN}/internal/users/${encodedUserId}/settings`,
      headers: { Authorization: `Bearer ${token}` },
    };
  }

  return {
    url: `${normalizedUserServiceUrl}/internal/users/${encodedUserId}/settings`,
    headers: { 'X-Internal-Auth': internalAuthToken },
  };
}

async function fetchGoogleIdentityToken(audience: string): Promise<string> {
  const params = new URLSearchParams({ audience, format: 'full' });
  const response = await fetch(`${GCP_METADATA_IDENTITY_ENDPOINT}?${params.toString()}`, {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Google identity token: HTTP ${String(response.status)}`);
  }
  return await response.text();
}

/**
 * Re-export `ok` / `err` for callers that build `Result`-typed signed URLs.
 *
 * The runtime entry point in `index.ts` wraps `Storage#getSignedUrl` calls
 * with this pair to translate thrown errors into the structured Result type
 * the handler expects. Re-exporting keeps the import surface minimal there.
 */
export { ok, err };
