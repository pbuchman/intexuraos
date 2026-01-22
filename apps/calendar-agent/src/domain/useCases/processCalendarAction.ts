/**
 * Process Calendar Action Use Case
 *
 * Handles natural language calendar event creation by:
 * 1. Extracting event data from text using LLM
 * 2. Creating the event in Google Calendar if valid
 * 3. Saving failed extractions for manual review
 */

import { err, ok, type Result, ServiceErrorCodes } from '@intexuraos/common-core';
import type { Logger, ServiceFeedback } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CreateEventInput } from '../models.js';
import type {
  GoogleCalendarClient,
  FailedEventRepository,
  CalendarActionExtractionService,
  ExtractionError,
  ExtractedCalendarEvent,
  UserServiceClient,
  ProcessedActionRepository,
  CalendarPreviewRepository,
} from '../ports.js';

export interface ProcessCalendarActionDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  failedEventRepository: FailedEventRepository;
  calendarActionExtractionService: CalendarActionExtractionService;
  processedActionRepository: ProcessedActionRepository;
  calendarPreviewRepository: CalendarPreviewRepository;
  logger: Logger;
}

export interface ProcessCalendarActionRequest {
  actionId: string;
  userId: string;
  text: string;
}

export type ProcessCalendarActionResponse = ServiceFeedback;

function toCalendarError(error: ExtractionError): CalendarError {
  return {
    code: error.code === 'NO_API_KEY' ? 'NOT_CONNECTED' : 'INTERNAL_ERROR',
    message: error.message,
  };
}

function createResourceUrl(): string {
  return '/#/calendar';
}

function isValidIsoDateTime(value: string | null): boolean {
  if (value === null) return false;
  const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  return isoDateTimeRegex.test(value) || isoDateRegex.test(value);
}

function toEventDateTime(
  isoString: string,
  timeZone: string
): { dateTime?: string; date?: string; timeZone?: string } {
  const hasTime = isoString.includes('T');
  if (hasTime) {
    return { dateTime: isoString, timeZone };
  }
  return { date: isoString };
}

function buildCreateEventInput(
  extracted: {
    summary: string;
    start: string;
    end: string | null;
    location: string | null;
    description: string | null;
  },
  timeZone: string
): CreateEventInput {
  const input: CreateEventInput = {
    summary: extracted.summary,
    start: toEventDateTime(extracted.start, timeZone),
    end: toEventDateTime(extracted.end ?? extracted.start, timeZone),
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
  const { userServiceClient, googleCalendarClient, failedEventRepository, calendarActionExtractionService, processedActionRepository, calendarPreviewRepository, logger } =
    deps;

  logger.info({ userId, actionId, textLength: text.length }, 'processCalendarAction: entry');

  const existingResult = await processedActionRepository.getByActionId(actionId);
  if (!existingResult.ok) {
    logger.error({ actionId, error: existingResult.error }, 'processCalendarAction: failed to check processed action');
    return err(existingResult.error);
  }

  if (existingResult.value !== null) {
    const existing = existingResult.value;
    logger.info(
      { actionId, eventId: existing.eventId },
      'processCalendarAction: action already processed, returning existing result'
    );
    return ok({
      status: 'completed',
      message: 'Calendar event created successfully',
      resourceUrl: existing.resourceUrl,
    });
  }

  const currentDate = new Date().toISOString().substring(0, 10);

  // Check for existing preview - if ready, use its data instead of LLM extraction
  const previewResult = await calendarPreviewRepository.getByActionId(actionId);
  let extracted: ExtractedCalendarEvent;

  if (previewResult.ok && previewResult.value !== null && previewResult.value.status === 'ready') {
    const preview = previewResult.value;
    logger.info(
      { userId, actionId, summary: preview.summary },
      'processCalendarAction: using existing preview data (skipping LLM extraction)'
    );

    // Convert preview to ExtractedCalendarEvent format
    extracted = {
      summary: preview.summary ?? '',
      start: preview.start ?? null,
      end: preview.end ?? null,
      location: preview.location ?? null,
      description: preview.description ?? null,
      valid: preview.summary !== undefined && preview.start !== undefined,
      error: null,
      reasoning: preview.reasoning ?? 'Used pre-generated preview data',
    };
  } else {
    // Fallback: LLM extraction (original behavior)
    if (previewResult.ok && previewResult.value !== null) {
      logger.info(
        { userId, actionId, previewStatus: previewResult.value.status },
        'processCalendarAction: preview exists but not ready, falling back to LLM extraction'
      );
    }

    const extractResult = await calendarActionExtractionService.extractEvent(userId, text, currentDate);

    if (!extractResult.ok) {
      logger.error(
        { userId, actionId, error: extractResult.error },
        'processCalendarAction: extraction failed'
      );
      return err(toCalendarError(extractResult.error));
    }

    extracted = extractResult.value;
  }

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
      message: errorMessage,
      errorCode: ServiceErrorCodes.EXTRACTION_FAILED,
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
      message: 'Invalid date format',
      errorCode: ServiceErrorCodes.VALIDATION_ERROR,
    });
  }

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    logger.error({ userId, actionId, error: tokenResult.error }, 'processCalendarAction: failed to get OAuth token');
    return err(tokenResult.error);
  }

  const timezoneResult = await googleCalendarClient.getCalendarTimezone(
    tokenResult.value.accessToken,
    'primary',
    logger
  );
  if (!timezoneResult.ok) {
    if (timezoneResult.error.code === 'PERMISSION_DENIED') {
      logger.warn(
        { userId, actionId },
        'processCalendarAction: calendar.readonly scope missing, user needs to reconnect'
      );
      return err({
        code: 'TOKEN_ERROR',
        message: 'Calendar permissions have been updated. Please reconnect your Google Calendar.',
      });
    }
    logger.error({ userId, actionId, error: timezoneResult.error }, 'processCalendarAction: failed to get calendar timezone');
    return err(timezoneResult.error);
  }

  const timeZone = timezoneResult.value;

  const createInput = buildCreateEventInput(
    {
      ...extracted,
      start: extracted.start as string,
    },
    timeZone
  );

  logger.info(
    { userId, actionId, summary: createInput.summary, timeZone },
    'processCalendarAction: creating Google Calendar event'
  );

  const createResult = await googleCalendarClient.createEvent(
    tokenResult.value.accessToken,
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

    if (createResult.error.code === 'TOKEN_ERROR') {
      return err(createResult.error);
    }

    return ok({
      status: 'failed',
      message: createResult.error.message,
      errorCode: ServiceErrorCodes.EXTERNAL_API_ERROR,
    });
  }

  const createdEvent = createResult.value;
  const resourceUrl = createResourceUrl();

  logger.info(
    { userId, actionId, eventId: createdEvent.id },
    'processCalendarAction: event created successfully'
  );

  const saveResult = await processedActionRepository.create({
    actionId,
    userId,
    eventId: createdEvent.id,
    resourceUrl,
  });

  if (!saveResult.ok) {
    logger.warn(
      { actionId, error: saveResult.error },
      'processCalendarAction: failed to save processed action (event was created successfully)'
    );
  }

  return ok({
    status: 'completed',
    message: `Event "${createdEvent.summary}" created successfully`,
    resourceUrl,
  });
}
