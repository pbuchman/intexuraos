import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import type { PrivateDigestSourceError } from '../domain/whatsapp/models/PrivateWhatsAppDigestSource.js';
import type {
  QueryPrivateDigestMessagesInput,
  ResolvePrivateDigestMigrationBindingInput,
  ValidatePrivateDigestSourceInput,
} from '../domain/whatsapp/models/PrivateWhatsAppDigestSource.js';
import {
  resolvePrivateDigestMigrationBinding,
  validatePrivateDigestSource,
} from '../domain/whatsapp/usecases/privateWhatsAppDigestSource.js';
import { readPrivateWhatsAppDigestSource } from '../domain/whatsapp/usecases/readPrivateWhatsAppDigestSource.js';
import { getServices } from '../services.js';

const VALIDATE_BODY_KEYS = new Set(['userId', 'chatId', 'expectedGenerationId']);
const MIGRATION_BINDING_BODY_KEYS = new Set(['userId', 'expectedDisplayName']);
const CUTOVER_CALLER_ROLE = 'message_digest_cutover_verifier';
const QUERY_BODY_KEYS = new Set([
  'userId',
  'sourceAccountId',
  'generationId',
  'chatId',
  'chatType',
  'windowStart',
  'windowEnd',
  'limit',
  'cursor',
]);

const errorResponseSchema = {
  description: 'Private WhatsApp digest source error',
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    error: { $ref: 'ErrorBody#' },
  },
  required: ['success', 'error'],
} as const;

const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sourceAccountId: { type: 'string' },
    generationId: { type: 'string' },
    chatId: { type: 'string' },
    chatType: { type: 'string', enum: ['group', 'direct'] },
    displayName: { type: 'string' },
    messageCount: { type: 'integer', minimum: 0 },
    participantCount: { type: 'integer', minimum: 0 },
    lastActivityAt: { type: 'string' },
    sourceRevision: { type: 'string' },
  },
  required: [
    'sourceAccountId',
    'generationId',
    'chatId',
    'chatType',
    'displayName',
    'messageCount',
    'sourceRevision',
  ],
} as const;

const digestMessageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageRef: { type: 'string' },
    eventTimestamp: { type: 'string' },
    direction: { type: 'string', enum: ['inbound', 'outbound', 'system'] },
    authorLabel: { type: 'string' },
    text: { type: 'string' },
    contentKind: {
      type: 'string',
      enum: ['text', 'media_caption', 'transcription', 'reaction', 'system'],
    },
  },
  required: ['messageRef', 'eventTimestamp', 'direction', 'authorLabel', 'text', 'contentKind'],
} as const;

export const privateDigestSourceRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/whatsapp/private/digest-source/migration-binding/resolve',
    {
      attachValidation: true,
      schema: {
        operationId: 'resolvePrivateWhatsAppDigestMigrationBinding',
        summary: 'Resolve the one exact owner-scoped group for Message Digest cutover',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1, maxLength: 256 },
            expectedDisplayName: { type: 'string', minLength: 1, maxLength: 512 },
          },
          required: ['userId', 'expectedDisplayName'],
        },
        response: {
          200: {
            description: 'Resolved Private WhatsApp migration binding',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  sourceAccountId: { type: 'string' },
                  generationId: { type: 'string' },
                  chatId: { type: 'string' },
                  displayName: { type: 'string' },
                },
                required: ['sourceAccountId', 'generationId', 'chatId', 'displayName'],
              },
            },
            required: ['success', 'data'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received private WhatsApp migration binding request',
        bodyPreviewLength: 0,
        additionalFields: { operation: 'migration_binding' },
      });
      if (
        !validateInternalAuth(request).valid ||
        request.headers['x-internal-caller-role'] !== CUTOVER_CALLER_ROLE
      ) {
        return await reply.fail('UNAUTHORIZED', 'Internal cutover auth failed');
      }
      if (
        hasValidationError(request) ||
        !rawBodyUsesAllowlist(request, MIGRATION_BINDING_BODY_KEYS)
      ) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const result = await resolvePrivateDigestMigrationBinding(
        request.body as ResolvePrivateDigestMigrationBindingInput,
        { repository: getServices().privateWhatsAppRepository }
      );
      if (!result.ok) return await sendDigestError(reply, result.error);
      return await reply.ok(result.value);
    }
  );

  fastify.post(
    '/internal/whatsapp/private/digest-source/validate',
    {
      attachValidation: true,
      schema: {
        operationId: 'validatePrivateWhatsAppDigestSource',
        summary: 'Validate an owned Private WhatsApp digest source',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1 },
            chatId: { type: 'string', minLength: 1 },
            expectedGenerationId: { type: 'string', minLength: 1 },
          },
          required: ['userId', 'chatId'],
        },
        response: {
          200: {
            description: 'Validated Private WhatsApp digest source',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: sourceSchema,
            },
            required: ['success', 'data'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received private WhatsApp digest source request',
        bodyPreviewLength: 0,
        additionalFields: { operation: 'validate' },
      });
      if (!validateInternalAuth(request).valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for digest source');
      }
      if (hasValidationError(request) || !rawBodyUsesAllowlist(request, VALIDATE_BODY_KEYS)) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const services = getServices();
      const sourceTokens = services.privateDigestSourceTokens;
      if (sourceTokens === undefined) {
        return await reply.fail('INTERNAL_ERROR', 'Private digest source is not configured');
      }
      const result = await validatePrivateDigestSource(
        request.body as ValidatePrivateDigestSourceInput,
        {
          repository: services.privateWhatsAppRepository,
          issueSourceRevision: (claims) => sourceTokens.issueSourceRevision(claims),
        }
      );
      if (!result.ok) return await sendDigestError(reply, result.error);
      return await reply.ok(result.value);
    }
  );

  fastify.post(
    '/internal/whatsapp/private/digest-source/messages/query',
    {
      attachValidation: true,
      schema: {
        operationId: 'queryPrivateWhatsAppDigestSourceMessages',
        summary: 'Read one fenced page of Private WhatsApp digest messages',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1 },
            sourceAccountId: { type: 'string', minLength: 1 },
            generationId: { type: 'string', minLength: 1 },
            chatId: { type: 'string', minLength: 1 },
            chatType: { type: 'string', enum: ['group', 'direct'] },
            windowStart: { type: 'string', format: 'date-time' },
            windowEnd: { type: 'string', format: 'date-time' },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            cursor: { type: 'string', minLength: 1, maxLength: 8192 },
          },
          required: [
            'userId',
            'sourceAccountId',
            'generationId',
            'chatId',
            'chatType',
            'windowStart',
            'windowEnd',
            'limit',
          ],
        },
        response: {
          200: {
            description: 'Private WhatsApp digest source message page',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  messages: { type: 'array', maxItems: 500, items: digestMessageSchema },
                  sourceRevision: { type: 'string' },
                  highWatermark: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
                required: ['messages', 'sourceRevision', 'highWatermark', 'nextCursor'],
              },
            },
            required: ['success', 'data'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received private WhatsApp digest source request',
        bodyPreviewLength: 0,
        additionalFields: { operation: 'query' },
      });
      if (!validateInternalAuth(request).valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for digest source');
      }
      if (hasValidationError(request) || !rawBodyUsesAllowlist(request, QUERY_BODY_KEYS)) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const services = getServices();
      if (
        services.privateWhatsAppDigestSourceRepository === undefined ||
        services.privateDigestSourceTokens === undefined
      ) {
        return await reply.fail('INTERNAL_ERROR', 'Private digest source is not configured');
      }
      const result = await readPrivateWhatsAppDigestSource(
        request.body as QueryPrivateDigestMessagesInput,
        {
          repository: services.privateWhatsAppDigestSourceRepository,
          tokens: services.privateDigestSourceTokens,
        }
      );
      if (!result.ok) return await sendDigestError(reply, result.error);
      return await reply.ok(result.value);
    }
  );

  done();
};

function hasValidationError(request: FastifyRequest): boolean {
  return (request as FastifyRequest & { validationError?: Error }).validationError !== undefined;
}

function rawBodyUsesAllowlist(request: FastifyRequest, allowedKeys: ReadonlySet<string>): boolean {
  const rawBody = (request as FastifyRequest & { rawBody?: unknown }).rawBody;
  return privateDigestSourceBodyUsesAllowlist(rawBody, allowedKeys);
}

export function privateDigestSourceBodyUsesAllowlist(
  rawBody: unknown,
  allowedKeys: ReadonlySet<string>
): boolean {
  if (typeof rawBody !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).every((key) => allowedKeys.has(key))
    );
  } catch {
    return false;
  }
}

async function sendDigestError(
  reply: FastifyReply,
  error: PrivateDigestSourceError
): Promise<FastifyReply> {
  switch (error.code) {
    case 'SOURCE_CHANGED':
      return await reply.fail('SOURCE_CHANGED', 'Private WhatsApp source changed');
    case 'NOT_FOUND':
      return await reply.fail('NOT_FOUND', 'Private WhatsApp source not found');
    case 'VALIDATION_ERROR':
      return await reply.fail('INVALID_REQUEST', 'Invalid private digest source request');
    case 'PERSISTENCE_ERROR':
    case 'INTERNAL_ERROR':
    case 'ALREADY_VERIFIED':
    case 'COOLDOWN_ACTIVE':
    case 'RATE_LIMIT_EXCEEDED':
      return await reply.fail('INTERNAL_ERROR', 'Private digest source request failed');
  }
}
