/**
 * Tests for the `withSchemaVersion` write helper.
 */

import { describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import { withSchemaVersion } from '../schemaVersion.js';

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
    const oldStamp = Timestamp.fromMillis(1_000);
    const newStamp = Timestamp.fromMillis(2_000);
    const stamped = withSchemaVersion(
      { name: 'doc', schemaVersion: 1, schemaUpdatedAt: oldStamp },
      7,
      newStamp,
    );

    expect(stamped.schemaVersion).toBe(7);
    expect(stamped.schemaUpdatedAt).toBe(newStamp);
  });

  it('does not mutate the input body', () => {
    const body = { name: 'doc' };
    const now = Timestamp.fromMillis(0);
    withSchemaVersion(body, 2, now);

    expect(body).toEqual({ name: 'doc' });
  });

  it('defaults `now` to Timestamp.now() when omitted', () => {
    const before = Timestamp.now();
    const stamped = withSchemaVersion({ name: 'doc' }, 1);
    const after = Timestamp.now();

    expect(stamped.schemaUpdatedAt.toMillis()).toBeGreaterThanOrEqual(before.toMillis());
    expect(stamped.schemaUpdatedAt.toMillis()).toBeLessThanOrEqual(after.toMillis());
  });
});
