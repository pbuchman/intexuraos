import { createHash } from 'node:crypto';
import type { MessageDigestDefinition } from '../models/messageDigestDefinition.js';
import type { MessageDigestRun } from '../models/messageDigestRun.js';
import type { MessageDigestStore } from '../ports/messageDigestStore.js';

const MAX_CURSOR_LENGTH = 4_096;
const MAX_TERMS = 20;
const MAX_TERM_LENGTH = 100;
const MAX_RUN_PAGE_SIZE = 100;
const MAX_TIME_ZONE_OFFSET_MS = 14 * 60 * 60 * 1_000;
const LEGACY_GROUP_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface LegacyDigestDefinitionProjection {
  definitionId: string;
  legacyGroupKey: string;
  source: {
    sourceAccountId: string;
    generationId: string;
    chatId: string;
    chatType: 'group';
  };
  activeMigrationId: string;
}

export interface LegacyDigestRunProjection {
  definitionId: string;
  runId: string;
  legacyGroupKey: string;
  date: string;
  title: string;
  summaryMarkdown: string;
  messageCount: number;
  evidenceMessageRefs: string[];
  windowStart: string;
  windowEnd: string;
}

export interface QueryLegacyDigestDefinitionsInput {
  userId: string;
  legacyGroupKey: string;
}

export interface QueryLegacyDigestRunsInput extends QueryLegacyDigestDefinitionsInput {
  fromDate?: string | undefined;
  toDate?: string | undefined;
  terms?: string[] | undefined;
  limit: number;
  cursor?: string | undefined;
}

type LegacyDefinitionStore = Pick<MessageDigestStore, 'getOwnedDefinitionByLegacyAlias'>;
type LegacyRunStore = Pick<
  MessageDigestStore,
  'getOwnedDefinitionByLegacyAlias' | 'listOwnedLegacyRuns'
>;

export async function queryLegacyDigestDefinitions(
  input: QueryLegacyDigestDefinitionsInput,
  dependencies: { store: LegacyDefinitionStore }
): Promise<
  | { ok: true; items: LegacyDigestDefinitionProjection[] }
  | { ok: false; code: 'INVALID_QUERY' }
> {
  const normalized = normalizeAliasInput(input);
  if (normalized === null) return { ok: false, code: 'INVALID_QUERY' };
  const definition = await dependencies.store.getOwnedDefinitionByLegacyAlias(normalized);
  if (!isVisibleLegacyDefinition(definition, normalized)) return { ok: true, items: [] };
  return { ok: true, items: [toLegacyDefinitionProjection(definition)] };
}

export async function queryLegacyDigestRuns(
  input: QueryLegacyDigestRunsInput,
  dependencies: { store: LegacyRunStore }
): Promise<
  | {
      ok: true;
      items: LegacyDigestRunProjection[];
      truncated: boolean;
      nextCursor: string | null;
    }
  | { ok: false; code: 'INVALID_QUERY' | 'INVALID_CURSOR' }
> {
  const normalized = normalizeRunInput(input);
  if (normalized === null) return { ok: false, code: 'INVALID_QUERY' };
  const definition = await dependencies.store.getOwnedDefinitionByLegacyAlias({
    userId: normalized.userId,
    legacyGroupKey: normalized.legacyGroupKey,
  });
  if (!isVisibleLegacyDefinition(definition, normalized)) {
    return { ok: true, items: [], truncated: false, nextCursor: null };
  }

  let scheduledBoundaryFrom: string | undefined;
  let scheduledBoundaryBefore: string | undefined;
  if (normalized.fromDate !== undefined) {
    scheduledBoundaryFrom = conservativeUtcStart(normalized.fromDate);
  }
  if (normalized.toDate !== undefined) {
    scheduledBoundaryBefore = conservativeUtcEnd(normalized.toDate);
  }

  const queryFingerprint = fingerprint([
    'legacy-message-digest-runs-v2',
    normalized.userId,
    normalized.legacyGroupKey,
    definition.definitionId,
    definition.activeMigrationId,
    definition.source.sourceAccountId,
    definition.source.generationId,
    definition.source.chatId,
    normalized.fromDate ?? null,
    normalized.toDate ?? null,
    scheduledBoundaryFrom ?? null,
    scheduledBoundaryBefore ?? null,
    ...normalized.terms,
  ]);
  try {
    const page = await dependencies.store.listOwnedLegacyRuns({
      userId: normalized.userId,
      definitionId: definition.definitionId,
      activeMigrationId: definition.activeMigrationId,
      legacyGroupKey: normalized.legacyGroupKey,
      limit: normalized.limit,
      ...(normalized.cursor === undefined ? {} : { cursor: normalized.cursor }),
      ...(scheduledBoundaryFrom === undefined ? {} : { scheduledBoundaryFrom }),
      ...(scheduledBoundaryBefore === undefined ? {} : { scheduledBoundaryBefore }),
      queryFingerprint,
    });
    const items = page.items
      .filter((run) => isVisibleLegacyRun(run, definition))
      .filter((run) => runMatchesDateRange(run, normalized))
      .filter((run) => runMatchesTerms(run, normalized.terms))
      .map((run) => toLegacyRunProjection(run, definition));
    return {
      ok: true,
      items,
      truncated: page.nextCursor !== null,
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CURSOR') {
      return { ok: false, code: 'INVALID_CURSOR' };
    }
    throw error;
  }
}

export async function resolveLegacyDigestRun(
  input: QueryLegacyDigestDefinitionsInput & { date: string },
  dependencies: { store: LegacyRunStore }
): Promise<
  | { ok: true; definitionId: string; runId: string }
  | { ok: false; code: 'NOT_FOUND' }
> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const result = await queryLegacyDigestRuns(
      {
        userId: input.userId,
        legacyGroupKey: input.legacyGroupKey,
        fromDate: input.date,
        toDate: input.date,
        limit: MAX_RUN_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      },
      dependencies
    );
    if (!result.ok) return { ok: false, code: 'NOT_FOUND' };
    const run = result.items.find((item) => item.date === input.date);
    if (run !== undefined) {
      return { ok: true, definitionId: run.definitionId, runId: run.runId };
    }
    if (result.nextCursor === null || seenCursors.has(result.nextCursor)) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    cursor = result.nextCursor;
    seenCursors.add(cursor);
  }
}

interface NormalizedAliasInput {
  userId: string;
  legacyGroupKey: string;
}

interface NormalizedRunInput extends NormalizedAliasInput {
  fromDate?: string | undefined;
  toDate?: string | undefined;
  terms: string[];
  limit: number;
  cursor?: string | undefined;
}

function normalizeAliasInput(
  input: QueryLegacyDigestDefinitionsInput
): NormalizedAliasInput | null {
  const userId = input.userId.trim();
  const legacyGroupKey = input.legacyGroupKey.trim();
  if (
    userId === '' ||
    userId.length > 256 ||
    legacyGroupKey.length > 128 ||
    !LEGACY_GROUP_KEY_PATTERN.test(legacyGroupKey)
  ) {
    return null;
  }
  return { userId, legacyGroupKey };
}

function normalizeRunInput(input: QueryLegacyDigestRunsInput): NormalizedRunInput | null {
  const alias = normalizeAliasInput(input);
  if (
    alias === null ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_RUN_PAGE_SIZE ||
    (input.cursor !== undefined &&
      (input.cursor.length < 1 || input.cursor.length > MAX_CURSOR_LENGTH)) ||
    !validOptionalDate(input.fromDate) ||
    !validOptionalDate(input.toDate) ||
    (input.fromDate !== undefined &&
      input.toDate !== undefined &&
      input.fromDate > input.toDate) ||
    (input.terms !== undefined &&
      (input.terms.length < 1 ||
        input.terms.length > MAX_TERMS ||
        input.terms.some((term) => term.trim() === '' || term.trim().length > MAX_TERM_LENGTH)))
  ) {
    return null;
  }
  const terms = [...new Set((input.terms ?? []).map((term) => term.trim().toLocaleLowerCase()))];
  return {
    ...alias,
    terms,
    limit: input.limit,
    ...(input.fromDate === undefined ? {} : { fromDate: input.fromDate }),
    ...(input.toDate === undefined ? {} : { toDate: input.toDate }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

function isVisibleLegacyDefinition(
  definition: MessageDigestDefinition | null,
  input: NormalizedAliasInput
): definition is MessageDigestDefinition & {
  activeMigrationId: string;
  legacyAlias: { groupKey: string };
  source: MessageDigestDefinition['source'] & { chatType: 'group' };
} {
  return (
    definition !== null &&
    definition.userId === input.userId &&
    (definition.status === 'active' || definition.status === 'paused') &&
    definition.activeMigrationId !== null &&
    definition.legacyAlias?.groupKey === input.legacyGroupKey &&
    definition.source.chatType === 'group'
  );
}

function toLegacyDefinitionProjection(
  definition: MessageDigestDefinition & {
    activeMigrationId: string;
    legacyAlias: { groupKey: string };
    source: MessageDigestDefinition['source'] & { chatType: 'group' };
  }
): LegacyDigestDefinitionProjection {
  return {
    definitionId: definition.definitionId,
    legacyGroupKey: definition.legacyAlias.groupKey,
    source: {
      sourceAccountId: definition.source.sourceAccountId,
      generationId: definition.source.generationId,
      chatId: definition.source.chatId,
      chatType: 'group',
    },
    activeMigrationId: definition.activeMigrationId,
  };
}

function isVisibleLegacyRun(
  run: MessageDigestRun,
  definition: MessageDigestDefinition
): run is MessageDigestRun & {
  headline: string;
  summaryMarkdown: string;
  effectiveMessageCount: number;
} {
  return (
    run.userId === definition.userId &&
    run.definitionId === definition.definitionId &&
    run.recordRole === 'canonical' &&
    run.visibilityMigrationId === null &&
    run.trigger === 'scheduled' &&
    run.generationStatus === 'completed' &&
    run.headline !== null &&
    run.summaryMarkdown !== null &&
    run.effectiveMessageCount !== null &&
    run.sourceSnapshot.chatType === 'group' &&
    run.sourceSnapshot.sourceAccountId === definition.source.sourceAccountId &&
    run.sourceSnapshot.generationId === definition.source.generationId &&
    run.sourceSnapshot.chatId === definition.source.chatId
  );
}

function runMatchesTerms(
  run: MessageDigestRun & { headline: string; summaryMarkdown: string },
  terms: readonly string[]
): boolean {
  if (terms.length === 0) return true;
  const searchable = `${run.headline}\n${run.summaryMarkdown}`.toLocaleLowerCase();
  return terms.some((term) => searchable.includes(term));
}

function runMatchesDateRange(run: MessageDigestRun, input: NormalizedRunInput): boolean {
  if (input.fromDate === undefined && input.toDate === undefined) return true;
  const date = localDate(run.scheduledBoundary, run.scheduleSnapshot.timeZone);
  return (
    (input.fromDate === undefined || date >= input.fromDate) &&
    (input.toDate === undefined || date <= input.toDate)
  );
}

function toLegacyRunProjection(
  run: MessageDigestRun & {
    headline: string;
    summaryMarkdown: string;
    effectiveMessageCount: number;
  },
  definition: MessageDigestDefinition & { legacyAlias: { groupKey: string } }
): LegacyDigestRunProjection {
  return {
    definitionId: definition.definitionId,
    runId: run.runId,
    legacyGroupKey: definition.legacyAlias.groupKey,
    date: localDate(run.scheduledBoundary, run.scheduleSnapshot.timeZone),
    title: run.headline,
    summaryMarkdown: run.summaryMarkdown,
    messageCount: run.effectiveMessageCount,
    evidenceMessageRefs: [...run.evidenceMessageRefs],
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
  };
}

function conservativeUtcStart(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - MAX_TIME_ZONE_OFFSET_MS).toISOString();
}

function conservativeUtcEnd(date: string): string {
  const nextUtcDay = Date.parse(`${date}T00:00:00.000Z`) + 24 * 60 * 60 * 1_000;
  return new Date(nextUtcDay + MAX_TIME_ZONE_OFFSET_MS).toISOString();
}

function localDate(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('INVALID_SCHEDULED_BOUNDARY');
  }
  return `${year}-${month}-${day}`;
}

function validOptionalDate(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function fingerprint(values: readonly (string | null)[]): string {
  return createHash('sha256').update(JSON.stringify(values), 'utf8').digest('hex');
}
