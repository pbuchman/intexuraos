import { describe, it, expect } from 'vitest';
import { formatCalendarCompletionMessage } from '../domain/utils/formatCalendarCompletionMessage.js';
import type { CalendarPreview } from '../domain/ports/calendarServiceClient.js';

describe('formatCalendarCompletionMessage', () => {
  const baseParams = {
    fallbackMessage: 'Calendar event created successfully',
    eventUrl: 'https://calendar.google.com/calendar/event?eid=abc123',
  };

  describe('rich message (preview available)', () => {
    it('formats message with all fields', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Team Meeting',
        start: '2025-01-15T15:00:00',
        end: '2025-01-15T16:30:00',
        duration: '1 hour 30 minutes',
        location: 'Conference Room A',
        isAllDay: false,
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('\u2705 Calendar Event Created');
      expect(result).toContain('*Team Meeting*');
      expect(result).toContain('\u{1F4C6}');
      expect(result).toContain('\u23F1 1 hour 30 minutes');
      expect(result).toContain('\u{1F4CD} Conference Room A');
      expect(result).toContain('View: https://calendar.google.com/calendar/event?eid=abc123');
    });

    it('formats message without location when null', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Quick Sync',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T10:30:00',
        duration: '30 minutes',
        location: null,
        isAllDay: false,
        generatedAt: '2025-01-15T09:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('*Quick Sync*');
      expect(result).not.toContain('\u{1F4CD}');
    });

    it('formats message without date line when start is missing', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Event without date',
        duration: '1 hour',
        location: null,
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('*Event without date*');
      expect(result).not.toContain('\u{1F4C6}'); // No date icon when start missing
      expect(result).toContain('\u23F1 1 hour');
    });

    it('formats all-day event', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Company Offsite',
        start: '2025-01-15',
        isAllDay: true,
        duration: null,
        location: 'Beach Resort',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('*Company Offsite*');
      expect(result).toContain('(All day)');
      expect(result).not.toContain('\u23F1');
    });
  });

  describe('fallback message', () => {
    it('returns basic message when preview is null', () => {
      const result = formatCalendarCompletionMessage({ ...baseParams, preview: null });

      expect(result).toContain('\u{1F4C5} Calendar event created successfully');
      expect(result).toContain('View: https://calendar.google.com/calendar/event?eid=abc123');
    });

    it('returns basic message when preview status is failed', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'failed',
        error: 'Could not parse date',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('\u{1F4C5} Calendar event created successfully');
    });

    it('returns basic message when preview summary is missing', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarCompletionMessage({ ...baseParams, preview });

      expect(result).toContain('\u{1F4C5} Calendar event created successfully');
    });
  });
});
