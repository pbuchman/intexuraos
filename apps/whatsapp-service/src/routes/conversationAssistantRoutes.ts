import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import {
  conversationAssistantRandomIds,
  conversationAssistantSystemClock,
  createConversationAssistantSession,
  getConversationAssistantSession,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
  sendConversationAssistantTurn,
} from '../domain/conversation-assistant/sessionUseCases.js';
import type { ConversationAssistantDeps } from '../domain/conversation-assistant/ports.js';
import type {
  ConversationAssistantError,
  ConversationAssistantSession,
  CreateConversationAssistantSessionInput,
  PublicConversationAssistantSession,
} from '../domain/conversation-assistant/types.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

interface CreateSessionBody {
  chatId: string;
  from: string;
  to: string;
  maxMessages?: number;
  question?: string;
}

interface SessionParams {
  sessionId: string;
}

interface SendTurnBody {
  question: string;
}

export const conversationAssistantRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/conversation-assistant/sessions',
    {
      schema: {
        operationId: 'listWhatsAppConversationAssistantSessions',
        tags: ['whatsapp'],
        response: routeResponseSchema(),
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
      return await reply.ok({ sessions: result.value.map(toPublicSession) });
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
            chatId: { type: 'string', minLength: 1 },
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
            maxMessages: { type: 'integer', minimum: 1, maximum: 5000 },
            question: { type: 'string' },
          },
          required: ['chatId', 'from', 'to'],
        },
        response: routeResponseSchema(201),
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
        chatId: request.body.chatId,
        from: request.body.from,
        to: request.body.to,
      };
      if (request.body.maxMessages !== undefined) input.maxMessages = request.body.maxMessages;
      if (request.body.question !== undefined) input.question = request.body.question;

      const result = await safeCall(() => createConversationAssistantSession(input, deps));
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.status(201).ok({
        session: toPublicSession(result.value.session),
        turns: result.value.turns,
      });
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/conversation-assistant/sessions/:sessionId',
    {
      schema: {
        operationId: 'getWhatsAppConversationAssistantSession',
        tags: ['whatsapp'],
        response: routeResponseSchema(),
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
      return await reply.ok({ session: toPublicSession(result.value) });
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/conversation-assistant/sessions/:sessionId/turns',
    {
      schema: {
        operationId: 'listWhatsAppConversationAssistantTurns',
        tags: ['whatsapp'],
        response: routeResponseSchema(),
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
      return await reply.ok({ turns: result.value });
    }
  );

  fastify.post<{ Params: SessionParams; Body: SendTurnBody }>(
    '/conversation-assistant/sessions/:sessionId/turns',
    {
      attachValidation: true,
      schema: {
        operationId: 'sendWhatsAppConversationAssistantTurn',
        tags: ['whatsapp'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { question: { type: 'string' } },
          required: ['question'],
        },
        response: routeResponseSchema(201),
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
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      const result = await safeCall(() =>
        sendConversationAssistantTurn(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            question: request.body.question,
          },
          deps
        )
      );
      if (!result.ok) {
        return await sendConversationAssistantError(reply, result.error);
      }
      return await reply.status(201).ok({ turns: result.value });
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
    services.llmClient === undefined ||
    services.conversationAssistantModel === undefined
  ) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  return {
    repository: services.conversationAssistantRepository,
    privateWhatsAppRepository: services.privateWhatsAppRepository,
    llmClient: services.llmClient,
    model: services.conversationAssistantModel,
    clock: conversationAssistantSystemClock,
    ids: conversationAssistantRandomIds,
  };
}

function toPublicSession(
  session: ConversationAssistantSession
): PublicConversationAssistantSession {
  const { transcriptText: _transcriptText, ...publicSession } = session;
  return publicSession;
}

async function sendConversationAssistantError(
  reply: FastifyReply,
  error: ConversationAssistantError
): Promise<FastifyReply> {
  if (error.code === 'NOT_FOUND') {
    return await reply.fail('NOT_FOUND', error.message);
  }
  if (error.code === 'INVALID_REQUEST' || error.code === 'EMPTY_TRANSCRIPT') {
    return await reply.fail(error.code, error.message);
  }
  return await reply.fail('INTERNAL_ERROR', error.message);
}

async function safeCall<T>(
  fn: () => Promise<import('../domain/conversation-assistant/types.js').ConversationAssistantResult<T>>
): Promise<import('../domain/conversation-assistant/types.js').ConversationAssistantResult<T>> {
  try {
    return await fn();
  } catch (error) {
    return {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: getErrorMessage(error) },
    };
  }
}

function routeResponseSchema(status = 200): Record<number, Record<string, unknown>> {
  return {
    [status]: {
      description: 'Conversation Assistant response',
      type: 'object',
      properties: {
        success: { type: 'boolean', const: true },
        data: { type: 'object', additionalProperties: true },
      },
      required: ['success', 'data'],
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found'),
    500: errorResponse('Internal error'),
  };
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    type: 'object',
    properties: {
      success: { type: 'boolean', const: false },
      error: { $ref: 'ErrorBody#' },
      diagnostics: { $ref: 'Diagnostics#' },
    },
    required: ['success', 'error'],
  };
}
