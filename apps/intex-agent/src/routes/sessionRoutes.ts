import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '../domain/sessions/types.js';

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

      const { sessionRepository } = getServices();
      const sessions = await sessionRepository.listSessions(user.userId);
      const enrichedSessions = await enrichSessionsWithSummary(
        sessions.filter((session) => session.matrixCorpusProfile === undefined),
        user.userId
      );
      return await reply.ok(enrichedSessions);
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

      const { sessionRepository } = getServices();
      const session = await sessionRepository.getSession(
        request.params.sessionId,
        user.userId
      );
      if (session === null || session.matrixCorpusProfile !== undefined)
        return await reply.fail('NOT_FOUND', 'Session not found');
      const events = await sessionRepository.listEvents(request.params.sessionId, user.userId);
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

      const { sessionRepository } = getServices();
      const session = await sessionRepository.getSession(
        request.params.sessionId,
        user.userId
      );
      if (session === null || session.matrixCorpusProfile !== undefined) {
        return await reply.fail('NOT_FOUND', 'Session not found');
      }

      return await reply.ok(await enrichSessionWithSummary(session, user.userId));
    }
  );

  done();
};

async function enrichSessionsWithSummary(
  sessions: IntexAgentSession[],
  userId: string
): Promise<IntexAgentSession[]> {
  return await Promise.all(sessions.map((session) => enrichSessionWithSummary(session, userId)));
}

async function enrichSessionWithSummary(
  session: IntexAgentSession,
  userId: string
): Promise<IntexAgentSession> {
  if (hasTitleMetadata(session)) {
    return session;
  }

  const events = await getServices().sessionRepository.listEvents(session.id, userId);
  const title = getFirstUserMessageTitle(events);
  return title === undefined ? session : { ...session, summary: title };
}

function hasTitleMetadata(session: IntexAgentSession): boolean {
  return (
    (session.summary !== undefined && session.summary.trim() !== '') ||
    session.activeTool !== undefined
  );
}

function getFirstUserMessageTitle(events: IntexAgentSessionEvent[]): string | undefined {
  const event = events.find((candidate) => candidate.type === 'user_message');
  const text = event?.payload['text'];
  if (typeof text !== 'string') {
    return undefined;
  }

  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized === '') {
    return undefined;
  }

  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}
