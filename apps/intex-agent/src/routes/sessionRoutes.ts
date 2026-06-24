import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';

interface SessionParams {
  sessionId: string;
}

const sessionParamsSchema = {
  type: 'object',
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
  },
} as const;

export const sessionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/sessions',
    {
      schema: {
        operationId: 'listIntexAgentSessions',
        summary: 'List Intex Agent sessions',
        description: 'List WhatsApp Assistant sessions for the authenticated user.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const sessions = await getServices().sessionRepository.listSessions(user.userId);
      return await reply.ok(sessions);
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/sessions/:sessionId/events',
    {
      schema: {
        operationId: 'listIntexAgentSessionEvents',
        summary: 'List Intex Agent session events',
        description: 'List timeline events for one WhatsApp Assistant session.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        params: sessionParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const events = await getServices().sessionRepository.listEvents(
        request.params.sessionId,
        user.userId
      );
      return await reply.ok(events);
    }
  );

  fastify.get<{ Params: SessionParams }>(
    '/sessions/:sessionId',
    {
      schema: {
        operationId: 'getIntexAgentSession',
        summary: 'Get Intex Agent session',
        description: 'Get one WhatsApp Assistant session for the authenticated user.',
        tags: ['intex-agent'],
        security: [{ bearerAuth: [] }],
        params: sessionParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const session = await getServices().sessionRepository.getSession(
        request.params.sessionId,
        user.userId
      );
      if (session === null) {
        return await reply.fail('NOT_FOUND', 'Session not found');
      }

      return await reply.ok(session);
    }
  );

  done();
};
