/**
 * Schema-version write helper.
 *
 * Stamps every Firestore write with a `schemaVersion` (the writer's current
 * write-contract version) and `schemaUpdatedAt` (server-side write timestamp)
 * so reads can detect documents written by older code paths.
 *
 * Per the INT-1532 plan §C3, this helper is the single source of truth for the
 * versioned-schema convention. Existing writes are NOT retro-stamped — only new
 * writes adopt the convention as repositories migrate.
 */

import { Timestamp } from '@google-cloud/firestore';

export interface SchemaVersionedFields {
  schemaVersion: number;
  schemaUpdatedAt: Timestamp;
}

/**
 * Stamp `schemaVersion` (current write contract version) and `schemaUpdatedAt`
 * onto a document body. Idempotent — always overwrites both fields.
 *
 * @param body    The document body to stamp. Returned object is a shallow copy;
 *                the input is not mutated.
 * @param version The writer's current schema version (monotonically increasing
 *                integer; bumped whenever the persisted shape changes).
 * @param now     Optional override for the timestamp; defaults to
 *                `Timestamp.now()` (evaluated per-call, not at module load).
 *                Provided for deterministic tests.
 */
export function withSchemaVersion<T extends object>(
  body: T,
  version: number,
  now: Timestamp = Timestamp.now()
): T & SchemaVersionedFields {
  return { ...body, schemaVersion: version, schemaUpdatedAt: now };
}
