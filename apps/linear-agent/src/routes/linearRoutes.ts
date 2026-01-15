/**
 * Public API routes for Linear integration.
 * Handles connection management and issue listing.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { listIssues } from '../domain/index.js';

interface ConnectionBody {
  apiKey: string;
  teamId: string;
  teamName: string;
}

interface ValidateBody {
  apiKey: string;
}

async function handleLinearError(
  error: { code: string; message: string },
  reply: FastifyReply
): Promise<unknown> {
  if (error.code === 'NOT_CONNECTED') {
    reply.status(403);
    return await reply.fail('FORBIDDEN', error.message);
  }
  if (error.code === 'INVALID_API_KEY') {
    reply.status(401);
    return await reply.fail('UNAUTHORIZED', error.message);
  }
  if (error.code === 'RATE_LIMIT') {
    reply.status(429);
    return await reply.fail('DOWNSTREAM_ERROR', error.message);
  }
  reply.status(500);
  return await reply.fail('DOWNSTREAM_ERROR', error.message);
}

export const linearRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Get connection status
  fastify.get('/linear/connection', async (request: FastifyRequest, reply: FastifyReply) => {
    logIncomingRequest(request);
    const user = await requireAuth(request, reply);
    if (user === null) {
      return;
    }

    const { connectionRepository } = getServices();

    const result = await connectionRepository.getConnection(user.userId);
    if (!result.ok) {
      return await handleLinearError(result.error, reply);
    }

    return await reply.ok(result.value);
  });

  // Validate API key and get teams
  fastify.post<{ Body: ValidateBody }>(
    '/linear/connection/validate',
    async (request: FastifyRequest<{ Body: ValidateBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const { apiKey } = request.body;
      const { linearApiClient } = getServices();

      const result = await linearApiClient.validateAndGetTeams(apiKey);
      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      return await reply.ok({ teams: result.value });
    }
  );

  // Save connection
  fastify.post<{ Body: ConnectionBody }>(
    '/linear/connection',
    async (request: FastifyRequest<{ Body: ConnectionBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { apiKey, teamId, teamName } = request.body;
      const { connectionRepository } = getServices();

      const result = await connectionRepository.save(user.userId, apiKey, teamId, teamName);
      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      return await reply.ok(result.value);
    }
  );

  // Disconnect
  fastify.delete('/linear/connection', async (request: FastifyRequest, reply: FastifyReply) => {
    logIncomingRequest(request);
    const user = await requireAuth(request, reply);
    if (user === null) {
      return;
    }

    const { connectionRepository } = getServices();

    const result = await connectionRepository.disconnect(user.userId);
    if (!result.ok) {
      return await handleLinearError(result.error, reply);
    }

    return await reply.ok(result.value);
  });

  // List issues (grouped for dashboard)
  fastify.get<{ Querystring: { includeArchive?: string } }>(
    '/linear/issues',
    async (
      request: FastifyRequest<{ Querystring: { includeArchive?: string } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const includeArchive = request.query.includeArchive !== 'false';
      const services = getServices();

      const result = await listIssues(
        { userId: user.userId, includeArchive },
        {
          linearApiClient: services.linearApiClient,
          connectionRepository: services.connectionRepository,
          logger: request.log,
        }
      );

      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
