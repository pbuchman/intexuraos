const idSchema = { type: 'string', minLength: 1, maxLength: 256 } as const;
const localTimeSchema = {
  type: 'string',
  pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$',
} as const;
const timeZoneSchema = { type: 'string', minLength: 1, maxLength: 100 } as const;
const scheduleSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'localTime', 'timeZone'],
      properties: {
        kind: { type: 'string', const: 'daily' },
        localTime: localTimeSchema,
        timeZone: timeZoneSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'localTime', 'timeZone'],
      properties: {
        kind: { type: 'string', const: 'weekdays' },
        localTime: localTimeSchema,
        timeZone: timeZoneSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'weekday', 'localTime', 'timeZone'],
      properties: {
        kind: { type: 'string', const: 'weekly' },
        weekday: {
          type: 'string',
          enum: [
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
            'sunday',
          ],
        },
        localTime: localTimeSchema,
        timeZone: timeZoneSchema,
      },
    },
  ],
} as const;
const instructionsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['templateId', 'text'],
  properties: {
    templateId: {
      type: 'string',
      enum: ['fishing_group', 'direct_sentiment', 'custom'],
    },
    text: { type: 'string', minLength: 20, maxLength: 4_000 },
  },
} as const;

export const definitionParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['definitionId'],
  properties: { definitionId: idSchema },
} as const;

export const runParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['definitionId', 'runId'],
  properties: { definitionId: idSchema, runId: idSchema },
} as const;

export const erasureParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['erasureRequestId'],
  properties: { erasureRequestId: idSchema },
} as const;

export const idempotencyHeadersSchema = {
  type: 'object',
  required: ['idempotency-key'],
  properties: {
    'idempotency-key': { type: 'string', minLength: 8, maxLength: 256 },
  },
} as const;

export const createMessageDigestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'name', 'source', 'instructions', 'schedule'],
  properties: {
    status: { type: 'string', enum: ['active', 'paused'] },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['chatId'],
      properties: { chatId: idSchema },
    },
    instructions: instructionsSchema,
    schedule: scheduleSchema,
  },
} as const;

export const updateMessageDigestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'patch'],
  properties: {
    expectedRevision: { type: 'integer', minimum: 1 },
    patch: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 },
        source: {
          type: 'object',
          additionalProperties: false,
          required: ['chatId'],
          properties: { chatId: idSchema },
        },
        instructions: instructionsSchema,
        schedule: scheduleSchema,
        status: { type: 'string', enum: ['active', 'paused'] },
      },
    },
  },
} as const;

export const listMessageDigestsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string', minLength: 1, maxLength: 4_096 },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
    query: { type: 'string', maxLength: 100 },
    chatType: { type: 'string', enum: ['group', 'direct'] },
    status: { type: 'string', enum: ['active', 'paused', 'needs_attention'] },
    sort: { type: 'string', enum: ['name', 'updatedAt', 'nextRunAt'] },
    direction: { type: 'string', enum: ['asc', 'desc'] },
  },
} as const;

export const schedulePreviewBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schedule'],
  properties: {
    schedule: scheduleSchema,
    evaluatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const previewMessageDigestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'instructions', 'schedule'],
  properties: {
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['chatId'],
      properties: { chatId: idSchema },
    },
    instructions: instructionsSchema,
    schedule: scheduleSchema,
  },
} as const;

export const reserveMessageDigestRunBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['preparationToken'],
  properties: {
    preparationToken: { type: 'string', minLength: 1, maxLength: 16_384 },
  },
} as const;

export const listMessageDigestRunsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string', minLength: 1, maxLength: 4_096 },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
    fromDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    toDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    generationStatus: {
      type: 'string',
      enum: ['queued', 'processing', 'completed', 'failed', 'skipped_no_activity'],
    },
    deliveryStatus: {
      type: 'string',
      enum: ['not_sent', 'pending', 'sent', 'ambiguous', 'failed'],
    },
    sort: { type: 'string', enum: ['windowStart'] },
    direction: { type: 'string', enum: ['asc', 'desc'] },
  },
} as const;

export function messageDigestResponseSchema(status = 200): Record<number, unknown> {
  return {
    [status]: {
      description: 'Message Digest response',
      type: 'object',
      additionalProperties: false,
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', const: true },
        data: { type: 'object', additionalProperties: true },
        diagnostics: { $ref: 'Diagnostics#' },
      },
    },
    400: errorResponseSchema('Invalid request'),
    401: errorResponseSchema('Unauthorized'),
    404: errorResponseSchema('Not found'),
    409: errorResponseSchema('Conflict'),
    500: errorResponseSchema('Internal error'),
    502: errorResponseSchema('Downstream error'),
  };
}

function errorResponseSchema(description: string): Record<string, unknown> {
  return {
    description,
    type: 'object',
    additionalProperties: false,
    required: ['success', 'error'],
    properties: {
      success: { type: 'boolean', const: false },
      error: { $ref: 'ErrorBody#' },
      diagnostics: { $ref: 'Diagnostics#' },
    },
  };
}
