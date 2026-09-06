import {
  defaultSentryTracesSampleRate,
  resolveSentryRelease,
} from '@intexuraos/infra-sentry/runtime-defaults';

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
}

/** Build an allowlisted browser config without forwarding the ambient env. */
export function buildWebSentryConfig(input: WebSentryConfigInput): WebSentryConfig {
  const release = resolveSentryRelease({ INTEXURAOS_COMMIT_SHA: input.commitSha });
  return {
    ...(input.dsn !== undefined && { dsn: input.dsn }),
    ...(input.environment !== undefined && { environment: input.environment }),
    ...(release !== undefined && { release }),
    tracesSampleRate: input.tracesSampleRate ?? defaultSentryTracesSampleRate(input.environment),
    sendDefaultPii: false,
  };
}
