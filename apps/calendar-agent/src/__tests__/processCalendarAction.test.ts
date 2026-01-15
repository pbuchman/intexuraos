import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err } from '@intexuraos/common-core';
import { processCalendarAction } from '../domain/useCases/processCalendarAction.js';
import {
  FakeGoogleCalendarClient,
  FakeFailedEventRepository,
  FakeCalendarActionExtractionService,
} from './fakes.js';
import type { Logger } from '@intexuraos/common-core';
import type { ExtractionError } from '../infra/gemini/calendarActionExtractionService.js';

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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('successful event creation', () => {
    it('creates calendar event when extraction is valid', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Team Meeting',
          start: '2025-01-15T14:00:00',
          end: '2025-01-15T15:00:00',
          location: 'Conference Room A',
          description: 'Weekly team sync',
          valid: true,
          error: null,
          reasoning: 'Clear meeting request',
        },
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Team meeting at 2pm tomorrow',
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
        expect(result.value.resourceUrl).toMatch(/^\/#\/calendar\/event-\d+$/);
      }
    });

    it('creates event with date-only (no time)', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'All Day Event',
          start: '2025-01-15',
          end: null,
          location: null,
          description: 'Company holiday',
          valid: true,
          error: null,
          reasoning: 'All day event',
        },
      };

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
      }
    });

    it('creates event with end date fallback to start when end is null', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Quick Call',
          start: '2025-01-15T14:00:00',
          end: null,
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'Quick call',
        },
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Quick call tomorrow at 2pm',
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

  describe('invalid event handling', () => {
    it('saves to failed events when extraction returns valid=false', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Unclear Request',
          start: null,
          end: null,
          location: null,
          description: null,
          valid: false,
          error: 'Could not determine event time',
          reasoning: 'No specific time mentioned',
        },
      };

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
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.actionId).toBe('action-123');
      expect(failedEvents[0]?.summary).toBe('Unclear Request');
    });

    it('saves to failed events when start date format is invalid', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Invalid Date Event',
          start: 'invalid-date',
          end: null,
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Invalid date',
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
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.error).toBe('Invalid date format');
    });

    it('returns error when failed event repository create fails', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Test',
          start: null,
          end: null,
          location: null,
          description: null,
          valid: false,
          error: 'No time specified',
          reasoning: 'test',
        },
      };

      failedEventRepository.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Database error' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Test',
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
      }
    });
  });

  describe('extraction errors', () => {
    it('returns NOT_CONNECTED error when extraction returns NO_API_KEY', async () => {
      const extractionError: ExtractionError = {
        code: 'NO_API_KEY',
        message: 'No API key configured for LLM',
      };

      calendarActionExtractionService.extractEventResult = {
        ok: false,
        error: extractionError,
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Test text',
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
        expect(result.error.message).toBe('No API key configured for LLM');
      }
    });

    it('returns INTERNAL_ERROR for other extraction errors', async () => {
      const extractionError: ExtractionError = {
        code: 'GENERATION_ERROR',
        message: 'LLM service unavailable',
        details: { llmErrorCode: 'SERVICE_UNAVAILABLE' },
      };

      calendarActionExtractionService.extractEventResult = {
        ok: false,
        error: extractionError,
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Test text',
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
        expect(result.error.message).toBe('LLM service unavailable');
      }
    });

    it('returns INTERNAL_ERROR for USER_SERVICE_ERROR', async () => {
      const extractionError: ExtractionError = {
        code: 'USER_SERVICE_ERROR',
        message: 'Failed to fetch user settings',
        details: { userServiceError: 'User not found' },
      };

      calendarActionExtractionService.extractEventResult = {
        ok: false,
        error: extractionError,
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Test text',
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
      }
    });
  });

  describe('Google Calendar errors', () => {
    it('saves to failed events when Google Calendar creation fails', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Test Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };

      googleCalendarClient.setCreateResult(
        err({ code: 'TOKEN_ERROR', message: 'Invalid access token' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Test event at 10am',
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
        expect(result.value.error).toBe('Invalid access token');
      }

      const failedEvents = failedEventRepository.getEvents();
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.error).toBe('Invalid access token');
    });

    it('returns error when failed event repository create fails after calendar error', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Test Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };

      googleCalendarClient.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Google Calendar API error' })
      );

      failedEventRepository.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Database error' })
      );

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Test event',
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
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty text', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: '',
          start: null,
          end: null,
          location: null,
          description: null,
          valid: false,
          error: 'No event details provided',
          reasoning: 'Empty input',
        },
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: '',
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
      }
    });

    it('handles event with only start date (ISO date format)', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Birthday Party',
          start: '2025-02-10',
          end: '2025-02-10',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'All day event',
        },
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Birthday on Feb 10',
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

    it('handles event with dateTime (ISO datetime format)', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Conference Call',
          start: '2025-01-15T14:30:00',
          end: '2025-01-15T15:30:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'Timed event',
        },
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Conference call at 2:30pm',
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

    it('creates resource URL with correct format', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Test Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };

      const result = await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Test event',
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
        expect(result.value.resourceUrl).toMatch(/^\/#\/calendar\/event-\d+$/);
      }
    });
  });

  describe('logging', () => {
    it('logs entry with action details', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Test Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };

      await processCalendarAction(
        {
          actionId: 'action-abc',
          userId: 'user-xyz',
          text: 'Some calendar action text here',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-xyz',
          actionId: 'action-abc',
          textLength: 30,
        }),
        'processCalendarAction: entry'
      );
    });

    it('logs extraction completion', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Meeting',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'Clear meeting',
        },
      };

      await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting at 10am',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user-456',
          actionId: 'action-123',
          summary: 'Meeting',
          valid: true,
        },
        'processCalendarAction: extraction complete'
      );
    });

    it('logs Google Calendar creation success', async () => {
      calendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Created Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };

      await processCalendarAction(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Create event',
        },
        {
          googleCalendarClient,
          failedEventRepository,
          calendarActionExtractionService,
          logger: mockLogger,
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user-456',
          actionId: 'action-123',
          summary: 'Created Event',
        },
        'processCalendarAction: creating Google Calendar event'
      );
    });
  });
});
