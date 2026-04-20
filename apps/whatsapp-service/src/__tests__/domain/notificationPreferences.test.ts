/**
 * Tests for NotificationPreferences domain model.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_LEVEL,
  isNotificationLevel,
} from '../../domain/whatsapp/models/NotificationPreferences.js';

describe('NotificationPreferences', () => {
  describe('DEFAULT_NOTIFICATION_LEVEL', () => {
    it("defaults to 'all'", () => {
      expect(DEFAULT_NOTIFICATION_LEVEL).toBe('all');
    });
  });

  describe('isNotificationLevel', () => {
    it("accepts 'all'", () => {
      expect(isNotificationLevel('all')).toBe(true);
    });

    it("accepts 'important'", () => {
      expect(isNotificationLevel('important')).toBe(true);
    });

    it("rejects 'ALL' (case-sensitive)", () => {
      expect(isNotificationLevel('ALL')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isNotificationLevel('')).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isNotificationLevel(undefined)).toBe(false);
    });

    it('rejects null', () => {
      expect(isNotificationLevel(null)).toBe(false);
    });

    it('rejects numbers', () => {
      expect(isNotificationLevel(42)).toBe(false);
    });
  });
});
