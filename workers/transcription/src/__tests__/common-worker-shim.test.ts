import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AckDecision,
  createFakeLogger,
  createWorkerLogger,
  loadRequiredEnv,
  makePubSubCloudEvent,
  verifyInternalAuth,
  withObservability,
  type AckResult,
  type CloudEventHandler,
} from '../__shims__/common-worker.js';

describe('shim: createWorkerLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a logger with default level "info" when LOG_LEVEL is unset', () => {
    delete process.env['LOG_LEVEL'];
    const logger = createWorkerLogger('transcription-test');
    expect(logger.level).toBe('info');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('respects LOG_LEVEL when set', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const logger = createWorkerLogger('transcription-test');
    expect(logger.level).toBe('debug');
  });
});

describe('shim: loadRequiredEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns required vars when present', () => {
    process.env['SHIM_TEST_REQ'] = 'present';
    const out = loadRequiredEnv({ SHIM_TEST_REQ: { required: true } });
    expect(out.SHIM_TEST_REQ).toBe('present');
  });

  it('throws when a required var is missing', () => {
    delete process.env['SHIM_TEST_MISSING'];
    expect(() => loadRequiredEnv({ SHIM_TEST_MISSING: { required: true } })).toThrow(
      /SHIM_TEST_MISSING/
    );
  });

  it('throws when a required var is empty string', () => {
    process.env['SHIM_TEST_EMPTY'] = '';
    expect(() => loadRequiredEnv({ SHIM_TEST_EMPTY: { required: true } })).toThrow(
      /SHIM_TEST_EMPTY/
    );
  });

  it('uses provided default when optional var is missing', () => {
    delete process.env['SHIM_TEST_OPT'];
    const out = loadRequiredEnv({
      SHIM_TEST_OPT: { required: false, default: 'fallback' },
    });
    expect(out.SHIM_TEST_OPT).toBe('fallback');
  });

  it('uses empty string when optional var is missing and no default given', () => {
    delete process.env['SHIM_TEST_OPT_NODEF'];
    const out = loadRequiredEnv({ SHIM_TEST_OPT_NODEF: { required: false } });
    expect(out.SHIM_TEST_OPT_NODEF).toBe('');
  });

  it('aggregates multiple missing required vars in one error', () => {
    delete process.env['SHIM_MULTI_A'];
    delete process.env['SHIM_MULTI_B'];
    expect(() =>
      loadRequiredEnv({
        SHIM_MULTI_A: { required: true },
        SHIM_MULTI_B: { required: true },
      })
    ).toThrow(/SHIM_MULTI_A.*SHIM_MULTI_B/);
  });
});

describe('shim: verifyInternalAuth', () => {
  it('returns false when expected token is undefined', () => {
    expect(verifyInternalAuth('whatever', undefined)).toBe(false);
  });

  it('returns false when expected token is empty', () => {
    expect(verifyInternalAuth('whatever', '')).toBe(false);
  });

  it('returns false when header is undefined', () => {
    expect(verifyInternalAuth(undefined, 'expected')).toBe(false);
  });

  it('returns false when header is empty string', () => {
    expect(verifyInternalAuth('', 'expected')).toBe(false);
  });

  it('returns false when first array element is undefined', () => {
    expect(verifyInternalAuth([] as unknown as string[], 'expected')).toBe(false);
  });

  it('returns false on length mismatch', () => {
    expect(verifyInternalAuth('short', 'much-longer-token')).toBe(false);
  });

  it('returns true on exact match', () => {
    expect(verifyInternalAuth('exact-match', 'exact-match')).toBe(true);
  });

  it('returns false when tokens differ but lengths match', () => {
    expect(verifyInternalAuth('aaaaaaaa', 'bbbbbbbb')).toBe(false);
  });

  it('uses first element of an array header value', () => {
    expect(verifyInternalAuth(['exact-match', 'ignored'], 'exact-match')).toBe(true);
  });

  it('rejects legacy `Bearer <token>` format', () => {
    expect(verifyInternalAuth('Bearer test-token', 'test-token')).toBe(false);
  });
});

describe('shim: createFakeLogger', () => {
  it('records info / warn / error / debug entries with the level tag', () => {
    const logger = createFakeLogger();
    logger.info({ k: 1 }, 'info-msg');
    logger.warn({ k: 2 }, 'warn-msg');
    logger.error({ k: 3 }, 'error-msg');
    logger.debug({ k: 4 }, 'debug-msg');

    expect(logger.entries).toHaveLength(4);
    expect(logger.entries[0]).toEqual({ level: 'info', obj: { k: 1 }, msg: 'info-msg' });
    expect(logger.entries[1]).toEqual({ level: 'warn', obj: { k: 2 }, msg: 'warn-msg' });
    expect(logger.entries[2]).toEqual({ level: 'error', obj: { k: 3 }, msg: 'error-msg' });
    expect(logger.entries[3]).toEqual({ level: 'debug', obj: { k: 4 }, msg: 'debug-msg' });
  });

  it('omits msg field when called without a message string', () => {
    const logger = createFakeLogger();
    logger.info({ k: 1 });
    expect(logger.entries[0]).toEqual({ level: 'info', obj: { k: 1 } });
    expect(logger.entries[0]).not.toHaveProperty('msg');
  });

  it('returns the configured level', () => {
    expect(createFakeLogger('warn').level).toBe('warn');
    expect(createFakeLogger().level).toBe('debug');
  });

  it('returns an independent fake logger from .child() with its own entries', () => {
    const parent = createFakeLogger();
    const child = parent.child({ requestId: 'abc' });
    child.info({}, 'child line');

    expect(parent.entries).toHaveLength(0);
    expect(child.entries).toHaveLength(1);
  });
});

describe('shim: makePubSubCloudEvent', () => {
  it('encodes payload as base64 JSON in event.data.message.data by default', () => {
    const event = makePubSubCloudEvent({ hello: 'world' });
    const decoded = Buffer.from(event.data?.message.data ?? '', 'base64').toString('utf-8');
    expect(JSON.parse(decoded)).toEqual({ hello: 'world' });
    expect(event.id).toBe('test-event-id');
    expect(event.type).toBe('google.cloud.pubsub.topic.v1.messagePublished');
  });

  it('applies overrides for top-level CloudEvent fields', () => {
    const event = makePubSubCloudEvent({}, { id: 'custom-id', source: 'custom-source' });
    expect(event.id).toBe('custom-id');
    expect(event.source).toBe('custom-source');
  });

  it('lets callers override the entire message (e.g. omit data field)', () => {
    const event = makePubSubCloudEvent({}, {}, { attributes: { 'x-request-id': 'req-1' } });
    expect(event.data?.message.data).toBeUndefined();
    expect(event.data?.message.attributes).toEqual({ 'x-request-id': 'req-1' });
  });
});

describe('shim: withObservability', () => {
  // CloudEvent `id` is required by the type but only used for log correlation;
  // pass a stable string in tests so log assertions stay deterministic.
  function makeEvent(overrides: { id?: string } = {}): ReturnType<typeof makePubSubCloudEvent> {
    return makePubSubCloudEvent({ payload: 'x' }, { id: overrides.id ?? 'evt-1' });
  }

  it('Ack: resolves and logs worker_request_ack', async () => {
    const baseLogger = createFakeLogger();
    const handler: CloudEventHandler<unknown> = async (): Promise<AckResult> => ({
      decision: AckDecision.Ack,
    });
    const wrapped = withObservability('test', handler, { baseLogger });

    await expect(wrapped(makeEvent())).resolves.toBeUndefined();

    const events = baseLogger.entries.map((e) => (e.obj as { event?: string }).event);
    expect(events).toContain('worker_request_start');
    expect(events).toContain('worker_request_ack');
  });

  it('Nack: throws and logs worker_request_nack with reason', async () => {
    const baseLogger = createFakeLogger();
    const handler: CloudEventHandler<unknown> = async (): Promise<AckResult> => ({
      decision: AckDecision.Nack,
      reason: 'transient_error',
    });
    const wrapped = withObservability('test', handler, { baseLogger });

    await expect(wrapped(makeEvent())).rejects.toThrow(/nack: transient_error/);

    const nackEntry = baseLogger.entries.find(
      (e) => (e.obj as { event?: string }).event === 'worker_request_nack'
    );
    expect(nackEntry).toBeDefined();
    expect((nackEntry?.obj as { reason?: string }).reason).toBe('transient_error');
  });

  it('Nack with no reason: throws "nack: unspecified"', async () => {
    const baseLogger = createFakeLogger();
    const handler: CloudEventHandler<unknown> = async (): Promise<AckResult> => ({
      decision: AckDecision.Nack,
    });
    const wrapped = withObservability('test', handler, { baseLogger });
    await expect(wrapped(makeEvent())).rejects.toThrow(/nack: unspecified/);
  });

  it('DeadLetter with publisher: invokes dlqPublish with payload + reason and resolves', async () => {
    const baseLogger = createFakeLogger();
    const dlqPublish = vi.fn().mockResolvedValue(undefined);
    const handler: CloudEventHandler<unknown> = async (): Promise<AckResult> => ({
      decision: AckDecision.DeadLetter,
      reason: 'parse_error',
    });
    const wrapped = withObservability('test', handler, { baseLogger, dlqPublish });

    const event = makeEvent();
    await expect(wrapped(event)).resolves.toBeUndefined();

    expect(dlqPublish).toHaveBeenCalledTimes(1);
    expect(dlqPublish).toHaveBeenCalledWith(event.data, 'parse_error');

    const dlqEntry = baseLogger.entries.find(
      (e) => (e.obj as { event?: string }).event === 'worker_request_dlq'
    );
    expect(dlqEntry).toBeDefined();
  });

  it('DeadLetter without publisher: degrades to nack and logs missing-publisher warning', async () => {
    const baseLogger = createFakeLogger();
    const handler: CloudEventHandler<unknown> = async (): Promise<AckResult> => ({
      decision: AckDecision.DeadLetter,
      reason: 'schema_invalid',
    });
    const wrapped = withObservability('test', handler, { baseLogger });

    await expect(wrapped(makeEvent())).rejects.toThrow(/dlq \(no publisher\): schema_invalid/);

    const warnEntry = baseLogger.entries.find(
      (e) => (e.obj as { event?: string }).event === 'worker_request_dlq_missing_publisher'
    );
    expect(warnEntry).toBeDefined();
  });

  it('DeadLetter with no reason: defaults reason to "dlq" when invoking dlqPublish', async () => {
    const baseLogger = createFakeLogger();
    const dlqPublish = vi.fn().mockResolvedValue(undefined);
    const handler: CloudEventHandler<unknown> = async (): Promise<AckResult> => ({
      decision: AckDecision.DeadLetter,
    });
    const wrapped = withObservability('test', handler, { baseLogger, dlqPublish });

    await wrapped(makeEvent());

    expect(dlqPublish).toHaveBeenCalledWith(expect.anything(), 'dlq');
  });

  it('handler throws: logs worker_request_error and re-throws', async () => {
    const baseLogger = createFakeLogger();
    const handler: CloudEventHandler<unknown> = async (): Promise<AckResult> => {
      throw new Error('boom');
    };
    const wrapped = withObservability('test', handler, { baseLogger });

    await expect(wrapped(makeEvent())).rejects.toThrow(/boom/);

    const errEntry = baseLogger.entries.find(
      (e) => (e.obj as { event?: string }).event === 'worker_request_error'
    );
    expect(errEntry).toBeDefined();
  });

  it('falls back to createWorkerLogger(handlerName) when no baseLogger is supplied', async () => {
    // Smoke test: ensures the no-baseLogger code path in withObservability does
    // not crash. The default pino logger writes to stdout; we assert only that
    // the handler ran and ack resolved.
    const handlerCalls: string[] = [];
    const handler: CloudEventHandler<unknown> = async (_event, log): Promise<AckResult> => {
      handlerCalls.push(log.level);
      return { decision: AckDecision.Ack };
    };
    const wrapped = withObservability('handler-without-base-logger', handler);

    await expect(wrapped(makeEvent())).resolves.toBeUndefined();
    expect(handlerCalls).toHaveLength(1);
  });
});
