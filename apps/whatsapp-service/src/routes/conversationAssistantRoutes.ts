import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { type Logger, type Result } from '@intexuraos/common-core';
import {
  getConversationAssistantModelDisplayName,
  type ConversationAssistantModel,
} from '@intexuraos/llm-contract';
import { getServices } from '../services.js';
import {
  checkConversationAssistantContext,
  conversationAssistantRandomIds,
  conversationAssistantSystemClock,
  createConversationAssistantSession,
  deleteConversationAssistantSession,
  exportConversationAssistantSessionPdf,
  getConversationAssistantContext,
  getConversationAssistantSession,
  getConversationAssistantSessionByRequest,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  retryConversationAssistantPreparation,
  sendConversationAssistantTurn,
  streamConversationAssistantTurn,
} from '../domain/conversation-assistant/sessionUseCases.js';
import type { ConversationAssistantDeps } from '../domain/conversation-assistant/ports.js';
import type {
  CheckConversationAssistantContextInput,
  ConversationAssistantError,
  ConversationAssistantSession,
  ConversationAssistantStreamEvent,
  CreateConversationAssistantSessionInput,
  PublicConversationAssistantContextAttachment,
  PublicConversationAssistantSession,
} from '../domain/conversation-assistant/types.js';
import { createConversationAssistantDeletionToken } from '../domain/conversation-assistant/deletionToken.js';
import {
  deleteConversationAssistantContextAttachmentDraft,
  getConversationAssistantContextAttachmentPreview,
  getConversationAssistantContextAttachmentStatus,
  listConversationAssistantContextHistory,
  resolveConversationAssistantContinuationState,
  retryConversationAssistantContextAttachmentForUser,
  type GetConversationAssistantContextAttachmentStatusResult,
  type RetryConversationAssistantContextAttachmentForUserResult,
} from '../domain/conversation-assistant/contextAttachmentAccess.js';
import {
  createConversationAssistantContextAttachment,
  toPublicConversationAssistantContextAttachment,
} from '../domain/conversation-assistant/contextAttachmentUseCases.js';
import type {
  ConversationAssistantContextAttachmentAccessDeps,
  ConversationAssistantContextAttachmentAccessRepository,
  ConversationAssistantContextAttachmentCreationDeps,
  ConversationAssistantContextAttachmentPublicRetryDeps,
  ConversationAssistantContextAttachmentPreparationPublisher,
} from '../domain/conversation-assistant/contextAttachmentPorts.js';
import {
  getConversationAssistantTurnRequest,
  conversationAssistantTurnRequestSystemHeartbeat,
  resumeConversationAssistantTurnRequest,
  retryConversationAssistantTurnRequestAnswer,
  startConversationAssistantTurnRequest,
  type ConversationAssistantTurnRequestDeps,
  type ConversationAssistantTurnRequestError,
  type ConversationAssistantTurnRequestStreamEvent,
} from '../domain/conversation-assistant/turnRequestUseCases.js';
import {
  toPublicConversationAssistantAttachmentPreviewDto,
  toPublicConversationAssistantContextAttachmentDto,
  toPublicConversationAssistantContextDto,
  toPublicConversationAssistantContextHistoryDto,
  toPublicConversationAssistantExecutionRecoveryDto,
  toPublicConversationAssistantSessionDto,
  toPublicConversationAssistantSseEvent,
  toPublicConversationAssistantTurnDto,
  toPublicConversationAssistantTurnRequestRecoveryDto,
} from '../domain/conversation-assistant/publicDtos.js';
import { registerConversationAssistantPublicSchemas } from './conversationAssistantPublicSchemas.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

const CONVERSATION_ASSISTANT_INTERNAL_ERROR_MESSAGE = 'Conversation Assistant request failed';

interface CreateSessionBody {
  requestId: string;
  chatId: string;
  from: string;
  to: string;
  model?: string;
  maxMessages?: number;
  displayTimeZone?: string;
}

interface CheckContextBody {
  chatId: string;
  from: string;
  to: string;
}

interface SessionParams {
  sessionId: string;
}

interface DeleteSessionHeaders {
  'x-conversation-assistant-deletion-token'?: string;
}

interface SessionRequestParams {
  requestId: string;
}

interface ContextQuerystring {
  messageCursor?: string;
  omittedCursor?: string;
}

interface SendTurnBody {
  requestId?: string;
  question: string;
  contextAttachmentId?: string;
  confirmationToken?: string;
}

interface TurnRequestParams extends SessionParams {
  requestId: string;
}

interface ContextAttachmentParams extends SessionParams {
  attachmentId: string;
}

interface CreateContextAttachmentBody {
  requestId: string;
  replacesAttachmentId?: string;
}

interface ContextAttachmentPreviewQuerystring {
  cursor?: string;
  limit?: number;
}

export const conversationAssistantRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  registerConversationAssistantPublicSchemas(fastify);
  fastify.get(
    '/conversation-assistant/sessions',
    {
      schema: {
        operationId: 'listWhatsAppConversationAssistantSessions',
        tags: ['whatsapp'],
        response: routeResponseSchema('ConversationAssistantSessionList'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /whatsapp/conversation-assistant/sessions',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_list_sessions' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() => listConversationAssistantSessions(user.userId, deps));
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.ok({
        sessions: await Promise.all(
          result.value.map((session) => toPublicSession(session, request.log))
        ),
      });
    }
  );

  fastify.post<{ Body: CheckContextBody }>(
    '/conversation-assistant/context/check',
    {
      attachValidation: true,
      schema: {
        operationId: 'checkWhatsAppConversationAssistantContext',
        tags: ['whatsapp'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chatId: { type: 'string', minLength: 1 },
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
          },
          required: ['chatId', 'from', 'to'],
        },
        response: routeResponseSchema('ConversationAssistantContextCheck'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /whatsapp/conversation-assistant/context/check',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_check_context' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const input: CheckConversationAssistantContextInput = {
        userId: user.userId,
        chatId: request.body.chatId,
        from: request.body.from,
        to: request.body.to,
      };
      const result = await safeCall(() => checkConversationAssistantContext(input, deps));
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.ok(result.value);
    }
  );

  fastify.post<{ Body: CreateSessionBody }>(
    '/conversation-assistant/sessions',
    {
      attachValidation: true,
      schema: {
        operationId: 'createWhatsAppConversationAssistantSession',
        tags: ['whatsapp'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requestId: { type: 'string', minLength: 1, maxLength: 128 },
            chatId: { type: 'string', minLength: 1 },
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
            model: { type: 'string', minLength: 1 },
            maxMessages: { type: 'integer', minimum: 1 },
            displayTimeZone: { type: 'string', minLength: 1, maxLength: 128 },
            question: false,
          },
          required: ['requestId', 'chatId', 'from', 'to'],
        },
        response: routeResponseSchema('ConversationAssistantSessionResponse', 202),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /whatsapp/conversation-assistant/sessions',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_create_session' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const input: CreateConversationAssistantSessionInput = {
        userId: user.userId,
        requestId: request.body.requestId,
        chatId: request.body.chatId,
        from: request.body.from,
        to: request.body.to,
      };
      if (request.body.model !== undefined) {
        input.model = request.body.model as ConversationAssistantModel;
      }
      if (request.body.maxMessages !== undefined) input.maxMessages = request.body.maxMessages;
      if (request.body.displayTimeZone !== undefined) {
        input.displayTimeZone = request.body.displayTimeZone;
      }

      const result = await safeCall(() => createConversationAssistantSession(input, deps));
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.status(202).ok({
        session: await toPublicSession(result.value.session, request.log),
      });
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/conversation-assistant/sessions/:sessionId',
    {
      schema: {
        operationId: 'getWhatsAppConversationAssistantSession',
        tags: ['whatsapp'],
        response: routeResponseSchema('ConversationAssistantSessionResponse'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message:
          'Received request to GET /whatsapp/conversation-assistant/sessions/:sessionId',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_get_session' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() =>
        getConversationAssistantSession(
          { userId: user.userId, sessionId: request.params.sessionId },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.ok({ session: await toPublicSession(result.value, request.log) });
    }
  );

  fastify.delete<{ Params: SessionParams; Headers: DeleteSessionHeaders }>(
    '/conversation-assistant/sessions/:sessionId',
    {
      attachValidation: true,
      schema: {
        operationId: 'deleteWhatsAppConversationAssistantSession',
        tags: ['whatsapp'],
        headers: {
          type: 'object',
          required: ['x-conversation-assistant-deletion-token'],
          properties: {
            'x-conversation-assistant-deletion-token': { type: 'string', minLength: 1 },
          },
        },
        response: routeResponseSchema('ConversationAssistantDeleted'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to DELETE /whatsapp/conversation-assistant/sessions/:sessionId',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_delete_session' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;
      const deletionToken = request.headers['x-conversation-assistant-deletion-token'];
      if (typeof deletionToken !== 'string' || deletionToken.trim() === '') {
        return await reply.fail('INVALID_REQUEST', 'Deletion token is required');
      }

      const result = await safeCall(() =>
        deleteConversationAssistantSession(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            deletionToken,
          },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.ok(result.value);
    }
  );

  fastify.get<{ Params: SessionRequestParams }>(
    '/conversation-assistant/session-requests/:requestId',
    {
      schema: {
        operationId: 'getWhatsAppConversationAssistantSessionByRequest',
        tags: ['whatsapp'],
        response: routeResponseSchema('ConversationAssistantSessionResponse'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to recover a Conversation Assistant session request',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_recover_session' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() =>
        getConversationAssistantSessionByRequest(
          { userId: user.userId, requestId: request.params.requestId },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.ok({ session: await toPublicSession(result.value, request.log) });
    }
  );

  fastify.get<{ Params: SessionParams; Querystring: ContextQuerystring }>(
    '/conversation-assistant/sessions/:sessionId/context',
    {
      schema: {
        operationId: 'getWhatsAppConversationAssistantContext',
        tags: ['whatsapp'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            messageCursor: { type: 'string' },
            omittedCursor: { type: 'string' },
          },
        },
        response: routeResponseSchema('ConversationAssistantContext'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to inspect a frozen Conversation Assistant context',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_get_context' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() =>
        getConversationAssistantContext(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            ...(request.query.messageCursor !== undefined
              ? { messageCursor: Number(request.query.messageCursor) }
              : {}),
            ...(request.query.omittedCursor !== undefined
              ? { omittedCursor: Number(request.query.omittedCursor) }
              : {}),
          },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.ok(toPublicConversationAssistantContextDto(result.value));
    }
  );

  fastify.post<{ Params: SessionParams; Body: CreateContextAttachmentBody }>(
    '/conversation-assistant/sessions/:sessionId/context-attachments',
    {
      attachValidation: true,
      schema: {
        operationId: 'createWhatsAppConversationAssistantContextAttachment',
        tags: ['whatsapp'],
        params: contextAttachmentSessionParamsSchema(),
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requestId: { type: 'string', minLength: 1, maxLength: 128 },
            replacesAttachmentId: { type: 'string', minLength: 1, maxLength: 256 },
          },
          required: ['requestId'],
        },
        response: routeResponseSchema('ConversationAssistantContextAttachmentResponse', 202),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to create a Conversation Assistant context attachment',
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'whatsapp_conversation_assistant_create_context_attachment',
        },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if (
        !contextAttachmentCreateBodyUsesPublicAllowlist(request) ||
        (request as ValidatedRequest).validationError !== undefined
      ) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getContextAttachmentCreationDeps(reply);
      if (deps === null) return;
      const result = await safeAttachmentCall(() =>
        createConversationAssistantContextAttachment(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            requestId: request.body.requestId,
            ...(request.body.replacesAttachmentId === undefined
              ? {}
              : { replacesAttachmentId: request.body.replacesAttachmentId }),
          },
          deps,
          request.log
        )
      );
      if (result === null) {
        return await reply.fail('INTERNAL_ERROR', 'Context attachment request failed');
      }
      if (result.kind === 'invalid') {
        return await reply.fail('INVALID_REQUEST', result.message);
      }
      if (result.kind === 'not_found') {
        return await reply.fail('NOT_FOUND', 'Context attachment was not found');
      }
      if (result.kind === 'conflict') {
        return await reply.fail('CONFLICT', 'Request id was already used');
      }
      if (result.kind === 'unsupported') {
        return await reply.fail(
          'CONFLICT',
          result.reason === 'legacy_session'
            ? 'This analysis cannot include later messages'
            : 'The source conversation is unavailable'
        );
      }
      if (result.kind === 'stale') {
        return await reply.fail('CONFLICT', 'The conversation context changed');
      }
      return await reply.status(202).ok({
        attachment: toPublicConversationAssistantContextAttachmentDto(
          toPublicConversationAssistantContextAttachment(result.attachment, {
            compatibility: 'current',
            newerAvailableCount: 0,
            newerAvailableCorrectionCount: 0,
          })
        ),
      });
    }
  );

  fastify.get<{ Params: ContextAttachmentParams }>(
    '/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId',
    {
      attachValidation: true,
      schema: {
        operationId: 'getWhatsAppConversationAssistantContextAttachment',
        tags: ['whatsapp'],
        params: contextAttachmentParamsSchema(),
        response: routeResponseSchema('ConversationAssistantContextAttachmentResponse'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to get a Conversation Assistant context attachment',
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'whatsapp_conversation_assistant_get_context_attachment',
        },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getContextAttachmentAccessDeps(reply);
      if (deps === null) return;
      const result = await safeAttachmentCall<GetConversationAssistantContextAttachmentStatusResult>(() =>
        getConversationAssistantContextAttachmentStatus(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            attachmentId: request.params.attachmentId,
          },
          deps,
          request.log
        )
      );
      if (result === null) {
        return await reply.fail('INTERNAL_ERROR', 'Context attachment request failed');
      }
      if (result.kind === 'invalid') {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      if (result.kind === 'not_found') {
        return await reply.fail('NOT_FOUND', 'Context attachment was not found');
      }
      if (result.kind === 'source_unavailable') {
        return await reply.fail('CONFLICT', 'The source conversation is unavailable');
      }
      return await reply.ok(contextAttachmentResponse(result.attachment));
    }
  );

  fastify.get<{
    Params: ContextAttachmentParams;
    Querystring: ContextAttachmentPreviewQuerystring;
  }>(
    '/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId/messages',
    {
      attachValidation: true,
      schema: {
        operationId: 'previewWhatsAppConversationAssistantContextAttachment',
        tags: ['whatsapp'],
        params: contextAttachmentParamsSchema(),
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string', minLength: 1, maxLength: 512 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: routeResponseSchema('ConversationAssistantContextAttachmentPreviewPage'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to preview a Conversation Assistant context attachment',
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'whatsapp_conversation_assistant_preview_context_attachment',
        },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const repository = await getContextAttachmentAccessRepository(reply);
      if (repository === null) return;
      const result = await safeAttachmentCall(() =>
        getConversationAssistantContextAttachmentPreview(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            attachmentId: request.params.attachmentId,
            ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
            limit: request.query.limit ?? 50,
          },
          { repository, clock: conversationAssistantSystemClock },
          request.log
        )
      );
      if (result === null) {
        return await reply.fail('INTERNAL_ERROR', 'Context attachment request failed');
      }
      if (result.kind === 'invalid') {
        return await reply.fail('INVALID_REQUEST', 'Invalid attachment preview cursor');
      }
      if (result.kind === 'not_found') {
        return await reply.fail('NOT_FOUND', 'Context attachment was not found');
      }
      if (result.kind === 'not_ready') {
        return await reply.fail('CONFLICT', 'Context attachment is not ready');
      }
      return await reply.ok(toPublicConversationAssistantAttachmentPreviewDto(result.page));
    }
  );

  fastify.delete<{ Params: ContextAttachmentParams }>(
    '/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId',
    {
      attachValidation: true,
      schema: {
        operationId: 'deleteWhatsAppConversationAssistantContextAttachment',
        tags: ['whatsapp'],
        params: contextAttachmentParamsSchema(),
        response: routeResponseSchema('ConversationAssistantDeleted'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to remove a Conversation Assistant context attachment',
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'whatsapp_conversation_assistant_delete_context_attachment',
        },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const repository = await getContextAttachmentAccessRepository(reply);
      if (repository === null) return;
      const result = await safeAttachmentCall(() =>
        deleteConversationAssistantContextAttachmentDraft(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            attachmentId: request.params.attachmentId,
          },
          { repository },
          request.log
        )
      );
      if (result === null) {
        return await reply.fail('INTERNAL_ERROR', 'Context attachment request failed');
      }
      if (result.kind === 'invalid') {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      if (result.kind === 'not_found') {
        return await reply.fail('NOT_FOUND', 'Context attachment was not found');
      }
      if (result.kind === 'committed') {
        return await reply.fail('CONFLICT', 'Committed context cannot be removed');
      }
      return await reply.ok({ deleted: true });
    }
  );

  fastify.post<{ Params: ContextAttachmentParams }>(
    '/conversation-assistant/sessions/:sessionId/context-attachments/:attachmentId/preparation/retry',
    {
      attachValidation: true,
      schema: {
        operationId: 'retryWhatsAppConversationAssistantContextAttachment',
        tags: ['whatsapp'],
        params: contextAttachmentParamsSchema(),
        response: routeResponseSchema('ConversationAssistantContextAttachmentResponse', 202),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to retry a Conversation Assistant context attachment',
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'whatsapp_conversation_assistant_retry_context_attachment',
        },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getContextAttachmentPublicRetryDeps(reply);
      if (deps === null) return;
      const result = await safeAttachmentCall<RetryConversationAssistantContextAttachmentForUserResult>(() =>
        retryConversationAssistantContextAttachmentForUser(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            attachmentId: request.params.attachmentId,
          },
          deps,
          request.log
        )
      );
      if (result === null) {
        return await reply.fail('INTERNAL_ERROR', 'Context attachment request failed');
      }
      if (result.kind === 'invalid') {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      if (result.kind === 'not_found') {
        return await reply.fail('NOT_FOUND', 'Context attachment was not found');
      }
      if (
        result.kind === 'stale' ||
        result.kind === 'expired' ||
        result.kind === 'invalid_state'
      ) {
        return await reply.fail('CONFLICT', 'Context attachment cannot be retried');
      }
      return await reply.status(202).ok(contextAttachmentResponse(result.attachment));
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/conversation-assistant/sessions/:sessionId/context/history',
    {
      attachValidation: true,
      schema: {
        operationId: 'listWhatsAppConversationAssistantContextHistory',
        tags: ['whatsapp'],
        params: contextAttachmentSessionParamsSchema(),
        response: routeResponseSchema('ConversationAssistantContextHistory'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to list Conversation Assistant context history',
        bodyPreviewLength: 0,
        additionalFields: {
          route: 'whatsapp_conversation_assistant_list_context_history',
        },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const repository = await getContextAttachmentAccessRepository(reply);
      if (repository === null) return;
      const result = await safeAttachmentCall(() =>
        listConversationAssistantContextHistory(
          { userId: user.userId, sessionId: request.params.sessionId },
          { repository },
          request.log
        )
      );
      if (result === null) {
        return await reply.fail('INTERNAL_ERROR', 'Context history request failed');
      }
      if (result.kind === 'invalid') {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      if (result.kind === 'not_found') {
        return await reply.fail('NOT_FOUND', 'Conversation Assistant session was not found');
      }
      return await reply.ok(toPublicConversationAssistantContextHistoryDto(result.snapshots));
    }
  );

  fastify.post<{ Params: SessionParams }>(
    '/conversation-assistant/sessions/:sessionId/preparation/retry',
    {
      schema: {
        operationId: 'retryWhatsAppConversationAssistantPreparation',
        tags: ['whatsapp'],
        response: routeResponseSchema('ConversationAssistantSessionResponse', 202),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to retry Conversation Assistant preparation',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_retry_preparation' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() =>
        retryConversationAssistantPreparation(
          { userId: user.userId, sessionId: request.params.sessionId },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.status(202).ok({
        session: await toPublicSession(result.value, request.log),
      });
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/conversation-assistant/sessions/:sessionId/export.pdf',
    {
      schema: {
        operationId: 'exportWhatsAppConversationAssistantSessionPdf',
        tags: ['whatsapp'],
        response: pdfExportResponseSchema(),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message:
          'Received request to GET /whatsapp/conversation-assistant/sessions/:sessionId/export.pdf',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_export_pdf' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantExportDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() =>
        exportConversationAssistantSessionPdf(
          { userId: user.userId, sessionId: request.params.sessionId },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }

      reply
        .header('Content-Type', result.value.contentType)
        .header('Content-Disposition', `attachment; filename="${result.value.fileName}"`)
        .header('Cache-Control', 'no-store');
      // @allow-raw-send: Conversation Assistant PDF export returns binary PDF bytes
      return await reply.send(result.value.bytes);
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/conversation-assistant/sessions/:sessionId/turns',
    {
      schema: {
        operationId: 'listWhatsAppConversationAssistantTurns',
        tags: ['whatsapp'],
        response: routeResponseSchema('ConversationAssistantTurnList'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message:
          'Received request to GET /whatsapp/conversation-assistant/sessions/:sessionId/turns',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_list_turns' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() =>
        listConversationAssistantTurns(
          { userId: user.userId, sessionId: request.params.sessionId },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.ok({
        turns: result.value.map(({ turn, canRetryAnswer }) =>
          toPublicConversationAssistantTurnDto(turn, { canRetryAnswer })
        ),
      });
    }
  );

  fastify.post<{ Params: SessionParams; Body: SendTurnBody }>(
    '/conversation-assistant/sessions/:sessionId/turns',
    {
      attachValidation: true,
      schema: {
        operationId: 'sendWhatsAppConversationAssistantTurnRequest',
        tags: ['whatsapp'],
        params: contextAttachmentSessionParamsSchema(),
        body: turnRequestBodySchema(),
        response: routeResponseSchema('ConversationAssistantSendTurn', 201),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message:
          'Received request to POST /whatsapp/conversation-assistant/sessions/:sessionId/turns',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_send_turn' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if (
        !turnRequestBodyUsesPublicAllowlist(request) ||
        (request as ValidatedRequest).validationError !== undefined ||
        !turnRequestBodyHasSafeCompatibilityBoundary(request.body)
      ) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const legacyMode = await resolveLegacyTurnMode(
        user.userId,
        request.params.sessionId
      );
      if (!legacyMode.ok) {
        return await sendConversationAssistantError(reply, legacyMode.error);
      }
      if (legacyMode.value) {
        if (request.body.contextAttachmentId !== undefined) {
          return await reply.fail(
            'CONTEXT_STALE',
            'This analysis cannot include later messages'
          );
        }
        const legacyDeps = await getConversationAssistantDeps(reply);
        if (legacyDeps === null) return;
        const legacyResult = await safeCall(() =>
          sendConversationAssistantTurn(
            {
              userId: user.userId,
              sessionId: request.params.sessionId,
              question: request.body.question,
            },
            legacyDeps
          )
        );
        if (!legacyResult.ok) {
          return await sendConversationAssistantError(reply, legacyResult.error);
        }
        return await reply.status(201).ok({
          turns: legacyResult.value.map((turn) => toPublicConversationAssistantTurnDto(turn)),
        });
      }
      const deps = await getConversationAssistantTurnRequestDeps(reply);
      if (deps === null) return;
      const requestId = request.body.requestId ?? `compat-${randomUUID()}`;

      const result = await safeTurnRequestCall(() =>
        startConversationAssistantTurnRequest(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            requestId,
            question: request.body.question,
            ...(request.body.contextAttachmentId === undefined
              ? {}
              : { contextAttachmentId: request.body.contextAttachmentId }),
            ...(request.body.confirmationToken === undefined
              ? {}
              : { confirmationToken: request.body.confirmationToken }),
          },
          deps,
          () => undefined
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantTurnRequestError(reply, result.error);
      }
      return await reply
        .status(201)
        .ok(toPublicConversationAssistantExecutionRecoveryDto(result.value));
    }
  );

  fastify.post<{ Params: SessionParams; Body: SendTurnBody }>(
    '/conversation-assistant/sessions/:sessionId/turns/stream',
    {
      attachValidation: true,
      schema: {
        operationId: 'streamWhatsAppConversationAssistantTurnRequest',
        tags: ['whatsapp'],
        params: contextAttachmentSessionParamsSchema(),
        body: turnRequestBodySchema(),
        response: streamResponseSchema(),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message:
          'Received request to POST /whatsapp/conversation-assistant/sessions/:sessionId/turns/stream',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_stream_turn' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if (
        !turnRequestBodyUsesPublicAllowlist(request) ||
        (request as ValidatedRequest).validationError !== undefined ||
        !turnRequestBodyHasSafeCompatibilityBoundary(request.body)
      ) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const legacyMode = await resolveLegacyTurnMode(
        user.userId,
        request.params.sessionId
      );
      if (!legacyMode.ok) {
        return await sendConversationAssistantError(reply, legacyMode.error);
      }
      if (legacyMode.value && request.body.contextAttachmentId !== undefined) {
        return await reply.fail(
          'CONTEXT_STALE',
          'This analysis cannot include later messages'
        );
      }
      if (legacyMode.value) {
        const legacyDeps = await getConversationAssistantDeps(reply);
        if (legacyDeps === null) return;
        startConversationAssistantSse(reply);
        const legacyResult = await safeCall(() =>
          streamConversationAssistantTurn(
            {
              userId: user.userId,
              sessionId: request.params.sessionId,
              question: request.body.question,
            },
            legacyDeps,
            (event) => {
              writeLegacyTurnSseEvent(reply, event);
            }
          )
        );
        if (!legacyResult.ok && canWriteSse(reply)) {
          writeLegacyTurnSseEvent(reply, { type: 'error', error: legacyResult.error });
          writeLegacyTurnSseEvent(reply, { type: 'done' });
        }
        endConversationAssistantSse(reply);
        return;
      }

      const deps = await getConversationAssistantTurnRequestDeps(reply);
      if (deps === null) return;
      startConversationAssistantSse(reply);

      const requestId = request.body.requestId ?? `compat-${randomUUID()}`;
      let lastSequence = 0;
      const result = await safeTurnRequestCall(() =>
        startConversationAssistantTurnRequest(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            requestId,
            question: request.body.question,
            ...(request.body.contextAttachmentId === undefined
              ? {}
              : { contextAttachmentId: request.body.contextAttachmentId }),
            ...(request.body.confirmationToken === undefined
              ? {}
              : { confirmationToken: request.body.confirmationToken }),
          },
          deps,
          (event) => {
            lastSequence = event.streamSequence;
            writeTurnRequestSseEvent(reply, event);
          }
        )
      );
      if (!result.ok && canWriteSse(reply)) {
        lastSequence += 1;
        writeTurnRequestSseEvent(reply, {
          type: 'error',
          requestId,
          streamSequence: lastSequence,
          error: result.error,
        });
        lastSequence += 1;
        writeTurnRequestSseEvent(reply, {
          type: 'done',
          requestId,
          streamSequence: lastSequence,
        });
      }
      endConversationAssistantSse(reply);
    }
  );

  fastify.get<{ Params: TurnRequestParams }>(
    '/conversation-assistant/sessions/:sessionId/turn-requests/:requestId',
    {
      attachValidation: true,
      schema: {
        operationId: 'getWhatsAppConversationAssistantTurnRequest',
        tags: ['whatsapp'],
        params: turnRequestParamsSchema(),
        response: routeResponseSchema('ConversationAssistantTurnRequestRecovery'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to recover a Conversation Assistant answer request',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_get_turn_request' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getConversationAssistantTurnRequestDeps(reply);
      if (deps === null) return;
      const result = await safeTurnRequestCall(() =>
        getConversationAssistantTurnRequest(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            requestId: request.params.requestId,
          },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantTurnRequestError(reply, result.error);
      }
      return await reply.ok(toPublicConversationAssistantTurnRequestRecoveryDto(result.value));
    }
  );

  fastify.post<{ Params: TurnRequestParams }>(
    '/conversation-assistant/sessions/:sessionId/turn-requests/:requestId/resume',
    {
      attachValidation: true,
      schema: {
        operationId: 'resumeWhatsAppConversationAssistantTurnRequest',
        tags: ['whatsapp'],
        params: turnRequestParamsSchema(),
        response: routeResponseSchema('ConversationAssistantTurnRequestRecovery'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to resume a Conversation Assistant answer request',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_resume_turn_request' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getConversationAssistantTurnRequestDeps(reply);
      if (deps === null) return;
      const result = await safeTurnRequestCall(() =>
        resumeConversationAssistantTurnRequest(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            requestId: request.params.requestId,
          },
          deps,
          () => undefined
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantTurnRequestError(reply, result.error);
      }
      return await reply.ok(toPublicConversationAssistantExecutionRecoveryDto(result.value));
    }
  );

  fastify.post<{ Params: TurnRequestParams }>(
    '/conversation-assistant/sessions/:sessionId/turn-requests/:requestId/answer/retry',
    {
      attachValidation: true,
      schema: {
        operationId: 'retryWhatsAppConversationAssistantTurnRequestAnswer',
        tags: ['whatsapp'],
        params: turnRequestParamsSchema(),
        response: routeResponseSchema('ConversationAssistantTurnRequestRecovery'),
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to retry a Conversation Assistant answer',
        bodyPreviewLength: 0,
        additionalFields: { route: 'whatsapp_conversation_assistant_retry_answer' },
      });
      const user = await requireAuth(request, reply);
      if (user === null) return;
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getConversationAssistantTurnRequestDeps(reply);
      if (deps === null) return;
      const result = await safeTurnRequestCall(() =>
        retryConversationAssistantTurnRequestAnswer(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            requestId: request.params.requestId,
          },
          deps,
          () => undefined
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantTurnRequestError(reply, result.error);
      }
      return await reply.ok(toPublicConversationAssistantExecutionRecoveryDto(result.value));
    }
  );

  done();
};

async function getConversationAssistantDeps(
  reply: FastifyReply
): Promise<ConversationAssistantDeps | null> {
  const services = getServices();
  if (
    services.conversationAssistantRepository === undefined ||
    services.llmClientFactory === undefined ||
    services.conversationAssistantModel === undefined
  ) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  const deps: ConversationAssistantDeps = {
    repository: services.conversationAssistantRepository,
    privateWhatsAppRepository: services.privateWhatsAppRepository,
    llmClientFactory: services.llmClientFactory,
    preparationPublisher: {
      async publish(event) {
        const result = await services.eventPublisher.publishConversationAssistantPreparation(event);
        return result.ok
          ? { ok: true as const, value: undefined }
          : {
              ok: false as const,
              error: { code: 'INTERNAL_ERROR' as const, message: result.error.message },
            };
      },
    },
    defaultModel: services.conversationAssistantModel,
    clock: conversationAssistantSystemClock,
    ids: conversationAssistantRandomIds,
  };
  if (services.conversationAssistantOperationalTelemetry !== undefined) {
    deps.telemetry = services.conversationAssistantOperationalTelemetry;
  }
  if (services.pdfConversationExporter !== undefined) {
    deps.pdfExporter = services.pdfConversationExporter;
  }
  return deps;
}

async function getConversationAssistantTurnRequestDeps(
  reply: FastifyReply
): Promise<ConversationAssistantTurnRequestDeps | null> {
  const services = getServices();
  if (
    services.conversationAssistantTurnRequestRepository === undefined ||
    services.conversationAssistantTurnRequestRunner === undefined ||
    services.conversationAssistantOperationalTelemetry === undefined
  ) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  return {
    repository: services.conversationAssistantTurnRequestRepository,
    runner: services.conversationAssistantTurnRequestRunner,
    telemetry: services.conversationAssistantOperationalTelemetry,
    clock: conversationAssistantSystemClock,
    ids: { claimId: conversationAssistantRandomIds.sessionGenerationId },
    heartbeat: conversationAssistantTurnRequestSystemHeartbeat,
  };
}

async function resolveLegacyTurnMode(
  userId: string,
  sessionId: string
): Promise<Result<boolean, ConversationAssistantError>> {
  const repository = getServices().conversationAssistantRepository;
  if (repository === undefined) return { ok: true, value: false };
  try {
    const session = await repository.getSessionById(sessionId);
    return {
      ok: true,
      value:
        session !== null &&
        session.userId === userId &&
        session.continuation === undefined,
    };
  } catch {
    return {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: CONVERSATION_ASSISTANT_INTERNAL_ERROR_MESSAGE },
    };
  }
}

function contextAttachmentPreparationPublisher(): ConversationAssistantContextAttachmentPreparationPublisher {
  return {
    async publish(
      event
    ): ReturnType<ConversationAssistantContextAttachmentPreparationPublisher['publish']> {
      const result = await getServices().eventPublisher
        .publishConversationAssistantContextAttachmentPreparation(event);
      return result.ok
        ? { ok: true as const, value: undefined }
        : {
            ok: false as const,
            error: { code: result.error.code, message: result.error.message },
          };
    },
  };
}

async function getContextAttachmentCreationDeps(
  reply: FastifyReply
): Promise<ConversationAssistantContextAttachmentCreationDeps | null> {
  const repository = getServices().conversationAssistantContextAttachmentRepository;
  if (repository === undefined) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  return {
    repository,
    preparationPublisher: contextAttachmentPreparationPublisher(),
    ...(getServices().conversationAssistantOperationalTelemetry === undefined
      ? {}
      : { telemetry: getServices().conversationAssistantOperationalTelemetry }),
  };
}

async function getContextAttachmentAccessRepository(
  reply: FastifyReply
): Promise<ConversationAssistantContextAttachmentAccessRepository | null> {
  const repository = getServices().conversationAssistantContextAttachmentRepository;
  if (repository === undefined) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  return repository;
}

async function getContextAttachmentAccessDeps(
  reply: FastifyReply
): Promise<ConversationAssistantContextAttachmentAccessDeps | null> {
  const repository = await getContextAttachmentAccessRepository(reply);
  if (repository === null) return null;
  return {
    repository,
    privateWhatsAppRepository: getServices().privateWhatsAppRepository,
    clock: conversationAssistantSystemClock,
  };
}

async function getContextAttachmentPublicRetryDeps(
  reply: FastifyReply
): Promise<ConversationAssistantContextAttachmentPublicRetryDeps | null> {
  const repository = getServices().conversationAssistantContextAttachmentRepository;
  if (repository === undefined) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  return {
    repository,
    preparationPublisher: contextAttachmentPreparationPublisher(),
    clock: conversationAssistantSystemClock,
  };
}

async function getConversationAssistantExportDeps(
  reply: FastifyReply
): Promise<ConversationAssistantDeps | null> {
  const deps = await getConversationAssistantDeps(reply);
  if (deps === null) {
    return null;
  }
  if (deps.pdfExporter === undefined) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  return deps;
}

async function toPublicSession(
  session: ConversationAssistantSession,
  logger: Logger
): Promise<PublicConversationAssistantSession> {
  const continuation = session.continuation;
  const [contextContinuationState, activeTurn] = await Promise.all([
    resolveConversationAssistantContinuationState(
      session,
      getServices().privateWhatsAppRepository,
      logger
    ),
    resolvePublicActiveTurn(session, logger),
  ]);
  return toPublicConversationAssistantSessionDto(session, {
    deletionToken: createConversationAssistantDeletionToken(session),
    deletionPending: session.deletionStartedAt !== undefined,
    modelDisplayName: getConversationAssistantModelDisplayName(session.model),
    contextSummary: {
      displayTimeZone:
        continuation?.displayTimeZone ?? session.preparationDisplayTimeZone ?? 'UTC',
      availability:
        contextContinuationState === 'available'
          ? {
              state: contextContinuationState,
              displayTimeZone:
                continuation?.displayTimeZone ?? session.preparationDisplayTimeZone ?? 'UTC',
            }
          : { state: contextContinuationState },
      contextVersion: continuation?.contextVersion ?? 0,
      snapshotCount: continuation === undefined ? 0 : continuation.attachmentCount + 1,
      totalAttachedMessageCount: continuation?.totalAttachedMessageCount ?? 0,
      totalAttachedOmittedCount: continuation?.totalAttachedOmittedCount ?? 0,
      completedConversationRevision: continuation?.completedConversationRevision ?? 0,
      activeTurn,
    },
  });
}

async function resolvePublicActiveTurn(
  session: ConversationAssistantSession,
  logger: Logger
): Promise<null | { requestId: string; stateVersion: number }> {
  const requestId = session.continuation?.activeTurnRequestId;
  const repository = getServices().conversationAssistantTurnRequestRepository;
  if (requestId === undefined || repository === undefined) return null;

  try {
    const result = await repository.getTurnRequest({
      userId: session.userId,
      sessionId: session.id,
      requestId,
    });
    if (result.status !== 'found' || result.request.status !== 'in_progress') return null;
    return { requestId: result.request.id, stateVersion: result.request.stateVersion };
  } catch {
    logger.warn(
      {
        operation: 'conversation_assistant_active_turn_summary',
        outcome: 'unavailable',
        errorCode: 'TURN_REQUEST_LOOKUP_FAILED',
      },
      'Failed to resolve Conversation Assistant active turn summary'
    );
    return null;
  }
}

async function sendConversationAssistantError(
  reply: FastifyReply,
  error: ConversationAssistantError
): Promise<FastifyReply> {
  if (error.code === 'NOT_FOUND') {
    return await reply.fail('NOT_FOUND', error.message);
  }
  if (error.code === 'CONTEXT_NOT_READY') {
    return await reply.fail('INVALID_REQUEST', error.message);
  }
  if (error.code === 'INVALID_REQUEST' || error.code === 'EMPTY_TRANSCRIPT') {
    return await reply.fail(error.code, error.message);
  }
  return await reply.fail('INTERNAL_ERROR', CONVERSATION_ASSISTANT_INTERNAL_ERROR_MESSAGE);
}

async function sendConversationAssistantTurnRequestError(
  reply: FastifyReply,
  error: ConversationAssistantTurnRequestError
): Promise<FastifyReply> {
  return await reply.fail(error.code, error.message);
}

async function safeCall<T>(
  fn: () => Promise<import('../domain/conversation-assistant/types.js').ConversationAssistantResult<T>>
): Promise<import('../domain/conversation-assistant/types.js').ConversationAssistantResult<T>> {
  try {
    return await fn();
  } catch {
    return {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: CONVERSATION_ASSISTANT_INTERNAL_ERROR_MESSAGE },
    };
  }
}

async function safeTurnRequestCall<T>(
  fn: () => Promise<Result<T, ConversationAssistantTurnRequestError>>
): Promise<Result<T, ConversationAssistantTurnRequestError>> {
  try {
    return await fn();
  } catch {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Conversation Assistant answer request failed',
      },
    };
  }
}

async function safeAttachmentCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function contextAttachmentResponse(
  attachment: PublicConversationAssistantContextAttachment
): { attachment: PublicConversationAssistantContextAttachment } {
  return { attachment: toPublicConversationAssistantContextAttachmentDto(attachment) };
}

type TurnRequestHttpStreamEvent =
  | ConversationAssistantTurnRequestStreamEvent
  | {
      type: 'error';
      requestId: string;
      streamSequence: number;
      error: ConversationAssistantTurnRequestError;
    };

function startConversationAssistantSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

export function writeTurnRequestSseEvent(
  reply: FastifyReply,
  event: TurnRequestHttpStreamEvent
): void {
  if (!canWriteSse(reply)) throw new Error('Conversation Assistant event stream disconnected');
  const publicEvent = toPublicConversationAssistantSseEvent(event);
  reply.raw.write(`event: ${publicEvent.type}\ndata: ${JSON.stringify(publicEvent)}\n\n`);
}

export function writeLegacyTurnSseEvent(
  reply: FastifyReply,
  event: ConversationAssistantStreamEvent
): void {
  if (!canWriteSse(reply)) throw new Error('Conversation Assistant event stream disconnected');
  const publicEvent = toPublicConversationAssistantSseEvent(event);
  reply.raw.write(`event: ${publicEvent.type}\ndata: ${JSON.stringify(publicEvent)}\n\n`);
}

function canWriteSse(reply: FastifyReply): boolean {
  return !reply.raw.destroyed && !reply.raw.writableEnded;
}

export function endConversationAssistantSse(reply: FastifyReply): void {
  if (canWriteSse(reply)) reply.raw.end();
}

function routeResponseSchema(
  dataSchemaId: string,
  status = 200
): Record<number, Record<string, unknown>> {
  return {
    [status]: {
      description: 'Conversation Assistant response',
      type: 'object',
      additionalProperties: false,
      properties: {
        success: { type: 'boolean', const: true },
        data: { $ref: `${dataSchemaId}#` },
        diagnostics: { $ref: 'Diagnostics#' },
      },
      required: ['success', 'data'],
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found'),
    409: errorResponse('Conflict'),
    422: errorResponse('Context window exceeded'),
    500: errorResponse('Internal error'),
  };
}

function contextAttachmentSessionParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { sessionId: { type: 'string', minLength: 1, maxLength: 256 } },
    required: ['sessionId'],
  };
}

function contextAttachmentParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      sessionId: { type: 'string', minLength: 1, maxLength: 256 },
      attachmentId: { type: 'string', minLength: 1, maxLength: 256 },
    },
    required: ['sessionId', 'attachmentId'],
  };
}

function turnRequestParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      sessionId: { type: 'string', minLength: 1, maxLength: 256 },
      requestId: { type: 'string', minLength: 1, maxLength: 128 },
    },
    required: ['sessionId', 'requestId'],
  };
}

function turnRequestBodySchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      requestId: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        description:
          'Client idempotency key. New clients always send it; omission is accepted only for a plain question from a pre-release client during rolling deployment.',
      },
      question: { type: 'string', minLength: 1 },
      contextAttachmentId: { type: 'string', minLength: 1, maxLength: 256 },
      confirmationToken: { type: 'string', minLength: 1, maxLength: 512 },
    },
    required: ['question'],
  };
}

const TURN_REQUEST_PUBLIC_BODY_KEYS = new Set([
  'requestId',
  'question',
  'contextAttachmentId',
  'confirmationToken',
]);

const CONTEXT_ATTACHMENT_CREATE_PUBLIC_BODY_KEYS = new Set([
  'requestId',
  'replacesAttachmentId',
]);

function rawBodyUsesPublicAllowlist(rawBody: unknown, allowedKeys: ReadonlySet<string>): boolean {
  if (typeof rawBody !== 'string') return false;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    return Object.keys(parsed).every((key) => allowedKeys.has(key));
  } catch {
    return false;
  }
}

export function conversationAssistantTurnBodyUsesPublicAllowlist(rawBody: unknown): boolean {
  return rawBodyUsesPublicAllowlist(rawBody, TURN_REQUEST_PUBLIC_BODY_KEYS);
}

function turnRequestBodyUsesPublicAllowlist(request: FastifyRequest): boolean {
  return conversationAssistantTurnBodyUsesPublicAllowlist(
    (request as FastifyRequest & { rawBody?: unknown }).rawBody
  );
}

function turnRequestBodyHasSafeCompatibilityBoundary(body: SendTurnBody): boolean {
  return (
    body.requestId !== undefined ||
    (body.contextAttachmentId === undefined && body.confirmationToken === undefined)
  );
}

export function conversationAssistantContextAttachmentCreateBodyUsesPublicAllowlist(
  rawBody: unknown
): boolean {
  return rawBodyUsesPublicAllowlist(rawBody, CONTEXT_ATTACHMENT_CREATE_PUBLIC_BODY_KEYS);
}

function contextAttachmentCreateBodyUsesPublicAllowlist(request: FastifyRequest): boolean {
  return conversationAssistantContextAttachmentCreateBodyUsesPublicAllowlist(
    (request as FastifyRequest & { rawBody?: unknown }).rawBody
  );
}

function streamResponseSchema(): Record<number, Record<string, unknown>> {
  return {
    200: {
      description: 'Conversation Assistant event stream',
      type: 'string',
      content: {
        'text/event-stream': {
          schema: { type: 'string' },
          'x-event-schema': { $ref: 'ConversationAssistantSseEvent#' },
        },
      },
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found'),
    409: errorResponse('Conflict'),
    422: errorResponse('Context window exceeded'),
    500: errorResponse('Internal error'),
  };
}

function pdfExportResponseSchema(): Record<number, Record<string, unknown>> {
  return {
    200: {
      description: 'Conversation Assistant PDF export',
      type: 'string',
      content: {
        'application/pdf': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found'),
    500: errorResponse('Internal error'),
  };
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    type: 'object',
    additionalProperties: false,
    properties: {
      success: { type: 'boolean', const: false },
      error: { $ref: 'ErrorBody#' },
      diagnostics: { $ref: 'Diagnostics#' },
    },
    required: ['success', 'error'],
  };
}
