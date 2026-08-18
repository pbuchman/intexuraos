import crypto from 'node:crypto';
import type { UsageEvent } from '../../domain/models/usageEvent.js';
import { MISSING_PROMPT_TYPE_SENTINEL } from '../../domain/models/dailyAggregate.js';

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
 * Escape a raw dimension used inside a Firestore document ID without changing
 * the value persisted in the aggregate document. Escaping "%" first keeps the
 * mapping collision-free for literal strings such as "%2F".
 */
function encodeAggregateKeySegment(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('/', '%2F');
}

/**
 * Compute the aggregate document ID from event dimensions.
 *
 * Format: {date}__{ownerType}__{ownerIdHash}__{service}__{componentKey}__{clientHash}__{environment}__{provider}__{modelHash}__{operation}__{promptType}__{success}
 *
 * `componentKey` percent-escapes path separators while the aggregate document
 * retains the exact raw source.component value. Position 5 is `clientHash`
 * (sha256Truncated of source.client) rather than the raw value so that
 * any client string containing "/" cannot produce an invalid Firestore document path segment.
 */
export function computeAggregateId(event: UsageEvent): string {
  const date = toDateString(event.occurredAt);
  const ownerIdHash = sha256Truncated(event.owner.id);
  const componentKey = encodeAggregateKeySegment(event.source.component);
  const clientHash = sha256Truncated(event.source.client);
  const modelHash = sha256Truncated(event.request.model);
  const promptTypeHash = sha256Truncated(event.request.promptType ?? MISSING_PROMPT_TYPE_SENTINEL);
  const success = String(event.request.success);

  return [
    date,
    event.owner.type,
    ownerIdHash,
    event.source.service,
    componentKey,
    clientHash,
    event.source.environment,
    event.request.provider,
    modelHash,
    event.request.operation,
    promptTypeHash,
    success,
  ].join('__');
}
