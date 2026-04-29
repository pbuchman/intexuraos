/**
 * TTL helper for Firestore writes.
 *
 * Computes a Firestore Timestamp at which a document should be deleted by
 * a Firestore native TTL policy. Repositories add `expireAt` to their write
 * payloads; the matching `google_firestore_field` Terraform resource (with
 * field name `expireAt`) drives deletion within ~24h of expiry.
 */

import { Timestamp } from '@google-cloud/firestore';

/** 24 hours in milliseconds. */
export const RETENTION_24H_MS = 24 * 60 * 60 * 1000;

/** 7 days in milliseconds. */
export const RETENTION_7D_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns `now + retentionMs` as a Firestore Timestamp.
 *
 * @param retentionMs How long the document should live, in milliseconds.
 * @param now         Optional override for the base time; defaults to `new Date()`.
 *                    Provided for deterministic tests.
 */
export function computeExpireAt(retentionMs: number, now: Date = new Date()): Timestamp {
  return Timestamp.fromMillis(now.getTime() + retentionMs);
}
