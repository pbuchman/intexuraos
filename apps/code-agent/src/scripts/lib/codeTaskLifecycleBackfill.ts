import { FieldPath, Timestamp } from '@google-cloud/firestore';
import { getErrorMessage } from '@intexuraos/common-core';
import type {
  DocumentData,
  Firestore,
  Query,
  QueryDocumentSnapshot,
  Transaction,
} from '@google-cloud/firestore';
import type { CodeTask, TaskStatus } from '../../domain/models/codeTask.js';
import type { TaskLifecycleTimeSource } from '../../domain/models/taskLifecycleTime.js';
import {
  isActiveTaskStatus,
  isTerminalTaskStatus,
  normalizeTaskLifecycleTimestamp,
  resolveTaskLifecycleTime,
} from '../../domain/models/taskLifecycleTime.js';
import { deriveAggregateStatusFromSummary } from '../../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import type {
  LifecycleBackfillTaskGroupSummaryRepository,
} from '../../domain/ports/taskGroupSummaryRepository.js';
import type { TaskGroupSummary, UserGroupCounts } from '../../domain/models/taskGroupSummary.js';
import { fromFirestoreDoc } from '../../infra/firestore/task-serializer.js';
import { createTaskGroupSummaryFirestoreRepository } from '../../infra/firestore/taskGroupSummaryFirestoreRepository.js';
import {
  applyNewGroupDelta,
  applyStatusChangeDelta,
  computeAllArchivedSummaryFromTasks,
  computeSummaryFromTasks,
  docToCounts,
  docToSummary,
} from '../../infra/firestore/taskGroupSummary/serializer.js';
import {
  countsDocRef,
  summaryDocRef,
} from '../../infra/firestore/taskGroupSummary/queries.js';

export const EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID = 'intexuraos-dev-pbuchman';
const TASKS_COLLECTION = 'code_tasks';
const SUMMARIES_COLLECTION = 'task_group_summaries';
const DEFAULT_PAGE_SIZE = 200;
const AGENT_TYPES: ReadonlySet<string> = new Set([
  'planning', 'execution', 'pull_request', 'review', 'remediation', 'ask_agent', 'sentry',
]);

export type LifecycleBackfillMode = 'dry-run' | 'apply';
export type LifecycleBackfillPhase = 'all' | 'tasks' | 'summaries';

export interface LifecycleBackfillOptions {
  mode: LifecycleBackfillMode;
  phase: LifecycleBackfillPhase;
  projectId: string;
  pageSize: number;
  cursor?: string;
  limit?: number;
}

export interface RawFirestoreDocument {
  id: string;
  data: Record<string, unknown>;
}

export class LifecycleBackfillSafetyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'LifecycleBackfillSafetyError';
    this.code = code;
  }
}

export class LifecycleBackfillRunError extends Error {
  readonly code: string;
  readonly cursor?: string;

  constructor(code: string, cursor: string | undefined, internalMessage: string) {
    super(internalMessage);
    this.name = 'LifecycleBackfillRunError';
    this.code = code;
    if (cursor !== undefined) this.cursor = cursor;
  }
}

const WRITABLE_STATUSES: ReadonlySet<string> = new Set<TaskStatus>([
  'queued',
  'dispatched',
  'running',
  'planned',
  'implemented',
  'reviewed',
  'failed',
  'interrupted',
  'cancelled',
  'archived',
]);

const LIFECYCLE_SOURCES: readonly TaskLifecycleTimeSource[] = [
  'status_changed',
  'completed',
  'dispatch_terminal_cause',
  'dispatch_terminal',
  'dispatched',
  'queued',
  'legacy_updated',
  'created',
];

export type TaskLifecycleBackfillPlan =
  | {
    docId: string;
    outcome: 'change';
    source: TaskLifecycleTimeSource;
    terminal: boolean;
    activeCompletedAtAnomaly: boolean;
    update: { statusChangedAt?: Timestamp; completedAt?: Timestamp };
  }
  | {
    docId: string;
    outcome: 'skip';
    source: TaskLifecycleTimeSource;
    terminal: boolean;
    activeCompletedAtAnomaly: boolean;
  }
  | {
    docId: string;
    outcome: 'invalid';
    reason: string;
  };

export interface TaskLifecycleBackfillReport {
  scanned: number;
  changed: number;
  skipped: number;
  invalid: number;
  deleted: number;
  statusChangedAtAdded: number;
  completedAtAdded: number;
  activeCompletedAtAnomalies: number;
  sources: Record<TaskLifecycleTimeSource, number>;
  invalidReasons: Record<string, number>;
  cursor: string | null;
  limitReached: boolean;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isRawStatus(value: unknown): value is TaskStatus | 'completed' {
  return typeof value === 'string' && (WRITABLE_STATUSES.has(value) || value === 'completed');
}

function isTerminalRawStatus(status: TaskStatus | 'completed'): boolean {
  return status === 'completed' || isTerminalTaskStatus(status);
}

export function planRawCodeTaskLifecycle(doc: RawFirestoreDocument): TaskLifecycleBackfillPlan {
  const statusValue = doc.data['status'];
  if (!isRawStatus(statusValue)) {
    return { docId: doc.id, outcome: 'invalid', reason: 'status_invalid' };
  }

  const statusChangedPresent = hasOwn(doc.data, 'statusChangedAt');
  if (
    statusChangedPresent &&
    normalizeTaskLifecycleTimestamp(doc.data['statusChangedAt']) === undefined
  ) {
    return { docId: doc.id, outcome: 'invalid', reason: 'status_changed_at_invalid' };
  }

  const completedPresent = hasOwn(doc.data, 'completedAt');
  if (completedPresent && normalizeTaskLifecycleTimestamp(doc.data['completedAt']) === undefined) {
    return { docId: doc.id, outcome: 'invalid', reason: 'completed_at_invalid' };
  }

  let resolved;
  try {
    resolved = resolveTaskLifecycleTime({
      ...doc.data,
      status: statusValue,
    } as Parameters<typeof resolveTaskLifecycleTime>[0]);
  } catch {
    return { docId: doc.id, outcome: 'invalid', reason: 'lifecycle_unresolvable' };
  }

  const terminal = isTerminalRawStatus(statusValue);
  const update: { statusChangedAt?: Timestamp; completedAt?: Timestamp } = {};
  if (!statusChangedPresent) update.statusChangedAt = resolved.at;
  if (terminal && !completedPresent) update.completedAt = resolved.at;
  const activeCompletedAtAnomaly = isActiveTaskStatus(statusValue as TaskStatus) && completedPresent;

  if (Object.keys(update).length === 0) {
    return {
      docId: doc.id,
      outcome: 'skip',
      source: resolved.source,
      terminal,
      activeCompletedAtAnomaly,
    };
  }
  return {
    docId: doc.id,
    outcome: 'change',
    source: resolved.source,
    terminal,
    activeCompletedAtAnomaly,
    update,
  };
}

function emptySources(): Record<TaskLifecycleTimeSource, number> {
  return Object.fromEntries(LIFECYCLE_SOURCES.map((source) => [source, 0])) as Record<
    TaskLifecycleTimeSource,
    number
  >;
}

function emptyTaskReport(): TaskLifecycleBackfillReport {
  return {
    scanned: 0,
    changed: 0,
    skipped: 0,
    invalid: 0,
    deleted: 0,
    statusChangedAtAdded: 0,
    completedAtAdded: 0,
    activeCompletedAtAnomalies: 0,
    sources: emptySources(),
    invalidReasons: {},
    cursor: null,
    limitReached: false,
  };
}

function addTaskPlan(report: TaskLifecycleBackfillReport, plan: TaskLifecycleBackfillPlan): void {
  report.scanned++;
  if (plan.outcome === 'invalid') {
    report.invalid++;
    report.invalidReasons[plan.reason] = (report.invalidReasons[plan.reason] ?? 0) + 1;
    return;
  }
  report.sources[plan.source]++;
  if (plan.activeCompletedAtAnomaly) report.activeCompletedAtAnomalies++;
  if (plan.outcome === 'skip') {
    report.skipped++;
    return;
  }
  report.changed++;
  if (plan.update.statusChangedAt !== undefined) report.statusChangedAtAdded++;
  if (plan.update.completedAt !== undefined) report.completedAtAdded++;
}

export function aggregateTaskLifecyclePlans(
  plans: readonly TaskLifecycleBackfillPlan[],
): TaskLifecycleBackfillReport {
  const report = emptyTaskReport();
  for (const plan of plans) addTaskPlan(report, plan);
  return report;
}

function parsePositiveInteger(raw: string | undefined, errorCode: string, maximum?: number): number {
  if (raw === undefined || !/^\d+$/u.test(raw)) throw new LifecycleBackfillSafetyError(errorCode);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum !== undefined && value > maximum)) {
    throw new LifecycleBackfillSafetyError(errorCode);
  }
  return value;
}

export function parseLifecycleBackfillArgs(argv: readonly string[]): LifecycleBackfillOptions {
  let mode: LifecycleBackfillMode = 'dry-run';
  let explicitMode: LifecycleBackfillMode | undefined;
  let projectId: string | undefined;
  let phase: LifecycleBackfillPhase = 'all';
  let cursor: string | undefined;
  let pageSize = DEFAULT_PAGE_SIZE;
  let limit: number | undefined;
  const seen = new Set<string>();

  for (const arg of argv) {
    const equalsAt = arg.indexOf('=');
    const name = equalsAt === -1 ? arg : arg.slice(0, equalsAt);
    const value = equalsAt === -1 ? undefined : arg.slice(equalsAt + 1);
    if (seen.has(name)) throw new LifecycleBackfillSafetyError('DUPLICATE_FLAG');
    seen.add(name);

    switch (name) {
      case '--apply':
      case '--dry-run': {
        if (value !== undefined) throw new LifecycleBackfillSafetyError('INVALID_MODE_FLAG');
        const nextMode = name === '--apply' ? 'apply' : 'dry-run';
        if (explicitMode !== undefined && explicitMode !== nextMode) {
          throw new LifecycleBackfillSafetyError('MODE_CONFLICT');
        }
        explicitMode = nextMode;
        mode = nextMode;
        break;
      }
      case '--project':
        if (value === undefined || value.length === 0) {
          throw new LifecycleBackfillSafetyError('PROJECT_REQUIRED');
        }
        projectId = value;
        break;
      case '--phase':
        if (value !== 'all' && value !== 'tasks' && value !== 'summaries') {
          throw new LifecycleBackfillSafetyError('PHASE_INVALID');
        }
        phase = value;
        break;
      case '--cursor':
        if (value === undefined || value.trim().length === 0 || value.includes('/')) {
          throw new LifecycleBackfillSafetyError('CURSOR_INVALID');
        }
        cursor = value;
        break;
      case '--page-size':
        pageSize = parsePositiveInteger(value, 'PAGE_SIZE_INVALID', 200);
        break;
      case '--limit':
        limit = parsePositiveInteger(value, 'LIMIT_INVALID');
        break;
      default:
        throw new LifecycleBackfillSafetyError('UNKNOWN_FLAG');
    }
  }

  if (projectId === undefined) throw new LifecycleBackfillSafetyError('PROJECT_REQUIRED');
  if (projectId !== EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID) {
    throw new LifecycleBackfillSafetyError('PROJECT_MISMATCH');
  }
  if (phase === 'all' && cursor !== undefined) {
    throw new LifecycleBackfillSafetyError('CURSOR_REQUIRES_SINGLE_PHASE');
  }

  return {
    mode,
    phase,
    projectId,
    pageSize,
    ...(cursor !== undefined && { cursor }),
    ...(limit !== undefined && { limit }),
  };
}

export async function validateLifecycleBackfillEnvironment(
  input: { projectId: string },
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string, encoding: 'utf8') => Promise<string>,
): Promise<{ keyFilename: string }> {
  for (const [key, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      value.trim().length > 0 &&
      (key === 'FIREBASE_EMULATOR_HUB' || key.endsWith('_EMULATOR_HOST'))
    ) {
      throw new LifecycleBackfillSafetyError('EMULATOR_CONFIGURED');
    }
  }

  const keyFilename = env['GOOGLE_APPLICATION_CREDENTIALS'];
  if (keyFilename === undefined || keyFilename.trim().length === 0) {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_REQUIRED');
  }

  let raw: string;
  try {
    raw = await readFile(keyFilename, 'utf8');
  } catch {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_UNREADABLE');
  }
  let credentials: unknown;
  try {
    credentials = JSON.parse(raw) as unknown;
  } catch {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_INVALID_JSON');
  }
  if (typeof credentials !== 'object' || credentials === null) {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_NOT_SERVICE_ACCOUNT');
  }
  const record = credentials as Record<string, unknown>;
  if (record['type'] !== 'service_account') {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_NOT_SERVICE_ACCOUNT');
  }
  if (record['project_id'] !== input.projectId) {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_PROJECT_MISMATCH');
  }
  if (typeof record['client_email'] !== 'string' || record['client_email'].length === 0) {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_CLIENT_EMAIL_INVALID');
  }
  return { keyFilename };
}

async function* scanRawCollection(
  firestore: Firestore,
  collectionName: string,
  pageSize: number,
  initialCursor?: string,
): AsyncGenerator<RawFirestoreDocument> {
  let cursor = initialCursor;
  for (;;) {
    let query: Query = firestore.collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return;
    for (const doc of snapshot.docs) {
      yield { id: doc.id, data: doc.data() as Record<string, unknown> };
    }
    if (snapshot.size < pageSize) return;
    cursor = snapshot.docs[snapshot.docs.length - 1]?.id;
  }
}

function rawDocumentSnapshot(doc: QueryDocumentSnapshot): RawFirestoreDocument {
  return { id: doc.id, data: doc.data() as Record<string, unknown> };
}

export async function runTaskLifecycleBackfillPhase(input: {
  firestore: Firestore;
  mode: LifecycleBackfillMode;
  pageSize: number;
  cursor?: string;
  limit?: number;
}): Promise<TaskLifecycleBackfillReport> {
  const report = emptyTaskReport();
  report.cursor = input.cursor ?? null;
  let durableCursor = input.cursor;
  try {
    for await (const scanned of scanRawCollection(
      input.firestore,
      TASKS_COLLECTION,
      input.pageSize,
      input.cursor,
    )) {
      if (input.limit !== undefined && report.scanned >= input.limit) break;

      let outcome: TaskLifecycleBackfillPlan | { outcome: 'deleted'; docId: string };
      if (input.mode === 'dry-run') {
        outcome = planRawCodeTaskLifecycle(scanned);
      } else {
        try {
          outcome = await input.firestore.runTransaction(async (tx) => {
            const ref = input.firestore.collection(TASKS_COLLECTION).doc(scanned.id);
            const snapshot = await tx.get(ref);
            if (!snapshot.exists) return { outcome: 'deleted' as const, docId: scanned.id };
            const plan = planRawCodeTaskLifecycle(rawDocumentSnapshot(snapshot as QueryDocumentSnapshot));
            if (plan.outcome === 'change') {
              tx.update(ref, plan.update);
            }
            return plan;
          });
        } catch (error) {
          throw new LifecycleBackfillRunError(
            'TASK_TRANSACTION_FAILED',
            durableCursor,
            getErrorMessage(error instanceof Error ? error : undefined, 'Task transaction failed'),
          );
        }
      }

      if (outcome.outcome === 'deleted') {
        report.scanned++;
        report.deleted++;
      } else {
        addTaskPlan(report, outcome);
      }
      durableCursor = scanned.id;
      report.cursor = scanned.id;
    }
  } catch (error) {
    if (error instanceof LifecycleBackfillRunError) throw error;
    throw new LifecycleBackfillRunError(
      'TASK_SCAN_FAILED',
      durableCursor,
      getErrorMessage(error instanceof Error ? error : undefined, 'Task scan failed'),
    );
  }
  report.limitReached = input.limit !== undefined && report.scanned >= input.limit;
  return report;
}

interface RawGroup {
  userId: string;
  groupKey: string;
  tasks: RawFirestoreDocument[];
  nonAskTasks: RawFirestoreDocument[];
}

export type SummaryReconciliationItem =
  | {
    kind: 'upsert';
    reason: 'missing' | 'semantic_mismatch';
    docId: string;
    userId: string;
    groupKey: string;
    expected: TaskGroupSummary;
  }
  | { kind: 'unchanged'; docId: string; userId: string; groupKey: string }
  | { kind: 'delete_ask_only'; docId: string; userId: string; groupKey: string }
  | { kind: 'ask_only_without_summary'; docId: string; userId: string; groupKey: string }
  | { kind: 'unknown_orphan'; docId: string; userId: string; groupKey: string }
  | { kind: 'invalid'; docId: string; reason: string };

export interface SummaryReconciliationPlan {
  scannedSourceTasks: number;
  rawGroups: number;
  authoritativeGroups: number;
  askOnlyGroups: number;
  scannedSummaries: number;
  missingSummaries: number;
  semanticUpdates: number;
  unchangedSummaries: number;
  askOnlyOrphans: number;
  unknownOrphans: number;
  invalid: number;
  summariesWithLabels: number;
  importantSummaries: number;
  maxGroupSize: number;
  items: SummaryReconciliationItem[];
}

function groupIdentity(doc: RawFirestoreDocument): { userId: string; groupKey: string } | undefined {
  const userId = doc.data['userId'];
  if (typeof userId !== 'string' || userId.length === 0) return undefined;
  const linearIssueId = doc.data['linearIssueId'];
  if (linearIssueId === undefined) return { userId, groupKey: `standalone_${doc.id}` };
  if (typeof linearIssueId !== 'string' || linearIssueId.length === 0) return undefined;
  return { userId, groupKey: linearIssueId };
}

function rawTaskCanBeSummarized(doc: RawFirestoreDocument): boolean {
  const agentType = doc.data['agentType'];
  return groupIdentity(doc) !== undefined &&
    planRawCodeTaskLifecycle(doc).outcome !== 'invalid' &&
    normalizeTaskLifecycleTimestamp(doc.data['createdAt']) !== undefined &&
    normalizeTaskLifecycleTimestamp(doc.data['updatedAt']) !== undefined &&
    (agentType === undefined || (typeof agentType === 'string' && AGENT_TYPES.has(agentType)));
}

function identityKey(userId: string, groupKey: string): string {
  return JSON.stringify([userId, groupKey]);
}

function summaryDocumentId(userId: string, groupKey: string): string {
  return `${userId}_${groupKey}`;
}

function validateRawSummary(
  doc: RawFirestoreDocument,
): { userId: string; groupKey: string } | undefined {
  const userId = doc.data['userId'];
  const groupKey = doc.data['groupKey'];
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof groupKey !== 'string' ||
    groupKey.length === 0 ||
    doc.id !== summaryDocumentId(userId, groupKey)
  ) return undefined;
  if (
    hasOwn(doc.data, 'aggregateStatus') &&
    !['active', 'needs-action', 'done', 'failed', 'archived'].includes(String(doc.data['aggregateStatus']))
  ) return undefined;
  for (const field of ['hasImplementationReadyLabel', 'hasMergeReadyLabel', 'isImportant']) {
    if (hasOwn(doc.data, field) && typeof doc.data[field] !== 'boolean') return undefined;
  }
  if (
    hasOwn(doc.data, 'labelsUpdatedAt') &&
    normalizeTaskLifecycleTimestamp(doc.data['labelsUpdatedAt']) === undefined
  ) return undefined;
  return { userId, groupKey };
}

function hydrateRawTask(doc: RawFirestoreDocument): CodeTask {
  return fromFirestoreDoc({ id: doc.id, data: () => doc.data });
}

function preserveUserOwnedSummaryState(
  current: Record<string, unknown>,
  expected: TaskGroupSummary,
): TaskGroupSummary {
  const preserved = { ...expected };
  if (hasOwn(current, 'hasImplementationReadyLabel')) {
    preserved.hasImplementationReadyLabel = current['hasImplementationReadyLabel'] as boolean;
  }
  if (hasOwn(current, 'hasMergeReadyLabel')) {
    preserved.hasMergeReadyLabel = current['hasMergeReadyLabel'] as boolean;
  }
  if (hasOwn(current, 'labelsUpdatedAt')) {
    preserved.labelsUpdatedAt = current['labelsUpdatedAt'] as Timestamp;
  }
  if (hasOwn(current, 'isImportant')) {
    preserved.isImportant = current['isImportant'] as boolean;
  }
  preserved.aggregateStatus = deriveAggregateStatusFromSummary(preserved);
  return preserved;
}

function stableValue(value: unknown): unknown {
  if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
  );
}

function summariesSemanticallyEqual(
  current: Record<string, unknown>,
  expected: TaskGroupSummary,
): boolean {
  const { updatedAt: _currentUpdatedAt, ...currentSemantic } = current;
  const { updatedAt: _expectedUpdatedAt, ...expectedSemantic } = expected;
  return JSON.stringify(stableValue(currentSemantic)) === JSON.stringify(stableValue(expectedSemantic));
}

function computeExpectedSummary(
  group: RawGroup,
  current: Record<string, unknown> | undefined,
  now: Timestamp,
): TaskGroupSummary {
  const tasks = group.nonAskTasks.map(hydrateRawTask);
  const allArchived = tasks.every((task) => task.status === 'archived');
  const computed = (allArchived
    ? computeAllArchivedSummaryFromTasks(group.userId, group.groupKey, tasks, now)
    : computeSummaryFromTasks(group.userId, group.groupKey, tasks, now)) as TaskGroupSummary;
  computed.aggregateStatus = deriveAggregateStatusFromSummary(computed);
  return current === undefined ? computed : preserveUserOwnedSummaryState(current, computed);
}

export function buildSummaryReconciliationPlan(
  taskDocs: readonly RawFirestoreDocument[],
  summaryDocs: readonly RawFirestoreDocument[],
  now: Timestamp,
): SummaryReconciliationPlan {
  const groups = new Map<string, RawGroup>();
  const invalidItems: SummaryReconciliationItem[] = [];
  let invalid = 0;
  for (const task of taskDocs) {
    const identity = groupIdentity(task);
    if (identity === undefined || !rawTaskCanBeSummarized(task)) {
      invalidItems.push({ kind: 'invalid', docId: task.id, reason: 'source_task_invalid' });
      invalid++;
      continue;
    }
    const key = identityKey(identity.userId, identity.groupKey);
    const group = groups.get(key) ?? { ...identity, tasks: [], nonAskTasks: [] };
    group.tasks.push(task);
    if (task.data['agentType'] !== 'ask_agent') group.nonAskTasks.push(task);
    groups.set(key, group);
  }

  const validSummaries = new Map<
    string,
    { doc: RawFirestoreDocument; identity: { userId: string; groupKey: string } }
  >();
  for (const summary of summaryDocs) {
    const identity = validateRawSummary(summary);
    if (identity === undefined || validSummaries.has(identityKey(identity.userId, identity.groupKey))) {
      invalidItems.push({ kind: 'invalid', docId: summary.id, reason: 'summary_invalid' });
      invalid++;
      continue;
    }
    validSummaries.set(identityKey(identity.userId, identity.groupKey), { doc: summary, identity });
  }

  const items: SummaryReconciliationItem[] = [...invalidItems];
  let authoritativeGroups = 0;
  let askOnlyGroups = 0;
  let missingSummaries = 0;
  let semanticUpdates = 0;
  let unchangedSummaries = 0;
  let askOnlyOrphans = 0;
  let unknownOrphans = 0;

  for (const [key, group] of groups) {
    const currentEntry = validSummaries.get(key);
    const current = currentEntry?.doc;
    validSummaries.delete(key);
    const docId = summaryDocumentId(group.userId, group.groupKey);
    if (group.nonAskTasks.length === 0) {
      askOnlyGroups++;
      if (current === undefined) {
        items.push({ kind: 'ask_only_without_summary', docId, userId: group.userId, groupKey: group.groupKey });
      } else {
        askOnlyOrphans++;
        items.push({ kind: 'delete_ask_only', docId, userId: group.userId, groupKey: group.groupKey });
      }
      continue;
    }

    authoritativeGroups++;
    const expected = computeExpectedSummary(group, current?.data, now);
    if (current === undefined) {
      missingSummaries++;
      items.push({
        kind: 'upsert', reason: 'missing', docId,
        userId: group.userId, groupKey: group.groupKey, expected,
      });
    } else if (summariesSemanticallyEqual(current.data, expected)) {
      unchangedSummaries++;
      items.push({ kind: 'unchanged', docId, userId: group.userId, groupKey: group.groupKey });
    } else {
      semanticUpdates++;
      items.push({
        kind: 'upsert', reason: 'semantic_mismatch', docId,
        userId: group.userId, groupKey: group.groupKey, expected,
      });
    }
  }

  for (const { doc: summary, identity } of validSummaries.values()) {
    unknownOrphans++;
    items.push({
      kind: 'unknown_orphan',
      docId: summary.id,
      userId: identity.userId,
      groupKey: identity.groupKey,
    });
  }
  items.sort((left, right) => left.docId.localeCompare(right.docId));

  return {
    scannedSourceTasks: taskDocs.length,
    rawGroups: groups.size,
    authoritativeGroups,
    askOnlyGroups,
    scannedSummaries: summaryDocs.length,
    missingSummaries,
    semanticUpdates,
    unchangedSummaries,
    askOnlyOrphans,
    unknownOrphans,
    invalid,
    summariesWithLabels: summaryDocs.filter((doc) =>
      hasOwn(doc.data, 'hasImplementationReadyLabel') ||
      hasOwn(doc.data, 'hasMergeReadyLabel') ||
      hasOwn(doc.data, 'labelsUpdatedAt'),
    ).length,
    importantSummaries: summaryDocs.filter((doc) => doc.data['isImportant'] === true).length,
    maxGroupSize: Math.max(0, ...Array.from(groups.values(), (group) => group.tasks.length)),
    items,
  };
}

function rawTaskMatchesGroup(
  task: RawFirestoreDocument,
  userId: string,
  groupKey: string,
): boolean {
  const identity = groupIdentity(task);
  return identity?.userId === userId && identity.groupKey === groupKey;
}

async function loadExactRawGroupTasks(
  tx: Transaction,
  firestore: Firestore,
  userId: string,
  groupKey: string,
): Promise<RawFirestoreDocument[]> {
  if (groupKey.startsWith('standalone_')) {
    const taskId = groupKey.slice('standalone_'.length);
    const snapshot = await tx.get(firestore.collection(TASKS_COLLECTION).doc(taskId));
    if (!snapshot.exists) return [];
    return [{ id: snapshot.id, data: snapshot.data() as Record<string, unknown> }];
  }
  const snapshot = await tx.get(
    firestore.collection(TASKS_COLLECTION)
      .where('userId', '==', userId)
      .where('linearIssueId', '==', groupKey),
  );
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
}

function countsAreValid(raw: Record<string, unknown>, userId: string): boolean {
  if (raw['userId'] !== userId) return false;
  return ['active', 'needsAction', 'done', 'failed', 'archived', 'totalGroups'].every((field) =>
    Number.isSafeInteger(raw[field]) && Number(raw[field]) >= 0,
  );
}

type AppliedSummaryOutcome =
  | { kind: 'changed'; reason: 'missing' | 'semantic_mismatch' }
  | { kind: 'unchanged' }
  | { kind: 'invalid' };

async function applyAuthoritativeSummary(
  firestore: Firestore,
  item: Extract<SummaryReconciliationItem, { kind: 'upsert' | 'unchanged' }>,
  now: () => Timestamp,
): Promise<AppliedSummaryOutcome> {
  return await firestore.runTransaction(async (tx) => {
    const rawTasks = await loadExactRawGroupTasks(tx, firestore, item.userId, item.groupKey);
    if (
      rawTasks.length === 0 ||
      rawTasks.some((task) => !rawTaskMatchesGroup(task, item.userId, item.groupKey)) ||
      rawTasks.some((task) => !rawTaskCanBeSummarized(task))
    ) return { kind: 'invalid' as const };
    const nonAskTasks = rawTasks.filter((task) => task.data['agentType'] !== 'ask_agent');
    if (nonAskTasks.length === 0) return { kind: 'invalid' as const };

    const summaryRef = summaryDocRef(firestore, item.userId, item.groupKey);
    const countsRef = countsDocRef(firestore, item.userId);
    const [summarySnapshot, countsSnapshot] = await Promise.all([
      tx.get(summaryRef),
      tx.get(countsRef),
    ]);
    const currentRaw = summarySnapshot.exists
      ? summarySnapshot.data() as Record<string, unknown>
      : undefined;
    if (
      currentRaw !== undefined &&
      validateRawSummary({ id: summarySnapshot.id, data: currentRaw }) === undefined
    ) return { kind: 'invalid' as const };
    if (!countsSnapshot.exists) return { kind: 'invalid' as const };
    const countsRaw = countsSnapshot.data() as Record<string, unknown>;
    if (!countsAreValid(countsRaw, item.userId)) {
      return { kind: 'invalid' as const };
    }

    const capturedNow = now();
    const group: RawGroup = {
      userId: item.userId,
      groupKey: item.groupKey,
      tasks: rawTasks,
      nonAskTasks,
    };
    const expected = computeExpectedSummary(group, currentRaw, capturedNow);
    if (currentRaw !== undefined && summariesSemanticallyEqual(currentRaw, expected)) {
      return { kind: 'unchanged' as const };
    }

    const counts = docToCounts(countsRaw);
    tx.set(summaryRef, expected as unknown as DocumentData);
    let updatedCounts: UserGroupCounts | undefined;
    let reason: 'missing' | 'semantic_mismatch';
    if (currentRaw === undefined) {
      reason = 'missing';
      updatedCounts = applyNewGroupDelta(counts, expected.aggregateStatus);
    } else {
      reason = 'semantic_mismatch';
      const current = docToSummary(currentRaw);
      if (current.aggregateStatus !== expected.aggregateStatus) {
        updatedCounts = applyStatusChangeDelta(counts, current.aggregateStatus, expected.aggregateStatus);
      }
    }
    if (updatedCounts !== undefined) {
      tx.set(countsRef, {
        ...updatedCounts,
        userId: item.userId,
        updatedAt: capturedNow,
      } as unknown as DocumentData);
    }
    return { kind: 'changed' as const, reason };
  });
}

export interface SummaryLifecycleBackfillReport {
  scannedSourceTasks: number;
  rawGroups: number;
  authoritativeGroups: number;
  askOnlyGroups: number;
  scannedSummaries: number;
  processed: number;
  changed: number;
  unchanged: number;
  deleted: number;
  missingSummaries: number;
  semanticUpdates: number;
  askOnlyOrphans: number;
  unknownOrphans: number;
  invalid: number;
  summariesWithLabels: number;
  importantSummaries: number;
  maxGroupSize: number;
  cursor: string | null;
  limitReached: boolean;
}

function createMaintenanceSummaryRepository(
  firestore: Firestore,
): LifecycleBackfillTaskGroupSummaryRepository {
  /* v8 ignore start -- test-infra: FakeFirestore cannot exercise discarded diagnostics without violating the structured-output-only contract @preserve */
  const logger = {
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
    debug: (): void => undefined,
  };
  /* v8 ignore stop @preserve */
  return createTaskGroupSummaryFirestoreRepository({ firestore, logger });
}

export async function runSummaryLifecycleBackfillPhase(input: {
  firestore: Firestore;
  mode: LifecycleBackfillMode;
  pageSize: number;
  cursor?: string;
  limit?: number;
  now?: () => Timestamp;
  summaryRepository?: LifecycleBackfillTaskGroupSummaryRepository;
}): Promise<SummaryLifecycleBackfillReport> {
  const now = input.now ?? ((): Timestamp => Timestamp.now());
  const taskDocs: RawFirestoreDocument[] = [];
  const summaryDocs: RawFirestoreDocument[] = [];
  try {
    for await (const doc of scanRawCollection(input.firestore, TASKS_COLLECTION, input.pageSize)) {
      taskDocs.push(doc);
    }
    for await (const doc of scanRawCollection(input.firestore, SUMMARIES_COLLECTION, input.pageSize)) {
      summaryDocs.push(doc);
    }
  } catch (error) {
    throw new LifecycleBackfillRunError(
      'SUMMARY_SCAN_FAILED',
      input.cursor,
      getErrorMessage(error instanceof Error ? error : undefined, 'Summary scan failed'),
    );
  }
  const plan = buildSummaryReconciliationPlan(taskDocs, summaryDocs, now());
  const selected = plan.items.filter((item) =>
    input.cursor === undefined || item.docId.localeCompare(input.cursor) > 0,
  );
  const bounded = input.limit === undefined ? selected : selected.slice(0, input.limit);
  const repository = input.summaryRepository ?? createMaintenanceSummaryRepository(input.firestore);
  const report: SummaryLifecycleBackfillReport = {
    scannedSourceTasks: plan.scannedSourceTasks,
    rawGroups: plan.rawGroups,
    authoritativeGroups: plan.authoritativeGroups,
    askOnlyGroups: plan.askOnlyGroups,
    scannedSummaries: plan.scannedSummaries,
    processed: 0,
    changed: 0,
    unchanged: 0,
    deleted: 0,
    missingSummaries: 0,
    semanticUpdates: 0,
    askOnlyOrphans: 0,
    unknownOrphans: 0,
    invalid: 0,
    summariesWithLabels: plan.summariesWithLabels,
    importantSummaries: plan.importantSummaries,
    maxGroupSize: plan.maxGroupSize,
    cursor: input.cursor ?? null,
    limitReached: input.limit !== undefined && bounded.length >= input.limit,
  };
  let durableCursor = input.cursor;

  for (const item of bounded) {
    try {
      if (item.kind === 'invalid') {
        report.invalid++;
      } else if (item.kind === 'unknown_orphan') {
        report.unknownOrphans++;
      } else if (item.kind === 'ask_only_without_summary') {
        report.unchanged++;
      } else if (item.kind === 'unchanged' && input.mode === 'dry-run') {
        report.unchanged++;
      } else if (item.kind === 'delete_ask_only') {
        report.askOnlyOrphans++;
        if (input.mode === 'dry-run') {
          report.changed++;
        } else {
          const removal = await repository.removeAskOnlyOrphan(item.userId, item.groupKey);
          if (!removal.ok) throw new Error(removal.error.message);
          if (removal.value === 'removed') {
            report.changed++;
            report.deleted++;
          } else if (removal.value === 'summary_missing') {
            report.unchanged++;
          } else {
            report.invalid++;
          }
        }
      } else if (item.kind === 'upsert' && input.mode === 'dry-run') {
        report.changed++;
        if (item.reason === 'missing') report.missingSummaries++;
        else report.semanticUpdates++;
      } else {
        const outcome = await applyAuthoritativeSummary(input.firestore, item, now);
        if (outcome.kind === 'invalid') {
          report.invalid++;
        } else if (outcome.kind === 'unchanged') {
          report.unchanged++;
        } else {
          report.changed++;
          if (outcome.reason === 'missing') report.missingSummaries++;
          else report.semanticUpdates++;
        }
      }
    } catch (error) {
      throw new LifecycleBackfillRunError(
        'SUMMARY_TRANSACTION_FAILED',
        durableCursor,
        getErrorMessage(error instanceof Error ? error : undefined, 'Summary transaction failed'),
      );
    }
    report.processed++;
    durableCursor = item.docId;
    report.cursor = item.docId;
  }
  return report;
}

export interface CodeTaskLifecycleBackfillReport {
  mode: LifecycleBackfillMode;
  phase: LifecycleBackfillPhase;
  projectId: string;
  tasks?: TaskLifecycleBackfillReport;
  summaries?: SummaryLifecycleBackfillReport;
}

export async function runCodeTaskLifecycleBackfill(
  input: LifecycleBackfillOptions & {
    firestore: Firestore;
    now?: () => Timestamp;
    summaryRepository?: LifecycleBackfillTaskGroupSummaryRepository;
  },
): Promise<CodeTaskLifecycleBackfillReport> {
  const report: CodeTaskLifecycleBackfillReport = {
    mode: input.mode,
    phase: input.phase,
    projectId: input.projectId,
  };
  if (input.phase === 'all' || input.phase === 'tasks') {
    report.tasks = await runTaskLifecycleBackfillPhase({
      firestore: input.firestore,
      mode: input.mode,
      pageSize: input.pageSize,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      ...(input.limit !== undefined && { limit: input.limit }),
    });
  }
  if (input.phase === 'all' || input.phase === 'summaries') {
    report.summaries = await runSummaryLifecycleBackfillPhase({
      firestore: input.firestore,
      mode: input.mode,
      pageSize: input.pageSize,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.now !== undefined && { now: input.now }),
      ...(input.summaryRepository !== undefined && { summaryRepository: input.summaryRepository }),
    });
  }
  return report;
}
