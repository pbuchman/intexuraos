/**
 * Tests for the `withSchemaVersion` write helper.
 */

import { assertType, describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { withSchemaVersion, type SchemaVersionedFields } from '../schemaVersion.js';

describe('withSchemaVersion', () => {
  it('stamps schemaVersion and schemaUpdatedAt onto a body', () => {
    const now = Timestamp.fromMillis(1_700_000_000_000);
    const stamped = withSchemaVersion({ name: 'doc' }, 3, now);

    expect(stamped).toEqual({
      name: 'doc',
      schemaVersion: 3,
      schemaUpdatedAt: now,
    });
  });

  it('preserves all original body fields', () => {
    const now = Timestamp.fromMillis(0);
    const stamped = withSchemaVersion({ a: 1, b: 'two', c: { nested: true } }, 1, now);

    expect(stamped.a).toBe(1);
    expect(stamped.b).toBe('two');
    expect(stamped.c).toEqual({ nested: true });
  });

  it('overwrites pre-existing schemaVersion and schemaUpdatedAt fields (idempotent)', () => {
    // Documents that already carry these fields are re-stamped, not rejected.
    // The spread in the implementation guarantees the new values win.
    const oldStamp = Timestamp.fromMillis(1_000);
    const newStamp = Timestamp.fromMillis(2_000);
    const stamped = withSchemaVersion(
      { name: 'doc', schemaVersion: 1, schemaUpdatedAt: oldStamp },
      7,
      newStamp
    );

    expect(stamped.schemaVersion).toBe(7);
    expect(stamped.schemaUpdatedAt).toBe(newStamp);
  });

  it('handles an empty body', () => {
    const now = Timestamp.fromMillis(0);
    const stamped = withSchemaVersion({}, 1, now);

    expect(stamped).toEqual({ schemaVersion: 1, schemaUpdatedAt: now });
  });

  it('does not mutate the input body', () => {
    const body = { name: 'doc' };
    const now = Timestamp.fromMillis(0);
    withSchemaVersion(body, 2, now);

    expect(body).toEqual({ name: 'doc' });
  });

  it('returns a value typed as `T & SchemaVersionedFields`', () => {
    const now = Timestamp.fromMillis(0);
    const stamped = withSchemaVersion({ name: 'doc', count: 3 }, 1, now);

    // Compile-time assertion: locks in the contract that consumers can read
    // both the original body fields and the stamped fields off the result.
    assertType<{ name: string; count: number } & SchemaVersionedFields>(stamped);

    // Runtime sanity check that the typed fields are actually present.
    expect(stamped.name).toBe('doc');
    expect(stamped.count).toBe(3);
    expect(stamped.schemaVersion).toBe(1);
    expect(stamped.schemaUpdatedAt).toBe(now);
  });

  it('defaults `now` to Timestamp.now() when omitted', () => {
    const before = Timestamp.now();
    const stamped = withSchemaVersion({ name: 'doc' }, 1);
    const after = Timestamp.now();

    expect(stamped.schemaUpdatedAt.toMillis()).toBeGreaterThanOrEqual(before.toMillis());
    expect(stamped.schemaUpdatedAt.toMillis()).toBeLessThanOrEqual(after.toMillis());
  });
});
