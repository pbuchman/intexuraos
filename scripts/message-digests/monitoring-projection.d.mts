export const DIGEST_MONITORING_COLLECTION: 'message_digest_monitoring_runs';
export const DIGEST_MONITORING_INITIALIZATION_ID: '_initialization';
export function buildDigestMonitoringProjection(
  run: Record<string, unknown>
): Record<string, unknown> | null;
export function writeDigestMonitoringProjection(
  firestore: FirebaseFirestore.Firestore,
  transaction: FirebaseFirestore.Transaction,
  run: Record<string, unknown>,
  previous?: Record<string, unknown>
): void;
