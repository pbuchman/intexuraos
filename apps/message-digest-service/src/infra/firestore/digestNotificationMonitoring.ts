import type { NotificationMonitoringSummary } from '@intexuraos/common-core';
import {
  createFirestoreSnapshotCache,
  FieldPath,
  type Firestore,
} from '@intexuraos/infra-firestore';
import {
  DIGEST_MONITORING_COLLECTION,
  DIGEST_MONITORING_INITIALIZATION_ID,
  type DigestMonitoringRun,
} from './digestMonitoringProjection.js';

interface Definition {
  definitionId: string;
  userId: string;
  nextRunAt: string;
  resumeCutoff?: string;
}
interface Diagnostics {
  queryStarts: number;
  documentReads: number;
  protobufDocumentBytes: number;
}
type Cache<T> = ReturnType<typeof createFirestoreSnapshotCache<T>>;
interface DefinitionCaches {
  fingerprint: string;
  deliveredBoundary: Cache<DigestMonitoringRun>;
  deliveredAt: Cache<DigestMonitoringRun>;
  cursor: Cache<DigestMonitoringRun>;
  unresolved?: Cache<DigestMonitoringRun>;
  unresolvedFingerprint?: string;
}

/** Listens only to compact rows and bounded delivery cursors, never canonical run history. */
export function createDigestNotificationMonitoring(
  firestore: Firestore,
  bootstrap?: (now: string) => Promise<NotificationMonitoringSummary>
): {
  read(now: string): Promise<NotificationMonitoringSummary>;
  diagnostics(): Diagnostics;
  close(): void;
  mode(): 'initializing' | 'legacy-bootstrap' | 'incremental';
} {
  const definitions = createFirestoreSnapshotCache<Definition>({
    query: () => firestore.collection('message_digest_definitions').where('status', '==', 'active'),
    map: (doc) => doc.data() as Definition,
  });
  const initialized = createFirestoreSnapshotCache<{ schemaVersion?: number; complete?: boolean }>({
    query: () =>
      firestore
        .collection(DIGEST_MONITORING_COLLECTION)
        .where(FieldPath.documentId(), '==', DIGEST_MONITORING_INITIALIZATION_ID),
    map: (doc) => doc.data(),
  });
  const owned = new Map<string, DefinitionCaches>();
  const retired: Diagnostics = { queryStarts: 0, documentReads: 0, protobufDocumentBytes: 0 };
  const caches = (entry: DefinitionCaches): Cache<DigestMonitoringRun>[] => [
    entry.deliveredBoundary,
    entry.deliveredAt,
    entry.cursor,
    ...(entry.unresolved === undefined ? [] : [entry.unresolved]),
  ];
  const retire = (cache: Cache<DigestMonitoringRun>): void => {
    const data = cache.diagnostics();
    for (const key of ['queryStarts', 'documentReads', 'protobufDocumentBytes'] as const)
      retired[key] += data[key];
    cache.close();
  };
  const queryFor = (definition: Definition): FirebaseFirestore.Query =>
    firestore
      .collection(DIGEST_MONITORING_COLLECTION)
      .where('userId', '==', definition.userId)
      .where('definitionId', '==', definition.definitionId);
  const makeCache = (query: () => FirebaseFirestore.Query): Cache<DigestMonitoringRun> =>
    createFirestoreSnapshotCache({ query, map: (doc) => doc.data() as DigestMonitoringRun });
  // Serialize readers so simultaneous monitor requests cannot replace one another's listeners.
  let reading: Promise<void> = Promise.resolve();
  let closed = false;
  let hasInitialized = false;
  let mode: 'initializing' | 'legacy-bootstrap' | 'incremental' = 'initializing';
  const ensureOpen = (): void => {
    if (closed) throw new Error('Digest monitoring closed');
  };

  const read = async (now: string): Promise<NotificationMonitoringSummary> => {
    ensureOpen();
    const marker = (await initialized.read())[0];
    ensureOpen();
    if (
      !hasInitialized &&
      (marker === undefined || (marker.schemaVersion === 1 && marker.complete === false)) &&
      bootstrap !== undefined
    ) {
      mode = 'legacy-bootstrap';
      return await bootstrap(now);
    }
    if (marker?.schemaVersion !== 1 || marker.complete !== true)
      throw new Error('Digest monitoring projections not initialized');
    hasInitialized = true;
    mode = 'incremental';
    const active = await definitions.read();
    ensureOpen();
    const activeIds = new Set(active.map((definition) => definition.definitionId));
    for (const [id, entry] of owned) {
      if (!activeIds.has(id)) {
        caches(entry).forEach(retire);
        owned.delete(id);
      }
    }
    const summary: NotificationMonitoringSummary = {
      pendingCount: 0,
      failedCount: 0,
      oldestPendingScheduledFor: null,
      lastDeliveredAt: null,
    };
    const pending = (boundary: string): void => {
      summary.pendingCount++;
      if (
        summary.oldestPendingScheduledFor === null ||
        boundary < summary.oldestPendingScheduledFor
      )
        summary.oldestPendingScheduledFor = boundary;
    };
    await Promise.all(
      active.map(async (definition) => {
        const fingerprint = JSON.stringify([
          definition.userId,
          definition.nextRunAt,
          definition.resumeCutoff,
        ]);
        let entry = owned.get(definition.definitionId);
        if (entry?.fingerprint !== fingerprint) {
          if (entry !== undefined) caches(entry).forEach(retire);
          entry = {
            fingerprint,
            deliveredBoundary: makeCache(() =>
              queryFor(definition)
                .where('outcome', '==', 'delivered')
                .orderBy('scheduledBoundary', 'desc')
                .limit(1)
            ),
            deliveredAt: makeCache(() =>
              queryFor(definition)
                .where('outcome', '==', 'delivered')
                .orderBy('deliveredAt', 'desc')
                .limit(1)
            ),
            cursor: makeCache(() =>
              queryFor(definition)
                .where(
                  'scheduledBoundary',
                  '>=',
                  definition.resumeCutoff !== undefined &&
                    definition.resumeCutoff > definition.nextRunAt
                    ? definition.resumeCutoff
                    : definition.nextRunAt
                )
                .where('windowEnd', '>=', definition.resumeCutoff ?? '0000-01-01T00:00:00.000Z')
                .orderBy('scheduledBoundary', 'asc')
                .orderBy('windowEnd', 'asc')
                .limit(1)
            ),
          };
          owned.set(definition.definitionId, entry);
        }
        const [boundaryRows, deliveredRows, cursorRows] = await Promise.all([
          entry.deliveredBoundary.read(),
          entry.deliveredAt.read(),
          entry.cursor.read(),
        ]);
        ensureOpen();
        const deliveredThrough = boundaryRows[0]?.scheduledBoundary;
        const deliveredAt = deliveredRows[0]?.deliveredAt;
        if (
          deliveredAt !== undefined &&
          deliveredAt !== null &&
          (summary.lastDeliveredAt === null || deliveredAt > summary.lastDeliveredAt)
        )
          summary.lastDeliveredAt = deliveredAt;
        const unresolvedFingerprint = JSON.stringify([deliveredThrough, definition.resumeCutoff]);
        if (
          entry.unresolved === undefined ||
          entry.unresolvedFingerprint !== unresolvedFingerprint
        ) {
          if (entry.unresolved !== undefined) retire(entry.unresolved);
          entry.unresolved = makeCache(() => {
            let query = queryFor(definition).where('outcome', 'in', ['pending', 'failed']);
            if (deliveredThrough !== undefined)
              query = query.where('scheduledBoundary', '>', deliveredThrough);
            if (definition.resumeCutoff !== undefined)
              query = query.where('scheduledBoundary', '>=', definition.resumeCutoff);
            return query.orderBy('scheduledBoundary', 'asc');
          });
          entry.unresolvedFingerprint = unresolvedFingerprint;
        }
        for (const run of await entry.unresolved.read()) {
          if (definition.resumeCutoff !== undefined && run.windowEnd < definition.resumeCutoff)
            continue;
          if (run.outcome === 'failed') summary.failedCount++;
          else pending(run.scheduledBoundary);
        }
        if (
          definition.nextRunAt <= now &&
          (definition.resumeCutoff === undefined ||
            definition.nextRunAt >= definition.resumeCutoff) &&
          cursorRows.length === 0
        )
          pending(definition.nextRunAt);
      })
    );
    return summary;
  };
  return {
    read(now): Promise<NotificationMonitoringSummary> {
      const result = reading.then(async () => await read(now));
      reading = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    diagnostics(): Diagnostics {
      const total = { ...retired };
      for (const cache of [initialized, definitions, ...[...owned.values()].flatMap(caches)]) {
        const data = cache.diagnostics();
        for (const key of ['queryStarts', 'documentReads', 'protobufDocumentBytes'] as const)
          total[key] += data[key];
      }
      return total;
    },
    close(): void {
      closed = true;
      initialized.close();
      definitions.close();
      for (const entry of owned.values())
        caches(entry).forEach((cache) => {
          cache.close();
        });
    },
    mode: () => mode,
  };
}
