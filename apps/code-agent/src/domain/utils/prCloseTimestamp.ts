/**
 * Resolve the "source timestamp" used when handling a PR close event.
 *
 * Priority:
 *   1. The webhook payload's `pull_request.closed_at` when present.
 *   2. The merge timestamp parsed from the payload.
 *   3. The current time as a last-resort fallback.
 */
export function resolvePrCloseSourceTimestamp(params: {
  closedAt: string | null | undefined;
  mergedAt: Date | null;
}): string {
  if (typeof params.closedAt === 'string') {
    return params.closedAt;
  }
  if (params.mergedAt instanceof Date) {
    return params.mergedAt.toISOString();
  }
  return new Date().toISOString();
}
