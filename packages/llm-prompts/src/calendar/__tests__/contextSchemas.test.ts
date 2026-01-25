import { describe, expect, it } from 'vitest';
import { CalendarEventSchema } from '../contextSchemas.js';

describe('CalendarEventSchema', () => {
  describe('valid events', () => {
    it('accepts valid event with all fields', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Team meeting',
        start: '2026-01-25T10:00:00',
        end: '2026-01-25T11:00:00',
        location: 'Room 101',
        description: 'Weekly sync',
        valid: true,
        error: null,
        reasoning: 'Clear event request',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid event with null optional fields', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Quick call',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Simple event',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid event with timezone offset', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Sync with team',
        start: '2026-01-25T10:00:00+05:00',
        end: '2026-01-25T11:00:00+05:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Event with timezone',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid event with Z timezone', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Global meeting',
        start: '2026-01-25T10:00:00Z',
        end: '2026-01-25T11:00:00Z',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'UTC event',
      });
      expect(result.success).toBe(true);
    });

    it('accepts invalid event with error message', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Ambiguous request',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: false,
        error: 'Cannot determine event time',
        reasoning: 'User said "meet sometime next week"',
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal valid event (only required fields)', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Note',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Just need to note this',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ISO date-time validation', () => {
    it('rejects slash date format', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: '2026/01/25 10:00',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path[0]).toBe('start');
      }
    });

    it('rejects date-only format', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: '2026-01-25',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path[0]).toBe('start');
      }
    });

    it('rejects invalid month', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: '2026-13-25T10:00:00',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid day', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: '2026-01-32T10:00:00',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid hour', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: '2026-01-25T25:00:00',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid minute', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: '2026-01-25T10:61:00',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid second', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: '2026-01-25T10:00:61',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('accepts null for date fields', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('required field validation', () => {
    it('rejects missing summary', () => {
      const result = CalendarEventSchema.safeParse({
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing valid', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: null,
        end: null,
        location: null,
        description: null,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing reasoning', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('type validation', () => {
    it('rejects non-string summary', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 123 as never,
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean valid', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: 'true' as never,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string error when not null', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: 123 as never,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string location when not null', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: null,
        end: null,
        location: 123 as never,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string description when not null', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Test',
        start: null,
        end: null,
        location: null,
        description: 123 as never,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts empty string summary', () => {
      const result = CalendarEventSchema.safeParse({
        summary: '',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('accepts multi-line description', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Meeting',
        start: '2026-01-25T10:00:00',
        end: '2026-01-25T11:00:00',
        location: null,
        description: 'Agenda:\n1. Review Q1 goals\n2. Discuss roadmap\n3. Action items',
        valid: true,
        error: null,
        reasoning: 'Multi-line description',
      });
      expect(result.success).toBe(true);
    });

    it('accepts special characters in location', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Off-site',
        start: '2026-01-25T10:00:00',
        end: '2026-01-25T11:00:00',
        location: '123 Main St, Suite 456, New York, NY 10001',
        description: null,
        valid: true,
        error: null,
        reasoning: 'Address with special chars',
      });
      expect(result.success).toBe(true);
    });

    it('accepts URL in location', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Virtual meeting',
        start: '2026-01-25T10:00:00',
        end: '2026-01-25T11:00:00',
        location: 'https://zoom.us/j/123456789',
        description: null,
        valid: true,
        error: null,
        reasoning: 'Video call link',
      });
      expect(result.success).toBe(true);
    });

    it('accepts very long description', () => {
      const longText = 'x'.repeat(5000);
      const result = CalendarEventSchema.safeParse({
        summary: 'Long event',
        start: null,
        end: null,
        location: null,
        description: longText,
        valid: true,
        error: null,
        reasoning: 'Detailed event',
      });
      expect(result.success).toBe(true);
    });

    it('accepts Unicode characters in summary', () => {
      const result = CalendarEventSchema.safeParse({
        summary: 'Team lunch 🍕',
        start: '2026-01-25T12:00:00',
        end: '2026-01-25T13:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Emoji in summary',
      });
      expect(result.success).toBe(true);
    });
  });
});
