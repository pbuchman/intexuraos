import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../../domain/models/cursor.js';

describe('cursor utilities', () => {
  describe('encodeCursor', () => {
    it('returns a base64url-encoded string', () => {
      const cursor = encodeCursor('2026-04-10T12:00:00.000Z', 'evt_123');
      expect(typeof cursor).toBe('string');
      expect(cursor.length).toBeGreaterThan(0);
      // base64url should not contain +, /, or = padding
      expect(cursor).not.toMatch(/[+/=]/);
    });

    it('encodes the correct JSON payload with a string sort value', () => {
      const cursor = encodeCursor('2026-04-10T12:00:00.000Z', 'evt_abc');
      const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
      const parsed = JSON.parse(decoded) as { lastSortValue: string; lastEventId: string };
      expect(parsed).toEqual({
        lastSortValue: '2026-04-10T12:00:00.000Z',
        lastEventId: 'evt_abc',
      });
    });

    it('encodes the correct JSON payload with a numeric sort value', () => {
      const cursor = encodeCursor(0.0042, 'evt_abc');
      const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
      const parsed = JSON.parse(decoded) as { lastSortValue: number; lastEventId: string };
      expect(parsed).toEqual({
        lastSortValue: 0.0042,
        lastEventId: 'evt_abc',
      });
    });
  });

  describe('decodeCursor', () => {
    it('decodes a valid cursor with a string sort value', () => {
      const cursor = encodeCursor('2026-04-10T12:00:00.000Z', 'evt_456');
      const result = decodeCursor(cursor);
      expect(result).toEqual({
        lastSortValue: '2026-04-10T12:00:00.000Z',
        lastEventId: 'evt_456',
      });
    });

    it('decodes a valid cursor with a numeric sort value', () => {
      const cursor = encodeCursor(1500, 'evt_789');
      const result = decodeCursor(cursor);
      expect(result).toEqual({
        lastSortValue: 1500,
        lastEventId: 'evt_789',
      });
    });

    it('returns null for invalid base64url', () => {
      const result = decodeCursor('!!!not-valid!!!');
      expect(result).toBeNull();
    });

    it('returns null for valid base64url but invalid JSON', () => {
      const cursor = Buffer.from('not json at all').toString('base64url');
      const result = decodeCursor(cursor);
      expect(result).toBeNull();
    });

    it('returns null when JSON is missing lastSortValue', () => {
      const cursor = Buffer.from(JSON.stringify({ lastEventId: 'evt_1' })).toString('base64url');
      const result = decodeCursor(cursor);
      expect(result).toBeNull();
    });

    it('returns null when JSON is missing lastEventId', () => {
      const cursor = Buffer.from(JSON.stringify({ lastSortValue: '2026-01-01T00:00:00Z' })).toString('base64url');
      const result = decodeCursor(cursor);
      expect(result).toBeNull();
    });

    it('returns null when lastSortValue is a boolean', () => {
      const cursor = Buffer.from(JSON.stringify({ lastSortValue: true, lastEventId: 'evt_1' })).toString('base64url');
      const result = decodeCursor(cursor);
      expect(result).toBeNull();
    });

    it('returns null when lastEventId is not a string', () => {
      const cursor = Buffer.from(JSON.stringify({ lastSortValue: '2026-01-01', lastEventId: 42 })).toString(
        'base64url',
      );
      const result = decodeCursor(cursor);
      expect(result).toBeNull();
    });

    it('returns null when decoded JSON is null', () => {
      const cursor = Buffer.from('null').toString('base64url');
      const result = decodeCursor(cursor);
      expect(result).toBeNull();
    });

    it('returns null when decoded JSON is an array', () => {
      const cursor = Buffer.from('[]').toString('base64url');
      const result = decodeCursor(cursor);
      expect(result).toBeNull();
    });

    it('roundtrips correctly with string sort value and special characters', () => {
      const timestamp = '2026-12-31T23:59:59.999Z';
      const eventId = 'evt_special-chars_123/456';
      const cursor = encodeCursor(timestamp, eventId);
      const result = decodeCursor(cursor);
      expect(result).toEqual({
        lastSortValue: timestamp,
        lastEventId: eventId,
      });
    });

    it('roundtrips correctly with numeric sort value', () => {
      const costUsd = 0.00325;
      const eventId = 'evt_cost_001';
      const cursor = encodeCursor(costUsd, eventId);
      const result = decodeCursor(cursor);
      expect(result).toEqual({
        lastSortValue: costUsd,
        lastEventId: eventId,
      });
    });
  });
});
