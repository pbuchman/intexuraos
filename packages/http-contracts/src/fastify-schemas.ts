/**
 * Fastify JSON Schemas for IntexuraOS APIs.
 * These schemas use $id for local reference (not OpenAPI $ref).
 *
 * Usage:
 *   app.addSchema(fastifyDiagnosticsSchema);
 *   // Then reference as { $ref: 'Diagnostics#' } in route schemas
 */
import {
  bookmarksBookmarkSchema,
  bookmarksCreateBookmarkDataSchema,
  bookmarksCreateBookmarkRequestSchema,
  calendarCreateEventDataSchema,
  calendarCreateEventInputSchema,
  calendarCreateEventRequestSchema,
  calendarUpdateEventDataSchema,
  calendarUpdateEventRequestSchema,
  calendarUpdateEventAttendeesDataSchema,
  calendarUpdateEventAttendeesRequestSchema,
  calendarCreatedEventSchema,
  calendarEventDateTimeSchema,
  calendarGeneratePreviewRequestSchema,
  calendarListEventsDataSchema,
  calendarListEventsRequestSchema,
  calendarPreviewDataSchema,
  calendarPreviewSchema,
  calendarProcessActionRequestSchema,
  imageGenerateImageRequestSchema,
  imageGeneratePromptRequestSchema,
  imageGeneratedImageDataSchema,
  imageThumbnailPromptSchema,
  linearProcessActionRequestSchema,
  notionPagePreviewSchema,
  notionTokenContextSchema,
  notesCreateNoteRequestSchema,
  researchCreateDraftRequestSchema,
  serviceFeedbackZodSchema,
  webAgentFetchLinkPreviewsRequestSchema,
  webAgentLinkPreviewSchema,
  webAgentPageSummarySchema,
  webAgentSummarizePageRequestSchema,
} from './zod/index.js';
import {
  testRunDtoV1Schema,
  testRunListDtoV1Schema,
  testScenarioDtoV1Schema,
} from './intexAgentTestRuns.js';
import { toFastifySchema } from './zod/json-schema.js';

/**
 * Fastify schema for Diagnostics with $id.
 */
export const fastifyDiagnosticsSchema = {
  $id: 'Diagnostics',
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    durationMs: { type: 'number' },
    downstreamStatus: { type: 'integer' },
    downstreamRequestId: { type: 'string' },
    endpointCalled: { type: 'string' },
  },
};

/**
 * Fastify schema for ErrorCode with $id.
 */
export const fastifyErrorCodeSchema = {
  $id: 'ErrorCode',
  type: 'string',
  enum: [
    'INVALID_REQUEST',
    'EMPTY_TRANSCRIPT',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
    'SERVICE_UNAVAILABLE',
    'DOWNSTREAM_ERROR',
    'INTERNAL_ERROR',
    'MISCONFIGURED',
  ],
};

/**
 * Fastify schema for ErrorBody with $id.
 */
export const fastifyErrorBodySchema = {
  $id: 'ErrorBody',
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { $ref: 'ErrorCode#' },
    message: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
};

export const contractFastifySchemas = {
  IntexAgentTestRunList: toFastifySchema('IntexAgentTestRunList', testRunListDtoV1Schema),
  IntexAgentTestRun: toFastifySchema('IntexAgentTestRun', testRunDtoV1Schema),
  IntexAgentTestScenario: toFastifySchema('IntexAgentTestScenario', testScenarioDtoV1Schema),
  ServiceFeedback: toFastifySchema('ServiceFeedback', serviceFeedbackZodSchema),
  BookmarksCreateBookmarkRequest: toFastifySchema(
    'BookmarksCreateBookmarkRequest',
    bookmarksCreateBookmarkRequestSchema
  ),
  BookmarksCreateBookmarkData: toFastifySchema(
    'BookmarksCreateBookmarkData',
    bookmarksCreateBookmarkDataSchema
  ),
  BookmarksBookmark: toFastifySchema('BookmarksBookmark', bookmarksBookmarkSchema),
  ImageGeneratePromptRequest: toFastifySchema(
    'ImageGeneratePromptRequest',
    imageGeneratePromptRequestSchema
  ),
  ImageThumbnailPrompt: toFastifySchema('ImageThumbnailPrompt', imageThumbnailPromptSchema),
  ImageGenerateImageRequest: toFastifySchema(
    'ImageGenerateImageRequest',
    imageGenerateImageRequestSchema
  ),
  ImageGeneratedImageData: toFastifySchema(
    'ImageGeneratedImageData',
    imageGeneratedImageDataSchema
  ),
  NotesCreateNoteRequest: toFastifySchema('NotesCreateNoteRequest', notesCreateNoteRequestSchema),
  NotionTokenContext: toFastifySchema('NotionTokenContext', notionTokenContextSchema),
  NotionPagePreview: toFastifySchema('NotionPagePreview', notionPagePreviewSchema),
  ResearchCreateDraftRequest: toFastifySchema(
    'ResearchCreateDraftRequest',
    researchCreateDraftRequestSchema
  ),
  CalendarEventDateTime: toFastifySchema('CalendarEventDateTime', calendarEventDateTimeSchema),
  CalendarCreateEventInput: toFastifySchema(
    'CalendarCreateEventInput',
    calendarCreateEventInputSchema
  ),
  CalendarCreateEventRequest: toFastifySchema(
    'CalendarCreateEventRequest',
    calendarCreateEventRequestSchema
  ),
  CalendarCreatedEvent: toFastifySchema('CalendarCreatedEvent', calendarCreatedEventSchema),
  CalendarCreateEventData: toFastifySchema(
    'CalendarCreateEventData',
    calendarCreateEventDataSchema
  ),
  CalendarUpdateEventRequest: toFastifySchema(
    'CalendarUpdateEventRequest',
    calendarUpdateEventRequestSchema
  ),
  CalendarUpdateEventData: toFastifySchema(
    'CalendarUpdateEventData',
    calendarUpdateEventDataSchema
  ),
  CalendarUpdateEventAttendeesRequest: toFastifySchema(
    'CalendarUpdateEventAttendeesRequest',
    calendarUpdateEventAttendeesRequestSchema
  ),
  CalendarUpdateEventAttendeesData: toFastifySchema(
    'CalendarUpdateEventAttendeesData',
    calendarUpdateEventAttendeesDataSchema
  ),
  CalendarListEventsRequest: toFastifySchema(
    'CalendarListEventsRequest',
    calendarListEventsRequestSchema
  ),
  CalendarListEventsData: toFastifySchema('CalendarListEventsData', calendarListEventsDataSchema),
  CalendarProcessActionRequest: toFastifySchema(
    'CalendarProcessActionRequest',
    calendarProcessActionRequestSchema
  ),
  CalendarPreview: toFastifySchema('CalendarPreview', calendarPreviewSchema),
  CalendarPreviewData: toFastifySchema('CalendarPreviewData', calendarPreviewDataSchema),
  CalendarGeneratePreviewRequest: toFastifySchema(
    'CalendarGeneratePreviewRequest',
    calendarGeneratePreviewRequestSchema
  ),
  LinearProcessActionRequest: toFastifySchema(
    'LinearProcessActionRequest',
    linearProcessActionRequestSchema
  ),
  WebAgentFetchLinkPreviewsRequest: toFastifySchema(
    'WebAgentFetchLinkPreviewsRequest',
    webAgentFetchLinkPreviewsRequestSchema
  ),
  WebAgentLinkPreview: toFastifySchema('WebAgentLinkPreview', webAgentLinkPreviewSchema),
  WebAgentSummarizePageRequest: toFastifySchema(
    'WebAgentSummarizePageRequest',
    webAgentSummarizePageRequestSchema
  ),
  WebAgentPageSummary: toFastifySchema('WebAgentPageSummary', webAgentPageSummarySchema),
};

/**
 * Register all core Fastify schemas on an app instance.
 * Call this after creating the Fastify instance.
 *
 * Usage:
 *   const app = Fastify();
 *   registerCoreSchemas(app);
 */
export function registerCoreSchemas(app: { addSchema: (schema: { $id: string }) => void }): void {
  app.addSchema(fastifyDiagnosticsSchema);
  app.addSchema(fastifyErrorCodeSchema);
  app.addSchema(fastifyErrorBodySchema);
  for (const schema of Object.values(contractFastifySchemas)) {
    app.addSchema(schema);
  }
}
