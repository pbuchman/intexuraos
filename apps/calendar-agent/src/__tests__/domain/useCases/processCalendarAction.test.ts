import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, ServiceErrorCodes } from '@intexuraos/common-core';
import { processCalendarAction } from '../../../domain/useCases/processCalendarAction.js';
import {
  FakeGoogleCalendarClient,
  FakeFailedEventRepository,
  FakeCalendarActionExtractionService,
  FakeUserServiceClient,
  FakeProcessedActionRepository,
} from '../../fakes.js';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('processCalendarAction', () => {
  let userServiceClient: FakeUserServiceClient;
  let googleCalendarClient: FakeGoogleCalendarClient;
  let failedEventRepository: FakeFailedEventRepository;
  let calendarActionExtractionService: FakeCalendarActionExtractionService;
  let processedActionRepository: FakeProcessedActionRepository;

  beforeEach(() => {
    userServiceClient = new FakeUserServiceClient();
    googleCalendarClient = new FakeGoogleCalendarClient();
    failedEventRepository = new FakeFailedEventRepository();
    calendarActionExtractionService = new FakeCalendarActionExtractionService();
    processedActionRepository = new FakeProcessedActionRepository();
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Could not determine event time');
        expect(result.value.errorCode).toBe(ServiceErrorCodes.EXTRACTION_FAILED);
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Could not extract valid calendar event');
        expect(result.value.errorCode).toBe(ServiceErrorCodes.EXTRACTION_FAILED);
      }
    });

    it('returns error when repository fails to save invalid event', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Unclear request',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: false,
        error: 'Could not determine time',
        reasoning: 'No specific time mentioned',
      });

      failedEventRepository.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Database unavailable' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Maybe do something later',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database unavailable');
      }
    });

    it('handles edge case where valid flag is true but dates are null', async () => {
      // Edge case: LLM marks event as valid but with null dates
      // This tests the toEventDateTime(null) path (line 61)
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Task reminder',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true, // Flagged as valid despite null dates
        error: null,
        reasoning: 'Reminder task',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Remind me to do something',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      // Null dates fail the isValidIsoDateTime check
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Invalid date format');
        expect(result.value.errorCode).toBe(ServiceErrorCodes.VALIDATION_ERROR);
      }

      const failedEvents = failedEventRepository.getEvents();
      expect(failedEvents.length).toBe(1);
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Invalid date format');
        expect(result.value.errorCode).toBe(ServiceErrorCodes.VALIDATION_ERROR);
      }

      const failedEvents = failedEventRepository.getEvents();
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0]?.error).toBe('Invalid date format');
    });

    it('returns error when repository fails to save invalid date format event', async () => {
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

      failedEventRepository.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Storage unavailable' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting on baddate',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Storage unavailable');
      }
    });
  });

  describe('when OAuth token retrieval fails', () => {
    it('returns error without creating event', async () => {
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

      userServiceClient.setTokenError('NOT_CONNECTED', 'Google Calendar not connected');

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Team meeting tomorrow at 2pm',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Google Calendar not connected');
      }
    });

    it('returns TOKEN_ERROR when token is invalid', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Team Meeting',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Clear meeting request',
      });

      userServiceClient.setTokenError('TOKEN_ERROR', 'Token expired');

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Team meeting tomorrow at 2pm',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_ERROR');
        expect(result.error.message).toBe('Token expired');
      }
    });
  });

  describe('when Google Calendar creation fails', () => {
    it('saves to failed events and propagates TOKEN_ERROR', async () => {
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_ERROR');
        expect(result.error.message).toBe('Invalid token');
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Event "Doctor Appointment" created successfully');
        expect(result.value.resourceUrl).toBe('/#/calendar');
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Event "Company Holiday" created successfully');
        expect(result.value.resourceUrl).toBe('/#/calendar');
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
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
      }
    });
  });

  describe('timezone handling', () => {
    it('fetches calendar timezone and includes it in event creation', async () => {
      const mockEvent = {
        id: 'event-with-timezone',
        summary: 'Timezone Test',
        start: { dateTime: '2025-01-20T14:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2025-01-20T15:00:00', timeZone: 'America/New_York' },
        htmlLink: 'https://calendar.google.com/event',
      };

      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Timezone Test',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Test with timezone',
      });

      googleCalendarClient.setCalendarTimezone('America/New_York');
      googleCalendarClient.setCreateResult(ok(mockEvent));

      const result = await processCalendarAction(
        {
          actionId: 'action-timezone',
          userId: 'user-456',
          text: 'Meeting at 2pm',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
      }
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ timeZone: 'America/New_York' }),
        expect.stringContaining('creating Google Calendar event')
      );
    });

    it('returns TOKEN_ERROR when timezone fetch fails with PERMISSION_DENIED', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Reconnect Test',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Test scope missing',
      });

      googleCalendarClient.setTimezoneResult(
        err({ code: 'PERMISSION_DENIED', message: 'Missing calendar.readonly scope' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-reconnect',
          userId: 'user-456',
          text: 'Meeting at 2pm',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_ERROR');
        expect(result.error.message).toContain('reconnect');
      }
    });

    it('returns error when fetching calendar timezone fails with other errors', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Timezone Fail Test',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Test timezone failure',
      });

      googleCalendarClient.setTimezoneResult(
        err({ code: 'INTERNAL_ERROR', message: 'API unavailable' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-timezone-fail',
          userId: 'user-456',
          text: 'Meeting at 2pm',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('API unavailable');
      }
    });

    it('does not include timezone for all-day events (date only)', async () => {
      const mockEvent = {
        id: 'event-all-day',
        summary: 'All Day Event',
        start: { date: '2025-01-20' },
        end: { date: '2025-01-20' },
        htmlLink: 'https://calendar.google.com/event',
      };

      calendarActionExtractionService.extractEventResult = ok({
        summary: 'All Day Event',
        start: '2025-01-20',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'All day event without time',
      });

      googleCalendarClient.setCalendarTimezone('Europe/London');
      googleCalendarClient.setCreateResult(ok(mockEvent));

      const result = await processCalendarAction(
        {
          actionId: 'action-all-day',
          userId: 'user-456',
          text: 'Holiday on Jan 20',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
      }
    });
  });

  describe('idempotency', () => {
    it('returns cached result when action was already processed', async () => {
      processedActionRepository.seedProcessedAction({
        actionId: 'action-123',
        userId: 'user-456',
        eventId: 'existing-event-id',
        resourceUrl: '/#/calendar',
        createdAt: '2025-01-15T10:00:00Z',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow at 2pm',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.resourceUrl).toBe('/#/calendar');
      }
    });

    it('saves processed action after successful event creation', async () => {
      const mockEvent = {
        id: 'new-event-123',
        summary: 'New Meeting',
        start: { dateTime: '2025-01-20T14:00:00' },
        end: { dateTime: '2025-01-20T15:00:00' },
        htmlLink: 'https://calendar.google.com/event',
      };

      calendarActionExtractionService.extractEventResult = ok({
        summary: 'New Meeting',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Clear meeting request',
      });

      googleCalendarClient.setCreateResult(ok(mockEvent));

      const result = await processCalendarAction(
        {
          actionId: 'action-new',
          userId: 'user-456',
          text: 'New meeting tomorrow',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      expect(processedActionRepository.count).toBe(1);
    });

    it('returns error when idempotency check fails', async () => {
      processedActionRepository.setGetByActionIdResult(
        err({ code: 'INTERNAL_ERROR', message: 'Database unavailable' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Database unavailable');
      }
    });

    it('succeeds even when saving processed action fails', async () => {
      const mockEvent = {
        id: 'event-save-fail',
        summary: 'Test Event',
        start: { dateTime: '2025-01-20T14:00:00' },
        end: { dateTime: '2025-01-20T15:00:00' },
        htmlLink: 'https://calendar.google.com/event',
      };

      calendarActionExtractionService.extractEventResult = ok({
        summary: 'Test Event',
        start: '2025-01-20T14:00:00',
        end: '2025-01-20T15:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Test',
      });

      googleCalendarClient.setCreateResult(ok(mockEvent));

      processedActionRepository.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Failed to save' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-save-fail',
          userId: 'user-456',
          text: 'Test event',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'action-save-fail' }),
        expect.stringContaining('failed to save processed action')
      );
    });

    it('handles null start time by returning failed status with invalid date error', async () => {
      calendarActionExtractionService.extractEventResult = ok({
        summary: 'All Day Event',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Event without time',
      });

      const result = await processCalendarAction(
        {
          actionId: 'action-null-times',
          userId: 'user-456',
          text: 'Event without specific time',
        },
        {
          userServiceClient,
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          processedActionRepository,
          logger: mockLogger,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Invalid date format');
        expect(result.value.errorCode).toBe(ServiceErrorCodes.VALIDATION_ERROR);
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: 'action-null-times', start: null }),
        expect.stringContaining('invalid start date format')
      );
    });
  });
});
