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
      failures?: number;
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
  const failures = recoveredDispatches.failures + reconciledDeliveries.failures;
  return { ok: true, recoveredDispatches: recoveredDispatches.count, reconciledDeliveries: reconciledDeliveries.count, ...(failures > 0 ? { failures } : {}) };
}

async function recoverReadyDispatches(
  now: string,
  limit: number,
  dependencies: RecoverMessageDigestWorkDependencies
): Promise<{count: number; failures: number}> {
  let recovered = 0;
  let failures = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_RECOVERY_PAGES; page += 1) {
    const result = await dependencies.store.listReadyDispatches({
      now,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const dispatch of result.items) {
      if (isDigestWorkFailure(await dependencies.dispatchOutbox(dispatch.outboxId))) failures++;
      recovered += 1;
    }
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return {count: recovered, failures};
}

async function recoverPendingDeliveries(
  now: string,
  limit: number,
  dependencies: RecoverMessageDigestWorkDependencies
): Promise<{count: number; failures: number}> {
  let reconciled = 0;
  let failures = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_RECOVERY_PAGES; page += 1) {
    const result = await dependencies.store.listPendingDeliveryRuns({
      now,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const run of result.items) {
      const outcome = await dependencies.reconcileDelivery({
        userId: run.userId,
        definitionId: run.definitionId,
        runId: run.runId,
      });
      if (isDigestWorkFailure(outcome)) failures++;
      reconciled += 1;
    }
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return {count: reconciled, failures};
}

export function isDigestWorkFailure(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false;
  const value = result as {ok?: boolean; disposition?: string};
  return value.ok === false || value.disposition === 'retry_scheduled' || value.disposition === 'failed';
}
