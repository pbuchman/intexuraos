import { FieldPath, Timestamp } from '@google-cloud/firestore';
import { createHash } from 'node:crypto';
import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import { createAppLogger } from '@intexuraos/infra-sentry';
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
import type { GroupStatus } from '../../domain/issueGrouping/types.js';
import type {
  LifecycleBackfillTaskGroupSummaryRepository,
} from '../../domain/ports/taskGroupSummaryRepository.js';
import type { TaskGroupSummary, UserGroupCounts } from '../../domain/models/taskGroupSummary.js';
import { fromFirestoreDoc } from '../../infra/firestore/task-serializer.js';
import { resolveCompletedTaskStatus } from '../../domain/utils/resolveCompletedTaskStatus.js';
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
const COUNTS_COLLECTION = 'user_group_counts';
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

export class LifecycleBackfillAuditError extends Error {
  readonly code = 'AUDIT_FINDINGS';
  readonly report: Record<string, unknown>;

  constructor(report: Record<string, unknown>) {
    super('AUDIT_FINDINGS');
    this.name = 'LifecycleBackfillAuditError';
    this.report = report;
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
): Promise<{ credentials: { client_email: string; private_key: string } }> {
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
  if (typeof record['client_email'] !== 'string' || record['client_email'].trim().length === 0) {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_CLIENT_EMAIL_INVALID');
  }
  if (typeof record['private_key'] !== 'string' || record['private_key'].trim().length === 0) {
    throw new LifecycleBackfillSafetyError('CREDENTIALS_PRIVATE_KEY_INVALID');
  }
  return {
    credentials: {
      client_email: record['client_email'].trim(),
      private_key: record['private_key'].trim(),
    },
  };
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
  let hasMore = false;
  try {
    for await (const scanned of scanRawCollection(
      input.firestore,
      TASKS_COLLECTION,
      input.pageSize,
      input.cursor,
    )) {
      if (input.limit !== undefined && report.scanned >= input.limit) {
        hasMore = true;
        break;
      }

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
      if (input.mode === 'apply' && outcome.outcome === 'invalid') break;
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
  report.limitReached = hasMore;
  return report;
}

interface RawGroup {
  userId: string;
  groupKey: string;
  tasks: RawFirestoreDocument[];
  nonAskTasks: RawFirestoreDocument[];
  invalidSource: boolean;
}

interface SummaryItemBase {
  workKey: string;
  docId: string;
}

export type SummaryReconciliationItem =
  | SummaryItemBase & {
    kind: 'upsert';
    reason: 'missing' | 'semantic_mismatch';
    userId: string;
    groupKey: string;
    expected: TaskGroupSummary;
  }
  | SummaryItemBase & { kind: 'unchanged'; userId: string; groupKey: string }
  | SummaryItemBase & { kind: 'delete_ask_only'; userId: string; groupKey: string }
  | SummaryItemBase & { kind: 'ask_only_without_summary'; userId: string; groupKey: string }
  | SummaryItemBase & { kind: 'unknown_orphan'; userId: string; groupKey: string }
  | SummaryItemBase & { kind: 'invalid'; reason: string };

export interface SummaryReconciliationPlan {
  scannedSourceTasks: number;
  rawGroups: number;
  authoritativeGroups: number;
  askOnlyGroups: number;
  scannedSummaries: number;
  scannedCounts: number;
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
  if (typeof userId !== 'string' || userId.trim().length === 0) return undefined;
  const linearIssueId = doc.data['linearIssueId'];
  if (linearIssueId === undefined) return { userId, groupKey: `standalone_${doc.id}` };
  if (typeof linearIssueId !== 'string' || linearIssueId.trim().length === 0) return undefined;
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

function groupWorkKey(userId: string, groupKey: string): string {
  return opaqueWorkKey('group', identityKey(userId, groupKey));
}

function standaloneWorkKey(kind: 'task' | 'summary' | 'counts', docId: string): string {
  return opaqueWorkKey(kind, docId);
}

function opaqueWorkKey(kind: string, value: string): string {
  const digest = createHash('sha256').update(`${kind}\0${value}`).digest('base64url');
  return `${kind}_${digest}`;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function rawSummaryIdentity(
  doc: RawFirestoreDocument,
): { userId: string; groupKey: string } | undefined {
  const userId = doc.data['userId'];
  const groupKey = doc.data['groupKey'];
  if (
    typeof userId !== 'string' ||
    userId.trim().length === 0 ||
    typeof groupKey !== 'string' ||
    groupKey.trim().length === 0
  ) return undefined;
  return { userId, groupKey };
}

function isGroupStatus(value: unknown): value is GroupStatus {
  return value === 'active' || value === 'needs-action' || value === 'done' ||
    value === 'failed' || value === 'archived';
}

function validateRawSummary(
  doc: RawFirestoreDocument,
): { userId: string; groupKey: string } | undefined {
  const identity = rawSummaryIdentity(doc);
  if (identity === undefined || doc.id !== summaryDocumentId(identity.userId, identity.groupKey)) {
    return undefined;
  }
  if (!hasOwn(doc.data, 'aggregateStatus') || !isGroupStatus(doc.data['aggregateStatus'])) {
    return undefined;
  }
  for (const field of ['hasImplementationReadyLabel', 'hasMergeReadyLabel', 'isImportant']) {
    if (hasOwn(doc.data, field) && typeof doc.data[field] !== 'boolean') return undefined;
  }
  if (
    hasOwn(doc.data, 'labelsUpdatedAt') &&
    normalizeTaskLifecycleTimestamp(doc.data['labelsUpdatedAt']) === undefined
  ) return undefined;
  return identity;
}

type GroupCountField = 'active' | 'needsAction' | 'done' | 'failed' | 'archived';

interface GroupCountVector extends Record<GroupCountField | 'totalGroups', number> {
  active: number;
  needsAction: number;
  done: number;
  failed: number;
  archived: number;
  totalGroups: number;
}

const COUNT_VECTOR_FIELDS = [
  'active', 'needsAction', 'done', 'failed', 'archived', 'totalGroups',
] as const;

function emptyGroupCountVector(): GroupCountVector {
  return { active: 0, needsAction: 0, done: 0, failed: 0, archived: 0, totalGroups: 0 };
}

const COUNT_BUCKET_BY_STATUS: Readonly<Record<GroupStatus, GroupCountField>> = {
  active: 'active',
  'needs-action': 'needsAction',
  done: 'done',
  failed: 'failed',
  archived: 'archived',
};

function addPhysicalSummaryToCounts(vector: GroupCountVector, status: GroupStatus): void {
  vector[COUNT_BUCKET_BY_STATUS[status]]++;
  vector.totalGroups++;
}

function buildPhysicalSummaryCountProof(
  summariesByDocumentId: ReadonlyMap<string, readonly RawFirestoreDocument[]>,
): {
  countsByUser: ReadonlyMap<string, GroupCountVector>;
  invalidUsers: ReadonlySet<string>;
} {
  const countsByUser = new Map<string, GroupCountVector>();
  const invalidUsers = new Set<string>();
  for (const entries of summariesByDocumentId.values()) {
    const identities = entries.flatMap((entry) => {
      const identity = rawSummaryIdentity(entry);
      return identity === undefined ? [] : [identity];
    });
    if (entries.length !== 1) {
      for (const identity of identities) invalidUsers.add(identity.userId);
      continue;
    }
    const entry = entries[0] as RawFirestoreDocument;
    const identity = validateRawSummary(entry);
    if (identity === undefined) {
      for (const candidate of identities) invalidUsers.add(candidate.userId);
      continue;
    }
    const vector = countsByUser.get(identity.userId) ?? emptyGroupCountVector();
    addPhysicalSummaryToCounts(vector, entry.data['aggregateStatus'] as GroupStatus);
    countsByUser.set(identity.userId, vector);
  }
  return { countsByUser, invalidUsers };
}

function reconstructExactPhysicalSummaryCounts(
  summaryDocs: readonly RawFirestoreDocument[],
  userId: string,
): GroupCountVector | undefined {
  const vector = emptyGroupCountVector();
  for (const summary of summaryDocs) {
    const identity = validateRawSummary(summary);
    if (identity?.userId !== userId) return undefined;
    addPhysicalSummaryToCounts(vector, summary.data['aggregateStatus'] as GroupStatus);
  }
  return vector;
}

function hydrateRawTask(doc: RawFirestoreDocument): CodeTask {
  const hydrated = fromFirestoreDoc({ id: doc.id, data: () => doc.data });
  if (doc.data['status'] !== 'completed') return hydrated;
  return {
    ...hydrated,
    status: resolveCompletedTaskStatus(hydrated.agentType),
  };
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
  countDocs: readonly RawFirestoreDocument[],
  now: Timestamp,
): SummaryReconciliationPlan {
  const groups = new Map<string, RawGroup>();
  const items: SummaryReconciliationItem[] = [];
  for (const task of taskDocs) {
    const identity = groupIdentity(task);
    if (identity === undefined) {
      items.push({
        kind: 'invalid',
        workKey: standaloneWorkKey('task', task.id),
        docId: task.id,
        reason: 'source_task_invalid',
      });
      continue;
    }
    const key = identityKey(identity.userId, identity.groupKey);
    const group = groups.get(key) ?? {
      ...identity,
      tasks: [],
      nonAskTasks: [],
      invalidSource: false,
    };
    group.tasks.push(task);
    if (!rawTaskCanBeSummarized(task)) group.invalidSource = true;
    else if (task.data['agentType'] !== 'ask_agent') group.nonAskTasks.push(task);
    groups.set(key, group);
  }

  const summariesByGroup = new Map<string, RawFirestoreDocument[]>();
  const summariesByDocumentId = new Map<string, RawFirestoreDocument[]>();
  for (const summary of summaryDocs) {
    const physicalEntries = summariesByDocumentId.get(summary.id) ?? [];
    physicalEntries.push(summary);
    summariesByDocumentId.set(summary.id, physicalEntries);
    const identity = rawSummaryIdentity(summary);
    if (identity === undefined) continue;
    const key = identityKey(identity.userId, identity.groupKey);
    const entries = summariesByGroup.get(key) ?? [];
    entries.push(summary);
    summariesByGroup.set(key, entries);
  }

  const countsByUser = new Map<string, RawFirestoreDocument[]>();
  for (const counts of countDocs) {
    const entries = countsByUser.get(counts.id) ?? [];
    entries.push(counts);
    countsByUser.set(counts.id, entries);
  }
  const physicalCountProof = buildPhysicalSummaryCountProof(summariesByDocumentId);
  const projectedCountsByUser = new Map<string, Record<string, unknown>>();
  for (const [userId, entries] of countsByUser) {
    const entry = entries[0] as RawFirestoreDocument;
    if (
      entries.length === 1 &&
      !physicalCountProof.invalidUsers.has(userId) &&
      countsMatchPhysicalSummaries(
        entry.data,
        userId,
        physicalCountProof.countsByUser.get(userId) ?? emptyGroupCountVector(),
      )
    ) {
      projectedCountsByUser.set(userId, { ...entry.data });
    }
  }

  let authoritativeGroups = 0;
  let askOnlyGroups = 0;
  let missingSummaries = 0;
  let semanticUpdates = 0;
  let unchangedSummaries = 0;
  let askOnlyOrphans = 0;
  let unknownOrphans = 0;
  const consumedPhysicalSummaryIds = new Set<string>();

  const orderedGroups = [...groups.entries()].sort((left, right) =>
    compareCodeUnits(
      groupWorkKey(left[1].userId, left[1].groupKey),
      groupWorkKey(right[1].userId, right[1].groupKey),
    ),
  );
  for (const [key, group] of orderedGroups) {
    const workKey = groupWorkKey(group.userId, group.groupKey);
    const docId = summaryDocumentId(group.userId, group.groupKey);
    const summaryEntries = summariesByGroup.get(key) ?? [];
    summariesByGroup.delete(key);
    const summary = summaryEntries[0];
    const physicalEntries = summariesByDocumentId.get(docId) ?? [];
    if (physicalEntries.length > 0) consumedPhysicalSummaryIds.add(docId);
    const summaryInvalid = summaryEntries.length > 1 ||
      (summary !== undefined && validateRawSummary(summary) === undefined) ||
      (physicalEntries.length > 0 && (
        physicalEntries.length !== 1 ||
        summaryEntries.length !== 1 ||
        physicalEntries[0] !== summaryEntries[0]
    ));
    const countEntries = countsByUser.get(group.userId) ?? [];
    const projectedCounts = projectedCountsByUser.get(group.userId);

    if (group.invalidSource) {
      items.push({ kind: 'invalid', workKey, docId, reason: 'source_task_invalid' });
      continue;
    }
    if (summaryInvalid) {
      items.push({ kind: 'invalid', workKey, docId, reason: 'summary_invalid' });
      continue;
    }
    if (
      countEntries.length !== 1 ||
      projectedCounts === undefined ||
      !countsAreStructurallyValid(projectedCounts, group.userId)
    ) {
      items.push({ kind: 'invalid', workKey, docId, reason: 'counts_invalid' });
      continue;
    }

    if (group.nonAskTasks.length === 0) {
      askOnlyGroups++;
      if (summary === undefined) {
        items.push({
          kind: 'ask_only_without_summary', workKey, docId,
          userId: group.userId, groupKey: group.groupKey,
        });
      } else {
        const currentStatus = summary.data['aggregateStatus'] as GroupStatus;
        askOnlyOrphans++;
        items.push({
          kind: 'delete_ask_only', workKey, docId,
          userId: group.userId, groupKey: group.groupKey,
        });
        projectDeleteCounts(projectedCounts, currentStatus);
      }
      continue;
    }

    let expected: TaskGroupSummary;
    try {
      expected = computeExpectedSummary(group, summary?.data, now);
    } catch {
      items.push({ kind: 'invalid', workKey, docId, reason: 'source_task_invalid' });
      continue;
    }
    if (summary === undefined) {
      authoritativeGroups++;
      missingSummaries++;
      items.push({
        kind: 'upsert', reason: 'missing', workKey, docId,
        userId: group.userId, groupKey: group.groupKey, expected,
      });
      projectIncrementCounts(projectedCounts, expected.aggregateStatus);
    } else if (summariesSemanticallyEqual(summary.data, expected)) {
      authoritativeGroups++;
      unchangedSummaries++;
      items.push({
        kind: 'unchanged', workKey, docId,
        userId: group.userId, groupKey: group.groupKey,
      });
    } else {
      const currentStatus = summary.data['aggregateStatus'] as GroupStatus;
      authoritativeGroups++;
      semanticUpdates++;
      items.push({
        kind: 'upsert', reason: 'semantic_mismatch', workKey, docId,
        userId: group.userId, groupKey: group.groupKey, expected,
      });
      if (currentStatus !== expected.aggregateStatus) {
        projectChangeCounts(projectedCounts, currentStatus, expected.aggregateStatus);
      }
    }
  }

  for (const [key, entries] of summariesByGroup) {
    const first = entries[0] as RawFirestoreDocument;
    const identity = rawSummaryIdentity(first) as { userId: string; groupKey: string };
    const workKey = groupWorkKey(identity.userId, identity.groupKey);
    const docId = first.id;
    if (entries.length > 1 || entries.some((entry) => validateRawSummary(entry) === undefined)) {
      items.push({ kind: 'invalid', workKey, docId, reason: 'summary_invalid' });
    } else {
      unknownOrphans++;
      items.push({
        kind: 'unknown_orphan', workKey, docId,
        userId: identity.userId, groupKey: identity.groupKey,
      });
    }
    summariesByGroup.delete(key);
  }

  for (const [docId, entries] of summariesByDocumentId) {
    if (consumedPhysicalSummaryIds.has(docId)) continue;
    if (entries.every((entry) => rawSummaryIdentity(entry) !== undefined)) continue;
    items.push({
      kind: 'invalid',
      workKey: standaloneWorkKey('summary', docId),
      docId,
      reason: 'summary_invalid',
    });
  }

  for (const [userId, entries] of countsByUser) {
    const countsValid = entries.length === 1 &&
      !physicalCountProof.invalidUsers.has(userId) &&
      countsMatchPhysicalSummaries(
        (entries[0] as RawFirestoreDocument).data,
        userId,
        physicalCountProof.countsByUser.get(userId) ?? emptyGroupCountVector(),
      );
    if (
      groupsHasUser(groups, userId) ||
      countsValid
    ) continue;
    items.push({
      kind: 'invalid',
      workKey: standaloneWorkKey('counts', userId),
      docId: userId,
      reason: 'counts_invalid',
    });
  }
  for (const userId of physicalCountProof.countsByUser.keys()) {
    if (countsByUser.has(userId) || groupsHasUser(groups, userId)) continue;
    items.push({
      kind: 'invalid',
      workKey: standaloneWorkKey('counts', userId),
      docId: userId,
      reason: 'counts_invalid',
    });
  }
  items.sort((left, right) => compareCodeUnits(left.workKey, right.workKey));

  return {
    scannedSourceTasks: taskDocs.length,
    rawGroups: groups.size,
    authoritativeGroups,
    askOnlyGroups,
    scannedSummaries: summaryDocs.length,
    scannedCounts: countDocs.length,
    missingSummaries,
    semanticUpdates,
    unchangedSummaries,
    askOnlyOrphans,
    unknownOrphans,
    invalid: items.filter((item) => item.kind === 'invalid').length,
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

function countsAreStructurallyValid(raw: Record<string, unknown>, userId: string): boolean {
  if (raw['userId'] !== userId) return false;
  const bucketFields = ['active', 'needsAction', 'done', 'failed', 'archived'] as const;
  let bucketTotal = 0;
  for (const field of bucketFields) {
    const value = raw[field];
    if (!Number.isSafeInteger(value) || Number(value) < 0) return false;
    bucketTotal += Number(value);
    if (!Number.isSafeInteger(bucketTotal)) return false;
  }
  const totalGroups = raw['totalGroups'];
  return Number.isSafeInteger(totalGroups) && Number(totalGroups) >= 0 &&
    bucketTotal === Number(totalGroups);
}

function countsMatchPhysicalSummaries(
  raw: Record<string, unknown>,
  userId: string,
  expected: GroupCountVector,
): boolean {
  return countsAreStructurallyValid(raw, userId) &&
    COUNT_VECTOR_FIELDS.every((field) => Number(raw[field]) === expected[field]);
}

function projectIncrementCounts(raw: Record<string, unknown>, status: GroupStatus): void {
  const field = COUNT_BUCKET_BY_STATUS[status];
  raw[field] = Number(raw[field]) + 1;
  raw['totalGroups'] = Number(raw['totalGroups']) + 1;
}

function projectDeleteCounts(raw: Record<string, unknown>, status: GroupStatus): void {
  const field = COUNT_BUCKET_BY_STATUS[status];
  raw[field] = Number(raw[field]) - 1;
  raw['totalGroups'] = Number(raw['totalGroups']) - 1;
}

function projectChangeCounts(
  raw: Record<string, unknown>,
  currentStatus: GroupStatus,
  expectedStatus: GroupStatus,
): void {
  const currentField = COUNT_BUCKET_BY_STATUS[currentStatus];
  const expectedField = COUNT_BUCKET_BY_STATUS[expectedStatus];
  raw[currentField] = Number(raw[currentField]) - 1;
  raw[expectedField] = Number(raw[expectedField]) + 1;
}

function groupsHasUser(groups: ReadonlyMap<string, RawGroup>, userId: string): boolean {
  for (const group of groups.values()) {
    if (group.userId === userId) return true;
  }
  return false;
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
    const [summarySnapshot, countsSnapshot, userSummariesSnapshot] = await Promise.all([
      tx.get(summaryRef),
      tx.get(countsRef),
      tx.get(
        firestore.collection(SUMMARIES_COLLECTION).where('userId', '==', item.userId),
      ),
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
    const physicalCounts = reconstructExactPhysicalSummaryCounts(
      userSummariesSnapshot.docs.map(rawDocumentSnapshot),
      item.userId,
    );
    if (
      physicalCounts === undefined ||
      !countsMatchPhysicalSummaries(countsRaw, item.userId, physicalCounts)
    ) {
      return { kind: 'invalid' as const };
    }

    const capturedNow = now();
    const group: RawGroup = {
      userId: item.userId,
      groupKey: item.groupKey,
      tasks: rawTasks,
      nonAskTasks,
      invalidSource: false,
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
  scannedCounts: number;
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
  logger: Logger,
): LifecycleBackfillTaskGroupSummaryRepository {
  return createTaskGroupSummaryFirestoreRepository({ firestore, logger });
}

export async function runSummaryLifecycleBackfillPhase(input: {
  firestore: Firestore;
  mode: LifecycleBackfillMode;
  pageSize: number;
  cursor?: string;
  limit?: number;
  now?: () => Timestamp;
  logger?: Logger;
  summaryRepository?: LifecycleBackfillTaskGroupSummaryRepository;
}): Promise<SummaryLifecycleBackfillReport> {
  const now = input.now ?? ((): Timestamp => Timestamp.now());
  const taskDocs: RawFirestoreDocument[] = [];
  const summaryDocs: RawFirestoreDocument[] = [];
  const countDocs: RawFirestoreDocument[] = [];
  try {
    for await (const doc of scanRawCollection(input.firestore, TASKS_COLLECTION, input.pageSize)) {
      taskDocs.push(doc);
    }
    for await (const doc of scanRawCollection(input.firestore, SUMMARIES_COLLECTION, input.pageSize)) {
      summaryDocs.push(doc);
    }
    for await (const doc of scanRawCollection(input.firestore, COUNTS_COLLECTION, input.pageSize)) {
      countDocs.push(doc);
    }
  } catch (error) {
    throw new LifecycleBackfillRunError(
      'SUMMARY_SCAN_FAILED',
      input.cursor,
      getErrorMessage(error instanceof Error ? error : undefined, 'Summary scan failed'),
    );
  }
  const plan = buildSummaryReconciliationPlan(taskDocs, summaryDocs, countDocs, now());
  const selected = plan.items.filter((item) =>
    input.cursor === undefined || compareCodeUnits(item.workKey, input.cursor) > 0,
  );
  const bounded = input.limit === undefined ? selected : selected.slice(0, input.limit);
  const report: SummaryLifecycleBackfillReport = {
    scannedSourceTasks: plan.scannedSourceTasks,
    scannedCounts: plan.scannedCounts,
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
    limitReached: selected.length > bounded.length,
  };

  if (input.mode === 'apply' && (plan.invalid > 0 || plan.unknownOrphans > 0)) {
    report.invalid = plan.invalid;
    report.unknownOrphans = plan.unknownOrphans;
    report.askOnlyOrphans = plan.askOnlyOrphans;
    report.limitReached = false;
    return report;
  }

  const logger = input.logger ?? createAppLogger({ name: 'code-task-lifecycle-backfill' });
  const repository = input.summaryRepository ?? createMaintenanceSummaryRepository(input.firestore, logger);
  let durableCursor = input.cursor;

  for (const item of bounded) {
    let applyFinding = false;
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
            applyFinding = true;
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
          applyFinding = true;
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
    if (applyFinding) break;
    report.processed++;
    durableCursor = item.workKey;
    report.cursor = item.workKey;
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
    logger?: Logger;
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
    if (input.mode === 'apply' && report.tasks.invalid > 0) return report;
  }
  if (input.phase === 'all' || input.phase === 'summaries') {
    report.summaries = await runSummaryLifecycleBackfillPhase({
      firestore: input.firestore,
      mode: input.mode,
      pageSize: input.pageSize,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.now !== undefined && { now: input.now }),
      ...(input.logger !== undefined && { logger: input.logger }),
      ...(input.summaryRepository !== undefined && { summaryRepository: input.summaryRepository }),
    });
  }
  return report;
}
