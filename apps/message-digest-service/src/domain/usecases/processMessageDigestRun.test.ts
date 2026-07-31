import { createHash } from 'node:crypto';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { MessageDigestSourceMessage } from '@intexuraos/llm-prompts';
import type { MessageDigestDefinition, MessageDigestState } from '../models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type {
  MessageDigestAggregationMetadata,
  MessageDigestAggregator,
  MessageDigestSourcePage,
  MessageDigestWhatsAppClient,
} from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import {
  processMessageDigestRun,
  type ProcessMessageDigestRunDependencies,
} from './processMessageDigestRun.js';

const NOW = '2026-07-27T12:02:00.000Z';
const OWNER_DIGEST = '8e76b360b0c1703677910871310f75176861a96c854868706fa5f1accda7d18c';
const REF_A = 'a'.repeat(64);
const REF_B = 'b'.repeat(64);

describe('processMessageDigestRun', () => {
  it('leases, validates, pages the frozen source, aggregates, commits, and dispatches delivery', async () => {
    const harness = createHarness();

    const result = await processMessageDigestRun(validInput(), harness.dependencies);

    expect(harness.claimRunLease).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      runId: 'mdr_run_001',
      ownerDigest: OWNER_DIGEST,
      now: NOW,
      expiresAt: '2026-07-27T12:05:00.000Z',
    });
    expect(harness.validateSource).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      chatId: 'synthetic-chat-001',
      expectedGenerationId: 'synthetic-generation-001',
    });
    expect(harness.getDeliveryReadiness).toHaveBeenCalledWith('synthetic-user-001');
    expect(harness.queryMessages).toHaveBeenCalledTimes(2);
    expect(harness.queryMessages).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'opaque-cursor-1' })
    );
    expect(harness.renewRunLease).toHaveBeenCalled();
    expect(harness.markRunProcessingStage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'mdr_run_001',
        ownerDigest: OWNER_DIGEST,
        fence: 4,
        processingStage: 'aggregating',
      })
    );
    expect(harness.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [message(REF_A, 'First fact'), message(REF_B, 'Second fact')],
        continuityMemoryMarkdown: 'Previous continuity.',
        previousSummaries: expect.arrayContaining([
          expect.objectContaining({ runId: 'mdr_previous_001' }),
        ]),
      })
    );
    expect(harness.aggregate.mock.calls[0]?.[0]).not.toHaveProperty('outputLanguage');
    expect(harness.formatDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        generationStatus: 'completed',
        headline: 'Two concrete facts',
        delivery: expect.objectContaining({ status: 'pending' }),
      })
    );
    const completion = harness.completeRun.mock.calls[0]?.[0];
    expect(completion).toMatchObject({
      userId: 'synthetic-user-001',
      runId: 'mdr_run_001',
      ownerDigest: OWNER_DIGEST,
      fence: 4,
      completedAt: NOW,
      generationStatus: 'completed',
      output: {
        headline: 'Two concrete facts',
        summaryMarkdown: '- First fact\n- Second fact',
        evidenceMessageRefs: [REF_A, REF_B],
        continuityMemoryMarkdown: 'New continuity.',
        effectiveMessageCount: 2,
        promptVersion: '1.0.0',
        model: 'or:synthetic/model',
      },
      deliveryOutbox: {
        kind: 'whatsapp_delivery',
        status: 'pending',
        payloadJson: harness.deliveryPayload,
        payloadDigest: createHash('sha256')
          .update(harness.deliveryPayload, 'utf8')
          .digest('hex'),
      },
    });
    expect(harness.dispatchOutbox).toHaveBeenCalledWith(
      expect.stringMatching(/^mdo_[A-Za-z0-9_-]+$/u)
    );
    expect(result).toMatchObject({
      ok: true,
      disposition: 'completed',
      run: { runId: 'mdr_run_001', generationStatus: 'completed' },
    });
  });

  it('completes an empty source as skipped without LLM provider work or delivery', async () => {
    const harness = createHarness({ empty: true });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toMatchObject({
      ok: true,
      disposition: 'skipped_no_activity',
      run: { generationStatus: 'skipped_no_activity' },
    });
    expect(harness.aggregate).toHaveBeenCalledWith(expect.objectContaining({ messages: [] }));
    expect(harness.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        generationStatus: 'skipped_no_activity',
        output: expect.objectContaining({
          headline: null,
          summaryMarkdown: null,
          effectiveMessageCount: 0,
        }),
      })
    );
    expect(harness.formatDelivery).not.toHaveBeenCalled();
    expect(harness.dispatchOutbox).not.toHaveBeenCalled();
  });

  it('discards changed pages, restarts once, and never mixes snapshot messages', async () => {
    const harness = createHarness({ restartOnce: true });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toMatchObject({
      ok: true,
      disposition: 'completed',
    });
    expect(harness.queryMessages).toHaveBeenCalledTimes(4);
    expect(harness.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [message(REF_A, 'Restarted first fact'), message(REF_B, 'Restarted second fact')],
      })
    );
  });

  it('continues a frozen snapshot without restart when append-only activity is beyond its watermark', async () => {
    const harness = createHarness();
    harness.queryMessages
      .mockResolvedValueOnce({ ok: true, value: firstPage('Frozen first fact') })
      .mockResolvedValueOnce({ ok: true, value: finalPage('Frozen second fact') });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toMatchObject({
      ok: true,
      disposition: 'completed',
    });
    expect(harness.queryMessages).toHaveBeenCalledTimes(2);
    expect(harness.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          message(REF_A, 'Frozen first fact'),
          message(REF_B, 'Frozen second fact'),
        ],
      })
    );
  });

  it('reclaims an expired lease with a higher fence and commits only with the new fence', async () => {
    const harness = createHarness();
    harness.claimRunLease.mockResolvedValueOnce({
      ok: true,
      disposition: 'acquired',
      fence: 5,
      run: {
        ...processingRun(),
        lease: {
          ownerDigest: 'f'.repeat(64),
          fence: 4,
          expiresAt: '2026-07-27T12:01:59.000Z',
          renewedAt: '2026-07-27T11:59:00.000Z',
        },
      },
    });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toMatchObject({
      ok: true,
      disposition: 'completed',
    });
    expect(harness.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ ownerDigest: OWNER_DIGEST, fence: 5 })
    );
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('renews the 180-second lease during slow LLM work at the 60-second heartbeat', async () => {
    const harness = createHarness();
    let currentTime = NOW;
    harness.dependencies.now = (): string => currentTime;
    let settleAggregation = (
      _value: Awaited<ReturnType<MessageDigestAggregator['aggregate']>>
    ): void => undefined;
    const aggregation = new Promise<
      Awaited<ReturnType<MessageDigestAggregator['aggregate']>>
    >((resolve) => {
      settleAggregation = resolve;
    });
    harness.aggregate.mockImplementationOnce(async () => await aggregation);
    let releaseHeartbeat = (): void => undefined;
    const heartbeat = new Promise<void>((resolve) => {
      releaseHeartbeat = resolve;
    });
    let aggregateHeartbeatReleased = false;
    harness.dependencies.waitForHeartbeat = async (_delayMs, signal): Promise<void> => {
      if (harness.aggregate.mock.calls.length === 0 || aggregateHeartbeatReleased) {
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
      }
      aggregateHeartbeatReleased = true;
      await heartbeat;
    };

    const pending = processMessageDigestRun(validInput(), harness.dependencies);
    await vi.waitFor(() => expect(harness.aggregate).toHaveBeenCalledOnce());
    currentTime = '2026-07-27T12:03:00.000Z';
    releaseHeartbeat();
    await vi.waitFor(() =>
      expect(harness.renewRunLease).toHaveBeenCalledWith({
        userId: 'synthetic-user-001',
        runId: 'mdr_run_001',
        ownerDigest: OWNER_DIGEST,
        fence: 4,
        now: '2026-07-27T12:03:00.000Z',
        expiresAt: '2026-07-27T12:06:00.000Z',
      })
    );
    settleAggregation({
      ok: true,
      kind: 'aggregate',
      aggregate: {
        headline: 'Two concrete facts',
        summaryMarkdown: '- First fact\n- Second fact',
        evidenceMessageRefs: [REF_A, REF_B],
        continuityMemoryMarkdown: 'New continuity.',
      },
      metadata: aggregationMetadata(2),
    });
    await expect(pending).resolves.toMatchObject({ ok: true, disposition: 'completed' });
  });

  it('defers aggregation when its heartbeat loses the active lease', async () => {
    const harness = createHarness();
    let settleAggregation = (
      _value: Awaited<ReturnType<MessageDigestAggregator['aggregate']>>
    ): void => undefined;
    const aggregation = new Promise<Awaited<ReturnType<MessageDigestAggregator['aggregate']>>>(
      (resolve) => {
        settleAggregation = resolve;
      }
    );
    harness.aggregate.mockImplementationOnce(async () => await aggregation);
    harness.renewRunLease.mockImplementation(async () =>
      harness.renewRunLease.mock.calls.length === 6
        ? { ok: false, code: 'LEASE_LOST' }
        : { ok: true, expiresAt: '2026-07-27T12:07:00.000Z' }
    );
    harness.dependencies.waitForHeartbeat = async (_delayMs, signal): Promise<void> => {
      if (harness.aggregate.mock.calls.length > 0) return;
      if (signal.aborted) return;
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    };

    const pending = processMessageDigestRun(validInput(), harness.dependencies);
    await vi.waitFor(() => expect(harness.renewRunLease).toHaveBeenCalledTimes(6));
    settleAggregation({
      ok: true,
      kind: 'aggregate',
      aggregate: {
        headline: 'Late aggregate',
        summaryMarkdown: 'Lease ownership was lost before commit.',
        evidenceMessageRefs: [REF_A],
        continuityMemoryMarkdown: 'Late continuity.',
      },
      metadata: aggregationMetadata(1),
    });

    await expect(pending).resolves.toEqual({ ok: true, disposition: 'deferred' });
    expect(harness.completeRun).not.toHaveBeenCalled();
  });

  it('does not schedule another default heartbeat after completion aborts the wait signal', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      let settleQuery = (
        _value: Awaited<ReturnType<MessageDigestWhatsAppClient['queryMessages']>>
      ): void => undefined;
      const query = new Promise<Awaited<ReturnType<MessageDigestWhatsAppClient['queryMessages']>>>(
        (resolve) => {
          settleQuery = resolve;
        }
      );
      let queryStarted = (): void => undefined;
      const started = new Promise<void>((resolve) => {
        queryStarted = resolve;
      });
      harness.queryMessages.mockImplementationOnce(async () => {
        queryStarted();
        return await query;
      });
      let releaseHeartbeatRenewal = (): void => undefined;
      const heartbeatRenewal = new Promise<void>((resolve) => {
        releaseHeartbeatRenewal = resolve;
      });
      harness.renewRunLease.mockImplementation(async () => {
        if (harness.renewRunLease.mock.calls.length === 2) await heartbeatRenewal;
        return { ok: true, expiresAt: '2026-07-27T12:07:00.000Z' };
      });

      const pending = processMessageDigestRun(validInput(), harness.dependencies);
      await started;
      vi.advanceTimersByTime(60_000);
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
      expect(harness.renewRunLease).toHaveBeenCalledTimes(2);

      settleQuery({ ok: true, value: finalPage('Completed during renewal') });
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
      releaseHeartbeatRenewal();

      await expect(pending).resolves.toMatchObject({ ok: true, disposition: 'completed' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains the reserved window after repeated source change or aggregation failure', async () => {
    const changed = createHarness({ repeatedSourceChange: true });
    await expect(processMessageDigestRun(validInput(), changed.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_CHANGED',
    });
    expect(changed.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ safeFailureCode: 'SOURCE_CHANGED', pauseDefinition: false })
    );
    expect(changed.completeRun).not.toHaveBeenCalled();

    const aggregateFailure = createHarness({ aggregateFailure: 'LLM_UNAVAILABLE' });
    await expect(
      processMessageDigestRun(validInput(), aggregateFailure.dependencies)
    ).resolves.toEqual({ ok: false, code: 'LLM_UNAVAILABLE' });
    expect(aggregateFailure.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ safeFailureCode: 'LLM_UNAVAILABLE', pauseDefinition: false })
    );
    expect(aggregateFailure.completeRun).not.toHaveBeenCalled();

    const unrecoverable = createHarness({ aggregateFailure: 'INVALID_AGGREGATE' });
    await expect(
      processMessageDigestRun(validInput(), unrecoverable.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_AGGREGATE' });
    expect(unrecoverable.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ safeFailureCode: 'INVALID_AGGREGATE', pauseDefinition: true })
    );
  });

  it('fails before source paging and LLM when mapping or source generation changed', async () => {
    const mapping = createHarness({ readinessVersion: 'changed-readiness-v2' });
    await expect(processMessageDigestRun(validInput(), mapping.dependencies)).resolves.toEqual({
      ok: false,
      code: 'READINESS_CHANGED',
    });
    expect(mapping.queryMessages).not.toHaveBeenCalled();
    expect(mapping.aggregate).not.toHaveBeenCalled();

    const source = createHarness({ sourceFailure: 'source_changed' });
    await expect(processMessageDigestRun(validInput(), source.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_CHANGED',
    });
    expect(source.queryMessages).not.toHaveBeenCalled();
    expect(source.aggregate).not.toHaveBeenCalled();
  });

  it.each([
    ['RUN_TERMINAL', 'already_terminal'],
    ['LEASE_BUSY', 'deferred'],
    ['RESERVATION_LOST', 'deferred'],
  ] as const)('handles duplicate/fenced lease result %s as %s', async (claimFailure, disposition) => {
    const harness = createHarness({ claimFailure });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition,
    });
    expect(harness.validateSource).not.toHaveBeenCalled();
    expect(harness.aggregate).not.toHaveBeenCalled();
  });

  it('defers an existing same-owner lease without sharing its fence or repeating work', async () => {
    const harness = createHarness();
    harness.claimRunLease.mockResolvedValueOnce({
      ok: true,
      disposition: 'existing',
      fence: 4,
      run: processingRun(),
    });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(harness.getOwnedRunContext).not.toHaveBeenCalled();
    expect(harness.validateSource).not.toHaveBeenCalled();
    expect(harness.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(harness.queryMessages).not.toHaveBeenCalled();
    expect(harness.listOwnedRuns).not.toHaveBeenCalled();
    expect(harness.markRunProcessingStage).not.toHaveBeenCalled();
    expect(harness.renewRunLease).not.toHaveBeenCalled();
    expect(harness.aggregate).not.toHaveBeenCalled();
    expect(harness.completeRun).not.toHaveBeenCalled();
    expect(harness.failRun).not.toHaveBeenCalled();
    expect(harness.dispatchOutbox).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'userId', value: '' },
    { field: 'userId', value: 'u'.repeat(257) },
    { field: 'definitionId', value: 'invalid-definition-id' },
    { field: 'runId', value: 'invalid-run-id' },
    { field: 'workerId', value: '' },
    { field: 'workerId', value: 'w'.repeat(257) },
  ] as const)('rejects invalid $field before claiming work', async ({ field, value }) => {
    const harness = createHarness();

    await expect(
      processMessageDigestRun({ ...validInput(), [field]: value }, harness.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(harness.claimRunLease).not.toHaveBeenCalled();
  });

  it('rejects an invalid clock and supports the default system clock', async () => {
    const invalidClock = createHarness();
    invalidClock.dependencies.now = (): string => 'not-a-timestamp';

    await expect(processMessageDigestRun(validInput(), invalidClock.dependencies)).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(invalidClock.claimRunLease).not.toHaveBeenCalled();

    const systemClock = createHarness();
    systemClock.dependencies.now = undefined;
    await expect(
      processMessageDigestRun({ ...validInput(), definitionId: 'invalid' }, systemClock.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('handles clock failure at renewal, aggregation staging, completion, and failure recording', async () => {
    const renewalClock = createHarness();
    let renewalReads = 0;
    renewalClock.dependencies.now = (): string => {
      renewalReads += 1;
      return renewalReads === 2 ? 'not-a-timestamp' : NOW;
    };
    await expect(processMessageDigestRun(validInput(), renewalClock.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(renewalClock.queryMessages).not.toHaveBeenCalled();

    const stageClock = createHarness();
    let stageFailed = false;
    stageClock.dependencies.now = (): string => {
      if (
        !stageFailed &&
        stageClock.listOwnedRuns.mock.calls.length > 0 &&
        stageClock.markRunProcessingStage.mock.calls.length === 0
      ) {
        stageFailed = true;
        return 'not-a-timestamp';
      }
      return NOW;
    };
    await expect(processMessageDigestRun(validInput(), stageClock.dependencies)).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(stageClock.markRunProcessingStage).not.toHaveBeenCalled();

    const completionClock = createHarness();
    let completionFailed = false;
    completionClock.dependencies.now = (): string => {
      if (
        !completionFailed &&
        completionClock.aggregate.mock.calls.length > 0 &&
        completionClock.renewRunLease.mock.calls.length === 6
      ) {
        completionFailed = true;
        return 'not-a-timestamp';
      }
      return NOW;
    };
    await expect(
      processMessageDigestRun(validInput(), completionClock.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(completionClock.completeRun).not.toHaveBeenCalled();

    const failureClock = createHarness({ sourceFailure: 'unavailable' });
    let failureReads = 0;
    failureClock.dependencies.now = (): string => {
      failureReads += 1;
      return failureReads === 1 ? NOW : 'not-a-timestamp';
    };
    await expect(processMessageDigestRun(validInput(), failureClock.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(failureClock.failRun).not.toHaveBeenCalled();
  });

  it('reports a missing claimed run and records a missing reserved context', async () => {
    const missingRun = createHarness();
    missingRun.claimRunLease.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await expect(processMessageDigestRun(validInput(), missingRun.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });

    const missingContext = createHarness();
    missingContext.getOwnedRunContext.mockResolvedValueOnce(null);
    await expect(processMessageDigestRun(validInput(), missingContext.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(missingContext.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ safeFailureCode: 'NOT_FOUND' })
    );
  });

  it('defers when the claimed run no longer matches the active reserved window', async () => {
    const harness = createHarness();
    const context = runContext();
    harness.getOwnedRunContext.mockResolvedValueOnce({
      ...context,
      state: { ...context.state, pendingWindow: null },
    });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(harness.validateSource).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 'SOURCE_NOT_FOUND'],
    ['unavailable', 'SOURCE_UNAVAILABLE'],
    ['invalid_request', 'SOURCE_UNAVAILABLE'],
    ['invalid_response', 'SOURCE_UNAVAILABLE'],
  ] as const)('maps source validation failure %s to %s', async (sourceCode, failureCode) => {
    const harness = createHarness();
    harness.validateSource.mockResolvedValueOnce({ ok: false, code: sourceCode });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: failureCode,
    });
    expect(harness.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ safeFailureCode: failureCode })
    );
  });

  it('rejects a validated source that differs from the reserved snapshot', async () => {
    const harness = createHarness();
    harness.validateSource.mockResolvedValueOnce({
      ok: true,
      value: {
        ...processingRun().sourceSnapshot,
        messageCount: processingRun().sourceSnapshot.messageCount ?? 0,
        generationId: 'changed-generation',
      },
    });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_CHANGED',
    });
    expect(harness.queryMessages).not.toHaveBeenCalled();
  });

  it('stops before reading when delivery readiness is unavailable or not ready', async () => {
    const unavailable = createHarness();
    unavailable.getDeliveryReadiness.mockResolvedValueOnce({ ok: false, code: 'unavailable' });
    await expect(processMessageDigestRun(validInput(), unavailable.dependencies)).resolves.toEqual({
      ok: false,
      code: 'READINESS_UNAVAILABLE',
    });

    const disconnected = createHarness();
    disconnected.getDeliveryReadiness.mockResolvedValueOnce({
      ok: true,
      value: {
        status: 'disconnected',
        observationVersion: 'reserved-readiness-v1',
        observedAt: NOW,
      },
    });
    await expect(processMessageDigestRun(validInput(), disconnected.dependencies)).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_NOT_READY',
    });
    expect(unavailable.queryMessages).not.toHaveBeenCalled();
    expect(disconnected.queryMessages).not.toHaveBeenCalled();
  });

  it('defers immediately when the lease is lost before or after a source read', async () => {
    const beforeRead = createHarness();
    beforeRead.renewRunLease.mockResolvedValueOnce({ ok: false, code: 'LEASE_LOST' });
    await expect(processMessageDigestRun(validInput(), beforeRead.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(beforeRead.queryMessages).not.toHaveBeenCalled();

    const afterRead = createHarness();
    afterRead.renewRunLease
      .mockResolvedValueOnce({ ok: true, expiresAt: '2026-07-27T12:07:00.000Z' })
      .mockResolvedValueOnce({ ok: false, code: 'LEASE_LOST' });
    await expect(processMessageDigestRun(validInput(), afterRead.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(afterRead.queryMessages).toHaveBeenCalledTimes(1);
    expect(afterRead.aggregate).not.toHaveBeenCalled();
  });

  it('defers a source page when its heartbeat loses the active lease', async () => {
    const harness = createHarness();
    let settleQuery = (
      _value: Awaited<ReturnType<MessageDigestWhatsAppClient['queryMessages']>>
    ): void => undefined;
    const query = new Promise<Awaited<ReturnType<MessageDigestWhatsAppClient['queryMessages']>>>(
      (resolve) => {
        settleQuery = resolve;
      }
    );
    harness.queryMessages.mockImplementationOnce(async () => await query);
    harness.renewRunLease.mockImplementation(async () =>
      harness.renewRunLease.mock.calls.length === 2
        ? { ok: false, code: 'LEASE_LOST' }
        : { ok: true, expiresAt: '2026-07-27T12:07:00.000Z' }
    );
    harness.dependencies.waitForHeartbeat = async (): Promise<void> => undefined;

    const pending = processMessageDigestRun(validInput(), harness.dependencies);
    await vi.waitFor(() => expect(harness.renewRunLease).toHaveBeenCalledTimes(2));
    settleQuery({ ok: true, value: finalPage('Late source page') });

    await expect(pending).resolves.toEqual({ ok: true, disposition: 'deferred' });
    expect(harness.aggregate).not.toHaveBeenCalled();
  });

  it('aborts the heartbeat when a source client violates its result contract by throwing', async () => {
    const harness = createHarness();
    harness.queryMessages.mockRejectedValueOnce(new Error('synthetic source transport crash'));

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).rejects.toThrow(
      'synthetic source transport crash'
    );
    expect(harness.aggregate).not.toHaveBeenCalled();
  });

  it('detects pagination snapshot drift, cursor loops, and oversized sources', async () => {
    const drift = createHarness();
    drift.queryMessages
      .mockResolvedValueOnce({ ok: true, value: firstPage('First') })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...finalPage('Second'), highWatermark: 'changed-high-watermark' },
      })
      .mockResolvedValueOnce({ ok: true, value: firstPage('First') })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...finalPage('Second'), sourceRevision: 'changed-revision' },
      });
    await expect(processMessageDigestRun(validInput(), drift.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_CHANGED',
    });

    const loop = createHarness();
    loop.queryMessages.mockResolvedValue({ ok: true, value: firstPage('Repeated') });
    await expect(processMessageDigestRun(validInput(), loop.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_CHANGED',
    });

    const oversized = createHarness();
    let page = 0;
    oversized.queryMessages.mockImplementation(async () => {
      page += 1;
      return {
        ok: true,
        value: { ...firstPage(`Page ${page}`), nextCursor: `opaque-cursor-${page}` },
      };
    });
    await expect(processMessageDigestRun(validInput(), oversized.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_TOO_LARGE',
    });
    expect(oversized.queryMessages).toHaveBeenCalledTimes(25);
  });

  it('fails the same run at 5,001 effective messages without LLM or checkpoint advance', async () => {
    const harness = createHarness();
    const oversizedMessages = Array.from({ length: 5_001 }, (_value, index) =>
      message(index.toString(16).padStart(64, '0'), 'Synthetic bounded fact')
    );
    harness.queryMessages.mockResolvedValueOnce({
      ok: true,
      value: pageWithMessages(oversizedMessages),
    });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_TOO_LARGE',
    });
    expect(harness.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ safeFailureCode: 'SOURCE_TOO_LARGE' })
    );
    expect(harness.aggregate).not.toHaveBeenCalled();
    expect(harness.completeRun).not.toHaveBeenCalled();
    expect(harness.dispatchOutbox).not.toHaveBeenCalled();
  });

  it('fails the same run at 2,000,001 UTF-8 source text bytes without partial aggregation', async () => {
    const harness = createHarness();
    const exactOversizedText = `${'x'.repeat(1_999_997)}💬`;
    expect(Buffer.byteLength(exactOversizedText, 'utf8')).toBe(2_000_001);
    harness.queryMessages.mockResolvedValueOnce({
      ok: true,
      value: pageWithMessages([message(REF_A, exactOversizedText)]),
    });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'SOURCE_TOO_LARGE',
    });
    expect(harness.aggregate).not.toHaveBeenCalled();
    expect(harness.completeRun).not.toHaveBeenCalled();
    expect(harness.dispatchOutbox).not.toHaveBeenCalled();
  });

  it('defers if the aggregation stage or a later lease renewal loses ownership', async () => {
    const stageLost = createHarness();
    stageLost.markRunProcessingStage.mockResolvedValueOnce({ ok: false, code: 'LEASE_LOST' });
    await expect(processMessageDigestRun(validInput(), stageLost.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(stageLost.aggregate).not.toHaveBeenCalled();

    const afterStage = createHarness();
    let afterStageRenewals = 0;
    afterStage.renewRunLease.mockImplementation(async () => {
      afterStageRenewals += 1;
      return afterStageRenewals === 5
        ? { ok: false, code: 'LEASE_LOST' }
        : { ok: true, expiresAt: '2026-07-27T12:07:00.000Z' };
    });
    await expect(processMessageDigestRun(validInput(), afterStage.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(afterStage.aggregate).not.toHaveBeenCalled();

    const afterAggregation = createHarness();
    let afterAggregationRenewals = 0;
    afterAggregation.renewRunLease.mockImplementation(async () => {
      afterAggregationRenewals += 1;
      return afterAggregationRenewals === 6
        ? { ok: false, code: 'LEASE_LOST' }
        : { ok: true, expiresAt: '2026-07-27T12:07:00.000Z' };
    });
    await expect(
      processMessageDigestRun(validInput(), afterAggregation.dependencies)
    ).resolves.toEqual({ ok: true, disposition: 'deferred' });
    expect(afterAggregation.aggregate).toHaveBeenCalledOnce();
    expect(afterAggregation.completeRun).not.toHaveBeenCalled();
  });

  it.each(['empty_with_aggregate', 'aggregate_without_value'] as const)(
    'rejects inconsistent aggregator contract %s',
    async (mode) => {
      const harness = createHarness();
      harness.aggregate.mockResolvedValueOnce({
        ok: true,
        kind: mode === 'empty_with_aggregate' ? 'empty' : 'aggregate',
        aggregate:
          mode === 'empty_with_aggregate'
            ? {
                headline: 'Unexpected',
                summaryMarkdown: 'Unexpected',
                evidenceMessageRefs: [],
                continuityMemoryMarkdown: 'Unexpected',
              }
            : null,
        metadata: aggregationMetadata(2),
      });

      await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'INVALID_AGGREGATE',
      });
    }
  );

  it('rejects formatter errors, invalid JSON, and mismatched payload digests', async () => {
    const formatterError = createHarness();
    formatterError.formatDelivery.mockReturnValueOnce({ ok: false, code: 'too_large' });
    await expect(processMessageDigestRun(validInput(), formatterError.dependencies)).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_FORMAT_INVALID',
    });

    const invalidJson = createHarness();
    invalidJson.formatDelivery.mockReturnValueOnce({
      ok: true,
      value: { payloadJson: '{not-json', payloadDigest: 'a'.repeat(64) },
    });
    await expect(processMessageDigestRun(validInput(), invalidJson.dependencies)).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_FORMAT_INVALID',
    });

    const digestMismatch = createHarness();
    digestMismatch.formatDelivery.mockReturnValueOnce({
      ok: true,
      value: { payloadJson: '{}', payloadDigest: 'a'.repeat(64) },
    });
    await expect(processMessageDigestRun(validInput(), digestMismatch.dependencies)).resolves.toEqual({
      ok: false,
      code: 'DELIVERY_FORMAT_INVALID',
    });
  });

  it('projects completion fencing failures without dispatching delivery', async () => {
    const missing = createHarness();
    missing.completeRun.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await expect(processMessageDigestRun(validInput(), missing.dependencies)).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(missing.dispatchOutbox).not.toHaveBeenCalled();

    const fenced = createHarness();
    fenced.completeRun.mockResolvedValueOnce({ ok: false, code: 'LEASE_LOST' });
    await expect(processMessageDigestRun(validInput(), fenced.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(fenced.dispatchOutbox).not.toHaveBeenCalled();

    const unexpected = createHarness();
    unexpected.completeRun.mockResolvedValueOnce({
      ok: true,
      disposition: 'existing',
      run: processingRun(),
    });
    await expect(processMessageDigestRun(validInput(), unexpected.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
    expect(unexpected.dispatchOutbox).not.toHaveBeenCalled();
  });

  it('defers when persisting a safe failure loses its lease', async () => {
    const harness = createHarness({ aggregateFailure: 'LLM_UNAVAILABLE' });
    harness.failRun.mockResolvedValueOnce({ ok: false, code: 'LEASE_LOST' });

    await expect(processMessageDigestRun(validInput(), harness.dependencies)).resolves.toEqual({
      ok: true,
      disposition: 'deferred',
    });
  });
});

interface HarnessOptions {
  empty?: boolean;
  restartOnce?: boolean;
  repeatedSourceChange?: boolean;
  aggregateFailure?: 'SOURCE_TOO_LARGE' | 'LLM_UNAVAILABLE' | 'INVALID_AGGREGATE';
  readinessVersion?: string;
  sourceFailure?: 'source_changed' | 'not_found' | 'unavailable';
  claimFailure?: 'RUN_TERMINAL' | 'LEASE_BUSY' | 'RESERVATION_LOST';
}

interface Harness {
  dependencies: ProcessMessageDigestRunDependencies;
  deliveryPayload: string;
  claimRunLease: Mock<MessageDigestStore['claimRunLease']>;
  renewRunLease: Mock<MessageDigestStore['renewRunLease']>;
  markRunProcessingStage: Mock<MessageDigestStore['markRunProcessingStage']>;
  getOwnedRunContext: Mock<MessageDigestStore['getOwnedRunContext']>;
  listOwnedRuns: Mock<MessageDigestStore['listOwnedRuns']>;
  validateSource: Mock<MessageDigestWhatsAppClient['validateSource']>;
  getDeliveryReadiness: Mock<MessageDigestWhatsAppClient['getDeliveryReadiness']>;
  queryMessages: Mock<MessageDigestWhatsAppClient['queryMessages']>;
  aggregate: Mock<MessageDigestAggregator['aggregate']>;
  formatDelivery: Mock<ProcessMessageDigestRunDependencies['formatDelivery']>;
  completeRun: Mock<MessageDigestStore['completeRun']>;
  failRun: Mock<MessageDigestStore['failRun']>;
  dispatchOutbox: Mock<ProcessMessageDigestRunDependencies['dispatchOutbox']>;
}

function createHarness(options: HarnessOptions = {}): Harness {
  return buildHarness(options);
}

function buildHarness(options: HarnessOptions): Harness {
  const run = processingRun();
  const context = runContext();
  const claimRunLease = vi.fn<MessageDigestStore['claimRunLease']>(async () =>
    options.claimFailure === undefined
      ? { ok: true, disposition: 'acquired', fence: 4, run }
      : { ok: false, code: options.claimFailure }
  );
  const renewRunLease = vi.fn<MessageDigestStore['renewRunLease']>(async () => ({
    ok: true,
    expiresAt: '2026-07-27T12:07:00.000Z',
  }));
  const markRunProcessingStage = vi.fn<MessageDigestStore['markRunProcessingStage']>(async () => ({
    ok: true,
  }));
  const getOwnedRunContext = vi.fn<MessageDigestStore['getOwnedRunContext']>(async () => context);
  const listOwnedRuns = vi.fn<MessageDigestStore['listOwnedRuns']>(async () => ({
    items: [run, previousRun()],
    nextCursor: null,
  }));
  const validateSource = vi.fn<MessageDigestWhatsAppClient['validateSource']>(async () =>
    options.sourceFailure === undefined
      ? {
          ok: true,
          value: {
            ...run.sourceSnapshot,
            messageCount: run.sourceSnapshot.messageCount ?? 0,
            displayName: run.sourceSnapshot.displayName,
          },
        }
      : { ok: false, code: options.sourceFailure }
  );
  const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(async () => ({
    ok: true,
    value: {
      status: 'ready',
      maskedPrimaryNumber: '+48•••123',
      observationVersion: options.readinessVersion ?? 'reserved-readiness-v1',
      observedAt: NOW,
    },
  }));
  let queryCall = 0;
  const queryMessages = vi.fn<MessageDigestWhatsAppClient['queryMessages']>(async () => {
    queryCall += 1;
    if (options.empty === true) return { ok: true, value: emptyPage() };
    if (options.repeatedSourceChange === true) {
      return queryCall % 2 === 1
        ? { ok: true, value: firstPage('Original fact') }
        : { ok: false, code: 'source_changed' };
    }
    if (options.restartOnce === true) {
      if (queryCall === 1) return { ok: true, value: firstPage('Discarded fact') };
      if (queryCall === 2) return { ok: false, code: 'source_changed' };
      if (queryCall === 3) return { ok: true, value: firstPage('Restarted first fact') };
      return { ok: true, value: finalPage('Restarted second fact') };
    }
    return queryCall === 1
      ? { ok: true, value: firstPage('First fact') }
      : { ok: true, value: finalPage('Second fact') };
  });
  const aggregate = vi.fn<MessageDigestAggregator['aggregate']>(async (input) => {
    if (options.aggregateFailure !== undefined) {
      return { ok: false, code: options.aggregateFailure };
    }
    if (input.messages.length === 0) {
      return {
        ok: true,
        kind: 'empty',
        aggregate: null,
        metadata: aggregationMetadata(0),
      };
    }
    return {
      ok: true,
      kind: 'aggregate',
      aggregate: {
        headline: 'Two concrete facts',
        summaryMarkdown: '- First fact\n- Second fact',
        evidenceMessageRefs: [REF_A, REF_B],
        continuityMemoryMarkdown: 'New continuity.',
      },
      metadata: aggregationMetadata(input.messages.length),
    };
  });
  const deliveryPayload = '{"type":"whatsapp.message.send","userId":"synthetic-user-001"}';
  const formatDelivery = vi.fn<ProcessMessageDigestRunDependencies['formatDelivery']>(() => ({
    ok: true as const,
    value: {
      payloadJson: deliveryPayload,
      payloadDigest: createHash('sha256').update(deliveryPayload, 'utf8').digest('hex'),
    },
  }));
  const completeRun = vi.fn<MessageDigestStore['completeRun']>(async (input) => ({
    ok: true,
    disposition: 'completed',
    run: {
      ...run,
      generationStatus: input.generationStatus,
      processingStage: input.generationStatus === 'completed' ? 'completed' : 'skipped_no_activity',
      ...input.output,
      lease: null,
      delivery: {
        ...run.delivery,
        status: input.generationStatus === 'completed' ? 'pending' : 'not_sent',
      },
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    },
  }));
  const failRun = vi.fn<MessageDigestStore['failRun']>(async () => ({ ok: true }));
  const dispatchOutbox = vi.fn<ProcessMessageDigestRunDependencies['dispatchOutbox']>(async () => ({
    ok: true as const,
    disposition: 'published' as const,
  }));
  return {
    dependencies: {
      store: {
        claimRunLease,
        renewRunLease,
        markRunProcessingStage,
        getOwnedRunContext,
        listOwnedRuns,
        completeRun,
        failRun,
      },
      whatsappClient: { validateSource, getDeliveryReadiness, queryMessages },
      aggregator: { aggregate },
      formatDelivery,
      dispatchOutbox,
      now: (): string => NOW,
    },
    deliveryPayload,
    claimRunLease,
    renewRunLease,
    markRunProcessingStage,
    getOwnedRunContext,
    listOwnedRuns,
    validateSource,
    getDeliveryReadiness,
    queryMessages,
    aggregate,
    formatDelivery,
    completeRun,
    failRun,
    dispatchOutbox,
  };
}

function validInput(): { userId: string; definitionId: string; runId: string; workerId: string } {
  return {
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_run_001',
    workerId: 'synthetic-worker-001',
  };
}

function processingRun(): MessageDigestRun {
  const definition = runContext().definition;
  return {
    version: 1,
    runId: 'mdr_run_001',
    userId: definition.userId,
    definitionId: definition.definitionId,
    definitionNameSnapshot: definition.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: definition.revision,
    instructionRevision: definition.instructions.revision,
    trigger: 'manual',
    requestIdDigest: 'a'.repeat(64),
    windowStart: '2026-07-27T07:00:00.000Z',
    windowEnd: '2026-07-27T12:00:00.000Z',
    scheduledBoundary: '2026-07-27T12:00:00.000Z',
    generationStatus: 'processing',
    processingStage: 'reading_messages',
    lease: {
      ownerDigest: OWNER_DIGEST,
      fence: 4,
      expiresAt: '2026-07-27T12:07:00.000Z',
      renewedAt: NOW,
    },
    attempts: 1,
    sourceSnapshot: definition.source,
    instructionsSnapshot: definition.instructions,
    scheduleSnapshot: definition.schedule,
    headline: null,
    summaryMarkdown: null,
    evidenceMessageRefs: [],
    continuityMemoryMarkdown: null,
    effectiveMessageCount: null,
    promptVersion: null,
    model: null,
    usage: null,
    delivery: {
      type: 'whatsapp_primary',
      status: 'not_sent',
      idempotencyKey: 'message-digest:mdr_run_001',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: null,
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-27T12:01:00.000Z',
    updatedAt: NOW,
    completedAt: null,
  };
}

function previousRun(): MessageDigestRun {
  return {
    ...processingRun(),
    runId: 'mdr_previous_001',
    windowStart: '2026-07-26T07:00:00.000Z',
    windowEnd: '2026-07-27T07:00:00.000Z',
    scheduledBoundary: '2026-07-27T07:00:00.000Z',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    headline: 'Previous facts',
    summaryMarkdown: 'Previous summary.',
    continuityMemoryMarkdown: 'Previous continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001 },
    completedAt: '2026-07-27T07:01:00.000Z',
  };
}

function runContext(): { definition: MessageDigestDefinition; state: MessageDigestState } {
  const definition: MessageDigestDefinition = {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Fishing daily',
    nameSortKey: 'fishing daily',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 3,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: true,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Fishing friends',
      sourceRevision: 'opaque-source-revision',
    },
    instructions: {
      templateId: 'fishing_group',
      text: 'Summarize concrete decisions, plans, catches, and follow-ups from this chat.',
      revision: '2',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'reserved-readiness-v1',
      readinessObservedAt: '2026-07-27T12:01:00.000Z',
    },
    checkpointAt: '2026-07-27T07:00:00.000Z',
    nextRunAt: '2026-07-28T07:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'c'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-27T07:00:00.000Z',
    updatedAt: '2026-07-27T12:01:00.000Z',
  };
  return {
    definition,
    state: {
      version: 1,
      definitionId: definition.definitionId,
      userId: definition.userId,
      revision: 6,
      checkpointAt: definition.checkpointAt,
      continuityMemoryMarkdown: 'Previous continuity.',
      precedingRunId: 'mdr_previous_001',
      precedingRunHash: 'd'.repeat(64),
      pendingWindow: {
        runId: 'mdr_run_001',
        trigger: 'manual',
        requestIdDigest: 'a'.repeat(64),
        windowStart: '2026-07-27T07:00:00.000Z',
        windowEnd: '2026-07-27T12:00:00.000Z',
        definitionRevision: 3,
        stateRevision: 5,
        erasureEpoch: 0,
        reservedAt: '2026-07-27T12:01:00.000Z',
      },
      updatedAt: '2026-07-27T12:01:00.000Z',
    },
  };
}

function message(messageRef: string, text: string): MessageDigestSourceMessage {
  return {
    messageRef,
    eventTimestamp: messageRef === REF_A ? '2026-07-27T08:00:00.000Z' : '2026-07-27T09:00:00.000Z',
    direction: 'inbound' as const,
    authorLabel: 'Synthetic participant',
    text,
    contentKind: 'text' as const,
  };
}

function firstPage(text: string): MessageDigestSourcePage {
  return {
    messages: [message(REF_A, text)],
    sourceRevision: 'snapshot-revision',
    highWatermark: 'snapshot-high-watermark',
    nextCursor: 'opaque-cursor-1',
  };
}

function finalPage(text: string): MessageDigestSourcePage {
  return {
    messages: [message(REF_B, text)],
    sourceRevision: 'snapshot-revision',
    highWatermark: 'snapshot-high-watermark',
    nextCursor: null,
  };
}

function pageWithMessages(messages: MessageDigestSourceMessage[]): MessageDigestSourcePage {
  return {
    messages,
    sourceRevision: 'snapshot-revision',
    highWatermark: 'snapshot-high-watermark',
    nextCursor: null,
  };
}

function emptyPage(): MessageDigestSourcePage {
  return {
    messages: [],
    sourceRevision: 'snapshot-revision',
    highWatermark: null,
    nextCursor: null,
  };
}

function aggregationMetadata(count: number): MessageDigestAggregationMetadata {
  return {
    effectiveMessageCount: count,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: count, outputTokens: count, totalTokens: count * 2, costUsd: 0.001 },
  };
}
