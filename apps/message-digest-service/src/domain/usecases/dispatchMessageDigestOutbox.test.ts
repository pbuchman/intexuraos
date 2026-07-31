import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestDispatchOutbox } from '../models/messageDigestRun.js';
import type { FrozenMessageDigestPayloadPublisher } from '../ports/messageDigestPublishers.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { dispatchMessageDigestOutbox } from './dispatchMessageDigestOutbox.js';

const NOW = '2026-07-27T12:00:00.000Z';
const OWNER_DIGEST = 'f09636c1f911fba0335c4544cb1f3b9d8c0a76530517d418b14e7d7ee1670a9d';

describe('dispatchMessageDigestOutbox', () => {
  it.each([
    ['run_request', 'runRequestPublisher'],
    ['whatsapp_delivery', 'whatsappPublisher'],
  ] as const)(
    'publishes exact persisted bytes for %s and records ack',
    async (kind, publisherKey) => {
      const harness = createHarness({ kind });

      const result = await dispatchMessageDigestOutbox(input(), harness.dependencies);

      expect(harness.claimDispatch).toHaveBeenCalledWith({
        outboxId: 'mdo_dispatch_001',
        ownerDigest: OWNER_DIGEST,
        now: NOW,
        expiresAt: '2026-07-27T12:02:00.000Z',
      });
      expect(harness[publisherKey]).toHaveBeenCalledWith(harness.dispatch.payloadJson);
      const unusedPublisher =
        publisherKey === 'runRequestPublisher'
          ? harness.whatsappPublisher
          : harness.runRequestPublisher;
      expect(unusedPublisher).not.toHaveBeenCalled();
      expect(harness.recordDispatchResult).toHaveBeenCalledWith({
        outboxId: 'mdo_dispatch_001',
        ownerDigest: OWNER_DIGEST,
        fence: 7,
        now: NOW,
        outcome: { status: 'published', publishedAt: NOW },
      });
      expect(result).toEqual({ ok: true, disposition: 'published' });
    }
  );

  it('keeps unknown acknowledgement pending and retries the identical payload', async () => {
    const harness = createHarness({ publishFailure: 'ACK_UNKNOWN' });

    await expect(dispatchMessageDigestOutbox(input(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'retry_scheduled',
    });
    expect(harness.recordDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: { status: 'retry', nextAttemptAt: '2026-07-27T12:00:30.000Z' },
      })
    );
    expect(harness.runRequestPublisher).toHaveBeenCalledWith(harness.dispatch.payloadJson);

    await dispatchMessageDigestOutbox(input(), harness.dependencies);
    expect(harness.runRequestPublisher).toHaveBeenNthCalledWith(2, harness.dispatch.payloadJson);
  });

  it('treats a thrown publisher acknowledgement as unknown and schedules the same retry', async () => {
    const harness = createHarness();
    harness.runRequestPublisher.mockRejectedValueOnce(
      new Error('synthetic publisher acknowledgement failure')
    );

    await expect(dispatchMessageDigestOutbox(input(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'retry_scheduled',
    });
    expect(harness.recordDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: { status: 'retry', nextAttemptAt: '2026-07-27T12:00:30.000Z' },
      })
    );
  });

  it('terminalizes only a locally invalid frozen payload', async () => {
    const harness = createHarness({ publishFailure: 'INVALID_PAYLOAD' });

    await expect(dispatchMessageDigestOutbox(input(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'terminal',
    });
    expect(harness.recordDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: { status: 'terminal', terminalCode: 'INVALID_PAYLOAD' },
      })
    );
  });

  it('heartbeats a fenced claim past its original expiry and records with fresh time', async () => {
    let releaseHeartbeat = (): void => undefined;
    const heartbeat = new Promise<void>((resolve) => {
      releaseHeartbeat = resolve;
    });
    let settlePublish = (_result: { ok: true; messageId: string }): void => undefined;
    const publication = new Promise<{ ok: true; messageId: string }>((resolve) => {
      settlePublish = resolve;
    });
    const dispatch = makeDispatch('whatsapp_delivery');
    const claimDispatch = vi.fn<MessageDigestStore['claimDispatch']>(async () => ({
      ok: true,
      disposition: 'claimed',
      fence: 7,
      dispatch,
    }));
    const renewDispatchClaim = vi.fn(async (renewal: {
      outboxId: string;
      ownerDigest: string;
      fence: number;
      now: string;
      expiresAt: string;
    }) => ({ ok: true as const, expiresAt: renewal.expiresAt }));
    const recordDispatchResult = vi.fn<MessageDigestStore['recordDispatchResult']>(async () => ({
      ok: true,
    }));
    const whatsappPublisher = vi.fn(() => publication);
    const nowValues = [
      NOW,
      '2026-07-27T12:01:30.000Z',
      '2026-07-27T12:02:30.000Z',
    ];
    const dependencies = {
      store: { claimDispatch, renewDispatchClaim, recordDispatchResult },
      runRequestPublisher: { publish: vi.fn() },
      whatsappPublisher: { publish: whatsappPublisher },
      waitForHeartbeat: vi.fn(async (_delayMs: number, signal: AbortSignal) => {
        if (signal.aborted) return;
        if (nowValues.length === 2) {
          await heartbeat;
          return;
        }
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
      now: (): string => nowValues.shift() ?? '2026-07-27T12:02:30.000Z',
    } as unknown as Parameters<typeof dispatchMessageDigestOutbox>[1];

    const pending = dispatchMessageDigestOutbox(input(), dependencies);
    await Promise.resolve();
    releaseHeartbeat();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const renewalCountBeforeOriginalExpiry = renewDispatchClaim.mock.calls.length;
    settlePublish({ ok: true, messageId: 'synthetic-message-id' });

    await expect(pending).resolves.toEqual({ ok: true, disposition: 'published' });
    expect(renewalCountBeforeOriginalExpiry).toBe(1);
    expect(renewDispatchClaim).toHaveBeenCalledWith({
      outboxId: 'mdo_dispatch_001',
      ownerDigest: OWNER_DIGEST,
      fence: 7,
      now: '2026-07-27T12:01:30.000Z',
      expiresAt: '2026-07-27T12:03:30.000Z',
    });
    expect(recordDispatchResult).toHaveBeenCalledWith({
      outboxId: 'mdo_dispatch_001',
      ownerDigest: OWNER_DIGEST,
      fence: 7,
      now: '2026-07-27T12:02:30.000Z',
      outcome: {
        status: 'published',
        publishedAt: '2026-07-27T12:02:30.000Z',
      },
    });
  });

  it('fails closed when the result clock becomes invalid after publication', async () => {
    const harness = createHarness();
    const nowValues = [NOW, 'not-an-instant'];
    harness.dependencies.now = (): string => nowValues.shift() ?? 'not-an-instant';

    await expect(dispatchMessageDigestOutbox(input(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'CLAIM_LOST',
    });
    expect(harness.recordDispatchResult).not.toHaveBeenCalled();
  });

  it('fails closed when the heartbeat clock becomes invalid', async () => {
    const harness = createHarness();
    const pendingPublication = createPendingPublication();
    harness.runRequestPublisher.mockReturnValueOnce(pendingPublication.promise);
    harness.dependencies.waitForHeartbeat = vi.fn(async () => undefined);
    const nowValues = [NOW, 'not-an-instant'];
    harness.dependencies.now = (): string => nowValues.shift() ?? 'not-an-instant';

    const pending = dispatchMessageDigestOutbox(input(), harness.dependencies);
    await vi.waitFor(() => {
      expect(harness.dependencies.waitForHeartbeat).toHaveBeenCalledOnce();
    });
    pendingPublication.resolve({ ok: true, messageId: 'synthetic-message-id' });

    await expect(pending).resolves.toEqual({ ok: false, code: 'CLAIM_LOST' });
    expect(harness.renewDispatchClaim).not.toHaveBeenCalled();
    expect(harness.recordDispatchResult).not.toHaveBeenCalled();
  });

  it.each(['lost', 'throws'] as const)(
    'fails closed when heartbeat claim renewal %s',
    async (renewalOutcome) => {
      const harness = createHarness();
      const pendingPublication = createPendingPublication();
      harness.runRequestPublisher.mockReturnValueOnce(pendingPublication.promise);
      harness.dependencies.waitForHeartbeat = vi.fn(async () => undefined);
      if (renewalOutcome === 'lost') {
        harness.renewDispatchClaim.mockResolvedValueOnce({
          ok: false,
          code: 'CLAIM_LOST',
        });
      } else {
        harness.renewDispatchClaim.mockRejectedValueOnce(new Error('synthetic renewal failure'));
      }

      const pending = dispatchMessageDigestOutbox(input(), harness.dependencies);
      await vi.waitFor(() => {
        expect(harness.renewDispatchClaim).toHaveBeenCalledOnce();
      });
      pendingPublication.resolve({ ok: true, messageId: 'synthetic-message-id' });

      await expect(pending).resolves.toEqual({ ok: false, code: 'CLAIM_LOST' });
      expect(harness.recordDispatchResult).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['NOT_READY', 'deferred'],
    ['CLAIM_BUSY', 'deferred'],
    ['TERMINAL', 'terminal'],
  ] as const)('treats store claim %s as a safe %s no-op', async (claimFailure, disposition) => {
    const harness = createHarness({ claimFailure });

    await expect(dispatchMessageDigestOutbox(input(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition,
    });
    expect(harness.runRequestPublisher).not.toHaveBeenCalled();
    expect(harness.whatsappPublisher).not.toHaveBeenCalled();
    expect(harness.recordDispatchResult).not.toHaveBeenCalled();
  });

  it('defers an existing same-owner claim without sharing its fence or publishing', async () => {
    const harness = createHarness();
    harness.claimDispatch.mockResolvedValueOnce({
      ok: true,
      disposition: 'existing',
      fence: 7,
      dispatch: harness.dispatch,
    });

    await expect(dispatchMessageDigestOutbox(input(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(harness.runRequestPublisher).not.toHaveBeenCalled();
    expect(harness.whatsappPublisher).not.toHaveBeenCalled();
    expect(harness.renewDispatchClaim).not.toHaveBeenCalled();
    expect(harness.recordDispatchResult).not.toHaveBeenCalled();
  });

  it('returns safe failures for missing outbox, lost claim, and malformed input', async () => {
    const missing = createHarness({ claimFailure: 'NOT_FOUND' });
    await expect(dispatchMessageDigestOutbox(input(), missing.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const lost = createHarness({ recordFailure: 'CLAIM_LOST' });
    await expect(dispatchMessageDigestOutbox(input(), lost.dependencies)).resolves.toEqual({
      ok: false,
      code: 'CLAIM_LOST',
    });

    const invalid = createHarness();
    await expect(
      dispatchMessageDigestOutbox(input({ workerId: '' }), invalid.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(invalid.claimDispatch).not.toHaveBeenCalled();
  });

  it('rejects malformed outbox identity, oversized worker identity, and invalid clock time', async () => {
    for (const invalidInput of [
      { outboxId: 'invalid', workerId: 'synthetic-worker-001' },
      { outboxId: 'mdo_dispatch_001', workerId: 'x'.repeat(257) },
    ]) {
      const harness = createHarness();
      await expect(
        dispatchMessageDigestOutbox(invalidInput, harness.dependencies)
      ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
      expect(harness.claimDispatch).not.toHaveBeenCalled();
    }
    const invalidNow = createHarness();
    invalidNow.dependencies.now = (): string => 'not-an-instant';
    await expect(
      dispatchMessageDigestOutbox(input(), invalidNow.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });

    const defaultClock = createHarness();
    defaultClock.dependencies.now = undefined;
    await expect(
      dispatchMessageDigestOutbox(input({ workerId: '' }), defaultClock.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });
});

interface HarnessOptions {
  kind?: 'run_request' | 'whatsapp_delivery';
  publishFailure?: 'ACK_UNKNOWN' | 'INVALID_PAYLOAD';
  claimFailure?: 'NOT_FOUND' | 'NOT_READY' | 'CLAIM_BUSY' | 'TERMINAL';
  recordFailure?: 'NOT_FOUND' | 'CLAIM_LOST';
}

function createHarness(options: HarnessOptions = {}): {
  dependencies: Parameters<typeof dispatchMessageDigestOutbox>[1];
  dispatch: MessageDigestDispatchOutbox;
  claimDispatch: ReturnType<typeof vi.fn<MessageDigestStore['claimDispatch']>>;
  renewDispatchClaim: ReturnType<typeof vi.fn<MessageDigestStore['renewDispatchClaim']>>;
  recordDispatchResult: ReturnType<typeof vi.fn<MessageDigestStore['recordDispatchResult']>>;
  runRequestPublisher: ReturnType<typeof vi.fn<FrozenMessageDigestPayloadPublisher['publish']>>;
  whatsappPublisher: ReturnType<typeof vi.fn<FrozenMessageDigestPayloadPublisher['publish']>>;
} {
  const dispatch = makeDispatch(options.kind ?? 'run_request');
  const claimDispatch = vi.fn<MessageDigestStore['claimDispatch']>(async () =>
    options.claimFailure === undefined
      ? { ok: true, disposition: 'claimed', fence: 7, dispatch }
      : { ok: false, code: options.claimFailure }
  );
  const recordDispatchResult = vi.fn<MessageDigestStore['recordDispatchResult']>(async () =>
    options.recordFailure === undefined ? { ok: true } : { ok: false, code: options.recordFailure }
  );
  const renewDispatchClaim = vi.fn<MessageDigestStore['renewDispatchClaim']>(async (renewal) => ({
    ok: true,
    expiresAt: renewal.expiresAt,
  }));
  const publishResult = async (): ReturnType<FrozenMessageDigestPayloadPublisher['publish']> =>
    options.publishFailure === undefined
      ? { ok: true, messageId: 'synthetic-message-id' }
      : { ok: false, code: options.publishFailure };
  const runRequestPublisher = vi.fn<FrozenMessageDigestPayloadPublisher['publish']>(publishResult);
  const whatsappPublisher = vi.fn<FrozenMessageDigestPayloadPublisher['publish']>(publishResult);
  return {
    dependencies: {
      store: { claimDispatch, renewDispatchClaim, recordDispatchResult },
      runRequestPublisher: { publish: runRequestPublisher },
      whatsappPublisher: { publish: whatsappPublisher },
      now: (): string => NOW,
    },
    dispatch,
    claimDispatch,
    renewDispatchClaim,
    recordDispatchResult,
    runRequestPublisher,
    whatsappPublisher,
  };
}

function input(overrides: Partial<{ workerId: string }> = {}): {
  outboxId: string;
  workerId: string;
} {
  return {
    outboxId: 'mdo_dispatch_001',
    workerId: 'synthetic-worker-001',
    ...overrides,
  };
}

function createPendingPublication(): {
  promise: Promise<{ ok: true; messageId: string }>;
  resolve: (result: { ok: true; messageId: string }) => void;
} {
  let resolve = (_result: { ok: true; messageId: string }): void => undefined;
  const promise = new Promise<{ ok: true; messageId: string }>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function makeDispatch(kind: 'run_request' | 'whatsapp_delivery'): MessageDigestDispatchOutbox {
  const payloadJson = JSON.stringify({ type: kind, runId: 'mdr_run_001' });
  return {
    version: 1,
    outboxId: 'mdo_dispatch_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    kind,
    status: 'pending',
    payloadJson,
    payloadDigest: createHash('sha256').update(payloadJson, 'utf8').digest('hex'),
    attempts: 1,
    nextAttemptAt: NOW,
    claim: {
      ownerDigest: OWNER_DIGEST,
      fence: 7,
      expiresAt: '2026-07-27T12:02:00.000Z',
    },
    publishedAt: null,
    terminalCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: 1_785_000_000,
  };
}
