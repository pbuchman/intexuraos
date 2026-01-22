/**
 * Generate Calendar Preview Use Case
 *
 * Generates a preview of a calendar event from natural language text.
 * This is called asynchronously after action creation to show users
 * what event will be created before they approve.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarPreview } from '../models.js';
import type {
  CalendarActionExtractionService,
  CalendarPreviewRepository,
} from '../ports.js';

export interface GenerateCalendarPreviewRequest {
  actionId: string;
  userId: string;
  text: string;
  currentDate: string;
}

export interface GenerateCalendarPreviewDeps {
  calendarActionExtractionService: CalendarActionExtractionService;
  calendarPreviewRepository: CalendarPreviewRepository;
  logger: Logger;
}

export interface GenerateCalendarPreviewResponse {
  preview: CalendarPreview;
}

/**
 * Calculate duration string from start and end times.
 */
function calculateDuration(start: string | null, end: string | null): string | null {
  if (start === null || end === null) {
    return null;
  }

  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();

    // Handle invalid dates (NaN) and non-positive durations
    if (Number.isNaN(diffMs) || diffMs <= 0) {
      return null;
    }

    const diffMinutes = Math.round(diffMs / 60000);

    if (diffMinutes < 60) {
      return `${String(diffMinutes)} minute${diffMinutes === 1 ? '' : 's'}`;
    }

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    if (minutes === 0) {
      return `${String(hours)} hour${hours === 1 ? '' : 's'}`;
    }

    return `${String(hours)} hour${hours === 1 ? '' : 's'} ${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  } catch {
    // Graceful degradation: if date parsing fails (unlikely since extraction validated),
    // return null duration rather than failing the entire preview generation.
    // This is a pure helper function without logger access - callers handle the null case.
    return null;
  }
}

/**
 * Check if a date string represents an all-day event (no time component).
 */
function isAllDayEvent(start: string | null): boolean {
  if (start === null) {
    return false;
  }
  // All-day events have date format without time: YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(start);
}

export async function generateCalendarPreview(
  request: GenerateCalendarPreviewRequest,
  deps: GenerateCalendarPreviewDeps
): Promise<Result<GenerateCalendarPreviewResponse, CalendarError>> {
  const { actionId, userId, text, currentDate } = request;
  const { calendarActionExtractionService, calendarPreviewRepository, logger } = deps;

  logger.info({ userId, actionId, textLength: text.length }, 'generateCalendarPreview: entry');

  // Check if preview already exists
  const existingResult = await calendarPreviewRepository.getByActionId(actionId);
  if (!existingResult.ok) {
    logger.error({ actionId, error: existingResult.error }, 'generateCalendarPreview: failed to check existing preview');
    return err(existingResult.error);
  }

  if (existingResult.value !== null) {
    logger.info({ actionId, status: existingResult.value.status }, 'generateCalendarPreview: preview already exists');
    return ok({ preview: existingResult.value });
  }

  // Create pending preview first
  const pendingResult = await calendarPreviewRepository.create({
    actionId,
    userId,
    status: 'pending',
  });

  if (!pendingResult.ok) {
    logger.error({ actionId, error: pendingResult.error }, 'generateCalendarPreview: failed to create pending preview');
    return err(pendingResult.error);
  }

  // Extract event data
  const extractResult = await calendarActionExtractionService.extractEvent(userId, text, currentDate);

  if (!extractResult.ok) {
    logger.error({ userId, actionId, error: extractResult.error }, 'generateCalendarPreview: extraction failed');

    // Update preview to failed status
    const updateResult = await calendarPreviewRepository.update(actionId, {
      status: 'failed',
      error: extractResult.error.message,
    });

    if (!updateResult.ok) {
      logger.warn({ actionId, error: updateResult.error }, 'generateCalendarPreview: failed to update preview to failed status');
    }

    // Return the failed preview
    const failedPreview: CalendarPreview = {
      actionId,
      userId,
      status: 'failed',
      error: extractResult.error.message,
      generatedAt: new Date().toISOString(),
    };

    return ok({ preview: failedPreview });
  }

  const extracted = extractResult.value;

  logger.info(
    { userId, actionId, summary: extracted.summary, valid: extracted.valid },
    'generateCalendarPreview: extraction complete'
  );

  // If extraction is invalid, save as failed
  if (!extracted.valid) {
    const errorMessage = extracted.error ?? 'Could not extract valid calendar event';

    // Build update object conditionally to avoid undefined values
    const failedUpdate: Parameters<typeof calendarPreviewRepository.update>[1] = {
      status: 'failed',
      summary: extracted.summary,
      end: extracted.end,
      location: extracted.location,
      description: extracted.description,
      error: errorMessage,
      reasoning: extracted.reasoning,
    };
    if (extracted.start !== null) {
      failedUpdate.start = extracted.start;
    }

    const updateResult = await calendarPreviewRepository.update(actionId, failedUpdate);

    if (!updateResult.ok) {
      logger.warn({ actionId, error: updateResult.error }, 'generateCalendarPreview: failed to update preview to failed status');
    }

    const failedPreview: CalendarPreview = {
      actionId,
      userId,
      status: 'failed',
      summary: extracted.summary,
      end: extracted.end,
      location: extracted.location,
      description: extracted.description,
      error: errorMessage,
      reasoning: extracted.reasoning,
      generatedAt: new Date().toISOString(),
    };
    if (extracted.start !== null) {
      failedPreview.start = extracted.start;
    }

    return ok({ preview: failedPreview });
  }

  // Calculate additional fields
  const duration = calculateDuration(extracted.start, extracted.end);
  const isAllDay = isAllDayEvent(extracted.start);

  // Build update object conditionally to avoid undefined values
  const readyUpdate: Parameters<typeof calendarPreviewRepository.update>[1] = {
    status: 'ready',
    summary: extracted.summary,
    end: extracted.end,
    location: extracted.location,
    description: extracted.description,
    duration,
    isAllDay,
    reasoning: extracted.reasoning,
  };
  if (extracted.start !== null) {
    readyUpdate.start = extracted.start;
  }

  // Update preview with extracted data
  const updateResult = await calendarPreviewRepository.update(actionId, readyUpdate);

  if (!updateResult.ok) {
    logger.error({ actionId, error: updateResult.error }, 'generateCalendarPreview: failed to update preview');
    return err(updateResult.error);
  }

  const preview: CalendarPreview = {
    actionId,
    userId,
    status: 'ready',
    summary: extracted.summary,
    end: extracted.end,
    location: extracted.location,
    description: extracted.description,
    duration,
    isAllDay,
    reasoning: extracted.reasoning,
    generatedAt: new Date().toISOString(),
  };
  if (extracted.start !== null) {
    preview.start = extracted.start;
  }

  logger.info(
    { userId, actionId, status: 'ready', summary: extracted.summary },
    'generateCalendarPreview: preview generated successfully'
  );

  return ok({ preview });
}
