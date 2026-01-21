/**
 * Tests for generateCalendarPreview use case.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, isOk, isErr, ok } from '@intexuraos/common-core';
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.preview.duration).toBe('1 hour');
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.preview.duration).toBe('1 minute');
      }
    });
  });
});
