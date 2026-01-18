export const summarizePageBodySchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: {
      type: 'string',
      format: 'uri',
      description: 'URL of the page to summarize',
    },
    maxSentences: {
      type: 'number',
      minimum: 1,
      maximum: 50,
      description: 'Maximum number of sentences in summary (default: 20)',
    },
    maxReadingMinutes: {
      type: 'number',
      minimum: 1,
      maximum: 10,
      description: 'Maximum reading time in minutes (default: 3)',
    },
  },
  additionalProperties: false,
} as const;

const pageSummarySchema = {
  type: 'object',
  required: ['url', 'summary', 'wordCount', 'estimatedReadingMinutes'],
  properties: {
    url: { type: 'string', format: 'uri' },
    summary: { type: 'string' },
    wordCount: { type: 'number' },
    estimatedReadingMinutes: { type: 'number' },
  },
} as const;

const pageSummaryErrorSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: {
      type: 'string',
      enum: ['FETCH_FAILED', 'TIMEOUT', 'TOO_LARGE', 'INVALID_URL', 'NO_CONTENT', 'API_ERROR'],
    },
    message: { type: 'string' },
  },
} as const;

const pageSummaryResultSchema = {
  type: 'object',
  required: ['url', 'status'],
  properties: {
    url: { type: 'string', format: 'uri' },
    status: { type: 'string', enum: ['success', 'failed'] },
    summary: pageSummarySchema,
    error: pageSummaryErrorSchema,
  },
} as const;

const summaryMetadataSchema = {
  type: 'object',
  required: ['durationMs'],
  properties: {
    durationMs: { type: 'number' },
  },
} as const;

export const summarizePageResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['result', 'metadata'],
      properties: {
        result: pageSummaryResultSchema,
        metadata: summaryMetadataSchema,
      },
    },
    diagnostics: { $ref: 'Diagnostics#' },
  },
} as const;

export interface SummarizePageBody {
  url: string;
  maxSentences?: number;
  maxReadingMinutes?: number;
}
