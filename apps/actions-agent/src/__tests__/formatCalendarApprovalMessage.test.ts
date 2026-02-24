import { describe, it, expect } from 'vitest';
import { formatCalendarApprovalMessage } from '../domain/utils/formatCalendarApprovalMessage.js';
import type { CalendarPreview } from '../domain/ports/calendarServiceClient.js';

const BASE_PARAMS = {
  actionTitle: 'Team Meeting',
  actionId: 'action-123',
  webAppUrl: 'https://app.intexuraos.com',
};

const REVIEW_URL = 'https://app.intexuraos.com/#/inbox?action=action-123';

describe('formatCalendarApprovalMessage', () => {
  describe('rich preview (all fields)', () => {
    it('formats message with title, date/time, duration, and location', () => {
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

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('\u{1F4C5} Calendar Event');
      expect(result).toContain('*Team Meeting*');
      expect(result).toContain('\u{1F4C6}');
      expect(result).toContain('\u23F1 1 hour 30 minutes');
      expect(result).toContain('\u{1F4CD} Conference Room A');
      expect(result).toContain(`Review: ${REVIEW_URL}`);
    });
  });

  describe('missing optional fields', () => {
    it('formats message without location when not available', () => {
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

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('*Quick Sync*');
      expect(result).toContain('\u23F1 30 minutes');
      expect(result).not.toContain('\u{1F4CD}');
    });

    it('formats message without end time', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Open-ended Meeting',
        start: '2025-01-15T14:00:00',
        end: null,
        duration: null,
        isAllDay: false,
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('*Open-ended Meeting*');
      expect(result).toContain('\u{1F4C6}');
      expect(result).not.toContain('\u2013'); // no dash for time range
      expect(result).not.toContain('\u23F1');
    });
  });

  describe('all-day events', () => {
    it('formats all-day event correctly', () => {
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

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('*Company Offsite*');
      expect(result).toContain('(All day)');
      expect(result).toContain('\u{1F4CD} Beach Resort');
      expect(result).not.toContain('\u23F1');
    });
  });

  describe('fallback messages', () => {
    it('returns basic message when preview is null', () => {
      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview: null });

      expect(result).toContain('\u{1F4C5} New calendar event ready for approval: "Team Meeting"');
      expect(result).toContain(`Review: ${REVIEW_URL}`);
      expect(result).not.toContain('Calendar Event');
    });

    it('returns basic message when preview status is failed', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'failed',
        error: 'Could not parse date',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('\u{1F4C5} New calendar event ready for approval: "Team Meeting"');
      expect(result).toContain(`Review: ${REVIEW_URL}`);
    });

    it('returns basic message when preview status is pending', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'pending',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('\u{1F4C5} New calendar event ready for approval: "Team Meeting"');
    });

    it('returns basic message when preview is ready but summary is missing', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('\u{1F4C5} New calendar event ready for approval: "Team Meeting"');
    });
  });

  describe('edge cases', () => {
    it('handles preview with only summary (no start time)', () => {
      const preview: CalendarPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Some Event',
        generatedAt: '2025-01-15T10:00:00Z',
      };

      const result = formatCalendarApprovalMessage({ ...BASE_PARAMS, preview });

      expect(result).toContain('*Some Event*');
      expect(result).not.toContain('\u{1F4C6}');
      expect(result).toContain(`Review: ${REVIEW_URL}`);
    });
  });
});
