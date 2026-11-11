/** Content-free projection. Keep the operator-script implementation in contract-test parity. */
export const DIGEST_MONITORING_COLLECTION = 'message_digest_monitoring_runs';
export const DIGEST_MONITORING_INITIALIZATION_ID = '_initialization';

export interface DigestMonitoringRun {
  schemaVersion: 1;
  runId: string;
  userId: string;
  definitionId: string;
  scheduledBoundary: string;
  windowEnd: string;
  outcome: 'pending' | 'failed' | 'delivered' | 'skipped';
  deliveredAt: string | null;
}

export function buildDigestMonitoringProjection(source: object): DigestMonitoringRun | null {
  const run = source as Record<string, unknown>;
  const delivery = run['delivery'] as Record<string, unknown>;
  if (
    run['recordRole'] !== 'canonical' ||
    run['visibilityMigrationId'] !== null ||
    run['deliveryMode'] === 'silent' ||
    [run['safeFailureCode'], delivery['failureCode']].some(
      (code) => code === 'SKIPPED_BEFORE_RESUME' || code === 'OBSOLETE_SCHEDULE_WINDOW'
    )
  )
    return null;
  const confirmation = delivery['transportConfirmation'] as Record<string, unknown> | undefined;
  const delivered = confirmation?.['status'] === 'delivered' || confirmation?.['status'] === 'read';
  return {
    schemaVersion: 1,
    runId: run['runId'] as string,
    userId: run['userId'] as string,
    definitionId: run['definitionId'] as string,
    scheduledBoundary: run['scheduledBoundary'] as string,
    windowEnd: (run['windowEnd'] ?? run['scheduledBoundary']) as string,
    outcome: delivered
      ? 'delivered'
      : run['generationStatus'] === 'skipped_no_activity'
        ? 'skipped'
        : run['generationStatus'] === 'failed' ||
            delivery['status'] === 'failed' ||
            confirmation?.['status'] === 'failed'
          ? 'failed'
          : 'pending',
    deliveredAt: delivered
      ? ((confirmation['deliveredAt'] ?? confirmation['readAt'] ?? null) as string | null)
      : null,
  };
}
