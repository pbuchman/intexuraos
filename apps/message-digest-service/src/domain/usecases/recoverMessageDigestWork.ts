import type { MessageDigestStore } from '../ports/messageDigestStore.js';

const MAX_RECOVERY_PAGES = 3;

export interface RecoverMessageDigestWorkInput {
  now: string;
  limit: number;
}

export interface RecoverMessageDigestWorkDependencies {
  store: Pick<MessageDigestStore, 'listReadyDispatches' | 'listPendingDeliveryRuns'>;
  dispatchOutbox(outboxId: string): Promise<unknown>;
  reconcileDelivery(input: {
    userId: string;
    definitionId: string;
    runId: string;
  }): Promise<unknown>;
}

export type RecoverMessageDigestWorkResult =
  | {
      ok: true;
      recoveredDispatches: number;
      reconciledDeliveries: number;
    }
  | { ok: false; code: 'INVALID_REQUEST' };

export async function recoverMessageDigestWork(
  input: RecoverMessageDigestWorkInput,
  dependencies: RecoverMessageDigestWorkDependencies
): Promise<RecoverMessageDigestWorkResult> {
  if (
    !Number.isFinite(Date.parse(input.now)) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const now = new Date(Date.parse(input.now)).toISOString();
  const recoveredDispatches = await recoverReadyDispatches(now, input.limit, dependencies);
  const reconciledDeliveries = await recoverPendingDeliveries(now, input.limit, dependencies);
  return { ok: true, recoveredDispatches, reconciledDeliveries };
}

async function recoverReadyDispatches(
  now: string,
  limit: number,
  dependencies: RecoverMessageDigestWorkDependencies
): Promise<number> {
  let recovered = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_RECOVERY_PAGES; page += 1) {
    const result = await dependencies.store.listReadyDispatches({
      now,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const dispatch of result.items) {
      await dependencies.dispatchOutbox(dispatch.outboxId);
      recovered += 1;
    }
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return recovered;
}

async function recoverPendingDeliveries(
  now: string,
  limit: number,
  dependencies: RecoverMessageDigestWorkDependencies
): Promise<number> {
  let reconciled = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_RECOVERY_PAGES; page += 1) {
    const result = await dependencies.store.listPendingDeliveryRuns({
      now,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const run of result.items) {
      await dependencies.reconcileDelivery({
        userId: run.userId,
        definitionId: run.definitionId,
        runId: run.runId,
      });
      reconciled += 1;
    }
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return reconciled;
}
