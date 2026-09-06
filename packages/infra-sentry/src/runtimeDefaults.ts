/** Browser-safe Sentry runtime defaults shared by services, workers, and web. */

export type SentryRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function exactCommitSha(value: string | undefined): string | undefined {
  return value !== undefined && /^[0-9a-f]{40}$/u.test(value) ? value : undefined;
}

function safeRevisionId(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    value.toLowerCase() === 'unknown' ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

export function resolveSentryRelease(env: SentryRuntimeEnvironment): string | undefined {
  return exactCommitSha(env['INTEXURAOS_COMMIT_SHA']) ?? safeRevisionId(env['K_REVISION']);
}

export function defaultSentryTracesSampleRate(environment: string | undefined): number {
  return environment === 'prod' || environment === 'production' ? 0.1 : 0;
}
