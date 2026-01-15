/**
 * Process Calendar Action Use Case
 *
 * Handles natural language calendar event creation by:
 * 1. Extracting event data from text using LLM
 * 2. Creating the event in Google Calendar if valid
 * 3. Saving failed extractions for manual review
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CreateEventInput } from '../models.js';
import type {
  GoogleCalendarClient,
  FailedEventRepository,
  CalendarActionExtractionService,
  ExtractionError,
} from '../ports.js';

export interface ProcessCalendarActionDeps {
  googleCalendarClient: GoogleCalendarClient;
  failedEventRepository: FailedEventRepository;
  calendarActionExtractionService: CalendarActionExtractionService;
  logger: Logger;
}

export interface ProcessCalendarActionRequest {
  actionId: string;
  userId: string;
  text: string;
}

export interface ProcessCalendarActionResponse {
  status: 'completed' | 'failed';
  resourceUrl?: string;
  error?: string;
}

function toCalendarError(error: ExtractionError): CalendarError {
  return {
    code: error.code === 'NO_API_KEY' ? 'NOT_CONNECTED' : 'INTERNAL_ERROR',
    message: error.message,
  };
}

function createResourceUrl(eventId: string): string {
  return `/#/calendar/${eventId}`;
}

function isValidIsoDateTime(value: string | null): boolean {
  if (value === null) return false;
  const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  return isoDateTimeRegex.test(value) || isoDateRegex.test(value);
}

function toEventDateTime(
  isoString: string | null
): { dateTime?: string; date?: string; timeZone?: string } {
  if (isoString === null) {
    return {};
  }

  const hasTime = isoString.includes('T');
  if (hasTime) {
    return { dateTime: isoString };
  }
  return { date: isoString };
}

function buildCreateEventInput(extracted: {
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  description: string | null;
}): CreateEventInput {
  const input: CreateEventInput = {
    summary: extracted.summary,
    start: toEventDateTime(extracted.start),
    end: toEventDateTime(extracted.end ?? extracted.start),
  };

  if (extracted.description !== null) {
    input.description = extracted.description;
  }
  if (extracted.location !== null) {
    input.location = extracted.location;
  }

  return input;
}

export async function processCalendarAction(
  request: ProcessCalendarActionRequest,
  deps: ProcessCalendarActionDeps
): Promise<Result<ProcessCalendarActionResponse, CalendarError>> {
  const { actionId, userId, text } = request;
  const { googleCalendarClient, failedEventRepository, calendarActionExtractionService, logger } = deps;

  logger.info({ userId, actionId, textLength: text.length }, 'processCalendarAction: entry');

  const currentDate = new Date().toISOString().split('T')[0] ?? '';

  const extractResult = await calendarActionExtractionService.extractEvent(userId, text, currentDate);

  if (!extractResult.ok) {
    logger.error(
      { userId, actionId, error: extractResult.error },
      'processCalendarAction: extraction failed'
    );
    return err(toCalendarError(extractResult.error));
  }

  const extracted = extractResult.value;

  logger.info(
    { userId, actionId, summary: extracted.summary, valid: extracted.valid },
    'processCalendarAction: extraction complete'
  );

  const errorMessage = extracted.error ?? 'Could not extract valid calendar event';

  if (!extracted.valid) {
    logger.info(
      { userId, actionId, error: errorMessage },
      'processCalendarAction: invalid event, saving to failed events'
    );

    const failedResult = await failedEventRepository.create({
      userId,
      actionId,
      originalText: text,
      summary: extracted.summary,
      start: extracted.start,
      end: extracted.end,
      location: extracted.location,
      description: extracted.description,
      error: errorMessage,
      reasoning: extracted.reasoning,
    });

    if (!failedResult.ok) {
      logger.error(
        { userId, actionId, error: failedResult.error },
        'processCalendarAction: failed to save failed event'
      );
      return err(failedResult.error);
    }

    return ok({
      status: 'failed',
      error: errorMessage,
    });
  }

  if (!isValidIsoDateTime(extracted.start)) {
    logger.warn(
      { userId, actionId, start: extracted.start },
      'processCalendarAction: invalid start date format'
    );

    const failedResult = await failedEventRepository.create({
      userId,
      actionId,
      originalText: text,
      summary: extracted.summary,
      start: extracted.start,
      end: extracted.end,
      location: extracted.location,
      description: extracted.description,
      error: 'Invalid date format',
      reasoning: extracted.reasoning,
    });

    if (!failedResult.ok) {
      return err(failedResult.error);
    }

    return ok({
      status: 'failed',
      error: 'Invalid date format',
    });
  }

  const createInput = buildCreateEventInput(extracted);

  logger.info(
    { userId, actionId, summary: createInput.summary },
    'processCalendarAction: creating Google Calendar event'
  );

  const createResult = await googleCalendarClient.createEvent(
    'DUMMY_TOKEN',
    'primary',
    createInput,
    logger
  );

  if (!createResult.ok) {
    logger.error(
      { userId, actionId, error: createResult.error },
      'processCalendarAction: Google Calendar creation failed'
    );

    const failedResult = await failedEventRepository.create({
      userId,
      actionId,
      originalText: text,
      summary: extracted.summary,
      start: extracted.start,
      end: extracted.end,
      location: extracted.location,
      description: extracted.description,
      error: createResult.error.message,
      reasoning: extracted.reasoning,
    });

    if (!failedResult.ok) {
      return err(failedResult.error);
    }

    return ok({
      status: 'failed',
      error: createResult.error.message,
    });
  }

  const createdEvent = createResult.value;

  logger.info(
    { userId, actionId, eventId: createdEvent.id },
    'processCalendarAction: event created successfully'
  );

  return ok({
    status: 'completed',
    resourceUrl: createResourceUrl(createdEvent.id),
  });
}
