import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { processCalendarAction } from '../../../domain/useCases/processCalendarAction.js';
import {
  FakeGoogleCalendarClient,
  FakeFailedEventRepository,
  FakeCalendarActionExtractionService,
} from '../../fakes.js';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('processCalendarAction', () => {
  let googleCalendarClient: FakeGoogleCalendarClient;
  let failedEventRepository: FakeFailedEventRepository;
  let calendarActionExtractionService: FakeCalendarActionExtractionService;

  beforeEach(() => {
    googleCalendarClient = new FakeGoogleCalendarClient();
    failedEventRepository = new FakeFailedEventRepository();
    calendarActionExtractionService = new FakeCalendarActionExtractionService();
    vi.clearAllMocks();
  });

  describe('when LLM extraction fails with NO_API_KEY', () => {
    it('returns NOT_CONNECTED error', async () => {
      calendarActionExtractionService.extractEventResult = err({
        code: 'NO_API_KEY',
        message: 'No API key configured',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('No API key configured');
      }
    });
  });

  describe('when LLM extraction fails with other errors', () => {
    it('returns INTERNAL_ERROR', async () => {
      calendarActionExtractionService.extractEventResult = err({
        code: 'GENERATION_ERROR',
        message: 'LLM rate limit',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('LLM rate limit');
      }
    });
  });

  describe('when extracted event is invalid', () => {
    it('saves to failed events and returns failed status', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Unclear request',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: false,
        error: 'Could not determine event time',
        reasoning: 'No specific time mentioned',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Maybe do something later',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.error).toBe('Could not determine event time');
      }

      const failedEvents = failedEventRepository.getEvents();
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0]?.error).toBe('Could not determine event time');
    });

    it('uses default error message when extracted error is null', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Unclear request',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: false,
        error: null,
        reasoning: 'Not clear',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Maybe do something later',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.error).toBe('Could not extract valid calendar event');
      }
    });
  });

  describe('when date format is invalid', () => {
    it('saves to failed events and returns failed status', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Meeting',
        start: 'invalid-date',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Has invalid start date',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting on baddate',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.error).toBe('Invalid date format');
      }

      const failedEvents = failedEventRepository.getEvents();
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0]?.error).toBe('Invalid date format');
    });
  });

  describe('when Google Calendar creation fails', () => {
    it('saves to failed events and returns failed status', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Team Meeting',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: 'Room A',
        description: 'Weekly sync',
        valid: true,
        error: null,
        reasoning: 'Clear meeting request',
      });

      googleCalendarClient.setCreateResult(
        err({ code: 'TOKEN_ERROR', message: 'Invalid token' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Team meeting tomorrow at 2pm',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.error).toBe('Invalid token');
      }

      const failedEvents = failedEventRepository.getEvents();
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0]?.error).toBe('Invalid token');
    });

    it('returns error when failed event repository fails', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Team Meeting',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: 'Room A',
        description: 'Weekly sync',
        valid: true,
        error: null,
        reasoning: 'Clear meeting request',
      });

      googleCalendarClient.setCreateResult(
        err({ code: 'TOKEN_ERROR', message: 'Invalid token' })
      );

      failedEventRepository.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Database error' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Team meeting tomorrow at 2pm',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database error');
      }
    });
  });

  describe('when event creation succeeds', () => {
    it('returns completed status with resource URL', async () => {
      const mockEvent = {
        id: 'event-abc-123',
        summary: 'Doctor Appointment',
        start: { dateTime: '2025-01-20T10:00:00' },
        end: { dateTime: '2025-01-20T11:00:00' },
        location: 'Medical Center',
        description: 'Annual checkup',
        htmlLink: 'https://calendar.google.com/event',
      };

      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Doctor Appointment',
        start: '2025-01-20T10:00:00',
        end: '2025-01-20T11:00:00',
        location: 'Medical Center',
        description: 'Annual checkup',
        valid: true,
        error: null,
        reasoning: 'Medical appointment with specific time',
      });

      googleCalendarClient.setCreateResult(ok(mockEvent));

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Doctor appointment at 10am tomorrow',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.resourceUrl).toBe('/#/calendar/event-abc-123');
      }
    });

    it('handles date-only events', async () => {
      const mockEvent = {
        id: 'event-holiday-123',
        summary: 'Company Holiday',
        start: { date: '2025-01-15' },
        end: { date: '2025-01-15' },
        htmlLink: 'https://calendar.google.com/event',
      };

      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Company Holiday',
        start: '2025-01-15',
        end: null,
        location: null,
        description: 'All day event',
        valid: true,
        error: null,
        reasoning: 'All day event with only start date',
      });

      googleCalendarClient.setCreateResult(ok(mockEvent));

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Company holiday on Jan 15',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.resourceUrl).toBe('/#/calendar/event-holiday-123');
      }
    });

    it('omits optional fields when not provided', async () => {
      const mockEvent = {
        id: 'event-123',
        summary: 'Quick Call',
        start: { dateTime: '2025-01-20T14:00:00' },
        end: { dateTime: '2025-01-20T14:30:00' },
        htmlLink: 'https://calendar.google.com/event',
      };

      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Quick Call',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T14:30:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Quick call',
      });

      googleCalendarClient.setCreateResult(ok(mockEvent));

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Quick call at 2pm',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
      }
    });
  });
});
