/** Content-free projection. Keep the operator-script implementation in contract-test parity. */
export const DIGEST_MONITORING_COLLECTION = 'message_digest_monitoring_runs';
export const DIGEST_MONITORING_INITIALIZATION_ID = '_initialization';

export function buildDigestMonitoringProjection(run) {
  const delivery = run['delivery'];
  if (
    run['recordRole'] !== 'canonical' ||
    run['visibilityMigrationId'] !== null ||
    run['deliveryMode'] === 'silent' ||
    [run['safeFailureCode'], delivery['failureCode']].some(
      (code) => code === 'SKIPPED_BEFORE_RESUME' || code === 'OBSOLETE_SCHEDULE_WINDOW'
    )
  )
    return null;
  const confirmation = delivery['transportConfirmation'];
  const delivered = confirmation?.['status'] === 'delivered' || confirmation?.['status'] === 'read';
  return {
    schemaVersion: 1,
    runId: run['runId'],
    userId: run['userId'],
    definitionId: run['definitionId'],
    scheduledBoundary: run['scheduledBoundary'],
    windowEnd: run['windowEnd'] ?? run['scheduledBoundary'],
    outcome: delivered
      ? 'delivered'
      : run['generationStatus'] === 'skipped_no_activity'
        ? 'skipped'
        : run['generationStatus'] === 'failed' ||
            delivery['status'] === 'failed' ||
            confirmation?.['status'] === 'failed'
          ? 'failed'
          : 'pending',
    deliveredAt: delivered ? (confirmation['deliveredAt'] ?? confirmation['readAt'] ?? null) : null,
  };
}

/** Mirror only semantic changes in the same transaction as the authoritative run. */
export function writeDigestMonitoringProjection(firestore, transaction, run, previous) {
  const projection = buildDigestMonitoringProjection(run);
  const before = previous === undefined ? null : buildDigestMonitoringProjection(previous);
  if (JSON.stringify(projection) === JSON.stringify(before)) return;
  const ref = firestore.collection(DIGEST_MONITORING_COLLECTION).doc(run.runId);
  if (projection === null) transaction.delete(ref);
  else transaction.set(ref, projection);
}
