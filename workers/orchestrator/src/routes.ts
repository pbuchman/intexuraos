/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-dynamic-delete */
/* eslint-disable @typescript-eslint/require-await */

import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import type { TaskDispatcher } from '../services/task-dispatcher.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { Logger } from '@intexuraos/common-core';
import type { CreateTaskRequest } from '../types/api.js';

const NONCE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

type NonceCache = Record<string, number>;

export function registerRoutes(
  app: FastifyInstance,
  dispatcher: TaskDispatcher,
  tokenService: GitHubTokenService,
  config: { dispatchSecret: string },
  logger: Logger
): void {
  const nonceCache: NonceCache = {};

  // Auth middleware for dispatch endpoint
  const verifyDispatchSignature = async (request: any, reply: any): Promise<void> => {
    const timestamp = request.headers['x-dispatch-timestamp'] as string | undefined;
    const signature = request.headers['x-dispatch-signature'] as string | undefined;
    const nonce = request.headers['x-dispatch-nonce'] as string | undefined;

    if (timestamp === undefined || signature === undefined || nonce === undefined) {
      reply.status(401).send({ error: 'Missing authentication headers' });
      return;
    }

    const timestampNum = Number.parseInt(timestamp, 10);
    const now = Date.now();

    // Check timestamp freshness
    if (Math.abs(now - timestampNum) > TIMESTAMP_TOLERANCE_MS) {
      reply.status(401).send({ error: 'Timestamp too old or too new' });
      return;
    }

    // Check nonce replay
    const nonceTimestamp = nonceCache[nonce];
    if (nonceTimestamp !== undefined) {
      reply.status(401).send({ error: 'Nonce already used' });
      return;
    }

    // Verify HMAC signature
    const message = `${timestamp}.${nonce}.${JSON.stringify(request.body)}`;
    const expectedSignature = createHmac('sha256', config.dispatchSecret)
      .update(message)
      .digest('hex');

    if (signature !== expectedSignature) {
      reply.status(401).send({ error: 'Invalid signature' });
      return;
    }

    // Store nonce
    nonceCache[nonce] = timestampNum;

    // Clean up old nonces periodically
    const nonceKeys = Object.keys(nonceCache);
    if (nonceKeys.length > 10000) {
      const cutoff = now - NONCE_CACHE_TTL_MS;
      for (const key of nonceKeys) {
        const cachedTimestamp = nonceCache[key];
        if (cachedTimestamp !== undefined && cachedTimestamp < cutoff) {
          delete nonceCache[key];
        }
      }
    }
  };

  // POST /tasks - Submit new task
  app.post('/tasks', { onRequest: [verifyDispatchSignature] }, async (request, reply) => {
    const body = request.body as CreateTaskRequest;

    const result = await dispatcher.submitTask(body);

    if (!result.ok) {
      const { error } = result;
      if (error.type === 'at_capacity') {
        reply.status(503).send({ error: error.message });
        return;
      }
      reply.status(400).send({ error: error.message });
      return;
    }

    reply.status(202).send({ taskId: body.taskId, status: 'queued' });
  });

  // GET /tasks/:id - Get task status
  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await dispatcher.getTask(id);

    if (task === null) {
      reply.status(404).send({ error: 'Task not found' });
      return;
    }

    reply.send(task);
  });

  // DELETE /tasks/:id - Cancel task
  app.delete('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await dispatcher.cancelTask(id);

    if (!result.ok) {
      const { error } = result;
      if (error.type === 'not_found') {
        reply.status(404).send({ error: error.message });
        return;
      }
      if (error.type === 'already_completed') {
        reply.status(409).send({ error: error.message });
        return;
      }
      reply.status(500).send({ error: error.message });
      return;
    }

    reply.send({ taskId: id, status: 'cancelled' });
  });

  // GET /health - Health check
  app.get('/health', async (_request, reply) => {
    const running = dispatcher.getRunningCount();
    const capacity = dispatcher.getCapacity();

    const tokenResult = await tokenService.getToken();

    reply.send({
      status: 'ready',
      capacity,
      running,
      available: capacity - running,
      githubTokenExpiresAt: tokenResult.expiresAt,
    });
  });

  // POST /admin/shutdown - Graceful shutdown
  app.post('/admin/shutdown', async (_request, reply) => {
    // TODO: Implement graceful shutdown logic
    logger.info({ message: 'Shutdown requested' });
    reply.send({ status: 'shutting_down' });
  });

  // POST /admin/refresh-token - Force token refresh
  app.post('/admin/refresh-token', async (_request, reply) => {
    const refreshResult = await tokenService.refreshToken();

    if (!refreshResult.ok) {
      reply.status(500).send({ error: refreshResult.error.message });
      return;
    }

    reply.send({ tokenExpiresAt: refreshResult.value.expiresAt });
  });
}
