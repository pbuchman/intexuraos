import { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import {
  buildTaskLifecycleJournalBatch,
  decodeFirestoreValue,
  encodeFirestoreValue,
} from '../../scripts/lib/productionLifecycleOperations.js';

const SHA = '1234567890abcdef1234567890abcdef12345678';
const CREATED_AT = new Date('2026-07-28T12:00:00.000Z');

describe('production lifecycle journal codec branch coverage', () => {
  it('round-trips every supported scalar and container representation', () => {
    const date = new Date('2026-07-28T12:00:00.123Z');
    const timestamp = new Timestamp(1_785_240_000, 123_456_789);
    const bytes = Uint8Array.from([0, 1, 127, 255]);

    expect(decodeFirestoreValue(encodeFirestoreValue(null))).toBeNull();
    expect(decodeFirestoreValue(encodeFirestoreValue('value'))).toBe('value');
    expect(decodeFirestoreValue(encodeFirestoreValue(true))).toBe(true);
    expect(decodeFirestoreValue(encodeFirestoreValue(12.5))).toBe(12.5);
    expect(decodeFirestoreValue(encodeFirestoreValue(undefined))).toBeUndefined();
    expect(decodeFirestoreValue(encodeFirestoreValue(date))).toEqual(date);
    expect(decodeFirestoreValue(encodeFirestoreValue(timestamp))).toEqual(timestamp);
    expect(decodeFirestoreValue(encodeFirestoreValue(bytes))).toEqual(Buffer.from(bytes));
    expect(decodeFirestoreValue(encodeFirestoreValue([1, 'two', false]))).toEqual([1, 'two', false]);
    expect(decodeFirestoreValue(encodeFirestoreValue({ plain: 1 }))).toEqual({ plain: 1 });
    expect(decodeFirestoreValue({ legacy: { nested: 1 } })).toEqual({ legacy: { nested: 1 } });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(Number.NaN),
    Symbol('unsupported'),
  ])('rejects unsupported Firestore values without lossy coercion', (value) => {
    expect(() => encodeFirestoreValue(value)).toThrowError(expect.objectContaining({
      code: 'FIRESTORE_VALUE_UNSUPPORTED',
    }));
  });

  it.each([
    { __firestoreType: 'timestamp', seconds: '1', nanoseconds: 2 },
    { __firestoreType: 'timestamp', seconds: 1, nanoseconds: '2' },
    { __firestoreType: 'date', iso: 123 },
    { __firestoreType: 'date', iso: 'not-a-date' },
    { __firestoreType: 'date', iso: '2026-07-28T12:00:00+00:00' },
    { __firestoreType: 'bytes', base64: 123 },
    { __firestoreType: 'map', entries: 'not-an-array' },
    { __firestoreType: 'map', entries: ['not-a-pair'] },
    { __firestoreType: 'map', entries: [['key']] },
    { __firestoreType: 'map', entries: [[1, 'value']] },
    { __firestoreType: 'map', entries: [['key', 1], ['key', 2]] },
  ])('rejects malformed encoded journal values', (value) => {
    expect(() => decodeFirestoreValue(value)).toThrowError(expect.objectContaining({
      code: 'JOURNAL_VALUE_INVALID',
    }));
  });
});

describe('production lifecycle task journal metadata branch coverage', () => {
  const baseInput = {
    documents: [],
    operationId: 'op_codec_coverage',
    expectedReleaseSha: SHA,
    createdAt: CREATED_AT,
  } as const;

  it.each([
    [{ ...baseInput, operationId: '' }, 'OPERATION_ID_INVALID'],
    [{ ...baseInput, expectedReleaseSha: 'INVALID' }, 'EXPECTED_RELEASE_SHA_INVALID'],
    [{ ...baseInput, createdAt: new Date(Number.NaN) }, 'OPERATION_TIMESTAMP_INVALID'],
  ])('rejects invalid journal metadata with %s', (input, code) => {
    expect(() => buildTaskLifecycleJournalBatch(input)).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects an invalid task source before building a journal entry', () => {
    expect(() => buildTaskLifecycleJournalBatch({
      ...baseInput,
      documents: [{ id: 'task_invalid_source', data: { status: 'unknown-status' } }],
    })).toThrowError(expect.objectContaining({ code: 'TASK_SOURCE_INVALID' }));
  });
});
