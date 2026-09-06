import { z } from 'zod';
import { createInternalHttpClient } from '../shared/createInternalHttpClient.js';
import type {
  MessageDigestServiceClient,
  MessageDigestServiceConfig,
  MessageDigestServiceRequestOptions,
  MessageDigestServiceResult,
  QueryLegacyDigestDefinitionsResponse,
  QueryLegacyDigestRunsResponse,
} from './types.js';

const MAX_CURSOR_LENGTH = 4_096;
const MAX_TERMS = 20;
const MAX_TERM_LENGTH = 100;
const MAX_RUN_PAGE_SIZE = 100;

const boundedUserIdSchema = z.string().trim().min(1).max(256);
const boundedPrivateIdSchema = z.string().trim().min(1).max(512);
const legacyGroupKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const definitionIdSchema = z.string().regex(/^md_[A-Za-z0-9_-]{3,120}$/u);
const runIdSchema = z.string().regex(/^mdr_[A-Za-z0-9_-]{3,160}$/u);
const migrationIdSchema = z.string().regex(/^mdm_[A-Za-z0-9_-]{3,160}$/u);
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isCalendarDate, 'Invalid calendar date');

const diagnosticsSchema = z
  .object({
    requestId: z.string().min(1).max(512),
    durationMs: z.number().finite().nonnegative().optional(),
    downstreamStatus: z.number().int().min(100).max(599).optional(),
    downstreamRequestId: z.string().min(1).max(512).optional(),
    endpointCalled: z.string().min(1).max(4_096).optional(),
  })
  .strict();

const successEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z.unknown(),
    diagnostics: diagnosticsSchema.optional(),
  })
  .strict();

const definitionQueryInputSchema = z
  .object({
    userId: boundedUserIdSchema,
    legacyGroupKey: legacyGroupKeySchema,
  })
  .strict();

const runQueryInputSchema = definitionQueryInputSchema
  .extend({
    fromDate: localDateSchema.optional(),
    toDate: localDateSchema.optional(),
    terms: z.array(z.string().trim().min(1).max(MAX_TERM_LENGTH)).min(1).max(MAX_TERMS).optional(),
    limit: z.number().int().min(1).max(MAX_RUN_PAGE_SIZE),
    cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.fromDate === undefined || value.toDate === undefined || value.fromDate <= value.toDate,
    'Invalid date range'
  );

const legacyDefinitionProjectionSchema = z
  .object({
    definitionId: definitionIdSchema,
    legacyGroupKey: legacyGroupKeySchema,
    source: z
      .object({
        sourceAccountId: boundedPrivateIdSchema,
        generationId: boundedPrivateIdSchema,
        chatId: boundedPrivateIdSchema,
        chatType: z.literal('group'),
      })
      .strict(),
    activeMigrationId: migrationIdSchema,
  })
  .strict();

const legacyDefinitionQueryResponseSchema = z
  .object({
    items: z.array(legacyDefinitionProjectionSchema).max(1),
  })
  .strict();

const legacyRunProjectionSchema = z
  .object({
    definitionId: definitionIdSchema,
    runId: runIdSchema,
    legacyGroupKey: legacyGroupKeySchema,
    date: localDateSchema,
    title: z.string().trim().min(1).max(200),
    summaryMarkdown: z.string().max(12_000),
    messageCount: z.number().int().nonnegative(),
    evidenceMessageRefs: z.array(sha256Schema).max(1_000),
    windowStart: timestampSchema,
    windowEnd: timestampSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.windowStart) < Date.parse(value.windowEnd));

const legacyRunQueryResponseSchema = z
  .object({
    items: z.array(legacyRunProjectionSchema).max(MAX_RUN_PAGE_SIZE),
    truncated: z.boolean(),
    nextCursor: z.string().min(1).max(MAX_CURSOR_LENGTH).nullable(),
  })
  .strict()
  .refine((value) => value.truncated === (value.nextCursor !== null));

export function createMessageDigestServiceClient(
  config: MessageDigestServiceConfig
): MessageDigestServiceClient {
  const http = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs: config.defaultTimeoutMs }),
  });

  return {
    async queryLegacyDigestDefinitions(
      input,
      options
    ): Promise<MessageDigestServiceResult<QueryLegacyDigestDefinitionsResponse>> {
      const parsed = definitionQueryInputSchema.safeParse(input);
      if (!parsed.success) return invalidRequest();
      const result = await requestStrict(
        http,
        '/internal/message-digests/definitions/query',
        parsed.data,
        options,
        legacyDefinitionQueryResponseSchema
      );
      if (!result.ok) return result;
      if (result.value.items.some((item) => item.legacyGroupKey !== parsed.data.legacyGroupKey)) {
        return invalidResponse();
      }
      return result;
    },

    async queryLegacyDigestRuns(
      input,
      options
    ): Promise<MessageDigestServiceResult<QueryLegacyDigestRunsResponse>> {
      const parsed = runQueryInputSchema.safeParse(input);
      if (!parsed.success) return invalidRequest();
      const result = await requestStrict(
        http,
        '/internal/message-digests/runs/query',
        parsed.data,
        options,
        legacyRunQueryResponseSchema
      );
      if (!result.ok) return result;
      if (result.value.items.some((item) => item.legacyGroupKey !== parsed.data.legacyGroupKey)) {
        return invalidResponse();
      }
      return result;
    },
  };
}

async function requestStrict<T>(
  http: ReturnType<typeof createInternalHttpClient>,
  path: string,
  body: unknown,
  options: MessageDigestServiceRequestOptions | undefined,
  schema: z.ZodType<T>
): Promise<MessageDigestServiceResult<T>> {
  const response = await http.request<unknown>({
    path,
    method: 'POST',
    body,
    responseMode: 'raw',
    privateRequest: true,
    skipSentry: true,
    ...(options?.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  if (!response.ok) return response;
  const envelope = successEnvelopeSchema.safeParse(response.value);
  if (!envelope.success) return invalidResponse();
  const parsed = schema.safeParse(envelope.data.data);
  return parsed.success ? { ok: true, value: parsed.data } : invalidResponse();
}

function invalidRequest<T>(): MessageDigestServiceResult<T> {
  return {
    ok: false,
    error: { code: 'INVALID_REQUEST', message: 'Invalid Message Digest service request' },
  };
}

function invalidResponse<T>(): MessageDigestServiceResult<T> {
  return {
    ok: false,
    error: {
      code: 'MALFORMED_ENVELOPE',
      message: 'Invalid response from message-digest-service',
    },
  };
}

function isCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export type { QueryLegacyDigestDefinitionsResponse, QueryLegacyDigestRunsResponse };
