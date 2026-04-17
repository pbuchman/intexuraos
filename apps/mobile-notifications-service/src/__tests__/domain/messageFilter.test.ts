/**
 * Tests for filterAndDedupeNotifications domain utility.
 */
import { describe, expect, it } from 'vitest';
import {
  filterAndDedupeNotifications,
  type RawNotification,
} from '../../domain/messageFilter.js';

function makeRaw(overrides: Partial<RawNotification> = {}): RawNotification {
  return {
    sender: 'Alice',
    text: 'Hello',
    postTime: '1000',
    title: 'Chat',
    app: 'com.example.chat',
    ...overrides,
  };
}

describe('filterAndDedupeNotifications', () => {
  describe('empty input', () => {
    it('returns empty array for empty input', () => {
      expect(filterAndDedupeNotifications([])).toEqual([]);
    });
  });

  describe('meta-row removal', () => {
    it('drops "(N new messages)" pattern', () => {
      const raw = [makeRaw({ text: '(3 new messages)' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('drops "(12 new messages)" pattern', () => {
      const raw = [makeRaw({ text: '(12 new messages)' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('drops "N new messages" without parens', () => {
      const raw = [makeRaw({ text: '5 new messages' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('drops "X messages in Y chats"', () => {
      const raw = [makeRaw({ text: '10 messages in 3 chats' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('drops "Y photos"', () => {
      const raw = [makeRaw({ text: '4 photos' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('drops "Y videos"', () => {
      const raw = [makeRaw({ text: '2 videos' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('drops "N attachments"', () => {
      const raw = [makeRaw({ text: '7 attachments' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('keeps normal message text', () => {
      const raw = [makeRaw({ text: 'Hey, how are you?' })];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('Hey, how are you?');
    });

    it('does not drop partial matches like "sent 3 new messages"', () => {
      const raw = [makeRaw({ text: 'sent 3 new messages today' })];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(1);
    });
  });

  describe('postTime parsing', () => {
    it('drops message with empty string postTime', () => {
      const raw = [makeRaw({ postTime: '' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('drops message with non-numeric postTime', () => {
      const raw = [makeRaw({ postTime: 'abc' })];
      expect(filterAndDedupeNotifications(raw)).toEqual([]);
    });

    it('does not throw for malformed postTime', () => {
      expect(() =>
        filterAndDedupeNotifications([makeRaw({ postTime: 'not-a-number' })])
      ).not.toThrow();
    });

    it('parses valid postTime as integer seconds', () => {
      const raw = [makeRaw({ postTime: '1700000000' })];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(1);
      expect(result[0]?.postTimeSec).toBe(1700000000);
    });

    it('truncates float-string postTime to integer', () => {
      const raw = [makeRaw({ postTime: '1000.9' })];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(1);
      expect(result[0]?.postTimeSec).toBe(1000);
    });
  });

  describe('deduplication within 90-second window', () => {
    it('keeps only the earliest when two identical (sender, text) arrive within 90s', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1000' }),
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1050' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(1);
      expect(result[0]?.postTimeSec).toBe(1000);
    });

    it('keeps both when |t1 - t2| > 90', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1000' }),
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1091' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(2);
    });

    it('keeps only the earliest at the exact 90s boundary (|diff| = 90)', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1000' }),
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1090' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(1);
      expect(result[0]?.postTimeSec).toBe(1000);
    });

    it('does NOT deduplicate different senders with identical text', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1000' }),
        makeRaw({ sender: 'Bob', text: 'Hello', postTime: '1010' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(2);
    });

    it('does NOT deduplicate same sender with different text', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'Hello', postTime: '1000' }),
        makeRaw({ sender: 'Alice', text: 'World', postTime: '1010' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(2);
    });

    it('handles cluster of 3 within 90s, keeps earliest', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'Hi', postTime: '1000' }),
        makeRaw({ sender: 'Alice', text: 'Hi', postTime: '1045' }),
        makeRaw({ sender: 'Alice', text: 'Hi', postTime: '1080' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(1);
      expect(result[0]?.postTimeSec).toBe(1000);
    });

    it('uses anchor-reset semantics: kept message becomes new anchor', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'Hi', postTime: '1000' }),
        makeRaw({ sender: 'Alice', text: 'Hi', postTime: '1080' }),
        makeRaw({ sender: 'Alice', text: 'Hi', postTime: '1160' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result).toHaveLength(2);
      expect(result[0]?.postTimeSec).toBe(1000);
      expect(result[1]?.postTimeSec).toBe(1160);
    });
  });

  describe('output ordering', () => {
    it('returns messages sorted ascending by postTimeSec', () => {
      const raw = [
        makeRaw({ sender: 'Alice', text: 'msg1', postTime: '3000' }),
        makeRaw({ sender: 'Bob', text: 'msg2', postTime: '1000' }),
        makeRaw({ sender: 'Carol', text: 'msg3', postTime: '2000' }),
      ];
      const result = filterAndDedupeNotifications(raw);
      expect(result.map((m) => m.postTimeSec)).toEqual([1000, 2000, 3000]);
    });
  });

  describe('output shape', () => {
    it('maps to CleanMessage fields (sender, text, postTimeSec)', () => {
      const raw = [makeRaw({ sender: 'Alice', text: 'Hello', postTime: '5000' })];
      const result = filterAndDedupeNotifications(raw);
      expect(result[0]).toEqual({ sender: 'Alice', text: 'Hello', postTimeSec: 5000 });
    });
  });
});
