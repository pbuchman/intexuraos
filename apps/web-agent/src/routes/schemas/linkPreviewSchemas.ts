export const fetchLinkPreviewsBodySchema = {
  type: 'object',
  required: ['urls'],
  properties: {
    urls: {
      type: 'array',
      items: { type: 'string', format: 'uri' },
      minItems: 1,
      maxItems: 10,
      description: 'Array of URLs to fetch previews for (1-10 URLs)',
    },
    timeoutMs: {
      type: 'number',
      minimum: 1000,
      maximum: 30000,
      description: 'Timeout per URL in milliseconds (1000-30000). When not specified, uses server default.',
    },
  },
  additionalProperties: false,
} as const;

const linkPreviewSchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    description: { type: 'string' },
    image: { type: 'string', format: 'uri' },
    favicon: { type: 'string', format: 'uri' },
    siteName: { type: 'string' },
  },
} as const;

const linkPreviewErrorSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: {
      type: 'string',
      enum: ['FETCH_FAILED', 'TIMEOUT', 'TOO_LARGE', 'INVALID_URL', 'ACCESS_DENIED'],
    },
    message: { type: 'string' },
  },
} as const;

const linkPreviewResultSchema = {
  type: 'object',
  required: ['url', 'status'],
  properties: {
    url: { type: 'string', format: 'uri' },
    status: { type: 'string', enum: ['success', 'failed'] },
    preview: linkPreviewSchema,
    error: linkPreviewErrorSchema,
  },
} as const;

const fetchMetadataSchema = {
  type: 'object',
  required: ['requestedCount', 'successCount', 'failedCount', 'durationMs'],
  properties: {
    requestedCount: { type: 'number' },
    successCount: { type: 'number' },
    failedCount: { type: 'number' },
    durationMs: { type: 'number' },
  },
} as const;

export const fetchLinkPreviewsResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['results', 'metadata'],
      properties: {
        results: {
          type: 'array',
          items: linkPreviewResultSchema,
        },
        metadata: fetchMetadataSchema,
      },
    },
    diagnostics: { $ref: 'Diagnostics#' },
  },
} as const;

export interface FetchLinkPreviewsBody {
  urls: string[];
  timeoutMs?: number;
}
