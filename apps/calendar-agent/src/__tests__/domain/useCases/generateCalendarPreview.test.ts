/**
 * Tests for generateCalendarPreview use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { generateCalendarPreview, type GenerateCalendarPreviewDeps } from '../../../domain/useCases/generateCalendarPreview.js';
import { FakeCalendarActionExtractionService, FakeCalendarPreviewRepository } from '../../fakes.js';

describe('generateCalendarPreview', () => {
  let extractionService: FakeCalendarActionExtractionService;
  let previewRepository: FakeCalendarPreviewRepository;
  let logger: Logger;
  let deps: GenerateCalendarPreviewDeps;

  beforeEach(() => {
    extractionService = new FakeCalendarActionExtractionService();
    previewRepository = new FakeCalendarPreviewRepository();
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    deps = {
      calendarActionExtractionService: extractionService,
      calendarPreviewRepository: previewRepository,
      logger,
    };
  });

  describe('successful preview generation', () => {
    it('generates preview from valid event extraction', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Lunch with Monika',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T15:00:00',
        location: 'Restaurant',
        description: 'Business lunch',
        valid: true,
        error: null,
        reasoning: 'User requested lunch at 2pm tomorrow',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Lunch with Monika tomorrow at 2pm',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.actionId).toBe('action-123');
        expect(result.value.preview.userId).toBe('user-456');
        expect(result.value.preview.status).toBe('ready');
        expect(result.value.preview.summary).toBe('Lunch with Monika');
        expect(result.value.preview.start).toBe('2025-01-15T14:00:00');
        expect(result.value.preview.end).toBe('2025-01-15T15:00:00');
        expect(result.value.preview.location).toBe('Restaurant');
        expect(result.value.preview.duration).toBe('1 hour');
        expect(result.value.preview.isAllDay).toBe(false);
      }
    });

    it('calculates duration for multi-hour events', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Workshop',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T13:30:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Half-day workshop',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Workshop from 10am to 1:30pm',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBe('3 hours 30 minutes');
      }
    });

    it('detects all-day events', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Conference',
        start: '2025-01-15',
        end: '2025-01-15',
        location: 'Convention Center',
        description: null,
        valid: true,
        error: null,
        reasoning: 'All day conference',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Conference on January 15th',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.isAllDay).toBe(true);
        expect(result.value.preview.duration).toBeNull();
      }
    });

    it('returns existing preview without regenerating', async () => {
      const existingPreview = {
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready' as const,
        summary: 'Existing Event',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T15:00:00',
        generatedAt: '2025-01-14T10:00:00Z',
      };
      previewRepository.seedPreview(existingPreview);

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'New text that should be ignored',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.summary).toBe('Existing Event');
      }
    });
  });

  describe('failed preview generation', () => {
    it('handles invalid extraction result', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Something',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: false,
        error: 'Could not determine event date',
        reasoning: 'No date information in text',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Do something',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.status).toBe('failed');
        expect(result.value.preview.error).toBe('Could not determine event date');
      }
    });

    it('handles extraction service error', async () => {
      extractionService.extractEventResult = err({
        code: 'NO_API_KEY',
        message: 'User has no API key configured',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.status).toBe('failed');
        expect(result.value.preview.error).toBe('User has no API key configured');
      }
    });
  });

  describe('repository errors', () => {
    it('returns error when checking existing preview fails', async () => {
      previewRepository.setGetByActionIdResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Firestore unavailable',
      }));

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when creating pending preview fails', async () => {
      previewRepository.setCreateResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Firestore write error',
      }));

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns error when final update fails', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Meeting scheduled',
      });

      previewRepository.setUpdateResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Firestore update error',
      }));

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting tomorrow at 10am',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('duration calculation edge cases', () => {
    it('handles null end time', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Open ended event',
        start: '2025-01-15T10:00:00',
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'No end time specified',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Event at 10am',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBeNull();
      }
    });

    it('handles short duration (minutes only)', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Quick call',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T10:15:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: '15 minute call',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Quick 15 min call at 10am',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBe('15 minutes');
      }
    });

    it('handles exactly 1 hour duration', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: '1 hour meeting',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: '1 hour meeting at 10am',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBe('1 hour');
      }
    });

    it('handles exactly 2 hours duration (plural hours, zero minutes)', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Long Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T12:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: '2 hour meeting',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: '2 hour meeting at 10am',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBe('2 hours');
      }
    });

    it('handles 1 hour 30 minutes duration (hours and minutes)', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Extended Standup',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T11:30:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: '1 hour 30 minute standup',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: '1.5 hour standup at 10am',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBe('1 hour 30 minutes');
      }
    });

    it('handles 2 hours 1 minute duration (plural hours, singular minute)', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Oddly Timed Meeting',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T12:01:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: '2 hours and 1 minute meeting',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Meeting from 10am to 12:01pm',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBe('2 hours 1 minute');
      }
    });

    it('handles 1 minute duration', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Reminder',
        start: '2025-01-15T10:00:00',
        end: '2025-01-15T10:01:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: '1 minute reminder',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: '1 minute reminder',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBe('1 minute');
      }
    });

    it('handles negative duration (end before start) by returning null', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Malformed event',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T10:00:00', // End is before start
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'LLM returned end before start',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Some event',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        // Duration should be null when end is before start (graceful degradation)
        expect(result.value.preview.duration).toBeNull();
      }
    });

    it('handles null start time by returning null duration', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Event with no start',
        start: null,
        end: '2025-01-15T15:00:00',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'No start time provided',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Some event ending at 3pm',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBeNull();
      }
    });

    it('handles zero duration (start equals end) by returning null', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Instant event',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T14:00:00', // Same as start
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Start and end are the same',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Zero duration event',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.duration).toBeNull();
      }
    });

    it('handles invalid date strings gracefully by returning null duration', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Event with bad dates',
        start: 'not-a-valid-date',
        end: 'also-invalid',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'LLM returned invalid date formats',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Event with invalid dates',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        // Duration should be null due to date parsing failure (try-catch path)
        expect(result.value.preview.duration).toBeNull();
        // But the preview should still be generated as ready
        expect(result.value.preview.status).toBe('ready');
      }
    });
  });

  describe('isAllDayEvent detection edge cases', () => {
    it('does NOT detect partial date format as all-day (2025-1-1)', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Partial date event',
        start: '2025-1-1', // Partial format (not YYYY-MM-DD)
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Partial date format from LLM',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Event on Jan 1st',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        // Should NOT be detected as all-day since format is not YYYY-MM-DD
        expect(result.value.preview.isAllDay).toBe(false);
      }
    });

    it('detects proper YYYY-MM-DD format as all-day event', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Full date event',
        start: '2025-01-15', // Proper YYYY-MM-DD format
        end: null,
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'Full date format',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Event on Jan 15th',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.isAllDay).toBe(true);
      }
    });

    it('does NOT detect null start as all-day', async () => {
      extractionService.extractEventResult = ok({
        summary: 'No start event',
        start: null,
        end: '2025-01-15',
        location: null,
        description: null,
        valid: true,
        error: null,
        reasoning: 'No start time provided',
      });

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Event ending Jan 15th',
          currentDate: '2025-01-14',
        },
        deps
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.isAllDay).toBe(false);
      }
    });
  });

  describe('update failure during invalid extraction', () => {
    it('still returns failed preview when update fails for invalid extraction', async () => {
      extractionService.extractEventResult = ok({
        summary: 'Something',
        start: null,
        end: null,
        location: null,
        description: null,
        valid: false,
        error: 'Could not determine event date',
        reasoning: 'No date information in text',
      });

      // Simulate update failure
      previewRepository.setUpdateResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Firestore update failed',
      }));

      const result = await generateCalendarPreview(
        {
          actionId: 'action-123',
          userId: 'user-456',
          text: 'Do something',
          currentDate: '2025-01-14',
        },
        deps
      );

      // Should still succeed with failed preview (graceful degradation)
      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.preview.status).toBe('failed');
        expect(result.value.preview.error).toBe('Could not determine event date');
      }

      // Verify logger.warn was called for the update failure
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('v8-ignore block coverage', () => {
    describe('calculateDuration: minutes === 0 branch (lines 62-66)', () => {
      it('returns "2 hours" for exactly 2 hour event', async () => {
        extractionService.extractEventResult = ok({
          summary: 'Two Hour Meeting',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T12:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'Exactly 2 hours',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-dur-2h',
            userId: 'user-456',
            text: 'Two hour meeting',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.duration).toBe('2 hours');
        }
      });

      it('returns "1 hour" for exactly 1 hour event (singular)', async () => {
        extractionService.extractEventResult = ok({
          summary: 'One Hour Meeting',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'Exactly 1 hour',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-dur-1h',
            userId: 'user-456',
            text: 'One hour meeting',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.duration).toBe('1 hour');
        }
      });
    });

    describe('calculateDuration: hours + minutes return string (lines 68-70)', () => {
      it('returns "1 hour 30 minutes" for 90 minute event', async () => {
        extractionService.extractEventResult = ok({
          summary: 'Ninety Minute Session',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:30:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: '90 minutes',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-dur-90m',
            userId: 'user-456',
            text: '90 minute session',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.duration).toBe('1 hour 30 minutes');
        }
      });

      it('returns "2 hours 15 minutes" for 135 minute event', async () => {
        extractionService.extractEventResult = ok({
          summary: 'Extended Workshop',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T12:15:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: '2 hours 15 minutes',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-dur-135m',
            userId: 'user-456',
            text: 'Extended workshop',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.duration).toBe('2 hours 15 minutes');
        }
      });

      it('returns "1 hour 1 minute" for 61 minute event (singular minute)', async () => {
        extractionService.extractEventResult = ok({
          summary: 'Slightly Over An Hour',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:01:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: '1 hour 1 minute',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-dur-61m',
            userId: 'user-456',
            text: 'Slightly over an hour meeting',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.duration).toBe('1 hour 1 minute');
        }
      });
    });

    describe('extraction failure with repo update also failing (lines 135-139)', () => {
      it('returns failed preview even when updating to failed status also fails', async () => {
        // Extraction service returns an error
        extractionService.extractEventResult = err({
          code: 'GENERATION_ERROR',
          message: 'LLM generation failed',
        });

        // Repository update also fails
        previewRepository.setUpdateResult(err({
          code: 'INTERNAL_ERROR',
          message: 'Firestore update failed during error recovery',
        }));

        const result = await generateCalendarPreview(
          {
            actionId: 'action-double-fail',
            userId: 'user-456',
            text: 'Meeting tomorrow',
            currentDate: '2025-01-14',
          },
          deps
        );

        // Should still return ok with a failed preview (graceful degradation)
        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.status).toBe('failed');
          expect(result.value.preview.error).toBe('LLM generation failed');
        }

        // Verify logger.warn was called for the update failure
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ actionId: 'action-double-fail' }),
          'generateCalendarPreview: failed to update preview to failed status'
        );
      });
    });

    describe('invalid extraction with start !== null (lines 161-207)', () => {
      it('includes start in failed preview when extraction is invalid but has start date', async () => {
        extractionService.extractEventResult = ok({
          summary: 'Ambiguous Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: 'Office',
          description: 'Some description',
          valid: false,
          error: 'Ambiguous event details',
          reasoning: 'Multiple possible interpretations',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-invalid-with-start',
            userId: 'user-456',
            text: 'Do something ambiguous tomorrow at 10',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.status).toBe('failed');
          expect(result.value.preview.error).toBe('Ambiguous event details');
          expect(result.value.preview.start).toBe('2025-01-15T10:00:00');
          expect(result.value.preview.end).toBe('2025-01-15T11:00:00');
          expect(result.value.preview.location).toBe('Office');
          expect(result.value.preview.description).toBe('Some description');
          expect(result.value.preview.reasoning).toBe('Multiple possible interpretations');
          expect(result.value.preview.summary).toBe('Ambiguous Event');
        }
      });

      it('does not include start in failed preview when extraction is invalid and start is null', async () => {
        extractionService.extractEventResult = ok({
          summary: 'Unknown Event',
          start: null,
          end: null,
          location: null,
          description: null,
          valid: false,
          error: 'Cannot extract event without date',
          reasoning: 'No date found in text',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-invalid-no-start',
            userId: 'user-456',
            text: 'Something vague',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.status).toBe('failed');
          expect(result.value.preview.error).toBe('Cannot extract event without date');
          expect(result.value.preview.start).toBeUndefined();
        }
      });

      it('uses default error message when extraction error is null', async () => {
        extractionService.extractEventResult = ok({
          summary: 'Bad Event',
          start: '2025-01-15T10:00:00',
          end: null,
          location: null,
          description: null,
          valid: false,
          error: null,
          reasoning: 'Something went wrong',
        });

        const result = await generateCalendarPreview(
          {
            actionId: 'action-invalid-null-error',
            userId: 'user-456',
            text: 'Some event',
            currentDate: '2025-01-14',
          },
          deps
        );

        expect(result.ok).toBe(true);
        if (result.ok === true) {
          expect(result.value.preview.status).toBe('failed');
          expect(result.value.preview.error).toBe('Could not extract valid calendar event');
          expect(result.value.preview.start).toBe('2025-01-15T10:00:00');
        }
      });
    });
  });
});
