import { describe, expect, it, vi } from 'vitest';
import type { MessageDigestDispatchOutbox, MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import {
  recoverMessageDigestWork,
  type RecoverMessageDigestWorkDependencies,
} from './recoverMessageDigestWork.js';

const NOW = '2026-07-27T12:00:00.000Z';

describe('recoverMessageDigestWork', () => {
  it('republishes pending run requests before reconciling deliveries and preserves page cursors', async () => {
    const harness = createHarness();
    harness.listReadyDispatches
      .mockResolvedValueOnce({
        items: [dispatch('mdo_run_request_001')],
        nextCursor: 'dispatch-page-2',
      })
      .mockResolvedValueOnce({
        items: [dispatch('mdo_run_request_002')],
        nextCursor: null,
      });
    harness.listPendingDeliveryRuns
      .mockResolvedValueOnce({
        items: [deliveryRun('mdr_delivery_001')],
        nextCursor: 'delivery-page-2',
      })
      .mockResolvedValueOnce({
        items: [deliveryRun('mdr_delivery_002')],
        nextCursor: null,
      });

    await expect(
      recoverMessageDigestWork({ now: NOW, limit: 25 }, harness.dependencies)
    ).resolves.toEqual({ ok: true, recoveredDispatches: 2, reconciledDeliveries: 2 });
    expect(harness.listReadyDispatches).toHaveBeenNthCalledWith(1, { now: NOW, limit: 25 });
    expect(harness.listReadyDispatches).toHaveBeenNthCalledWith(2, {
      now: NOW,
      limit: 25,
      cursor: 'dispatch-page-2',
    });
    expect(harness.dispatchOutbox.mock.calls).toEqual([
      ['mdo_run_request_001'],
      ['mdo_run_request_002'],
    ]);
    expect(harness.listPendingDeliveryRuns).toHaveBeenNthCalledWith(2, {
      now: NOW,
      limit: 25,
      cursor: 'delivery-page-2',
    });
    expect(harness.reconcileDelivery).toHaveBeenNthCalledWith(1, {
      userId: 'synthetic-user-001',
      definitionId: 'md_definition_001',
      runId: 'mdr_delivery_001',
    });
    expect(harness.dispatchOutbox.mock.invocationCallOrder.at(-1)).toBeLessThan(
      harness.reconcileDelivery.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
  });

  it('caps each recovery scan at three pages so a backlog cannot starve reservations', async () => {
    const harness = createHarness();
    harness.listReadyDispatches.mockResolvedValue({
      items: [dispatch('mdo_run_request_001')],
      nextCursor: 'another-dispatch-page',
    });
    harness.listPendingDeliveryRuns.mockResolvedValue({
      items: [deliveryRun('mdr_delivery_001')],
      nextCursor: 'another-delivery-page',
    });

    await expect(
      recoverMessageDigestWork({ now: NOW, limit: 10 }, harness.dependencies)
    ).resolves.toMatchObject({ ok: true, recoveredDispatches: 3, reconciledDeliveries: 3 });
    expect(harness.listReadyDispatches).toHaveBeenCalledTimes(3);
    expect(harness.listPendingDeliveryRuns).toHaveBeenCalledTimes(3);
  });

  it('does not republish terminal outboxes or recheck terminal deliveries returned as no work', async () => {
    const harness = createHarness();

    await expect(
      recoverMessageDigestWork({ now: NOW, limit: 25 }, harness.dependencies)
    ).resolves.toEqual({ ok: true, recoveredDispatches: 0, reconciledDeliveries: 0 });
    expect(harness.dispatchOutbox).not.toHaveBeenCalled();
    expect(harness.reconcileDelivery).not.toHaveBeenCalled();
  });

  it.each([
    { now: 'not-an-instant', limit: 25 },
    { now: NOW, limit: 0 },
    { now: NOW, limit: 101 },
    { now: NOW, limit: 1.5 },
  ])('rejects invalid bounded recovery input %#', async (input) => {
    const harness = createHarness();

    await expect(recoverMessageDigestWork(input, harness.dependencies)).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(harness.listReadyDispatches).not.toHaveBeenCalled();
    expect(harness.listPendingDeliveryRuns).not.toHaveBeenCalled();
  });
});

function createHarness(): {
  dependencies: RecoverMessageDigestWorkDependencies;
  listReadyDispatches: ReturnType<typeof vi.fn<MessageDigestStore['listReadyDispatches']>>;
  listPendingDeliveryRuns: ReturnType<
    typeof vi.fn<MessageDigestStore['listPendingDeliveryRuns']>
  >;
  dispatchOutbox: ReturnType<typeof vi.fn<(outboxId: string) => Promise<unknown>>>;
  reconcileDelivery: ReturnType<
    typeof vi.fn<RecoverMessageDigestWorkDependencies['reconcileDelivery']>
  >;
} {
  const listReadyDispatches = vi.fn<MessageDigestStore['listReadyDispatches']>(async () => ({
    items: [],
    nextCursor: null,
  }));
  const listPendingDeliveryRuns = vi.fn<MessageDigestStore['listPendingDeliveryRuns']>(
    async () => ({ items: [], nextCursor: null })
  );
  const dispatchOutbox = vi.fn(async (_outboxId: string) => ({ ok: true }));
  const reconcileDelivery = vi.fn<RecoverMessageDigestWorkDependencies['reconcileDelivery']>(
    async () => ({ ok: true })
  );
  return {
    dependencies: {
      store: { listReadyDispatches, listPendingDeliveryRuns },
      dispatchOutbox,
      reconcileDelivery,
    },
    listReadyDispatches,
    listPendingDeliveryRuns,
    dispatchOutbox,
    reconcileDelivery,
  };
}

function dispatch(outboxId: string): MessageDigestDispatchOutbox {
  return { outboxId } as MessageDigestDispatchOutbox;
}

function deliveryRun(runId: string): MessageDigestRun {
  return {
    runId,
    userId: 'synthetic-user-001',
    definitionId: 'md_definition_001',
  } as MessageDigestRun;
}
