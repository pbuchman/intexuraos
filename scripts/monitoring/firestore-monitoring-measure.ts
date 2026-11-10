#!/usr/bin/env -S pnpm exec tsx
/**
 * Read-only baseline for monitoring queries at Git revision 60c022386.
 *
 * pnpm exec tsx scripts/monitoring/firestore-monitoring-measure.ts \
 *   --project PROJECT_ID --allow-production-reads
 *
 * Uses existing ADC. Never writes, prints identifiers, document bodies, arbitrary
 * field names, credentials, or raw exceptions. These are document protobuf bytes,
 * not network, storage, or billing bytes. Minimum document read estimates exclude
 * retries, index-entry reads and security-rule reads. Empty queries and missing
 * point reads are counted separately from returned documents.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Firestore, type DocumentSnapshot, type Query } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const firestoreRequire = createRequire(
  require.resolve('@google-cloud/firestore', {
    paths: [require.resolve('firebase-admin/firestore')],
  })
);
// The SDK's generated static API intentionally omits encode/decode. Use its
// bundled protobuf descriptor with the same protobufjs version instead.
const protobuf = firestoreRequire('protobufjs') as {
  Root: {
    fromJSON(descriptor: unknown): {
      lookupType(name: string): { encode(value: unknown): { finish(): Uint8Array } };
    };
  };
};
const documentEncoder = protobuf.Root.fromJSON(firestoreRequire('../protos/v1.json')).lookupType(
  'google.firestore.v1.Document'
);

const HEARTBEATS: Readonly<Record<string, readonly string[]>> = {
  code_job_heartbeats: [
    'drain_task_queue',
    'merge_conflict_reconcile',
    'merge_queue_tick',
    'code_tasks_zombie_sweep',
    'archive_stale_groups',
    'auto_archive_merged_tasks',
    'execution_memory_process',
    'execution_memory_sweep_errored',
    'execution_memory_prune_stale',
  ],
  linear_job_heartbeats: ['linear_sync_hourly', 'linear_issues_prune_hourly'],
  calendar_job_heartbeats: ['calendar_schedule_tick'],
  message_digest_job_heartbeats: ['message_digest_tick'],
  whatsapp_job_heartbeats: ['retry_pending_whatsapp_webhooks'],
};

// Fixed operational fields only. Never enumerate arbitrary production fields.
const SCHEMA_FIELDS = [
  'status',
  'generationStatus',
  'deliveryMode',
  'delivery.status',
  'delivery.transportConfirmation.status',
  'delivery.transportConfirmation.deliveredAt',
  'delivery.transportConfirmation.readAt',
  'deliveryStatus',
  'dispatchStatus',
  'transportConfirmation.status',
  'transportConfirmation.deliveredAt',
  'recordRole',
  'visibilityMigrationId',
  'schemaVersion',
  'nextRunAt',
  'resumeCutoff',
  'scheduledBoundary',
  'scheduledFor',
  'windowEnd',
  'createdAt',
  'deliveredAt',
  'expiresAt',
  'validUntil',
  'lastStartedAt',
  'lastFinishedAt',
  'lastSucceededAt',
  'lastOutcome',
] as const;
const SAFE_STATUSES = new Set([
  'active',
  'paused',
  'pending',
  'failed',
  'delivered',
  'read',
  'accepted',
  'sending',
  'retry_ready',
  'sent',
  'succeeded',
  'running',
  'never',
  'canonical',
  'skipped_no_activity',
  'generated',
  'silent',
  'whatsapp',
]);

export interface ReadMetrics {
  returnedDocuments: number;
  protobufDocumentBytes: number;
  queryRequests: number;
  emptyQueryRequests: number;
  pointReadRequests: number;
  missingPointReads: number;
  estimatedMinimumDocumentReads: number;
  operationalFieldTypes: Record<string, Record<string, number>>;
  statusCounts: Record<string, Record<string, number>>;
  timestampRanges: Record<string, { min: string; max: string }>;
}

export function emptyMetrics(): ReadMetrics {
  return {
    returnedDocuments: 0,
    protobufDocumentBytes: 0,
    queryRequests: 0,
    emptyQueryRequests: 0,
    pointReadRequests: 0,
    missingPointReads: 0,
    estimatedMinimumDocumentReads: 0,
    operationalFieldTypes: {},
    statusCounts: {},
    timestampRanges: {},
  };
}

function operationalField(data: unknown, path: string): unknown {
  let value = data;
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** SDK internal API is guarded: fail closed rather than substitute JSON size. */
export function protobufDocumentBytes(snapshot: DocumentSnapshot): number {
  const internal = snapshot as unknown as { toDocumentProto?: () => unknown };
  if (typeof internal.toDocumentProto !== 'function') {
    throw new Error('UNSUPPORTED_DOCUMENT_PROTO_API');
  }
  return documentEncoder.encode(internal.toDocumentProto()).finish().byteLength;
}

export function recordDocument(metrics: ReadMetrics, snapshot: DocumentSnapshot): void {
  if (!snapshot.exists) return;
  metrics.returnedDocuments++;
  metrics.protobufDocumentBytes += protobufDocumentBytes(snapshot);
  const data: unknown = snapshot.data();
  for (const field of SCHEMA_FIELDS) {
    const value = operationalField(data, field);
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    increment((metrics.operationalFieldTypes[field] ??= {}), type);
    if (typeof value !== 'string') continue;
    if (SAFE_STATUSES.has(value)) increment((metrics.statusCounts[field] ??= {}), value);
    // Only canonical UTC ISO timestamps; never echo malformed/user-supplied text.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) continue;
    if (!Number.isFinite(Date.parse(value))) continue;
    const range = metrics.timestampRanges[field];
    metrics.timestampRanges[field] = {
      min: range === undefined || value < range.min ? value : range.min,
      max: range === undefined || value > range.max ? value : range.max,
    };
  }
}

export async function measureBaseline(
  db: Firestore,
  observedAt: string
): Promise<{
  collections: Record<string, ReadMetrics>;
  totals: Omit<ReadMetrics, 'operationalFieldTypes' | 'statusCounts' | 'timestampRanges'>;
}> {
  const collections: Record<string, ReadMetrics> = {};
  const query = async (collection: string, request: Query): Promise<DocumentSnapshot[]> => {
    const metrics = (collections[collection] ??= emptyMetrics());
    const snapshot = await request.get();
    metrics.queryRequests++;
    if (snapshot.empty) metrics.emptyQueryRequests++;
    metrics.estimatedMinimumDocumentReads += Math.max(1, snapshot.size);
    for (const document of snapshot.docs) recordDocument(metrics, document);
    return snapshot.docs;
  };
  const definitions = await query(
    'message_digest_definitions',
    db.collection('message_digest_definitions').where('status', '==', 'active')
  );
  for (const definition of definitions) {
    const data = definition.data();
    // Fail safely if the baseline query input schema has drifted.
    if (typeof data?.['userId'] !== 'string' || typeof data['definitionId'] !== 'string') {
      throw new Error('INVALID_DEFINITION_SCHEMA');
    }
    await query(
      'message_digest_runs',
      db
        .collection('message_digest_runs')
        .where('userId', '==', data['userId'])
        .where('definitionId', '==', data['definitionId'])
        .where('recordRole', '==', 'canonical')
        .where('visibilityMigrationId', '==', null)
    );
  }
  await query(
    'calendar_schedules',
    db.collection('calendar_schedules').where('status', '==', 'active')
  );
  await query(
    'calendar_schedule_runs',
    db
      .collection('calendar_schedule_runs')
      .where('scheduledFor', '>=', new Date(Date.parse(observedAt) - 7 * 86400000).toISOString())
  );
  for (const collection of ['whatsapp_notification_intents', 'whatsapp_notification_markers']) {
    await query(
      collection,
      db.collection(collection).where('expiresAt', '>', Math.floor(Date.parse(observedAt) / 1000))
    );
  }
  for (const [collection, keys] of Object.entries(HEARTBEATS)) {
    const metrics = (collections[collection] ??= emptyMetrics());
    for (const key of keys) {
      const snapshot = await db.collection(collection).doc(key).get();
      metrics.pointReadRequests++;
      metrics.estimatedMinimumDocumentReads++;
      if (!snapshot.exists) metrics.missingPointReads++;
      recordDocument(metrics, snapshot);
    }
  }
  const totals = {
    returnedDocuments: 0,
    protobufDocumentBytes: 0,
    queryRequests: 0,
    emptyQueryRequests: 0,
    pointReadRequests: 0,
    missingPointReads: 0,
    estimatedMinimumDocumentReads: 0,
  };
  for (const metrics of Object.values(collections)) {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += metrics[key];
  }
  return { collections, totals };
}

export function parseArguments(args: string[]): { projectId: string; observedAt: string } {
  let projectId = '';
  let allowed = false;
  let observedAt = new Date().toISOString();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--project') projectId = args[++index] ?? '';
    else if (arg === '--at') observedAt = args[++index] ?? '';
    else if (arg === '--allow-production-reads') allowed = true;
    else throw new Error('INVALID_ARGUMENTS');
  }
  if (!allowed || projectId !== 'intexuraos-dev-pbuchman') {
    throw new Error('EXPLICIT_PROJECT_AND_READ_AUTHORIZATION_REQUIRED');
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt)) {
    throw new Error('INVALID_OBSERVATION_TIME');
  }
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('INVALID_OBSERVATION_TIME');
  return { projectId, observedAt };
}

async function main(): Promise<void> {
  // Reject emulator/custom transport overrides: this measurement targets ADC-backed production.
  if (process.env['FIRESTORE_EMULATOR_HOST'] !== undefined) {
    throw new Error('EMULATOR_OVERRIDE_REJECTED');
  }
  const { projectId, observedAt } = parseArguments(process.argv.slice(2));
  const db = new Firestore({ projectId });
  try {
    const startedAt = new Date().toISOString();
    const result = await measureBaseline(db, observedAt);
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        mode: 'baseline',
        baselineRevision: '60c022386',
        startedAt,
        finishedAt: new Date().toISOString(),
        observedAt,
        byteMetric:
          'google.firestore.v1.Document protobuf; excludes response framing and transport',
        readMetric:
          'returned documents plus empty-query/missing-point minimum estimate; excludes indexes/rules/retries',
        ...result,
      })}\n`
    );
  } finally {
    await db.terminate();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code =
      typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
    process.stderr.write(
      `${JSON.stringify({
        status: 'failed',
        category:
          code === 7 ? 'permission_denied' : code === 16 ? 'unauthenticated' : 'measurement_failed',
      })}\n`
    );
    process.exitCode = 1;
  });
}
