import {
  buildDigestMonitoringProjection,
  DIGEST_MONITORING_COLLECTION,
  DIGEST_MONITORING_INITIALIZATION_ID,
} from './monitoring-projection.mjs';

function validateSource(run, id) {
  const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (
    run === null ||
    typeof run !== 'object' ||
    run.runId !== id ||
    !['userId', 'definitionId'].every(
      (field) => typeof run[field] === 'string' && run[field].length > 0
    ) ||
    !['canonical', 'audit'].includes(run.recordRole) ||
    !(run.visibilityMigrationId === null || typeof run.visibilityMigrationId === 'string') ||
    !timestamp(run.scheduledBoundary) ||
    (run.windowEnd !== undefined && !timestamp(run.windowEnd)) ||
    !['queued', 'processing', 'completed', 'failed', 'skipped_no_activity'].includes(
      run.generationStatus
    ) ||
    run.delivery === null ||
    typeof run.delivery !== 'object' ||
    !['not_sent', 'pending', 'sent', 'ambiguous', 'failed'].includes(run.delivery.status) ||
    (run.deliveryMode !== undefined && !['whatsapp', 'silent'].includes(run.deliveryMode))
  )
    throw new Error('DIGEST_MONITORING_SOURCE_INVALID');
  const confirmation = run.delivery.transportConfirmation;
  if (
    confirmation !== undefined &&
    (confirmation === null ||
      typeof confirmation !== 'object' ||
      !['pending', 'delivered', 'read', 'failed'].includes(confirmation.status) ||
      ['deliveredAt', 'readAt'].some(
        (key) => confirmation[key] !== undefined && !timestamp(confirmation[key])
      ))
  )
    throw new Error('DIGEST_MONITORING_SOURCE_INVALID');
}

/** Run after all canonical writers mirror projections. Reads sources again inside each transaction. */
export async function backfillDigestMonitoring(firestore, { pageSize = 200 } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)
    throw new Error('INVALID_BACKFILL_PAGE_SIZE');
  const marker = firestore
    .collection(DIGEST_MONITORING_COLLECTION)
    .doc(DIGEST_MONITORING_INITIALIZATION_ID);
  await marker.set({ schemaVersion: 1, complete: false });
  let cursor;
  let scanned = 0;
  let projected = 0;
  for (;;) {
    let query = firestore
      .collection('message_digest_runs')
      .orderBy('__name__', 'asc')
      .limit(pageSize);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const source of page.docs) {
      const included = await firestore.runTransaction(async (transaction) => {
        // Never use the earlier query's data: a receipt, erasure or migration may have committed since it.
        const current = await transaction.get(
          firestore.collection('message_digest_runs').doc(source.id)
        );
        const destination = firestore.collection(DIGEST_MONITORING_COLLECTION).doc(source.id);
        const run = current.data();
        if (current.exists) validateSource(run, source.id);
        const projection = current.exists ? buildDigestMonitoringProjection(run) : null;
        if (projection === null) transaction.delete(destination);
        else transaction.set(destination, projection);
        return projection !== null;
      });
      scanned++;
      if (included) projected++;
    }
    if (page.size < pageSize) break;
    cursor = page.docs.at(-1).id;
  }
  await marker.set({
    schemaVersion: 1,
    complete: true,
    scanned,
    projected,
    completedAt: new Date().toISOString(),
  });
  return { scanned, projected };
}
