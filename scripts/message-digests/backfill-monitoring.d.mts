export function backfillDigestMonitoring(
  firestore: FirebaseFirestore.Firestore,
  options?: { pageSize?: number }
): Promise<{ scanned: number; projected: number }>;
