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
  calendarGeneratePreviewRequestSchema,
  calendarPreviewDataSchema,
  calendarPreviewSchema,
  calendarProcessActionRequestSchema,
  commandsCommandWithTextSchema,
  commandsGetCommandDataSchema,
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
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
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
  CommandsCommandWithText: toFastifySchema(
    'CommandsCommandWithText',
    commandsCommandWithTextSchema
  ),
  CommandsGetCommandData: toFastifySchema('CommandsGetCommandData', commandsGetCommandDataSchema),
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
