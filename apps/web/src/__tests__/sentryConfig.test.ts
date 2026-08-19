import { describe, expect, it } from 'vitest';
import { buildWebSentryConfig } from '../sentryConfig.js';

const FIRESTORE_CANCELLATION_NAME_ERROR =
  "Cannot assign to read only property 'name' of object 'Error: Operation cancelled'";

interface TestSentryEvent {
  exception?: {
    values?: {
      type?: string;
      value?: string;
      stacktrace?: {
        frames?: { filename?: string }[];
      };
    }[];
  };
}

function runBeforeSend(event: TestSentryEvent): TestSentryEvent | null | undefined {
  const config = buildWebSentryConfig({
    dsn: 'https://public@example.invalid/1',
    environment: 'prod',
    commitSha: '1234567890abcdef1234567890abcdef12345678',
  }) as ReturnType<typeof buildWebSentryConfig> & {
    beforeSend?: (candidate: TestSentryEvent, hint: object) => TestSentryEvent | null;
  };

  return config.beforeSend?.(event, {});
}

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
      beforeSend: expect.any(Function),
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
      beforeSend: expect.any(Function),
    });
  });

  it('drops the expected Firestore timer cancellation constructor failure', () => {
    const event = {
      exception: {
        values: [{
          type: 'TypeError',
          value: FIRESTORE_CANCELLATION_NAME_ERROR,
          stacktrace: {
            frames: [
              { filename: 'https://intexuraos.cloud/assets/firebase-DjIaBHIJ.js' },
              { filename: 'https://intexuraos.cloud/assets/firebase-DjIaBHIJ.js' },
            ],
          },
        }],
      },
    };

    expect(runBeforeSend(event)).toBeNull();
  });

  it.each([
    {
      name: 'the same message without a stack',
      event: {
        exception: {
          values: [{ type: 'TypeError', value: FIRESTORE_CANCELLATION_NAME_ERROR }],
        },
      },
    },
    {
      name: 'the same message with an application frame',
      event: {
        exception: {
          values: [{
            type: 'TypeError',
            value: FIRESTORE_CANCELLATION_NAME_ERROR,
            stacktrace: {
              frames: [
                { filename: 'https://intexuraos.cloud/assets/firebase-DjIaBHIJ.js' },
                { filename: 'https://intexuraos.cloud/assets/index-FJfXyRiG.js' },
              ],
            },
          }],
        },
      },
    },
    {
      name: 'a different Firebase TypeError',
      event: {
        exception: {
          values: [{
            type: 'TypeError',
            value: 'Cannot assign to read only property',
            stacktrace: {
              frames: [{ filename: 'https://intexuraos.cloud/assets/firebase-DjIaBHIJ.js' }],
            },
          }],
        },
      },
    },
  ])('keeps $name', ({ event }) => {
    expect(runBeforeSend(event)).toBe(event);
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
