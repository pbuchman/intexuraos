import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import {
  checkConversationAssistantContext,
  conversationAssistantRandomIds,
  conversationAssistantSystemClock,
  createConversationAssistantSession,
  exportConversationAssistantSessionPdf,
  getConversationAssistantSession,
  listConversationAssistantSessions,
  listConversationAssistantTurns,
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

interface CheckContextBody {
  chatId: string;
  from: string;
  to: string;
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
        response: routeResponseSchema(),
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
            chatId: { type: 'string', minLength: 1 },
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
            maxMessages: { type: 'integer', minimum: 1 },
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
      const deps = await getConversationAssistantDeps(reply);
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

  fastify.post<{ Params: SessionParams; Body: SendTurnBody }>(
    '/conversation-assistant/sessions/:sessionId/turns/stream',
    {
      attachValidation: true,
      schema: {
        operationId: 'streamWhatsAppConversationAssistantTurn',
        tags: ['whatsapp'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { question: { type: 'string' } },
          required: ['question'],
        },
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
      if ((request as ValidatedRequest).validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const deps = await getConversationAssistantDeps(reply);
      if (deps === null) return;

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const result = await safeCall(() =>
        streamConversationAssistantTurn(
          {
            userId: user.userId,
            sessionId: request.params.sessionId,
            question: request.body.question,
          },
          deps,
          (event) => {
            writeSseEvent(reply, event);
          }
        )
      );
      if (!result.ok) {
        writeSseEvent(reply, { type: 'error', error: result.error });
        writeSseEvent(reply, { type: 'done' });
      }
      reply.raw.end();
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
    services.pdfConversationExporter === undefined ||
    services.conversationAssistantModel === undefined
  ) {
    await reply.fail('INTERNAL_ERROR', 'Conversation Assistant services are not configured');
    return null;
  }
  return {
    repository: services.conversationAssistantRepository,
    privateWhatsAppRepository: services.privateWhatsAppRepository,
    llmClientFactory: services.llmClientFactory,
    pdfExporter: services.pdfConversationExporter,
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

function writeSseEvent(reply: FastifyReply, event: ConversationAssistantStreamEvent): void {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
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

function streamResponseSchema(): Record<number, Record<string, unknown>> {
  return {
    200: {
      description: 'Conversation Assistant event stream',
      type: 'string',
    },
    400: errorResponse('Invalid request'),
    401: errorResponse('Unauthorized'),
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
    properties: {
      success: { type: 'boolean', const: false },
      error: { $ref: 'ErrorBody#' },
      diagnostics: { $ref: 'Diagnostics#' },
    },
    required: ['success', 'error'],
  };
}
