import {
  defaultSentryTracesSampleRate,
  resolveSentryRelease,
} from '@intexuraos/infra-sentry/runtime-defaults';
import type { BrowserOptions } from '@sentry/react';

const FIRESTORE_CANCELLATION_NAME_ERROR =
  "Cannot assign to read only property 'name' of object 'Error: Operation cancelled'";
const FIREBASE_BUNDLE_URL = /\/assets\/firebase-[^/?]+\.js(?:\?.*)?$/u;

type BeforeSendHook = NonNullable<BrowserOptions['beforeSend']>;
type SentryErrorEvent = Parameters<BeforeSendHook>[0];

export interface WebSentryConfigInput {
  dsn: string | undefined;
  environment: string | undefined;
  commitSha: string | undefined;
  tracesSampleRate?: number;
}

export interface WebSentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate: number;
  sendDefaultPii: false;
  beforeSend: BeforeSendHook;
}

function isExpectedFirestoreCancellationFailure(event: SentryErrorEvent): boolean {
  const exceptions = event.exception?.values;
  if (exceptions?.length !== 1) return false;

  const exception = exceptions[0];
  if (
    exception?.type !== 'TypeError'
    || exception.value !== FIRESTORE_CANCELLATION_NAME_ERROR
  ) {
    return false;
  }

  const frames = exception.stacktrace?.frames;
  return frames !== undefined
    && frames.length > 0
    && frames.every((frame) =>
      typeof frame.filename === 'string' && FIREBASE_BUNDLE_URL.test(frame.filename));
}

const beforeSend: BeforeSendHook = (event) =>
  isExpectedFirestoreCancellationFailure(event) ? null : event;

/** Build an allowlisted browser config without forwarding the ambient env. */
export function buildWebSentryConfig(input: WebSentryConfigInput): WebSentryConfig {
  const release = resolveSentryRelease({ INTEXURAOS_COMMIT_SHA: input.commitSha });
  return {
    ...(input.dsn !== undefined && { dsn: input.dsn }),
    ...(input.environment !== undefined && { environment: input.environment }),
    ...(release !== undefined && { release }),
    tracesSampleRate: input.tracesSampleRate ?? defaultSentryTracesSampleRate(input.environment),
    sendDefaultPii: false,
    beforeSend,
  };
}
