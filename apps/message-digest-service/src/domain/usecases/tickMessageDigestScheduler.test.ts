import { describe, expect, it, vi, type Mock } from 'vitest';
import type {
  MessageDigestDefinition,
  MessageDigestState,
} from '../models/messageDigestDefinition.js';
import type { MessageDigestDispatchOutbox, MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestWhatsAppClient } from '../ports/messageDigestClients.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import {
  tickMessageDigestScheduler,
  type TickMessageDigestSchedulerDependencies,
} from './tickMessageDigestScheduler.js';

const NOW = '2026-07-27T07:05:00.000Z';
const RUN_ID = 'mdr_d71653c73231eddbdd0a29813283a7d3ac5fcf3398e7b595';
const RUN_OUTBOX_ID = 'mdo_8e96444f9735c3e15389eec2737afc68c7697607b5935fb3';

describe('tickMessageDigestScheduler', () => {
  it('recovers due outbox and receipts before reserving and dispatching one scheduled window', async () => {
    const harness = createHarness();

    await expect(
      tickMessageDigestScheduler({ workerId: 'scheduler-worker-001', limit: 25 }, harness.dependencies)
    ).resolves.toEqual({
      ok: true,
      recoveredDispatches: 1,
      reconciledDeliveries: 1,
      reservedRuns: 1,
      deferredDefinitions: 0,
      nextCursor: null,
    });
    expect(harness.dispatchOutbox).toHaveBeenNthCalledWith(1, 'mdo_recovery_001');
    expect(harness.reconcileDelivery).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_delivery_pending_001',
    });
    expect(harness.reserveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedDefinitionRevision: 3,
        expectedStateRevision: 5,
        expectedErasureEpoch: 0,
        expectedReadinessObservationVersion: 'readiness-v1',
        readinessObservation: {
          observationVersion: 'readiness-v2',
          observedAt: NOW,
        },
        nextRunAt: '2026-07-28T07:00:00.000Z',
        run: expect.objectContaining({
          runId: RUN_ID,
          definitionNameSnapshot: 'Synthetic daily',
          trigger: 'scheduled',
          requestIdDigest:
            '77eabebafceee04c3caecb5d8f84bbd094b671d10b8b66b81e95c5db2fe82f30',
          windowStart: '2026-07-26T07:00:00.000Z',
          windowEnd: '2026-07-27T07:00:00.000Z',
          scheduledBoundary: '2026-07-27T07:00:00.000Z',
          generationStatus: 'queued',
        }),
        outbox: expect.objectContaining({
          outboxId: RUN_OUTBOX_ID,
          runId: RUN_ID,
          kind: 'run_request',
          status: 'pending',
        }),
      })
    );
    const reservation = harness.reserveRun.mock.calls[0]?.[0];
    expect(reservation?.outbox.payloadJson).toBe(
      JSON.stringify({
        type: 'message-digest.run',
        version: 1,
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        runId: RUN_ID,
        requestedAt: '2026-07-27T07:00:00.000Z',
      })
    );
    expect(harness.dispatchOutbox).toHaveBeenNthCalledWith(2, RUN_OUTBOX_ID);
    expect(harness.dispatchOutbox.mock.invocationCallOrder[0]).toBeLessThan(
      harness.reconcileDelivery.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
    expect(harness.reconcileDelivery.mock.invocationCallOrder[0]).toBeLessThan(
      harness.reserveRun.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
    expect(harness.listPendingDeliveryRuns).toHaveBeenCalledWith({ now: NOW, limit: 25 });
  });

  it('drains recovery cursors with one cutoff and stops at the fixed page cap', async () => {
    const harness = createHarness();
    const dispatchRows = [1, 2, 3].map((index) => ({
      ...runRequestOutbox(),
      outboxId: `mdo_recovery_00${String(index)}`,
    }));
    harness.listReadyDispatches.mockReset();
    for (const [index, row] of dispatchRows.entries()) {
      harness.listReadyDispatches.mockResolvedValueOnce({
        items: [row],
        nextCursor: `dispatch-page-${String(index + 2)}`,
      });
    }

    const deliveryRows = [1, 2, 3].map((index) => ({
      ...completedRun(),
      runId: `mdr_delivery_pending_00${String(index)}`,
    }));
    harness.listPendingDeliveryRuns.mockReset();
    for (const [index, row] of deliveryRows.entries()) {
      harness.listPendingDeliveryRuns.mockResolvedValueOnce({
        items: [row],
        nextCursor: `delivery-page-${String(index + 2)}`,
      });
    }

    await expect(
      tickMessageDigestScheduler({ workerId: 'scheduler-worker-001', limit: 25 }, harness.dependencies)
    ).resolves.toMatchObject({
      ok: true,
      recoveredDispatches: 3,
      reconciledDeliveries: 3,
    });
    expect(harness.listReadyDispatches).toHaveBeenCalledTimes(3);
    expect(harness.listReadyDispatches).toHaveBeenNthCalledWith(1, { now: NOW, limit: 25 });
    expect(harness.listReadyDispatches).toHaveBeenNthCalledWith(2, {
      now: NOW,
      limit: 25,
      cursor: 'dispatch-page-2',
    });
    expect(harness.listReadyDispatches).toHaveBeenNthCalledWith(3, {
      now: NOW,
      limit: 25,
      cursor: 'dispatch-page-3',
    });
    expect(harness.listPendingDeliveryRuns).toHaveBeenCalledTimes(3);
    expect(harness.listPendingDeliveryRuns).toHaveBeenNthCalledWith(1, {
      now: NOW,
      limit: 25,
    });
    expect(harness.listPendingDeliveryRuns).toHaveBeenNthCalledWith(2, {
      now: NOW,
      limit: 25,
      cursor: 'delivery-page-2',
    });
    expect(harness.listPendingDeliveryRuns).toHaveBeenNthCalledWith(3, {
      now: NOW,
      limit: 25,
      cursor: 'delivery-page-3',
    });
  });

  it.each([
    [2, null],
    [3, 'due-page-4'],
  ] as const)(
    'drains %i due pages cumulatively, skips duplicate candidates, and returns %s',
    async (pageCount, expectedNextCursor) => {
      const harness = createHarness();
      const contexts = Array.from({ length: pageCount }, (_value, index) =>
        runContextForPage(index + 1)
      );
      const listDueDefinitions = vi.mocked(
        harness.dependencies.store.listDueDefinitions
      );
      listDueDefinitions.mockReset();
      for (const [index, context] of contexts.entries()) {
        listDueDefinitions.mockResolvedValueOnce({
          items:
            index === 1
              ? [context.definition, contexts[0]?.definition as MessageDigestDefinition]
              : [context.definition],
          nextCursor:
            index + 1 < pageCount
              ? `due-page-${String(index + 2)}`
              : expectedNextCursor,
        });
      }
      vi.mocked(harness.dependencies.store.getOwnedRunContext).mockImplementation(
        async (_userId, definitionId) =>
          contexts.find((context) => context.definition.definitionId === definitionId) ?? null
      );
      harness.validateSource.mockImplementation(async (input) => {
        const context = contexts.find(
          (candidate) => candidate.definition.source.chatId === input.chatId
        );
        return context === undefined
          ? { ok: false as const, code: 'not_found' as const }
          : {
              ok: true as const,
              value: {
                ...context.definition.source,
                messageCount: context.definition.source.messageCount ?? 0,
              },
            };
      });

      await expect(
        tickMessageDigestScheduler(
          { workerId: 'scheduler-worker-001', limit: 25, cursor: 'due-page-1' },
          harness.dependencies
        )
      ).resolves.toMatchObject({
        ok: true,
        recoveredDispatches: 1,
        reconciledDeliveries: 1,
        reservedRuns: pageCount,
        deferredDefinitions: 0,
        nextCursor: expectedNextCursor,
      });
      expect(listDueDefinitions).toHaveBeenCalledTimes(pageCount);
      expect(listDueDefinitions.mock.calls.map((call) => call[0])).toEqual(
        Array.from({ length: pageCount }, (_value, index) => ({
          now: NOW,
          limit: 25,
          cursor: `due-page-${String(index + 1)}`,
        }))
      );
      expect(harness.dependencies.store.getOwnedRunContext).toHaveBeenCalledTimes(pageCount);
      expect(harness.reserveRun).toHaveBeenCalledTimes(pageCount);
      expect(harness.listReadyDispatches).toHaveBeenCalledOnce();
      expect(harness.listPendingDeliveryRuns).toHaveBeenCalledOnce();
      expect(harness.dispatchOutbox).toHaveBeenCalledTimes(pageCount + 1);
    }
  );

  it('uses the authoritative state checkpoint when its definition projection lags', async () => {
    const context = runContext();
    context.definition.checkpointAt = '2026-07-25T07:00:00.000Z';
    context.state.checkpointAt = '2026-07-26T07:00:00.000Z';
    const harness = createHarness({ context });

    await expect(
      tickMessageDigestScheduler(
        { workerId: 'scheduler-worker-001', limit: 25 },
        harness.dependencies
      )
    ).resolves.toMatchObject({ ok: true, reservedRuns: 1, deferredDefinitions: 0 });
    expect(harness.reserveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ windowStart: '2026-07-26T07:00:00.000Z' }),
      })
    );
  });

  it('defers a due definition with an existing pending window without readiness or reservation', async () => {
    const context = runContext();
    context.state.pendingWindow = {
      runId: 'mdr_existing_001',
      trigger: 'scheduled',
      requestIdDigest: 'e'.repeat(64),
      windowStart: context.state.checkpointAt,
      windowEnd: '2026-07-27T07:00:00.000Z',
      definitionRevision: context.definition.revision,
      stateRevision: context.state.revision,
      erasureEpoch: context.definition.erasureEpoch,
      reservedAt: NOW,
    };
    const harness = createHarness({ context });

    await expect(
      tickMessageDigestScheduler({ workerId: 'scheduler-worker-001', limit: 25 }, harness.dependencies)
    ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
    expect(harness.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(harness.reserveRun).not.toHaveBeenCalled();
  });

  it('moves a due definition to attention when current WhatsApp delivery is definitively not ready', async () => {
    const harness = createHarness({ readinessStatus: 'disconnected' });

    await expect(
      tickMessageDigestScheduler({ workerId: 'scheduler-worker-001', limit: 25 }, harness.dependencies)
    ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
    expect(harness.reserveRun).not.toHaveBeenCalled();
    expect(harness.updateDefinition).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedRevision: 3,
      updatedAt: NOW,
      patch: {
        status: 'paused',
        listStatus: 'needs_attention',
        attentionCode: 'DELIVERY_SETUP_REQUIRED',
      },
    });
    expect(harness.dispatchOutbox).toHaveBeenCalledTimes(1);
  });

  it('reserves only the earliest missed weekly boundary and advances one cadence', async () => {
    const context = runContext();
    context.definition.schedule = {
      kind: 'weekly',
      weekday: 'monday',
      localTime: '09:00',
      timeZone: 'UTC',
    };
    context.definition.checkpointAt = '2026-07-06T09:00:00.000Z';
    context.state.checkpointAt = '2026-07-06T09:00:00.000Z';
    context.definition.nextRunAt = '2026-07-13T09:00:00.000Z';
    const harness = createHarness({ context });

    await expect(
      tickMessageDigestScheduler({ workerId: 'scheduler-worker-001', limit: 25 }, harness.dependencies)
    ).resolves.toMatchObject({ ok: true, reservedRuns: 1 });
    expect(harness.reserveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        nextRunAt: '2026-07-20T09:00:00.000Z',
        run: expect.objectContaining({
          windowStart: '2026-07-06T09:00:00.000Z',
          windowEnd: '2026-07-13T09:00:00.000Z',
          scheduledBoundary: '2026-07-13T09:00:00.000Z',
        }),
      })
    );
  });

  it('creates contiguous non-overlapping catch-up windows across repeated completion ticks', async () => {
    const first = runContext();
    first.definition.checkpointAt = '2026-07-24T07:00:00.000Z';
    first.state.checkpointAt = '2026-07-24T07:00:00.000Z';
    first.definition.nextRunAt = '2026-07-25T07:00:00.000Z';
    const second = runContext();
    second.definition.checkpointAt = '2026-07-25T07:00:00.000Z';
    second.state.checkpointAt = '2026-07-25T07:00:00.000Z';
    second.definition.nextRunAt = '2026-07-26T07:00:00.000Z';
    second.definition.revision = first.definition.revision + 1;
    second.state.revision = first.state.revision + 1;
    const harness = createHarness({ context: first });
    vi.mocked(harness.dependencies.store.getOwnedRunContext)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await tickMessageDigestScheduler(
      { workerId: 'scheduler-worker-001', limit: 25 },
      harness.dependencies
    );
    await tickMessageDigestScheduler(
      { workerId: 'scheduler-worker-001', limit: 25 },
      harness.dependencies
    );

    const windows = harness.reserveRun.mock.calls.map((call) => ({
      start: call[0].run.windowStart,
      end: call[0].run.windowEnd,
      next: call[0].nextRunAt,
    }));
    expect(windows).toEqual([
      {
        start: '2026-07-24T07:00:00.000Z',
        end: '2026-07-25T07:00:00.000Z',
        next: '2026-07-26T07:00:00.000Z',
      },
      {
        start: '2026-07-25T07:00:00.000Z',
        end: '2026-07-26T07:00:00.000Z',
        next: '2026-07-27T07:00:00.000Z',
      },
    ]);
  });

  it.each(['paused', 'deleting', 'migrating'] as const)(
    'excludes a %s definition even when it leaks into a stale due page',
    async (status) => {
      const context = runContext();
      context.definition.status = status;
      const harness = createHarness({ context });

      await expect(
        tickMessageDigestScheduler(
          { workerId: 'scheduler-worker-001', limit: 25 },
          harness.dependencies
        )
      ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
      expect(harness.validateSource).not.toHaveBeenCalled();
      expect(harness.getDeliveryReadiness).not.toHaveBeenCalled();
      expect(harness.reserveRun).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['not_found', 'SOURCE_NOT_FOUND'],
    ['source_changed', 'SOURCE_CHANGED'],
  ] as const)(
    'moves a due definition to attention when current source validation returns %s',
    async (failure, attentionCode) => {
      const harness = createHarness();
      harness.validateSource.mockResolvedValueOnce({ ok: false, code: failure });

      await expect(
        tickMessageDigestScheduler(
          { workerId: 'scheduler-worker-001', limit: 25 },
          harness.dependencies
        )
      ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
      expect(harness.validateSource).toHaveBeenCalledWith({
        userId: 'synthetic-user-001',
        chatId: 'synthetic-chat-001',
        expectedGenerationId: 'synthetic-generation-001',
      });
      expect(harness.getDeliveryReadiness).not.toHaveBeenCalled();
      expect(harness.reserveRun).not.toHaveBeenCalled();
      expect(harness.updateDefinition).toHaveBeenCalledWith({
        userId: 'synthetic-user-001',
        definitionId: 'md_definition_001',
        expectedRevision: 3,
        updatedAt: NOW,
        patch: {
          status: 'paused',
          listStatus: 'needs_attention',
          attentionCode,
        },
      });
    }
  );

  it.each([
    ['source account', { sourceAccountId: 'synthetic-account-changed' }],
    ['generation', { generationId: 'synthetic-generation-changed' }],
    ['chat', { chatId: 'synthetic-chat-changed' }],
    ['chat type', { chatType: 'direct' as const }],
  ])('moves a due definition to attention when the validated %s identity changed', async (_label, changedSource) => {
    const harness = createHarness();
    harness.validateSource.mockResolvedValueOnce({
      ok: true,
      value: {
        ...runContext().definition.source,
        messageCount: 12,
        ...changedSource,
      },
    });

    await expect(
      tickMessageDigestScheduler(
        { workerId: 'scheduler-worker-001', limit: 25 },
        harness.dependencies
      )
    ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
    expect(harness.getDeliveryReadiness).not.toHaveBeenCalled();
    expect(harness.reserveRun).not.toHaveBeenCalled();
    expect(harness.updateDefinition).toHaveBeenCalledWith({
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      expectedRevision: 3,
      updatedAt: NOW,
      patch: {
        status: 'paused',
        listStatus: 'needs_attention',
        attentionCode: 'SOURCE_CHANGED',
      },
    });
  });

  it('keeps a due definition due when source validation is transiently unavailable', async () => {
    const harness = createHarness();
    harness.validateSource.mockResolvedValueOnce({ ok: false, code: 'unavailable' });

    await expect(
      tickMessageDigestScheduler(
        { workerId: 'scheduler-worker-001', limit: 25 },
        harness.dependencies
      )
    ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
    expect(harness.updateDefinition).not.toHaveBeenCalled();
    expect(harness.reserveRun).not.toHaveBeenCalled();
  });

  it('drains more than three pages of terminal blockers across fresh ticks and reaches healthy work', async () => {
    const contexts = Array.from({ length: 5 }, (_value, index) => runContextForPage(index + 1));
    const byId = new Map(contexts.map((context) => [context.definition.definitionId, context]));
    const listDueDefinitions = vi.fn<MessageDigestStore['listDueDefinitions']>(async ({ limit }) => {
      const active = contexts.filter((context) => context.definition.status === 'active');
      return {
        items: active.slice(0, limit).map((context) => context.definition),
        nextCursor: active.length > limit ? 'more-due-work' : null,
      };
    });
    const updateDefinition = vi.fn<MessageDigestStore['updateDefinition']>(async (input) => {
      const context = byId.get(input.definitionId);
      if (context === undefined || context.definition.revision !== input.expectedRevision) {
        return { ok: false, code: 'REVISION_CONFLICT' };
      }
      context.definition = {
        ...context.definition,
        status: input.patch.status ?? context.definition.status,
        listStatus: input.patch.listStatus ?? context.definition.listStatus,
        attentionCode:
          input.patch.attentionCode === undefined
            ? context.definition.attentionCode
            : input.patch.attentionCode,
        revision: context.definition.revision + 1,
        updatedAt: input.updatedAt,
      };
      return { ok: true, definition: context.definition };
    });
    const reserveRun = vi.fn<MessageDigestStore['reserveRun']>(async (input) => ({
      ok: true,
      disposition: 'reserved',
      run: input.run,
    }));
    const dispatchOutbox = vi.fn(async () => ({ ok: true }));
    const dependencies: TickMessageDigestSchedulerDependencies = {
      store: {
        listReadyDispatches: vi.fn(async () => ({ items: [], nextCursor: null })),
        listPendingDeliveryRuns: vi.fn(async () => ({ items: [], nextCursor: null })),
        listDueDefinitions,
        getOwnedRunContext: vi.fn(async (_userId, definitionId) => byId.get(definitionId) ?? null),
        updateDefinition,
        reserveRun,
      },
      whatsappClient: {
        validateSource: vi.fn(async ({ chatId }) => {
          const healthy = contexts[4];
          if (healthy === undefined || chatId !== healthy.definition.source.chatId) {
            return { ok: false, code: 'not_found' } as const;
          }
          return {
            ok: true,
            value: { ...healthy.definition.source, messageCount: 12 },
          } as const;
        }),
        getDeliveryReadiness: vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(
          async () => ({
            ok: true,
            value: {
              status: 'ready',
              observationVersion: 'readiness-v2',
              observedAt: NOW,
            },
          })
        ),
      },
      dispatchOutbox,
      reconcileDelivery: vi.fn<TickMessageDigestSchedulerDependencies['reconcileDelivery']>(
        async () => ({ ok: false, code: 'NOT_FOUND' })
      ),
      now: (): string => NOW,
    };

    await tickMessageDigestScheduler(
      { workerId: 'scheduler-worker-001', limit: 1 },
      dependencies
    );
    await tickMessageDigestScheduler(
      { workerId: 'scheduler-worker-001', limit: 1 },
      dependencies
    );

    expect(updateDefinition).toHaveBeenCalledTimes(4);
    expect(reserveRun).toHaveBeenCalledOnce();
    expect(reserveRun).toHaveBeenCalledWith(
      expect.objectContaining({ definitionId: 'md_definition_005' })
    );
  });

  it('rejects malformed scheduler bounds before scanning recovery work', async () => {
    for (const input of [
      { workerId: ' ', limit: 25 },
      { workerId: 'x'.repeat(257), limit: 25 },
      { workerId: 'scheduler-worker-001', limit: 1.5 },
      { workerId: 'scheduler-worker-001', limit: 0 },
      { workerId: 'scheduler-worker-001', limit: 101 },
    ]) {
      const harness = createHarness();
      await expect(tickMessageDigestScheduler(input, harness.dependencies)).resolves.toEqual({
        ok: false,
        code: 'INVALID_REQUEST',
      });
      expect(harness.dispatchOutbox).not.toHaveBeenCalled();
    }
    const invalidNow = createHarness();
    invalidNow.dependencies.now = (): string => 'not-an-instant';
    await expect(
      tickMessageDigestScheduler(
        { workerId: 'scheduler-worker-001', limit: 25 },
        invalidNow.dependencies
      )
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });

    const defaultClock = createHarness();
    defaultClock.dependencies.now = undefined;
    await expect(
      tickMessageDigestScheduler({ workerId: ' ', limit: 25 }, defaultClock.dependencies)
    ).resolves.toEqual({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('forwards the due-page cursor and defers every stale local reservation shape', async () => {
    const contexts: (ReturnType<typeof runContext> | null)[] = [null];
    const inactive = runContext();
    inactive.definition.status = 'paused';
    contexts.push(inactive);
    const notDue = runContext();
    notDue.definition.nextRunAt = '2026-07-28T07:00:00.000Z';
    contexts.push(notDue);
    const emptyWindow = runContext();
    emptyWindow.state.checkpointAt = emptyWindow.definition.nextRunAt;
    emptyWindow.definition.checkpointAt = emptyWindow.definition.nextRunAt;
    contexts.push(emptyWindow);

    for (const context of contexts) {
      const harness = createHarness();
      vi.mocked(harness.dependencies.store.getOwnedRunContext).mockResolvedValueOnce(context);
      await expect(
        tickMessageDigestScheduler(
          { workerId: 'scheduler-worker-001', limit: 25, cursor: 'opaque-cursor' },
          harness.dependencies
        )
      ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
      expect(harness.dependencies.store.listDueDefinitions).toHaveBeenCalledWith({
        now: NOW,
        limit: 25,
        cursor: 'opaque-cursor',
      });
    }
  });

  it('defers invalid schedules, readiness outages, and lost reservation races', async () => {
    const invalidSchedule = runContext();
    invalidSchedule.definition.schedule.localTime = 'invalid';
    const invalidHarness = createHarness({ context: invalidSchedule });
    await expect(
      tickMessageDigestScheduler(
        { workerId: 'scheduler-worker-001', limit: 25 },
        invalidHarness.dependencies
      )
    ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });

    const unavailable = createHarness();
    unavailable.getDeliveryReadiness.mockResolvedValueOnce({ ok: false, code: 'unavailable' });
    await expect(
      tickMessageDigestScheduler(
        { workerId: 'scheduler-worker-001', limit: 25 },
        unavailable.dependencies
      )
    ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });

    const race = createHarness();
    race.reserveRun.mockResolvedValueOnce({ ok: false, code: 'RUN_IN_PROGRESS' });
    await expect(
      tickMessageDigestScheduler(
        { workerId: 'scheduler-worker-001', limit: 25 },
        race.dependencies
      )
    ).resolves.toMatchObject({ ok: true, reservedRuns: 0, deferredDefinitions: 1 });
  });
});

interface HarnessOptions {
  context?: { definition: MessageDigestDefinition; state: MessageDigestState };
  readinessStatus?: 'ready' | 'mapping_missing' | 'disconnected' | 'delivery_disabled';
}

interface Harness {
  dependencies: TickMessageDigestSchedulerDependencies;
  reserveRun: Mock<MessageDigestStore['reserveRun']>;
  updateDefinition: Mock<MessageDigestStore['updateDefinition']>;
  getDeliveryReadiness: Mock<MessageDigestWhatsAppClient['getDeliveryReadiness']>;
  validateSource: Mock<MessageDigestWhatsAppClient['validateSource']>;
  dispatchOutbox: Mock<TickMessageDigestSchedulerDependencies['dispatchOutbox']>;
  reconcileDelivery: Mock<TickMessageDigestSchedulerDependencies['reconcileDelivery']>;
  listReadyDispatches: Mock<MessageDigestStore['listReadyDispatches']>;
  listPendingDeliveryRuns: Mock<MessageDigestStore['listPendingDeliveryRuns']>;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const context = options.context ?? runContext();
  const recoveryOutbox = runRequestOutbox();
  const pendingDelivery = completedRun();
  const listReadyDispatches = vi.fn<MessageDigestStore['listReadyDispatches']>(async () => ({
    items: [recoveryOutbox],
    nextCursor: null,
  }));
  const listPendingDeliveryRuns = vi.fn<MessageDigestStore['listPendingDeliveryRuns']>(async () => ({
    items: [pendingDelivery],
    nextCursor: null,
  }));
  const listDueDefinitions = vi.fn<MessageDigestStore['listDueDefinitions']>(async () => ({
    items: [context.definition],
    nextCursor: null,
  }));
  const getOwnedRunContext = vi.fn<MessageDigestStore['getOwnedRunContext']>(async () => context);
  const getDeliveryReadiness = vi.fn<MessageDigestWhatsAppClient['getDeliveryReadiness']>(
    async () => ({
      ok: true,
      value: {
        status: options.readinessStatus ?? 'ready',
        ...(options.readinessStatus === undefined || options.readinessStatus === 'ready'
          ? { maskedPrimaryNumber: '+48•••123' }
          : {}),
        observationVersion: 'readiness-v2',
        observedAt: NOW,
      },
    })
  );
  const validateSource = vi.fn<MessageDigestWhatsAppClient['validateSource']>(async () => ({
    ok: true,
    value: {
      ...context.definition.source,
      messageCount: context.definition.source.messageCount ?? 0,
    },
  }));
  const reserveRun = vi.fn<MessageDigestStore['reserveRun']>(async (input) => ({
    ok: true,
    disposition: 'reserved',
    run: input.run,
  }));
  const updateDefinition = vi.fn<MessageDigestStore['updateDefinition']>(async (input) => ({
    ok: true,
    definition: {
      ...context.definition,
      status: input.patch.status ?? context.definition.status,
      listStatus: input.patch.listStatus ?? context.definition.listStatus,
      attentionCode:
        input.patch.attentionCode === undefined
          ? context.definition.attentionCode
          : input.patch.attentionCode,
      revision: context.definition.revision + 1,
      updatedAt: input.updatedAt,
    },
  }));
  const dispatchOutbox = vi.fn<TickMessageDigestSchedulerDependencies['dispatchOutbox']>(
    async () => ({ ok: true })
  );
  const reconcileDelivery = vi.fn<TickMessageDigestSchedulerDependencies['reconcileDelivery']>(
    async () => ({ ok: true, disposition: 'pending', run: pendingDelivery })
  );
  return {
    dependencies: {
      store: {
        listReadyDispatches,
        listPendingDeliveryRuns,
        listDueDefinitions,
        getOwnedRunContext,
        updateDefinition,
        reserveRun,
      },
      whatsappClient: { getDeliveryReadiness, validateSource },
      dispatchOutbox,
      reconcileDelivery,
      now: (): string => NOW,
    },
    reserveRun,
    updateDefinition,
    getDeliveryReadiness,
    validateSource,
    dispatchOutbox,
    reconcileDelivery,
    listReadyDispatches,
    listPendingDeliveryRuns,
  };
}

function runContext(): { definition: MessageDigestDefinition; state: MessageDigestState } {
  const definition: MessageDigestDefinition = {
    version: 1,
    definitionId: 'md_definition_001',
    userId: 'synthetic-user-001',
    name: 'Synthetic daily',
    nameSortKey: 'synthetic daily',
    status: 'active',
    listStatus: 'active',
    attentionCode: null,
    revision: 3,
    erasureEpoch: 0,
    activeErasureRequestId: null,
    hasRuns: false,
    source: {
      type: 'private_whatsapp',
      sourceAccountId: 'synthetic-account-001',
      generationId: 'synthetic-generation-001',
      chatId: 'synthetic-chat-001',
      chatType: 'group',
      displayName: 'Synthetic group',
      sourceRevision: 'synthetic-source-revision',
    },
    instructions: {
      templateId: 'custom',
      text: 'Create a bounded digest from this synthetic conversation source.',
      revision: '1',
    },
    schedule: { kind: 'daily', localTime: '09:00', timeZone: 'Europe/Warsaw' },
    delivery: {
      type: 'whatsapp_primary',
      readinessObservationVersion: 'readiness-v1',
      readinessObservedAt: '2026-07-27T06:59:00.000Z',
    },
    checkpointAt: '2026-07-26T07:00:00.000Z',
    nextRunAt: '2026-07-27T07:00:00.000Z',
    lastRunAt: null,
    createRequestIdDigest: 'a'.repeat(64),
    activeMigrationId: null,
    legacyAlias: null,
    createdAt: '2026-07-26T07:00:00.000Z',
    updatedAt: '2026-07-27T06:59:00.000Z',
  };
  return {
    definition,
    state: {
      version: 1,
      definitionId: definition.definitionId,
      userId: definition.userId,
      revision: 5,
      checkpointAt: definition.checkpointAt,
      continuityMemoryMarkdown: '',
      precedingRunId: null,
      precedingRunHash: null,
      pendingWindow: null,
      updatedAt: definition.updatedAt,
    },
  };
}

function runContextForPage(index: number): {
  definition: MessageDigestDefinition;
  state: MessageDigestState;
} {
  const context = runContext();
  const suffix = String(index).padStart(3, '0');
  context.definition.definitionId = `md_definition_${suffix}`;
  context.definition.name = `Synthetic daily ${suffix}`;
  context.definition.nameSortKey = `synthetic daily ${suffix}`;
  context.definition.source = {
    ...context.definition.source,
    chatId: `synthetic-chat-${suffix}`,
    generationId: `synthetic-generation-${suffix}`,
  };
  context.state.definitionId = context.definition.definitionId;
  return context;
}

function runRequestOutbox(): MessageDigestDispatchOutbox {
  const payloadJson = JSON.stringify({ type: 'message-digest.run', runId: 'mdr_recovery_001' });
  return {
    version: 1,
    outboxId: 'mdo_recovery_001',
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
    runId: 'mdr_recovery_001',
    kind: 'run_request',
    status: 'pending',
    payloadJson,
    payloadDigest: 'd'.repeat(64),
    attempts: 0,
    nextAttemptAt: NOW,
    claim: null,
    publishedAt: null,
    terminalCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: 1_777_000_000,
  };
}

function completedRun(): MessageDigestRun {
  const definition = runContext().definition;
  return {
    version: 1,
    runId: 'mdr_delivery_pending_001',
    userId: definition.userId,
    definitionId: definition.definitionId,
    definitionNameSnapshot: definition.name,
    recordRole: 'canonical',
    visibilityMigrationId: null,
    definitionRevision: definition.revision,
    instructionRevision: definition.instructions.revision,
    trigger: 'scheduled',
    requestIdDigest: 'b'.repeat(64),
    windowStart: '2026-07-25T07:00:00.000Z',
    windowEnd: '2026-07-26T07:00:00.000Z',
    scheduledBoundary: '2026-07-26T07:00:00.000Z',
    generationStatus: 'completed',
    processingStage: 'completed',
    lease: null,
    attempts: 1,
    sourceSnapshot: definition.source,
    instructionsSnapshot: definition.instructions,
    scheduleSnapshot: definition.schedule,
    headline: 'Synthetic digest',
    summaryMarkdown: '- A bounded fact.',
    evidenceMessageRefs: ['c'.repeat(64)],
    continuityMemoryMarkdown: 'Synthetic continuity.',
    effectiveMessageCount: 1,
    promptVersion: '1.0.0',
    model: 'or:synthetic/model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.001 },
    delivery: {
      type: 'whatsapp_primary',
      status: 'pending',
      idempotencyKey: 'message-digest:mdr_delivery_pending_001',
      acceptedAt: null,
      failedAt: null,
      failureCode: null,
      reconciliationAttempts: 0,
      nextCheckAt: '2026-07-26T07:02:00.000Z',
      missingSince: null,
    },
    safeFailureCode: null,
    createdAt: '2026-07-26T07:01:00.000Z',
    updatedAt: '2026-07-26T07:02:00.000Z',
    completedAt: '2026-07-26T07:02:00.000Z',
  };
}
