import crypto from 'node:crypto';
import type { UsageEvent } from '../../domain/models/usageEvent.js';

/**
 * SHA-256 hash truncated to 32 hex characters.
 */
export function sha256Truncated(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 32);
}

/**
 * Extract YYYY-MM-DD date from an ISO timestamp string.
 */
export function toDateString(isoTimestamp: string): string {
  return isoTimestamp.substring(0, 10);
}

/**
 * Compute the aggregate document ID from event dimensions.
 *
 * Format: {date}__{ownerType}__{ownerIdHash}__{service}__{component}__{clientHash}__{environment}__{provider}__{modelHash}__{operation}__{success}
 *
 * Position 5 is `clientHash` (sha256Truncated of source.client) rather than the raw value so that
 * any client string containing "/" cannot produce an invalid Firestore document path segment.
 */
export function computeAggregateId(event: UsageEvent): string {
  const date = toDateString(event.occurredAt);
  const ownerIdHash = sha256Truncated(event.owner.id);
  const clientHash = sha256Truncated(event.source.client);
  const modelHash = sha256Truncated(event.request.model);
  const success = String(event.request.success);

  return [
    date,
    event.owner.type,
    ownerIdHash,
    event.source.service,
    event.source.component,
    clientHash,
    event.source.environment,
    event.request.provider,
    modelHash,
    event.request.operation,
    success,
  ].join('__');
}
