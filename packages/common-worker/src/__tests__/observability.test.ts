/**
 * Tests for withObservability.
 *
 * Covers every branch of the §3.3 contract:
 *  - Ack / Nack / DeadLetter (with and without publisher)
 *  - Handler throws → re-thrown
 *  - Sentry capture happens iff a DSN is provided
 *  - `worker_request_start` and decision-specific log entries are emitted
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn<(error: unknown) => string>(() => 'event-id');

vi.mock('@sentry/node', () => ({
  captureException,
}));

const { AckDecision, withObservability } = await import('../observability.js');
type AckResult = import('../observability.js').AckResult;
const { createFakeLogger } = await import('../testing/fakeLogger.js');
const { makePubSubCloudEvent } = await import('../testing/cloudEvent.js');

describe('withObservability', () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it('resolves and logs ack when handler returns Ack', async () => {
    const log = createFakeLogger();
    const handler = vi.fn(
      async (): Promise<AckResult> => Promise.resolve({ decision: AckDecision.Ack })
    );
    const wrapped = withObservability('t', handler, { logger: log });

    await expect(wrapped(makePubSubCloudEvent({ x: 1 }))).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledOnce();
    const events = log.entries.map((e) => (e.obj as { event: string }).event);
    expect(events).toContain('worker_request_start');
    expect(events).toContain('worker_request_ack');
  });

  it('throws and logs nack with reason when handler returns Nack', async () => {
    const log = createFakeLogger();
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> =>
        Promise.resolve({ decision: AckDecision.Nack, reason: 'transient' }),
      { logger: log }
    );

    await expect(wrapped(makePubSubCloudEvent({}))).rejects.toThrow(/nack: transient/);

    const nackEntry = log.entries.find(
      (e) => (e.obj as { event: string }).event === 'worker_request_nack'
    );
    expect(nackEntry).toBeDefined();
    expect((nackEntry?.obj as { reason?: string }).reason).toBe('transient');
  });

  it('uses "unspecified" reason when Nack omits one', async () => {
    const log = createFakeLogger();
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> => Promise.resolve({ decision: AckDecision.Nack }),
      { logger: log }
    );

    await expect(wrapped(makePubSubCloudEvent({}))).rejects.toThrow(/nack: unspecified/);
  });

  it('publishes to DLQ and resolves when DeadLetter is returned with a publisher', async () => {
    const log = createFakeLogger();
    const dlq = vi.fn(async (): Promise<void> => Promise.resolve());
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> =>
        Promise.resolve({ decision: AckDecision.DeadLetter, reason: 'parse_error' }),
      { logger: log, dlqPublish: dlq }
    );

    const evt = makePubSubCloudEvent({ payload: 'x' });
    await expect(wrapped(evt)).resolves.toBeUndefined();

    expect(dlq).toHaveBeenCalledExactlyOnceWith(evt.data, 'parse_error');
    const dlqEntry = log.entries.find(
      (e) => (e.obj as { event: string }).event === 'worker_request_dlq'
    );
    expect(dlqEntry).toBeDefined();
  });

  it('uses default reason "unspecified" when DeadLetter omits one', async () => {
    const dlq = vi.fn(async (): Promise<void> => Promise.resolve());
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> => Promise.resolve({ decision: AckDecision.DeadLetter }),
      { logger: createFakeLogger(), dlqPublish: dlq }
    );

    await wrapped(makePubSubCloudEvent({}));
    expect(dlq).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'unspecified');
  });

  it('degrades DeadLetter to Nack with WARN when no publisher is configured', async () => {
    const log = createFakeLogger();
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> =>
        Promise.resolve({ decision: AckDecision.DeadLetter, reason: 'no_pub' }),
      { logger: log }
    );

    await expect(wrapped(makePubSubCloudEvent({}))).rejects.toThrow(/dlq \(no publisher\): no_pub/);

    const warnEntry = log.entries.find(
      (e) => (e.obj as { event: string }).event === 'worker_request_dlq_missing_publisher'
    );
    expect(warnEntry).toBeDefined();
    expect(warnEntry?.level).toBe('warn');
  });

  it('uses default reason "unspecified" when DeadLetter degrades to Nack without reason', async () => {
    const log = createFakeLogger();
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> => Promise.resolve({ decision: AckDecision.DeadLetter }),
      { logger: log }
    );

    await expect(wrapped(makePubSubCloudEvent({}))).rejects.toThrow(
      /dlq \(no publisher\): unspecified/
    );
  });

  it('re-throws handler errors and captures to Sentry when DSN is provided', async () => {
    const log = createFakeLogger();
    const boom = new Error('boom');
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> => {
        await Promise.resolve();
        throw boom;
      },
      { logger: log, sentryDsn: 'https://example/123' }
    );

    await expect(wrapped(makePubSubCloudEvent({}))).rejects.toBe(boom);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(boom);

    const errEntry = log.entries.find(
      (e) => (e.obj as { event: string }).event === 'worker_request_error'
    );
    expect(errEntry).toBeDefined();
    expect(errEntry?.level).toBe('error');
  });

  it('does NOT call Sentry when DSN is omitted, even on handler throw', async () => {
    const log = createFakeLogger();
    const boom = new Error('boom');
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> => {
        await Promise.resolve();
        throw boom;
      },
      { logger: log }
    );

    await expect(wrapped(makePubSubCloudEvent({}))).rejects.toBe(boom);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does NOT call Sentry when DSN is empty string', async () => {
    const log = createFakeLogger();
    const wrapped = withObservability(
      't',
      async (): Promise<AckResult> => {
        await Promise.resolve();
        throw new Error('x');
      },
      { logger: log, sentryDsn: '' }
    );

    await expect(wrapped(makePubSubCloudEvent({}))).rejects.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('uses createWorkerLogger when no logger is injected', async () => {
    // No logger override → wrapper instantiates one internally; covers the
    // default-arm of the `opts.logger ?? createWorkerLogger(handlerName)` line.
    const wrapped = withObservability(
      'default-logger-test',
      async (): Promise<AckResult> => Promise.resolve({ decision: AckDecision.Ack })
    );
    await expect(wrapped(makePubSubCloudEvent({}))).resolves.toBeUndefined();
  });
});
