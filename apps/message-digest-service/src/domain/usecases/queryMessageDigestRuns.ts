import { createHash } from 'node:crypto';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';
import { getMessageDigestLocalDateRange } from '../schedules/messageDigestSchedule.js';

export interface QueryMessageDigestRunsInput {
  userId: string;
  definitionId: string;
  cursor?: string | undefined;
  limit?: number | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  generationStatus?: MessageDigestRun['generationStatus'] | undefined;
  deliveryStatus?: MessageDigestRun['delivery']['status'] | undefined;
  sort?: 'windowStart' | undefined;
  direction?: 'asc' | 'desc' | undefined;
}

export interface QueryMessageDigestRunsDependencies {
  store: Pick<MessageDigestStore, 'getOwnedDefinition' | 'listOwnedRuns'>;
}

export type QueryMessageDigestRunsResult =
  | { ok: true; items: MessageDigestRun[]; nextCursor: string | null }
  | { ok: false; code: 'INVALID_QUERY' | 'INVALID_CURSOR' | 'NOT_FOUND' };

interface NormalizedRunHistoryQuery {
  userId: string;
  definitionId: string;
  cursor?: string | undefined;
  limit: number;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  generationStatus?: MessageDigestRun['generationStatus'] | undefined;
  deliveryStatus?: MessageDigestRun['delivery']['status'] | undefined;
  direction: 'asc' | 'desc';
}

export async function queryMessageDigestRuns(
  input: QueryMessageDigestRunsInput,
  dependencies: QueryMessageDigestRunsDependencies
): Promise<QueryMessageDigestRunsResult> {
  const normalized = normalizeInput(input);
  if (normalized === null) return { ok: false, code: 'INVALID_QUERY' };
  const definition = await dependencies.store.getOwnedDefinition(
    normalized.userId,
    normalized.definitionId
  );
  if (definition === null) return { ok: false, code: 'NOT_FOUND' };

  let windowStartFrom: string | undefined;
  let windowStartBefore: string | undefined;
  if (normalized.fromDate !== undefined || normalized.toDate !== undefined) {
    const range = getMessageDigestLocalDateRange({
      timeZone: definition.schedule.timeZone,
      fromDate: normalized.fromDate ?? (normalized.toDate as string),
      toDate: normalized.toDate ?? (normalized.fromDate as string),
    });
    if (!range.ok) return { ok: false, code: 'INVALID_QUERY' };
    if (normalized.fromDate !== undefined) windowStartFrom = range.value.fromInclusive;
    if (normalized.toDate !== undefined) windowStartBefore = range.value.toExclusive;
  }
  const queryFingerprint = fingerprint([
    'message-digest-run-history-v1',
    normalized.userId,
    normalized.definitionId,
    normalized.fromDate ?? null,
    normalized.toDate ?? null,
    normalized.generationStatus ?? null,
    normalized.deliveryStatus ?? null,
    normalized.direction,
  ]);
  try {
    const result = await dependencies.store.listOwnedRuns({
      userId: normalized.userId,
      definitionId: normalized.definitionId,
      limit: normalized.limit,
      ...(normalized.cursor === undefined ? {} : { cursor: normalized.cursor }),
      ...(windowStartFrom === undefined ? {} : { windowStartFrom }),
      ...(windowStartBefore === undefined ? {} : { windowStartBefore }),
      ...(normalized.generationStatus === undefined
        ? {}
        : { generationStatus: normalized.generationStatus }),
      ...(normalized.deliveryStatus === undefined
        ? {}
        : { deliveryStatus: normalized.deliveryStatus }),
      direction: normalized.direction,
      queryFingerprint,
    });
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CURSOR') {
      return { ok: false, code: 'INVALID_CURSOR' };
    }
    throw error;
  }
}

export async function getMessageDigestRun(
  input: { userId: string; definitionId: string; runId: string },
  dependencies: { store: Pick<MessageDigestStore, 'getOwnedRun'> }
): Promise<{ ok: true; run: MessageDigestRun } | { ok: false; code: 'NOT_FOUND' }> {
  const normalized = {
    userId: input.userId.trim(),
    definitionId: input.definitionId.trim(),
    runId: input.runId.trim(),
  };
  if (
    normalized.userId === '' ||
    normalized.definitionId === '' ||
    normalized.runId === ''
  ) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  const run = await dependencies.store.getOwnedRun(normalized);
  return run === null ? { ok: false, code: 'NOT_FOUND' } : { ok: true, run };
}

function normalizeInput(input: QueryMessageDigestRunsInput): NormalizedRunHistoryQuery | null {
  const userId = input.userId.trim();
  const definitionId = input.definitionId.trim();
  const limit = input.limit ?? 25;
  const direction = input.direction ?? 'desc';
  if (
    userId === '' ||
    definitionId === '' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    input.cursor?.trim() === '' ||
    !isRunSort(input.sort) ||
    !isDirection(input.direction) ||
    !isGenerationStatus(input.generationStatus) ||
    !isDeliveryStatus(input.deliveryStatus)
  ) {
    return null;
  }
  return {
    userId,
    definitionId,
    limit,
    direction,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.fromDate === undefined ? {} : { fromDate: input.fromDate }),
    ...(input.toDate === undefined ? {} : { toDate: input.toDate }),
    ...(input.generationStatus === undefined
      ? {}
      : { generationStatus: input.generationStatus }),
    ...(input.deliveryStatus === undefined ? {} : { deliveryStatus: input.deliveryStatus }),
  };
}

function isRunSort(value: unknown): boolean {
  return value === undefined || value === 'windowStart';
}

function isDirection(value: unknown): value is 'asc' | 'desc' | undefined {
  return value === undefined || value === 'asc' || value === 'desc';
}

function isGenerationStatus(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'queued' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped_no_activity'
  );
}

function isDeliveryStatus(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'not_sent' ||
    value === 'pending' ||
    value === 'sent' ||
    value === 'ambiguous' ||
    value === 'failed'
  );
}

function fingerprint(values: readonly (string | null)[]): string {
  return createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex');
}
