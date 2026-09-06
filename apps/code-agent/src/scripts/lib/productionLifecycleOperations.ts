import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from '@google-cloud/firestore';
import { createLifecycleBackfillTaskSourceFingerprint } from '../../infra/firestore/taskGroupSummaryFirestoreRepository.js';
import {
  buildSummaryReconciliationPlan,
  encodeTaskLifecycleCursor,
  planRawCodeTaskLifecycle,
  resolveTaskLifecycleCursor,
  scanRawCollection,
  type RawFirestoreDocument,
} from './codeTaskLifecycleBackfill.js';
import { validateCodeAgentHealthResponse } from './codeAgentProductionHealth.js';

const EXACT_SHA = /^[0-9a-f]{40}$/u;
const EXACT_JOURNAL_SHA = /^[0-9a-f]{64}$/u;
const SAFE_OPERATION_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const TASKS_COLLECTION = 'code_tasks';
const SUMMARIES_COLLECTION = 'task_group_summaries';
const COUNTS_COLLECTION = 'user_group_counts';
export const LIFECYCLE_MAINTENANCE_LOCK_COLLECTION = 'code_task_lifecycle_maintenance_locks';
const LOCK_DOCUMENT_ID = 'code-task-lifecycle';
const LOCK_LEASE_MS = 30 * 60 * 1000;

export class LifecycleOperationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'LifecycleOperationError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new LifecycleOperationError(code);
}

function assertReleaseSha(value: string): void {
  if (!EXACT_SHA.test(value)) fail('EXPECTED_RELEASE_SHA_INVALID');
}

function assertJournalSha(value: string): void {
  if (!EXACT_JOURNAL_SHA.test(value)) fail('JOURNAL_SHA_INVALID');
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function canonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function canonicalDeploymentTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasNoStore(headers: Headers): boolean {
  return (headers.get('cache-control') ?? '')
    .toLowerCase()
    .split(',')
    .some((directive) => directive.trim() === 'no-store');
}

function hasJsonContentType(headers: Headers): boolean {
  return /^application\/json(?:\s*;|$)/u.test((headers.get('content-type') ?? '').toLowerCase());
}

export interface ProductionLifecycleEndpoints {
  directDeployment: string;
  publicDeployment: string;
  directHealth: string;
  publicHealth: string;
}

function validatedEndpoint(value: string | undefined): string {
  if (value === undefined || value.trim() === '') fail('PRODUCTION_ENDPOINT_REQUIRED');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('PRODUCTION_ENDPOINT_INVALID');
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username !== '' || parsed.password !== '') {
    fail('PRODUCTION_ENDPOINT_INVALID');
  }
  return parsed.toString();
}

export function productionLifecycleEndpointsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): ProductionLifecycleEndpoints {
  return {
    directDeployment: validatedEndpoint(env['INTEXURAOS_LIFECYCLE_DIRECT_DEPLOYMENT_URL']),
    publicDeployment: validatedEndpoint(env['INTEXURAOS_LIFECYCLE_PUBLIC_DEPLOYMENT_URL']),
    directHealth: validatedEndpoint(env['INTEXURAOS_LIFECYCLE_DIRECT_HEALTH_URL']),
    publicHealth: validatedEndpoint(env['INTEXURAOS_LIFECYCLE_PUBLIC_HEALTH_URL']),
  };
}

interface DeploymentProof {
  commitSha: string;
  workflowRunId: string;
  deployedAt: string;
}

async function fetchWithTimeout(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  kind: 'DEPLOYMENT' | 'HEALTH',
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchFn(url, {
      method: 'GET',
      headers: { 'cache-control': 'no-cache' },
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    fail(controller.signal.aborted ? `${kind}_REQUEST_TIMEOUT` : `${kind}_REQUEST_FAILED`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDeploymentProof(
  url: string,
  expectedReleaseSha: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<DeploymentProof> {
  const response = await fetchWithTimeout(url, fetchFn, timeoutMs, 'DEPLOYMENT');
  if (response.status < 200 || response.status >= 300) fail('DEPLOYMENT_HTTP_STATUS_INVALID');
  if (!hasJsonContentType(response.headers)) fail('DEPLOYMENT_CONTENT_TYPE_INVALID');
  if (!hasNoStore(response.headers)) fail('DEPLOYMENT_CACHE_CONTROL_INVALID');
  let body: unknown;
  try {
    body = JSON.parse(await response.text()) as unknown;
  } catch {
    fail('DEPLOYMENT_JSON_INVALID');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail('DEPLOYMENT_JSON_INVALID');
  }
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'commitSha,deployedAt,workflowRunId'
    || typeof record['commitSha'] !== 'string'
    || typeof record['workflowRunId'] !== 'string'
    || !/^\d+$/u.test(record['workflowRunId'])
    || !canonicalDeploymentTimestamp(record['deployedAt'])
  ) fail('DEPLOYMENT_DOCUMENT_INVALID');
  if (record['commitSha'] !== expectedReleaseSha) fail('DEPLOYMENT_RELEASE_MISMATCH');
  return record as unknown as DeploymentProof;
}

async function fetchHealthProof(url: string, fetchFn: typeof fetch, timeoutMs: number): Promise<void> {
  const response = await fetchWithTimeout(url, fetchFn, timeoutMs, 'HEALTH');
  const body = await response.text();
  try {
    validateCodeAgentHealthResponse({ status: response.status, headers: response.headers, body });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'HEALTH_RESPONSE_INVALID';
    fail(code);
  }
}

export async function verifyProductionLifecycleWindow(input: {
  expectedReleaseSha: string;
  endpoints: ProductionLifecycleEndpoints;
  fetchFn?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}): Promise<{ releaseSha: string }> {
  assertReleaseSha(input.expectedReleaseSha);
  const fetchFn = input.fetchFn ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    fail('PRODUCTION_REQUEST_TIMEOUT_INVALID');
  }
  const endpointValues = Object.values(input.endpoints);
  if (endpointValues.some((value) => typeof value !== 'string' || value.trim() === '')) {
    fail('PRODUCTION_ENDPOINT_INVALID');
  }

  const d1Direct = await fetchDeploymentProof(
    input.endpoints.directDeployment, input.expectedReleaseSha, fetchFn, timeoutMs,
  );
  const d1Public = await fetchDeploymentProof(
    input.endpoints.publicDeployment, input.expectedReleaseSha, fetchFn, timeoutMs,
  );
  if (JSON.stringify(d1Direct) !== JSON.stringify(d1Public)) fail('DEPLOYMENT_PROOF_MISMATCH');
  await fetchHealthProof(input.endpoints.directHealth, fetchFn, timeoutMs);
  await fetchHealthProof(input.endpoints.publicHealth, fetchFn, timeoutMs);
  const d2Direct = await fetchDeploymentProof(
    input.endpoints.directDeployment, input.expectedReleaseSha, fetchFn, timeoutMs,
  );
  const d2Public = await fetchDeploymentProof(
    input.endpoints.publicDeployment, input.expectedReleaseSha, fetchFn, timeoutMs,
  );
  if (JSON.stringify(d2Direct) !== JSON.stringify(d2Public)) fail('DEPLOYMENT_PROOF_MISMATCH');
  if (JSON.stringify(d2Direct) !== JSON.stringify(d1Direct)) fail('DEPLOYMENT_PROOF_DRIFT');
  void (input.now ?? ((): Date => new Date()))();
  return { releaseSha: input.expectedReleaseSha };
}

type EncodedFirestoreValue = unknown;

export function encodeFirestoreValue(value: unknown): EncodedFirestoreValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('FIRESTORE_VALUE_UNSUPPORTED');
    return value;
  }
  if (typeof value === 'undefined') return { __firestoreType: 'undefined' };
  if (value instanceof Timestamp) {
    return {
      __firestoreType: 'timestamp',
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail('FIRESTORE_VALUE_UNSUPPORTED');
    return { __firestoreType: 'date', iso: value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { __firestoreType: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map((entry) => encodeFirestoreValue(entry));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      __firestoreType: 'map',
      entries: Object.keys(record)
        .sort()
        .map((key) => [key, encodeFirestoreValue(record[key])]),
    };
  }
  fail('FIRESTORE_VALUE_UNSUPPORTED');
}

export function decodeFirestoreValue(value: EncodedFirestoreValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => decodeFirestoreValue(entry));
  const record = value as Record<string, unknown>;
  const tag = record['__firestoreType'];
  if (tag === 'undefined') return undefined;
  if (tag === 'timestamp') {
    const seconds = record['seconds'];
    const nanoseconds = record['nanoseconds'];
    if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds)) fail('JOURNAL_VALUE_INVALID');
    return new Timestamp(Number(seconds), Number(nanoseconds));
  }
  if (tag === 'date') {
    if (!canonicalIsoTimestamp(record['iso'])) fail('JOURNAL_VALUE_INVALID');
    return new Date(record['iso']);
  }
  if (tag === 'bytes') {
    if (typeof record['base64'] !== 'string') fail('JOURNAL_VALUE_INVALID');
    return Buffer.from(record['base64'], 'base64');
  }
  if (tag === 'map') {
    const entries = record['entries'];
    if (!Array.isArray(entries)) fail('JOURNAL_VALUE_INVALID');
    const decoded: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
        fail('JOURNAL_VALUE_INVALID');
      }
      const key = entry[0];
      if (seen.has(key)) fail('JOURNAL_VALUE_INVALID');
      seen.add(key);
      Object.defineProperty(decoded, key, {
        value: decodeFirestoreValue(entry[1]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return decoded;
  }
  const decoded: Record<string, unknown> = {};
  for (const key of Object.keys(record)) decoded[key] = decodeFirestoreValue(record[key]);
  return decoded;
}

interface EncodedFieldState {
  present: boolean;
  value?: EncodedFirestoreValue;
}

interface EncodedDocumentState {
  exists: boolean;
  data?: EncodedFirestoreValue;
}

export interface TaskLifecycleJournalEntry {
  kind: 'task';
  documentId: string;
  sourceProof: string;
  touchedFields: Record<string, { pre: EncodedFieldState; post: EncodedFieldState }>;
}

export interface SummaryLifecycleJournalEntry {
  kind: 'summary';
  documentId: string;
  countsDocumentId: string;
  userId: string;
  groupKey: string;
  sourceProof: string;
  summary: { pre: EncodedDocumentState; post: EncodedDocumentState };
  counts: { pre: EncodedDocumentState; post: EncodedDocumentState };
}

export type LifecycleJournalEntry = TaskLifecycleJournalEntry | SummaryLifecycleJournalEntry;

export interface LifecycleJournal {
  schemaVersion: 1;
  operationId: string;
  phase: 'tasks' | 'summaries';
  expectedReleaseSha: string;
  createdAt: string;
  hasMore: boolean;
  cursor?: string;
  entries: LifecycleJournalEntry[];
}

function hashEncoded(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(encodeFirestoreValue(value))).digest('hex');
}

const TASK_LIFECYCLE_SOURCE_FIELDS = [
  'status', 'statusChangedAt', 'completedAt', 'dispatchStatus',
  'dispatchedAt', 'queuedAt', 'updatedAt', 'createdAt',
] as const;

function taskSourceProof(
  data: Readonly<Record<string, unknown>>,
  touchedFields: Readonly<Record<string, unknown>>,
): string {
  const source: Record<string, unknown> = {};
  for (const field of TASK_LIFECYCLE_SOURCE_FIELDS) {
    if (!hasOwn(touchedFields, field) && hasOwn(data, field)) source[field] = data[field];
  }
  return hashEncoded(source);
}

function fieldState(data: Readonly<Record<string, unknown>>, field: string): EncodedFieldState {
  if (!hasOwn(data, field)) return { present: false };
  return { present: true, value: encodeFirestoreValue(data[field]) };
}

function encodedDocumentState(data: Readonly<Record<string, unknown>> | undefined): EncodedDocumentState {
  return data === undefined
    ? { exists: false }
    : { exists: true, data: encodeFirestoreValue(data) };
}

function assertJournalMetadata(input: {
  operationId: string;
  expectedReleaseSha: string;
  createdAt: Date;
}): void {
  if (!SAFE_OPERATION_ID.test(input.operationId)) fail('OPERATION_ID_INVALID');
  assertReleaseSha(input.expectedReleaseSha);
  if (!Number.isFinite(input.createdAt.getTime())) fail('OPERATION_TIMESTAMP_INVALID');
}

export function buildTaskLifecycleJournalBatch(input: {
  documents: readonly RawFirestoreDocument[];
  operationId: string;
  expectedReleaseSha: string;
  cursor?: string;
  createdAt: Date;
  hasMore?: boolean;
  nextDocumentId?: string;
}): { journal: LifecycleJournal; changed: number; skipped: number } {
  assertJournalMetadata(input);
  const entries: TaskLifecycleJournalEntry[] = [];
  let skipped = 0;
  for (const document of input.documents) {
    const plan = planRawCodeTaskLifecycle(document);
    if (plan.outcome === 'invalid') fail('TASK_SOURCE_INVALID');
    if (plan.outcome === 'skip') {
      skipped++;
      continue;
    }
    const touchedFields: TaskLifecycleJournalEntry['touchedFields'] = {};
    for (const [field, postValue] of Object.entries(plan.update)) {
      touchedFields[field] = {
        pre: fieldState(document.data, field),
        post: { present: true, value: encodeFirestoreValue(postValue) },
      };
    }
    entries.push({
      kind: 'task',
      documentId: document.id,
      sourceProof: taskSourceProof(document.data, touchedFields),
      touchedFields,
    });
  }
  return {
    journal: {
      schemaVersion: 1,
      operationId: input.operationId,
      phase: 'tasks',
      expectedReleaseSha: input.expectedReleaseSha,
      createdAt: input.createdAt.toISOString(),
      hasMore: input.hasMore ?? false,
      ...(input.hasMore === true && input.nextDocumentId !== undefined && {
        cursor: encodeTaskLifecycleCursor(input.nextDocumentId),
      }),
      entries,
    },
    changed: entries.length,
    skipped,
  };
}

type CountBucket = 'active' | 'needsAction' | 'done' | 'failed' | 'archived';
const COUNT_BUCKET: Record<string, CountBucket> = {
  active: 'active',
  'needs-action': 'needsAction',
  done: 'done',
  failed: 'failed',
  archived: 'archived',
};

function nextCounts(
  current: Readonly<Record<string, unknown>>,
  userId: string,
  oldStatus: string | undefined,
  newStatus: string | undefined,
  at: Timestamp,
): Record<string, unknown> {
  const next = { ...current };
  if (oldStatus !== undefined) {
    const oldBucket = COUNT_BUCKET[oldStatus];
    /* v8 ignore start -- upstream: validated reconciliation summaries guarantee oldStatus is always a known count bucket @preserve */
    if (oldBucket === undefined) fail('SUMMARY_SOURCE_INVALID');
    /* v8 ignore stop @preserve */
    next[oldBucket] = Number(next[oldBucket]) - 1;
    next['totalGroups'] = Number(next['totalGroups']) - 1;
  }
  if (newStatus !== undefined) {
    const newBucket = COUNT_BUCKET[newStatus];
    /* v8 ignore start -- upstream: computed TaskGroupSummary aggregateStatus guarantees newStatus is always a known count bucket @preserve */
    if (newBucket === undefined) fail('SUMMARY_SOURCE_INVALID');
    /* v8 ignore stop @preserve */
    next[newBucket] = Number(next[newBucket]) + 1;
    next['totalGroups'] = Number(next['totalGroups']) + 1;
  }
  next['userId'] = userId;
  next['updatedAt'] = at;
  return next;
}

export function buildSummaryLifecycleJournalBatch(input: {
  taskDocuments: readonly RawFirestoreDocument[];
  summaryDocuments: readonly RawFirestoreDocument[];
  countDocuments: readonly RawFirestoreDocument[];
  operationId: string;
  expectedReleaseSha: string;
  cursor?: string;
  createdAt: Date;
  batchTimestamp: Timestamp;
  limit?: number;
}): { journal: LifecycleJournal; changed: number; skipped: number } {
  assertJournalMetadata(input);
  const plan = buildSummaryReconciliationPlan(
    input.taskDocuments,
    input.summaryDocuments,
    input.countDocuments,
    input.batchTimestamp,
  );
  if (plan.items.some((item) => item.kind === 'invalid' || item.kind === 'unknown_orphan')) {
    fail('SUMMARY_SOURCE_INVALID');
  }
  if (input.cursor !== undefined && !plan.items.some((item) => item.workKey === input.cursor)) {
    fail('CURSOR_NOT_FOUND');
  }
  const summaries = new Map(input.summaryDocuments.map((doc) => [doc.id, doc.data]));
  const counts = new Map(input.countDocuments.map((doc) => [doc.id, { ...doc.data }]));
  const entries: SummaryLifecycleJournalEntry[] = [];
  let skipped = 0;
  const remainingItems = plan.items
    .filter((item) => input.cursor === undefined || item.workKey > input.cursor);
  const selectedItems = input.limit === undefined
    ? remainingItems
    : remainingItems.slice(0, input.limit);
  const hasMore = input.limit !== undefined && remainingItems.length > selectedItems.length;
  const nextCursor = selectedItems.at(-1)?.workKey;
  for (const item of selectedItems) {
    if (item.kind === 'unchanged' || item.kind === 'ask_only_without_summary') {
      skipped++;
      continue;
    }
    /* v8 ignore start -- upstream: prior invalid-plan rejection and skipped-kind guard guarantee only mutation items remain @preserve */
    if (item.kind !== 'upsert' && item.kind !== 'delete_ask_only') continue;
    /* v8 ignore stop @preserve */
    const summaryPre = summaries.get(item.docId);
    const countsPre = counts.get(item.userId);
    /* v8 ignore start -- upstream: reconciliation count validation guarantees every mutation user always has one counts preimage @preserve */
    if (countsPre === undefined) fail('SUMMARY_COUNTS_PREIMAGE_MISSING');
    /* v8 ignore stop @preserve */
    const oldStatus = typeof summaryPre?.['aggregateStatus'] === 'string'
      ? summaryPre['aggregateStatus']
      : undefined;
    const summaryPost = item.kind === 'upsert'
      ? item.expected as unknown as Record<string, unknown>
      : undefined;
    const newStatus = typeof summaryPost?.['aggregateStatus'] === 'string'
      ? summaryPost['aggregateStatus']
      : undefined;
    const countsPost = oldStatus === newStatus
      ? { ...countsPre }
      : nextCounts(countsPre, item.userId, oldStatus, newStatus, input.batchTimestamp);
    entries.push({
      kind: 'summary',
      documentId: item.docId,
      countsDocumentId: item.userId,
      userId: item.userId,
      groupKey: item.groupKey,
      sourceProof: item.proof.expectedSourceFingerprint,
      summary: {
        pre: encodedDocumentState(summaryPre),
        post: encodedDocumentState(summaryPost),
      },
      counts: {
        pre: encodedDocumentState(countsPre),
        post: encodedDocumentState(countsPost),
      },
    });
    if (summaryPost === undefined) summaries.delete(item.docId);
    else summaries.set(item.docId, summaryPost);
    counts.set(item.userId, countsPost);
  }
  return {
    journal: {
      schemaVersion: 1,
      operationId: input.operationId,
      phase: 'summaries',
      expectedReleaseSha: input.expectedReleaseSha,
      createdAt: input.createdAt.toISOString(),
      hasMore,
      ...(hasMore && nextCursor !== undefined ? { cursor: nextCursor } : {}),
      entries,
    },
    changed: entries.length,
    skipped,
  };
}

async function collectTaskBatch(input: {
  firestore: Firestore;
  pageSize: number;
  cursor?: string;
  limit: number;
}): Promise<{ documents: RawFirestoreDocument[]; hasMore: boolean; nextDocumentId?: string }> {
  let checkpointDocumentId: string | undefined;
  if (input.cursor !== undefined) {
    checkpointDocumentId = await resolveTaskLifecycleCursor({
      firestore: input.firestore,
      pageSize: input.pageSize,
      cursor: input.cursor,
    });
  }
  const documents: RawFirestoreDocument[] = [];
  for await (const document of scanRawCollection(
    input.firestore,
    TASKS_COLLECTION,
    input.pageSize,
    checkpointDocumentId,
  )) {
    if (documents.length >= input.limit + 1) break;
    documents.push(document);
  }
  const hasMore = documents.length > input.limit;
  const selected = documents.slice(0, input.limit);
  const nextDocumentId = selected.at(-1)?.id;
  return {
    documents: selected,
    hasMore,
    ...(hasMore && nextDocumentId !== undefined ? { nextDocumentId } : {}),
  };
}

async function collectAll(
  firestore: Firestore,
  collection: string,
  pageSize: number,
): Promise<RawFirestoreDocument[]> {
  const documents: RawFirestoreDocument[] = [];
  for await (const document of scanRawCollection(firestore, collection, pageSize)) {
    documents.push(document);
  }
  return documents;
}

export async function prepareProductionLifecycleJournal(input: {
  firestore: Firestore;
  phase: 'tasks' | 'summaries';
  pageSize: number;
  cursor?: string;
  limit: number;
  operationId: string;
  expectedReleaseSha: string;
  now?: () => Date;
}): Promise<LifecycleJournal> {
  const capturedAt = (input.now ?? ((): Date => new Date()))();
  if (input.phase === 'tasks') {
    const batch = await collectTaskBatch(input);
    return buildTaskLifecycleJournalBatch({
      documents: batch.documents,
      operationId: input.operationId,
      expectedReleaseSha: input.expectedReleaseSha,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      createdAt: capturedAt,
      hasMore: batch.hasMore,
      ...(batch.nextDocumentId !== undefined && { nextDocumentId: batch.nextDocumentId }),
    }).journal;
  }
  const [taskDocuments, summaryDocuments, countDocuments] = await Promise.all([
    collectAll(input.firestore, TASKS_COLLECTION, input.pageSize),
    collectAll(input.firestore, SUMMARIES_COLLECTION, input.pageSize),
    collectAll(input.firestore, COUNTS_COLLECTION, input.pageSize),
  ]);
  return buildSummaryLifecycleJournalBatch({
    taskDocuments,
    summaryDocuments,
    countDocuments,
    operationId: input.operationId,
    expectedReleaseSha: input.expectedReleaseSha,
    ...(input.cursor !== undefined && { cursor: input.cursor }),
    createdAt: capturedAt,
    batchTimestamp: Timestamp.fromDate(capturedAt),
    limit: input.limit,
  }).journal;
}

function validateParsedJournal(value: unknown): LifecycleJournal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('JOURNAL_INVALID');
  const journal = value as Partial<LifecycleJournal>;
  if (
    journal.schemaVersion !== 1
    || !SAFE_OPERATION_ID.test(journal.operationId ?? '')
    || (journal.phase !== 'tasks' && journal.phase !== 'summaries')
    || !EXACT_SHA.test(journal.expectedReleaseSha ?? '')
    || !canonicalIsoTimestamp(journal.createdAt)
    || typeof journal.hasMore !== 'boolean'
    || !Array.isArray(journal.entries)
  ) fail('JOURNAL_INVALID');
  const phase = journal.phase;
  const entries: unknown[] = journal.entries;
  if (entries.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return true;
    const kind = (entry as { kind?: unknown }).kind;
    return kind !== phase.slice(0, -1) && !(phase === 'summaries' && kind === 'summary');
  })) fail('JOURNAL_INVALID');
  return journal as LifecycleJournal;
}

export async function writeImmutableLifecycleJournal(input: {
  directory: string;
  journal: LifecycleJournal;
}): Promise<{ path: string; sha256: string }> {
  validateParsedJournal(input.journal);
  if (!isAbsolute(input.directory)) fail('JOURNAL_DIRECTORY_INVALID');
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  let directoryStat;
  try {
    directoryStat = await lstat(input.directory);
  } catch {
    fail('JOURNAL_DIRECTORY_UNSAFE');
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    fail('JOURNAL_DIRECTORY_UNSAFE');
  }
  await chmod(input.directory, 0o700);
  const directoryHandle = await open(input.directory, 'r');
  const path = join(input.directory, `${input.journal.operationId}-${input.journal.phase}.json`);
  const bytes = Buffer.from(JSON.stringify(input.journal), 'utf8');
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    await directoryHandle.close();
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      fail('JOURNAL_EXISTS');
    }
    fail('JOURNAL_WRITE_FAILED');
  }
  try {
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await directoryHandle.sync();
  } catch {
    fail('JOURNAL_WRITE_FAILED');
  } finally {
    await handle.close();
    await directoryHandle.close();
  }
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function readAndVerifyLifecycleJournal(input: {
  path: string;
  expectedSha256: string;
}): Promise<LifecycleJournal> {
  assertJournalSha(input.expectedSha256);
  if (!isAbsolute(input.path)) fail('JOURNAL_PATH_INVALID');
  let fileStat;
  try {
    fileStat = await lstat(input.path);
  } catch {
    fail('JOURNAL_UNREADABLE');
  }
  if (
    !fileStat.isFile()
    || fileStat.isSymbolicLink()
    || (fileStat.mode & 0o777) !== 0o600
  ) fail('JOURNAL_FILE_UNSAFE');
  let bytes: Buffer;
  try {
    bytes = await readFile(input.path);
  } catch {
    fail('JOURNAL_UNREADABLE');
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== input.expectedSha256) fail('JOURNAL_HASH_MISMATCH');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    fail('JOURNAL_INVALID');
  }
  return validateParsedJournal(parsed);
}

export function sanitizeLifecycleOperationResult(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ['ok', 'operationId', 'journalSha256', 'counts', 'cursor', 'hasMore'] as const) {
    if (hasOwn(input, key)) result[key] = input[key];
  }
  return result;
}

export interface LifecycleMaintenanceLock {
  operationId: string;
  phase: 'tasks' | 'summaries';
  expectedReleaseSha: string;
  ownerToken: string;
  fence: number;
  journalSha256?: string;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function lockRef(firestore: Firestore): DocumentReference {
  return firestore.collection(LIFECYCLE_MAINTENANCE_LOCK_COLLECTION).doc(LOCK_DOCUMENT_ID);
}

function asMillis(value: unknown): number | undefined {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const candidate = (value as { toMillis?: unknown }).toMillis;
    if (typeof candidate === 'function') return Number(candidate.call(value));
  }
  return undefined;
}

export async function acquireLifecycleMaintenanceLock(input: {
  firestore: Firestore;
  operationId: string;
  phase: 'tasks' | 'summaries';
  expectedReleaseSha: string;
  resumeJournalSha256?: string;
  now?: () => Date;
  randomToken?: () => string;
}): Promise<LifecycleMaintenanceLock> {
  if (!SAFE_OPERATION_ID.test(input.operationId)) fail('OPERATION_ID_INVALID');
  assertReleaseSha(input.expectedReleaseSha);
  if (input.resumeJournalSha256 !== undefined) assertJournalSha(input.resumeJournalSha256);
  const now = (input.now ?? ((): Date => new Date()))();
  const ownerToken = (input.randomToken ?? ((): string => randomBytes(32).toString('hex')))();
  if (ownerToken.length < 8) fail('LOCK_OWNER_TOKEN_INVALID');
  return await input.firestore.runTransaction(async (tx) => {
    const ref = lockRef(input.firestore);
    const snapshot = await tx.get(ref);
    let fence = 1;
    if (snapshot.exists) {
      const current = snapshot.data() as Record<string, unknown>;
      const expiresAt = asMillis(current['leaseExpiresAt']);
      if (expiresAt === undefined) fail('LOCK_RECORD_INVALID');
      if (expiresAt > now.getTime()) fail('LOCK_ACTIVE');
      if (input.resumeJournalSha256 === undefined) fail('LOCK_STALE_PROOF_REQUIRED');
      if (
        current['operationId'] !== input.operationId
        || current['phase'] !== input.phase
        || current['expectedReleaseSha'] !== input.expectedReleaseSha
        || current['journalSha256'] !== input.resumeJournalSha256
      ) fail('LOCK_RESUME_PROOF_MISMATCH');
      if (!Number.isSafeInteger(current['fence'])) fail('LOCK_RECORD_INVALID');
      fence = Number(current['fence']) + 1;
    }
    tx.set(ref, {
      operationId: input.operationId,
      phase: input.phase,
      expectedReleaseSha: input.expectedReleaseSha,
      ownerTokenHash: tokenHash(ownerToken),
      fence,
      ...(input.resumeJournalSha256 !== undefined && {
        journalSha256: input.resumeJournalSha256,
      }),
      state: 'active',
      acquiredAt: Timestamp.fromDate(now),
      leaseExpiresAt: Timestamp.fromMillis(now.getTime() + LOCK_LEASE_MS),
    });
    return {
      operationId: input.operationId,
      phase: input.phase,
      expectedReleaseSha: input.expectedReleaseSha,
      ownerToken,
      fence,
      ...(input.resumeJournalSha256 !== undefined && {
        journalSha256: input.resumeJournalSha256,
      }),
    };
  });
}

function assertOwnedLockRecord(
  raw: Readonly<Record<string, unknown>>,
  lock: LifecycleMaintenanceLock,
  journalSha256?: string,
): void {
  if (
    raw['operationId'] !== lock.operationId
    || raw['phase'] !== lock.phase
    || raw['expectedReleaseSha'] !== lock.expectedReleaseSha
    || raw['ownerTokenHash'] !== tokenHash(lock.ownerToken)
    || raw['fence'] !== lock.fence
    || raw['state'] !== 'active'
  ) fail('LOCK_FENCE_MISMATCH');
  if (journalSha256 !== undefined && raw['journalSha256'] !== journalSha256) {
    fail('LOCK_JOURNAL_MISMATCH');
  }
}

export async function bindLifecycleMaintenanceJournal(input: {
  firestore: Firestore;
  lock: LifecycleMaintenanceLock;
  journalSha256: string;
  now?: () => Date;
}): Promise<LifecycleMaintenanceLock> {
  assertJournalSha(input.journalSha256);
  const now = (input.now ?? ((): Date => new Date()))();
  await input.firestore.runTransaction(async (tx) => {
    const ref = lockRef(input.firestore);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail('LOCK_FENCE_MISMATCH');
    const raw = snapshot.data() as Record<string, unknown>;
    assertOwnedLockRecord(raw, input.lock);
    const existingHash = raw['journalSha256'];
    if (existingHash !== undefined && existingHash !== input.journalSha256) {
      fail('LOCK_JOURNAL_MISMATCH');
    }
    tx.update(ref, {
      journalSha256: input.journalSha256,
      leaseExpiresAt: Timestamp.fromMillis(now.getTime() + LOCK_LEASE_MS),
    });
  });
  return { ...input.lock, journalSha256: input.journalSha256 };
}

export async function releaseLifecycleMaintenanceLock(input: {
  firestore: Firestore;
  lock: LifecycleMaintenanceLock;
}): Promise<void> {
  await input.firestore.runTransaction(async (tx) => {
    const ref = lockRef(input.firestore);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail('LOCK_FENCE_MISMATCH');
    assertOwnedLockRecord(snapshot.data() as Record<string, unknown>, input.lock, input.lock.journalSha256);
    tx.delete(ref);
  });
}

function fieldStateEqual(actual: EncodedFieldState, expected: EncodedFieldState): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function documentStateEqual(actual: EncodedDocumentState, expected: EncodedDocumentState): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function snapshotState(snapshot: { exists: boolean; data(): DocumentData | undefined }): EncodedDocumentState {
  return snapshot.exists
    ? encodedDocumentState(snapshot.data() as Record<string, unknown>)
    : { exists: false };
}

async function assertLockInTransaction(
  tx: Transaction,
  firestore: Firestore,
  lock: LifecycleMaintenanceLock,
  journalSha256: string,
  now: Date,
): Promise<void> {
  const ref = lockRef(firestore);
  const snapshot = await tx.get(ref);
  if (!snapshot.exists) fail('LOCK_FENCE_MISMATCH');
  const raw = snapshot.data() as Record<string, unknown>;
  assertOwnedLockRecord(raw, lock, journalSha256);
  const expiresAt = asMillis(raw['leaseExpiresAt']);
  if (expiresAt === undefined || expiresAt <= now.getTime()) fail('LOCK_LEASE_EXPIRED');
}

function renewLockInTransaction(
  tx: Transaction,
  firestore: Firestore,
  now: Date,
): void {
  tx.update(lockRef(firestore), {
    leaseExpiresAt: Timestamp.fromMillis(now.getTime() + LOCK_LEASE_MS),
  });
}

function mutationForFieldState(state: EncodedFieldState): unknown {
  return state.present ? decodeFirestoreValue(state.value) : FieldValue.delete();
}

async function exactGroupSourceProof(
  tx: Transaction,
  firestore: Firestore,
  entry: SummaryLifecycleJournalEntry,
): Promise<string | undefined> {
  let documents: RawFirestoreDocument[];
  if (entry.groupKey.startsWith('standalone_')) {
    const taskId = entry.groupKey.slice('standalone_'.length);
    const snapshot = await tx.get(firestore.collection(TASKS_COLLECTION).doc(taskId));
    documents = snapshot.exists
      ? [{ id: snapshot.id, data: snapshot.data() as Record<string, unknown> }]
      : [];
  } else {
    const snapshot = await tx.get(
      firestore.collection(TASKS_COLLECTION)
        .where('userId', '==', entry.userId)
        .where('linearIssueId', '==', entry.groupKey),
    );
    documents = snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  }
  return createLifecycleBackfillTaskSourceFingerprint(documents);
}

function matchesTaskSide(
  data: Readonly<Record<string, unknown>>,
  entry: TaskLifecycleJournalEntry,
  side: 'pre' | 'post',
): boolean {
  return Object.entries(entry.touchedFields)
    .every(([field, states]) => fieldStateEqual(fieldState(data, field), states[side]));
}

function applyVirtualTaskSide(
  data: Readonly<Record<string, unknown>>,
  entry: TaskLifecycleJournalEntry,
  side: 'pre' | 'post',
): Record<string, unknown> {
  const next = { ...data };
  for (const [field, states] of Object.entries(entry.touchedFields)) {
    const state = states[side];
    if (state.present) next[field] = decodeFirestoreValue(state.value);
    else Reflect.deleteProperty(next, field);
  }
  return next;
}

type RawDocumentState = Record<string, unknown> | undefined;

function decodeDocumentData(state: EncodedDocumentState): Record<string, unknown> {
  if (!state.exists || state.data === undefined) fail('JOURNAL_VALUE_INVALID');
  const decoded = decodeFirestoreValue(state.data);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    fail('JOURNAL_VALUE_INVALID');
  }
  return decoded as Record<string, unknown>;
}

function documentTouchedFields(
  transition: { pre: EncodedDocumentState; post: EncodedDocumentState },
): string[] {
  /* v8 ignore start -- upstream: transition callers return before this helper unless both document sides are guaranteed present @preserve */
  if (!transition.pre.exists || !transition.post.exists) return [];
  /* v8 ignore stop @preserve */
  const pre = decodeDocumentData(transition.pre);
  const post = decodeDocumentData(transition.post);
  return [...new Set([...Object.keys(pre), ...Object.keys(post)])]
    .filter((field) => !fieldStateEqual(fieldState(pre, field), fieldState(post, field)));
}

function matchesDocumentSide(
  actual: RawDocumentState,
  transition: { pre: EncodedDocumentState; post: EncodedDocumentState },
  side: 'pre' | 'post',
): boolean {
  const expected = transition[side];
  if (transition.pre.exists !== transition.post.exists) {
    return documentStateEqual(encodedDocumentState(actual), expected);
  }
  if (!expected.exists) return actual === undefined;
  if (actual === undefined) return false;
  const expectedData = decodeDocumentData(expected);
  return documentTouchedFields(transition)
    .every((field) => fieldStateEqual(fieldState(actual, field), fieldState(expectedData, field)));
}

function applyVirtualDocumentSide(
  actual: RawDocumentState,
  transition: { pre: EncodedDocumentState; post: EncodedDocumentState },
  side: 'pre' | 'post',
): RawDocumentState {
  const target = transition[side];
  if (!target.exists) return undefined;
  const targetData = decodeDocumentData(target);
  if (actual === undefined || transition.pre.exists !== transition.post.exists) {
    return { ...targetData };
  }
  const next = { ...actual };
  for (const field of documentTouchedFields(transition)) {
    const state = fieldState(targetData, field);
    if (state.present) next[field] = decodeFirestoreValue(state.value);
    else Reflect.deleteProperty(next, field);
  }
  return next;
}

async function mutateTaskEntry(input: {
  firestore: Firestore;
  tx: Transaction;
  entry: TaskLifecycleJournalEntry;
  direction: 'apply' | 'rollback';
}): Promise<'changed' | 'already'> {
  const ref = input.firestore.collection(TASKS_COLLECTION).doc(input.entry.documentId);
  const snapshot = await input.tx.get(ref);
  if (!snapshot.exists) fail('JOURNAL_CAS_CONFLICT');
  const data = snapshot.data() as Record<string, unknown>;
  /* v8 ignore start -- upstream: private mutateTaskEntry is not reachable from tests and its only caller is guaranteed to supply apply @preserve */
  const from = input.direction === 'apply' ? 'pre' : 'post';
  const to = input.direction === 'apply' ? 'post' : 'pre';
  /* v8 ignore stop @preserve */
  const actualStates = Object.fromEntries(Object.keys(input.entry.touchedFields).map((field) => [
    field,
    fieldState(data, field),
  ]));
  const matches = (side: 'pre' | 'post'): boolean => Object.entries(input.entry.touchedFields)
    .every(([field, states]) => fieldStateEqual(actualStates[field] as EncodedFieldState, states[side]));
  if (taskSourceProof(data, input.entry.touchedFields) !== input.entry.sourceProof) {
    fail('JOURNAL_SOURCE_PROOF_MISMATCH');
  }
  if (matches(to)) return 'already';
  if (!matches(from)) fail('JOURNAL_CAS_CONFLICT');
  const update: Record<string, unknown> = {};
  for (const [field, states] of Object.entries(input.entry.touchedFields)) {
    update[field] = mutationForFieldState(states[to]);
  }
  input.tx.update(ref, update);
  return 'changed';
}

function writeDocumentState(
  tx: Transaction,
  ref: ReturnType<Firestore['collection']>['doc'] extends (...args: never[]) => infer R ? R : never,
  state: EncodedDocumentState,
): void {
  if (!state.exists) tx.delete(ref);
  else tx.set(ref, decodeFirestoreValue(state.data) as DocumentData);
}

function writeDocumentTransitionSide(
  tx: Transaction,
  ref: ReturnType<Firestore['collection']>['doc'] extends (...args: never[]) => infer R ? R : never,
  transition: { pre: EncodedDocumentState; post: EncodedDocumentState },
  side: 'pre' | 'post',
): void {
  const target = transition[side];
  if (transition.pre.exists !== transition.post.exists) {
    if (!target.exists) tx.delete(ref);
    else tx.set(ref, decodeDocumentData(target) as DocumentData);
    return;
  }
  if (!target.exists) return;
  const targetData = decodeDocumentData(target);
  const update: Record<string, unknown> = {};
  for (const field of documentTouchedFields(transition)) {
    update[field] = mutationForFieldState(fieldState(targetData, field));
  }
  if (Object.keys(update).length > 0) tx.update(ref, update);
}

async function mutateSummaryEntry(input: {
  firestore: Firestore;
  tx: Transaction;
  entry: SummaryLifecycleJournalEntry;
  direction: 'apply' | 'rollback';
}): Promise<'changed' | 'already'> {
  const summaryRef = input.firestore.collection(SUMMARIES_COLLECTION).doc(input.entry.documentId);
  const countsRef = input.firestore.collection(COUNTS_COLLECTION).doc(input.entry.countsDocumentId);
  const [summarySnapshot, countsSnapshot] = await Promise.all([
    input.tx.get(summaryRef),
    input.tx.get(countsRef),
  ]);
  const actualSummary = snapshotState(summarySnapshot);
  const actualCounts = snapshotState(countsSnapshot);
  /* v8 ignore start -- upstream: private mutateSummaryEntry is not reachable from tests and its only caller is guaranteed to supply apply @preserve */
  const from = input.direction === 'apply' ? 'pre' : 'post';
  const to = input.direction === 'apply' ? 'post' : 'pre';
  /* v8 ignore stop @preserve */
  const matches = (side: 'pre' | 'post'): boolean =>
    documentStateEqual(actualSummary, input.entry.summary[side])
    && documentStateEqual(actualCounts, input.entry.counts[side]);
  const proof = await exactGroupSourceProof(input.tx, input.firestore, input.entry);
  if (proof !== input.entry.sourceProof) fail('JOURNAL_SOURCE_PROOF_MISMATCH');
  if (matches(to)) return 'already';
  if (!matches(from)) fail('JOURNAL_CAS_CONFLICT');
  writeDocumentState(input.tx, summaryRef as never, input.entry.summary[to]);
  writeDocumentState(input.tx, countsRef as never, input.entry.counts[to]);
  return 'changed';
}

export async function applyLifecycleJournal(input: {
  firestore: Firestore;
  journal: LifecycleJournal;
  journalSha256: string;
  lock: LifecycleMaintenanceLock;
  now?: () => Date;
}): Promise<{ changed: number; alreadyApplied: number }> {
  assertJournalSha(input.journalSha256);
  if (
    input.lock.operationId !== input.journal.operationId
    || input.lock.phase !== input.journal.phase
    || input.lock.expectedReleaseSha !== input.journal.expectedReleaseSha
    || input.lock.journalSha256 !== input.journalSha256
  ) fail('LOCK_JOURNAL_MISMATCH');
  let changed = 0;
  let alreadyApplied = 0;
  for (const entry of input.journal.entries) {
    const outcome = await input.firestore.runTransaction(async (tx) => {
      const now = (input.now ?? ((): Date => new Date()))();
      await assertLockInTransaction(tx, input.firestore, input.lock, input.journalSha256, now);
      const result = entry.kind === 'task'
        ? await mutateTaskEntry({ firestore: input.firestore, tx, entry, direction: 'apply' })
        : await mutateSummaryEntry({ firestore: input.firestore, tx, entry, direction: 'apply' });
      renewLockInTransaction(tx, input.firestore, now);
      return result;
    });
    if (outcome === 'changed') changed++;
    else alreadyApplied++;
  }
  return { changed, alreadyApplied };
}

export async function rollbackLifecycleJournal(input: {
  firestore: Firestore;
  journal: LifecycleJournal;
  journalSha256: string;
  lock: LifecycleMaintenanceLock;
  now?: () => Date;
}): Promise<{ reverted: number; alreadyReverted: number }> {
  assertJournalSha(input.journalSha256);
  if (
    input.lock.operationId !== input.journal.operationId
    || input.lock.phase !== input.journal.phase
    || input.lock.expectedReleaseSha !== input.journal.expectedReleaseSha
    || input.lock.journalSha256 !== input.journalSha256
  ) fail('LOCK_JOURNAL_MISMATCH');
  return await input.firestore.runTransaction(async (tx) => {
    const now = (input.now ?? ((): Date => new Date()))();
    await assertLockInTransaction(tx, input.firestore, input.lock, input.journalSha256, now);
    const entries = [...input.journal.entries].reverse();
    const taskStates = new Map<string, RawDocumentState>();
    const summaryStates = new Map<string, RawDocumentState>();
    const countStates = new Map<string, RawDocumentState>();
    const summaryProofs = new Map<SummaryLifecycleJournalEntry, string | undefined>();

    // Read the complete rollback set before issuing any write. Firestore will
    // retry this one transaction if any target changes, so no journal prefix
    // can commit independently from a later CAS decision.
    for (const entry of entries) {
      if (entry.kind === 'task') {
        if (!taskStates.has(entry.documentId)) {
          const snapshot = await tx.get(
            input.firestore.collection(TASKS_COLLECTION).doc(entry.documentId),
          );
          if (!snapshot.exists) fail('JOURNAL_CAS_CONFLICT');
          taskStates.set(entry.documentId, snapshot.data() as Record<string, unknown>);
        }
        continue;
      }
      if (!summaryStates.has(entry.documentId)) {
        const snapshot = await tx.get(
          input.firestore.collection(SUMMARIES_COLLECTION).doc(entry.documentId),
        );
        summaryStates.set(
          entry.documentId,
          snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined,
        );
      }
      if (!countStates.has(entry.countsDocumentId)) {
        const snapshot = await tx.get(
          input.firestore.collection(COUNTS_COLLECTION).doc(entry.countsDocumentId),
        );
        countStates.set(
          entry.countsDocumentId,
          snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined,
        );
      }
      summaryProofs.set(entry, await exactGroupSourceProof(tx, input.firestore, entry));
    }

    const decisions: {
      entry: LifecycleJournalEntry;
      outcome: 'changed' | 'already';
    }[] = [];
    let reverted = 0;
    let alreadyReverted = 0;
    for (const entry of entries) {
      if (entry.kind === 'task') {
        const data = taskStates.get(entry.documentId);
        /* v8 ignore start -- upstream: taskStates is guaranteed to contain a defined task after snapshot existence preflight @preserve */
        if (data === undefined) fail('JOURNAL_CAS_CONFLICT');
        /* v8 ignore stop @preserve */
        if (taskSourceProof(data, entry.touchedFields) !== entry.sourceProof) {
          fail('JOURNAL_SOURCE_PROOF_MISMATCH');
        }
        if (matchesTaskSide(data, entry, 'post')) {
          taskStates.set(entry.documentId, applyVirtualTaskSide(data, entry, 'pre'));
          decisions.push({ entry, outcome: 'changed' });
          reverted++;
        } else if (matchesTaskSide(data, entry, 'pre')) {
          decisions.push({ entry, outcome: 'already' });
          alreadyReverted++;
        } else {
          fail('JOURNAL_CAS_CONFLICT');
        }
        continue;
      }

      const summaryState = summaryStates.get(entry.documentId);
      const countsState = countStates.get(entry.countsDocumentId);
      if (summaryProofs.get(entry) !== entry.sourceProof) {
        fail('JOURNAL_SOURCE_PROOF_MISMATCH');
      }
      const matches = (side: 'pre' | 'post'): boolean =>
        matchesDocumentSide(summaryState, entry.summary, side)
        && matchesDocumentSide(countsState, entry.counts, side);
      if (matches('post')) {
        summaryStates.set(
          entry.documentId,
          applyVirtualDocumentSide(summaryState, entry.summary, 'pre'),
        );
        countStates.set(
          entry.countsDocumentId,
          applyVirtualDocumentSide(countsState, entry.counts, 'pre'),
        );
        decisions.push({ entry, outcome: 'changed' });
        reverted++;
      } else if (matches('pre')) {
        decisions.push({ entry, outcome: 'already' });
        alreadyReverted++;
      } else {
        fail('JOURNAL_CAS_CONFLICT');
      }
    }

    // All CAS and source-proof decisions succeeded. Buffer only owned fields;
    // the transaction commits every reverse mutation together or none of them.
    for (const decision of decisions) {
      if (decision.outcome === 'already') continue;
      const entry = decision.entry;
      if (entry.kind === 'task') {
        const update: Record<string, unknown> = {};
        for (const [field, states] of Object.entries(entry.touchedFields)) {
          update[field] = mutationForFieldState(states.pre);
        }
        tx.update(input.firestore.collection(TASKS_COLLECTION).doc(entry.documentId), update);
        continue;
      }
      writeDocumentTransitionSide(
        tx,
        input.firestore.collection(SUMMARIES_COLLECTION).doc(entry.documentId) as never,
        entry.summary,
        'pre',
      );
      writeDocumentTransitionSide(
        tx,
        input.firestore.collection(COUNTS_COLLECTION).doc(entry.countsDocumentId) as never,
        entry.counts,
        'pre',
      );
    }
    renewLockInTransaction(tx, input.firestore, now);
    return { reverted, alreadyReverted };
  });
}

export async function runProductionLifecycleApplyBatch(input: {
  firestore: Firestore;
  journal: LifecycleJournal;
  journalDirectory: string;
  endpoints: ProductionLifecycleEndpoints;
  fetchFn?: typeof fetch;
  now?: () => Date;
  randomToken?: () => string;
}): Promise<Record<string, unknown>> {
  await verifyProductionLifecycleWindow({
    expectedReleaseSha: input.journal.expectedReleaseSha,
    endpoints: input.endpoints,
    ...(input.fetchFn !== undefined && { fetchFn: input.fetchFn }),
    ...(input.now !== undefined && { now: input.now }),
  });
  const written = await writeImmutableLifecycleJournal({
    directory: input.journalDirectory,
    journal: input.journal,
  });
  const bound = await acquireLifecycleMaintenanceLock({
    firestore: input.firestore,
    operationId: input.journal.operationId,
    phase: input.journal.phase,
    expectedReleaseSha: input.journal.expectedReleaseSha,
    resumeJournalSha256: written.sha256,
    ...(input.now !== undefined && { now: input.now }),
    ...(input.randomToken !== undefined && { randomToken: input.randomToken }),
  });
  await verifyProductionLifecycleWindow({
    expectedReleaseSha: input.journal.expectedReleaseSha,
    endpoints: input.endpoints,
    ...(input.fetchFn !== undefined && { fetchFn: input.fetchFn }),
    ...(input.now !== undefined && { now: input.now }),
  });
  const counts = await applyLifecycleJournal({
    firestore: input.firestore,
    journal: input.journal,
    journalSha256: written.sha256,
    lock: bound,
    ...(input.now !== undefined && { now: input.now }),
  });
  await releaseLifecycleMaintenanceLock({ firestore: input.firestore, lock: bound });
  return sanitizeLifecycleOperationResult({
    ok: true,
    operationId: input.journal.operationId,
    journalSha256: written.sha256,
    counts,
    ...(input.journal.cursor !== undefined && { cursor: input.journal.cursor }),
    hasMore: input.journal.hasMore,
  });
}

export async function runProductionLifecycleApplyResume(input: {
  firestore: Firestore;
  journalPath: string;
  expectedJournalSha256: string;
  expectedReleaseSha: string;
  endpoints: ProductionLifecycleEndpoints;
  fetchFn?: typeof fetch;
  now?: () => Date;
  randomToken?: () => string;
}): Promise<Record<string, unknown>> {
  const journal = await readAndVerifyLifecycleJournal({
    path: input.journalPath,
    expectedSha256: input.expectedJournalSha256,
  });
  assertReleaseSha(input.expectedReleaseSha);
  if (journal.expectedReleaseSha !== input.expectedReleaseSha) fail('JOURNAL_RELEASE_MISMATCH');
  await verifyProductionLifecycleWindow({
    expectedReleaseSha: input.expectedReleaseSha,
    endpoints: input.endpoints,
    ...(input.fetchFn !== undefined && { fetchFn: input.fetchFn }),
    ...(input.now !== undefined && { now: input.now }),
  });
  const lock = await acquireLifecycleMaintenanceLock({
    firestore: input.firestore,
    operationId: journal.operationId,
    phase: journal.phase,
    expectedReleaseSha: input.expectedReleaseSha,
    resumeJournalSha256: input.expectedJournalSha256,
    ...(input.now !== undefined && { now: input.now }),
    ...(input.randomToken !== undefined && { randomToken: input.randomToken }),
  });
  await verifyProductionLifecycleWindow({
    expectedReleaseSha: input.expectedReleaseSha,
    endpoints: input.endpoints,
    ...(input.fetchFn !== undefined && { fetchFn: input.fetchFn }),
    ...(input.now !== undefined && { now: input.now }),
  });
  const counts = await applyLifecycleJournal({
    firestore: input.firestore,
    journal,
    journalSha256: input.expectedJournalSha256,
    lock,
    ...(input.now !== undefined && { now: input.now }),
  });
  await releaseLifecycleMaintenanceLock({ firestore: input.firestore, lock });
  return sanitizeLifecycleOperationResult({
    ok: true,
    operationId: journal.operationId,
    journalSha256: input.expectedJournalSha256,
    counts,
    ...(journal.cursor !== undefined && { cursor: journal.cursor }),
    hasMore: journal.hasMore,
  });
}

export async function runProductionLifecycleRollback(input: {
  firestore: Firestore;
  journalPath: string;
  expectedJournalSha256: string;
  expectedReleaseSha: string;
  endpoints: ProductionLifecycleEndpoints;
  fetchFn?: typeof fetch;
  now?: () => Date;
  randomToken?: () => string;
}): Promise<Record<string, unknown>> {
  const journal = await readAndVerifyLifecycleJournal({
    path: input.journalPath,
    expectedSha256: input.expectedJournalSha256,
  });
  assertReleaseSha(input.expectedReleaseSha);
  if (journal.expectedReleaseSha !== input.expectedReleaseSha) fail('JOURNAL_RELEASE_MISMATCH');
  await verifyProductionLifecycleWindow({
    expectedReleaseSha: input.expectedReleaseSha,
    endpoints: input.endpoints,
    ...(input.fetchFn !== undefined && { fetchFn: input.fetchFn }),
    ...(input.now !== undefined && { now: input.now }),
  });
  const lock = await acquireLifecycleMaintenanceLock({
    firestore: input.firestore,
    operationId: journal.operationId,
    phase: journal.phase,
    expectedReleaseSha: input.expectedReleaseSha,
    resumeJournalSha256: input.expectedJournalSha256,
    ...(input.now !== undefined && { now: input.now }),
    ...(input.randomToken !== undefined && { randomToken: input.randomToken }),
  });
  await verifyProductionLifecycleWindow({
    expectedReleaseSha: input.expectedReleaseSha,
    endpoints: input.endpoints,
    ...(input.fetchFn !== undefined && { fetchFn: input.fetchFn }),
    ...(input.now !== undefined && { now: input.now }),
  });
  const counts = await rollbackLifecycleJournal({
    firestore: input.firestore,
    journal,
    journalSha256: input.expectedJournalSha256,
    lock,
    ...(input.now !== undefined && { now: input.now }),
  });
  await releaseLifecycleMaintenanceLock({ firestore: input.firestore, lock });
  return sanitizeLifecycleOperationResult({
    ok: true,
    operationId: journal.operationId,
    journalSha256: input.expectedJournalSha256,
    counts,
    ...(journal.cursor !== undefined && { cursor: journal.cursor }),
  });
}
