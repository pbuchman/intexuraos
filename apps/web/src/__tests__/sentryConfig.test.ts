import { describe, expect, it } from 'vitest';
import { buildWebSentryConfig } from '../sentryConfig.js';

describe('buildWebSentryConfig', () => {
  it.each([
    ['prod', 0.1],
    ['production', 0.1],
    ['development', 0],
    ['test', 0],
    [undefined, 0],
  ] as const)('uses the shared tracing policy for %s', (environment, expected) => {
    expect(buildWebSentryConfig({
      dsn: 'https://public@example.invalid/1',
      environment,
      commitSha: '1234567890abcdef1234567890abcdef12345678',
    }).tracesSampleRate).toBe(expected);
  });

  it('uses the exact commit release, disables default PII, and exposes only allowlisted config', () => {
    const result = buildWebSentryConfig({
      dsn: 'https://public@example.invalid/1',
      environment: 'prod',
      commitSha: '1234567890abcdef1234567890abcdef12345678',
      tracesSampleRate: 0.25,
      unexpectedSecret: 'must-not-escape',
    } as Parameters<typeof buildWebSentryConfig>[0] & { unexpectedSecret: string });

    expect(result).toEqual({
      dsn: 'https://public@example.invalid/1',
      environment: 'prod',
      release: '1234567890abcdef1234567890abcdef12345678',
      tracesSampleRate: 0.25,
      sendDefaultPii: false,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
  });

  it('passes an Error Hub DSN through unchanged with its environment and release', () => {
    const dsn =
      'https://0123456789abcdef0123456789abcdef@errors.intexuraos.cloud/2';

    expect(
      buildWebSentryConfig({
        dsn,
        environment: 'prod',
        commitSha: '1234567890abcdef1234567890abcdef12345678',
      }),
    ).toEqual({
      dsn,
      environment: 'prod',
      release: '1234567890abcdef1234567890abcdef12345678',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  });

  it('omits absent optional BrowserOptions instead of emitting undefined properties', () => {
    const result = buildWebSentryConfig({
      dsn: undefined,
      environment: undefined,
      commitSha: undefined,
    });

    expect(Object.hasOwn(result, 'dsn')).toBe(false);
    expect(Object.hasOwn(result, 'environment')).toBe(false);
    expect(Object.hasOwn(result, 'release')).toBe(false);
  });

  it.each([
    '',
    '   ',
    'unknown',
    ' UNKNOWN ',
    '1234567',
    'ABCDEF1234567890abcdef1234567890abcdef12',
    'g'.repeat(40),
    ' 1234567890abcdef1234567890abcdef12345678 ',
  ])('omits non-exact release %j', (commitSha) => {
    expect(buildWebSentryConfig({ dsn: '', environment: 'development', commitSha }).release)
      .toBeUndefined();
  });
});
