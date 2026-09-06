import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { requestPrivateWhatsAppErasure } from '../domain/whatsapp/usecases/privateWhatsAppErasure.js';
import type { PrivateWhatsAppErasureRequest } from '../domain/whatsapp/models/PrivateWhatsAppErasure.js';

interface ErasureParams {
  sourceAccountId: string;
  erasureRequestId?: string;
}

interface StartErasureBody {
  userId: string;
  erasureRequestId: string;
}

const PRIVATE_WHATSAPP_ERASURE_CALLER_ROLE = 'whatsapp_private_sync';

type PrivateErasureAuthorization = 'authorized' | 'unauthenticated' | 'forbidden';

const countsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assistantSessions: { type: 'integer', minimum: 0 },
    assistantTurns: { type: 'integer', minimum: 0 },
    assistantTranscriptChunks: { type: 'integer', minimum: 0 },
    assistantContextChunks: { type: 'integer', minimum: 0 },
    assistantContextAttachments: { type: 'integer', minimum: 0 },
    assistantTurnRequests: { type: 'integer', minimum: 0 },
    sourceContextChanges: { type: 'integer', minimum: 0 },
    sourceMessages: { type: 'integer', minimum: 0 },
    sourceChats: { type: 'integer', minimum: 0 },
    sourceSenders: { type: 'integer', minimum: 0 },
    sourceSenderDays: { type: 'integer', minimum: 0 },
    privateMediaObjects: { type: 'integer', minimum: 0 },
    sourceAccounts: { type: 'integer', minimum: 0 },
  },
  required: [
    'assistantSessions',
    'assistantTurns',
    'assistantTranscriptChunks',
    'assistantContextChunks',
    'assistantContextAttachments',
    'assistantTurnRequests',
    'sourceContextChanges',
    'sourceMessages',
    'sourceChats',
    'sourceSenders',
    'sourceSenderDays',
    'privateMediaObjects',
    'sourceAccounts',
  ],
} as const;

const statusDataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
    stage: {
      type: 'string',
      enum: [
        'assistant_sessions',
        'assistant_turns',
        'assistant_transcript_chunks',
        'assistant_context_chunks',
        'assistant_context_attachments',
        'assistant_turn_requests',
        'source_context_changes',
        'source_messages',
        'source_chats',
        'source_senders',
        'source_sender_days',
        'private_media',
        'source_account',
        'completed',
      ],
    },
    counts: countsSchema,
    attempt: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    completedAt: { type: 'string' },
    failureCode: {
      type: 'string',
      enum: ['ACCOUNT_GENERATION_CHANGED', 'INVALID_STORED_REQUEST'],
    },
  },
  required: ['status', 'stage', 'counts', 'attempt', 'createdAt', 'updatedAt'],
} as const;

const successResponseSchema = {
  description: 'Private WhatsApp erasure status',
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean', const: true },
    data: statusDataSchema,
  },
  required: ['success', 'data'],
} as const;

const errorResponseSchema = {
  description: 'Private WhatsApp erasure error',
  type: 'object',
  properties: {
    success: { type: 'boolean', const: false },
    error: { $ref: 'ErrorBody#' },
  },
  required: ['success', 'error'],
} as const;

function toStatusData(request: PrivateWhatsAppErasureRequest): Record<string, unknown> {
  return {
    status: request.status,
    stage: request.stage,
    counts: { ...request.counts },
    attempt: request.attempt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    ...(request.completedAt === undefined ? {} : { completedAt: request.completedAt }),
    ...(request.failureCode === undefined ? {} : { failureCode: request.failureCode }),
  };
}

function authorizePrivateErasureRequest(request: FastifyRequest): PrivateErasureAuthorization {
  if (!validateInternalAuth(request).valid) {
    return 'unauthenticated';
  }
  return request.headers['x-internal-caller-role'] === PRIVATE_WHATSAPP_ERASURE_CALLER_ROLE
    ? 'authorized'
    : 'forbidden';
}

export const privateErasureRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/whatsapp/private/accounts/:sourceAccountId/erasure',
    {
      attachValidation: true,
      schema: {
        operationId: 'startPrivateWhatsAppAccountErasure',
        summary: 'Start physical private WhatsApp account erasure',
        description:
          'Internal endpoint that starts or replays a durable, generation-fenced physical erasure workflow.',
        tags: ['internal'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: { sourceAccountId: { type: 'string', minLength: 1 } },
          required: ['sourceAccountId'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1 },
            erasureRequestId: { type: 'string', minLength: 1 },
          },
          required: ['userId', 'erasureRequestId'],
        },
        response: {
          202: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received private WhatsApp account erasure request',
        bodyPreviewLength: 0,
        additionalFields: { route: 'internal_whatsapp_private_account_erasure' },
      });
      const authorization = authorizePrivateErasureRequest(request);
      if (authorization === 'unauthenticated') {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for private WhatsApp erasure');
      }
      if (authorization === 'forbidden') {
        return await reply.fail(
          'FORBIDDEN',
          'Caller is not authorized for private WhatsApp erasure'
        );
      }
      if ((request as FastifyRequest & { validationError?: Error }).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }

      const services = getServices();
      if (
        services.privateWhatsAppErasureRepository === undefined ||
        services.privateWhatsAppErasurePublisher === undefined
      ) {
        return await reply.fail('INTERNAL_ERROR', 'Private WhatsApp erasure is not configured');
      }
      const params = request.params as ErasureParams;
      const body = request.body as StartErasureBody;
      const result = await requestPrivateWhatsAppErasure(
        {
          sourceAccountId: params.sourceAccountId,
          userId: body.userId,
          erasureRequestId: body.erasureRequestId,
        },
        {
          repository: services.privateWhatsAppErasureRepository,
          publisher: services.privateWhatsAppErasurePublisher,
          mediaStorage: services.mediaStorage,
          now: () => new Date().toISOString(),
          ...(services.conversationAssistantOperationalTelemetry === undefined
            ? {}
            : { telemetry: services.conversationAssistantOperationalTelemetry }),
        }
      );
      if (!result.ok) {
        request.log.error(
          { outcome: 'failed', code: result.error.code },
          'Private WhatsApp erasure request failed'
        );
        return await reply.fail('INTERNAL_ERROR', 'Private WhatsApp erasure request failed');
      }
      if (result.value.status === 'not_found') {
        return await reply.fail('NOT_FOUND', 'Private WhatsApp erasure request not found');
      }
      if (result.value.status === 'conflict') {
        return await reply.fail('CONFLICT', 'Private WhatsApp erasure request conflicts');
      }
      return await reply
        .code(202)
        .send({ success: true, data: toStatusData(result.value.request) });
    }
  );

  fastify.get(
    '/internal/whatsapp/private/accounts/:sourceAccountId/erasure/:erasureRequestId',
    {
      schema: {
        operationId: 'getPrivateWhatsAppAccountErasure',
        summary: 'Get physical private WhatsApp account erasure status',
        description: 'Internal recovery endpoint returning only content-free erasure progress.',
        tags: ['internal'],
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceAccountId: { type: 'string', minLength: 1 },
            erasureRequestId: { type: 'string', minLength: 1 },
          },
          required: ['sourceAccountId', 'erasureRequestId'],
        },
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received private WhatsApp account erasure status request',
        bodyPreviewLength: 0,
        additionalFields: { route: 'internal_whatsapp_private_account_erasure_status' },
      });
      const authorization = authorizePrivateErasureRequest(request);
      if (authorization === 'unauthenticated') {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for private WhatsApp erasure');
      }
      if (authorization === 'forbidden') {
        return await reply.fail(
          'FORBIDDEN',
          'Caller is not authorized for private WhatsApp erasure'
        );
      }
      const repository = getServices().privateWhatsAppErasureRepository;
      if (repository === undefined) {
        return await reply.fail('INTERNAL_ERROR', 'Private WhatsApp erasure is not configured');
      }
      const params = request.params as Required<ErasureParams>;
      const result = await repository.get({
        sourceAccountId: params.sourceAccountId,
        erasureRequestId: params.erasureRequestId,
      });
      if (!result.ok) {
        request.log.error(
          { outcome: 'failed', code: result.error.code },
          'Private WhatsApp erasure status failed'
        );
        return await reply.fail('INTERNAL_ERROR', 'Private WhatsApp erasure status failed');
      }
      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Private WhatsApp erasure request not found');
      }
      return await reply.ok(toStatusData(result.value));
    }
  );

  done();
};
