/**
 * Contract test for `@intexuraos/common-worker`.
 *
 * Locks the §3.3 frozen API surface so any rename / removal / silent shape
 * change in subsequent edits fails CI before downstream workers (`log-cleanup`,
 * `transcription`, `vm-lifecycle`) are broken at integration time.
 *
 * Every assertion here is intentionally redundant with the per-module unit
 * tests — this file's value is that ALL the contract-level invariants live in
 * one place and are read together when reviewing a contract change.
 */
import { describe, expect, it } from 'vitest';
import * as runtime from '../index.js';
import * as testing from '../testing/index.js';
import type {
  WorkerLogger,
  EnvSpec,
  EnvVarSpec,
  LoadedEnv,
  AckResult,
  CloudEventHandler,
  ObservabilityOptions,
} from '../index.js';

describe('common-worker contract — runtime exports (§3.3)', () => {
  it('exports the four core functions', () => {
    expect(typeof runtime.createWorkerLogger).toBe('function');
    expect(typeof runtime.loadRequiredEnv).toBe('function');
    expect(typeof runtime.verifyInternalAuth).toBe('function');
    expect(typeof runtime.withObservability).toBe('function');
  });

  it('exports AckDecision with exactly Ack/Nack/DeadLetter variants', () => {
    expect(runtime.AckDecision.Ack).toBe('ack');
    expect(runtime.AckDecision.Nack).toBe('nack');
    expect(runtime.AckDecision.DeadLetter).toBe('dlq');
    const variants = Object.values(runtime.AckDecision);
    // Lock both the values AND the cardinality — adding a fourth variant
    // should fail this test until subtasks B–D update their handlers.
    expect(variants.length).toBe(3);
    expect(new Set(variants)).toEqual(new Set(['ack', 'nack', 'dlq']));
  });

  it('createWorkerLogger returns a WorkerLogger with required methods', () => {
    const log: WorkerLogger = runtime.createWorkerLogger('contract-test');
    expect(typeof log.level).toBe('string');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('loadRequiredEnv accepts EnvSpec and returns LoadedEnv', () => {
    process.env['CONTRACT_TEST_VAR'] = 'value';
    const spec: EnvSpec = { CONTRACT_TEST_VAR: { required: true } };
    const env: LoadedEnv<typeof spec> = runtime.loadRequiredEnv(spec);
    expect(env['CONTRACT_TEST_VAR']).toBe('value');
    delete process.env['CONTRACT_TEST_VAR'];

    // EnvVarSpec shape (compile-time check; the cast confirms the type)
    const entry: EnvVarSpec = { required: false, default: 'd' };
    expect(entry.required).toBe(false);
  });

  it('verifyInternalAuth returns boolean', () => {
    expect(runtime.verifyInternalAuth('s', 's')).toBe(true);
    expect(runtime.verifyInternalAuth('Bearer s', 's')).toBe(false);
  });

  it('AckResult and CloudEventHandler are usable as types', () => {
    const result: AckResult = { decision: runtime.AckDecision.Ack };
    expect(result.decision).toBe('ack');

    const handler: CloudEventHandler<{ x: number }> = async (_event, _logger): Promise<AckResult> =>
      Promise.resolve({ decision: runtime.AckDecision.Ack });
    expect(typeof handler).toBe('function');

    const opts: ObservabilityOptions = {
      sentryDsn: 'x',
      dlqPublish: async () => Promise.resolve(),
    };
    expect(opts.sentryDsn).toBe('x');
  });
});

describe('common-worker contract — testing exports (§3.3)', () => {
  it('exports the three test helpers from /testing subpath', () => {
    expect(typeof testing.createFakeLogger).toBe('function');
    expect(typeof testing.makePubSubCloudEvent).toBe('function');
    expect(typeof testing.makeHttpRequest).toBe('function');
    expect(typeof testing.makeHttpResponse).toBe('function');
  });

  it('createFakeLogger returns a WorkerLogger with .entries', () => {
    const log = testing.createFakeLogger();
    log.info({ a: 1 }, 'msg');
    expect(log.entries.length).toBe(1);
    const first = log.entries[0];
    expect(first?.level).toBe('info');
    expect(first?.msg).toBe('msg');
  });

  it('makePubSubCloudEvent base64-encodes the JSON payload', () => {
    const evt = testing.makePubSubCloudEvent({ hello: 'world' });
    const encoded = evt.data?.message.data;
    expect(encoded).toBeDefined();
    const decoded = JSON.parse(Buffer.from(encoded ?? '', 'base64').toString('utf8')) as {
      hello: string;
    };
    expect(decoded.hello).toBe('world');
  });

  it('makeHttpResponse captures status and body', () => {
    const res = testing.makeHttpResponse();
    res.status(200).json({ ok: true });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true });
  });

  it('makePubSubCloudEvent supports stripping `data` for the missing-data DLQ path', () => {
    // The override accepts `data: undefined` directly via
    // `PubSubCloudEventOverrides`, no double-cast required. This exercises
    // the "missing message data" path that subtask C will dead-letter.
    const evt = testing.makePubSubCloudEvent({ ignored: true }, { data: undefined });
    expect(evt.data).toBeUndefined();
  });
});
