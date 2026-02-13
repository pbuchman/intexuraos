import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac } from 'node:crypto';
import type { TaskDispatcher } from './services/task-dispatcher.js';
import type { GitHubTokenService } from './github/token-service.js';
import type { AnthropicOAuthManager } from './services/isolation/anthropic-oauth.js';
import type { Logger } from '@intexuraos/common-core';
import type { CreateTaskRequest } from './types/api.js';
import { CreateTaskRequestSchema } from './types/schemas.js';

interface TaskParams {
  id: string;
}

type TaskParamsRequest = FastifyRequest<{ Params: TaskParams }>;
type TaskBodyRequest = FastifyRequest<{ Body: unknown }>;

const NONCE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_CACHE_CLEANUP_THRESHOLD = 10000; // Clean up when cache exceeds this size

type NonceCache = Record<string, number>;

/**
 * Removes expired nonce entries from the cache when it exceeds the threshold.
 * Extracted for testability — allows testing cleanup logic with small thresholds.
 *
 * @param nonceCache - The cache to clean up (modified in place)
 * @param now - Current timestamp in milliseconds
 * @param cleanupThreshold - Minimum cache size to trigger cleanup
 */
export function cleanUpExpiredNonces(
  nonceCache: NonceCache,
  now: number,
  cleanupThreshold = NONCE_CACHE_CLEANUP_THRESHOLD
): void {
  const nonceKeys = Object.keys(nonceCache);
  if (nonceKeys.length <= cleanupThreshold) {
    return;
  }

  const cutoff = now - NONCE_CACHE_TTL_MS;
  for (const key of nonceKeys) {
    const cachedTimestamp = nonceCache[key];
    if (cachedTimestamp !== undefined && cachedTimestamp < cutoff) {
      Reflect.deleteProperty(nonceCache, key);
    }
  }
}

export function registerRoutes(
  app: FastifyInstance,
  dispatcher: TaskDispatcher,
  tokenService: GitHubTokenService,
  config: { orchestratorSecret: string },
  logger: Logger,
  anthropicOAuth?: AnthropicOAuthManager
): void {
  const nonceCache: NonceCache = {};

  // Request/Response logging hooks
  // Note: Body is not yet parsed in onRequest - taskId from POST body is logged in route handler
  app.addHook('onRequest', async (request) => {
    const logData: Record<string, unknown> = {
      method: request.method,
      url: request.url,
      requestId: request.id,
    };

    // Add task ID from URL params if available (e.g., GET/DELETE /tasks/:id)
    const params = request.params as { id?: string } | undefined;
    if (params?.id !== undefined) {
      logData['taskId'] = params.id;
    }

    logger.info(logData, 'Incoming request');
  });

  app.addHook('onResponse', async (request, reply) => {
    const logData: Record<string, unknown> = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTimeMs: Math.round(reply.elapsedTime),
      requestId: request.id,
    };

    // Add taskId context if available
    const params = request.params as { id?: string } | undefined;
    if (params?.id !== undefined) {
      logData['taskId'] = params.id;
    }

    const level = reply.statusCode >= 400 ? 'warn' : 'info';
    logger[level](logData, 'Request completed');
  });

  const verifyDispatchSignature = async (
    request: TaskBodyRequest,
    reply: FastifyReply
  ): Promise<void> => {
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
    const expectedSignature = createHmac('sha256', config.orchestratorSecret)
      .update(message)
      .digest('hex');

    if (signature !== expectedSignature) {
      reply.status(401).send({ error: 'Invalid signature' });
      return;
    }

    // Store nonce
    nonceCache[nonce] = timestampNum;

    // Clean up old nonces periodically
    cleanUpExpiredNonces(nonceCache, now);
  };

  // POST /tasks - Submit new task
  app.post('/tasks', { preHandler: [verifyDispatchSignature] }, async (request, reply) => {
    // Log incoming request (redact secrets)
    const rawBody = request.body as Record<string, unknown>;
    logger.info(
      {
        method: 'POST',
        path: '/tasks',
        body: {
          ...rawBody,
          webhookSecret: rawBody['webhookSecret'] ? '[REDACTED]' : undefined,
        },
      },
      'Incoming request'
    );

    const parseResult = CreateTaskRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      const errorResponse = { error: parseResult.error.message };
      logger.warn(
        { taskId: 'unknown', validationError: parseResult.error.message, response: errorResponse },
        'Task validation failed - returning 400'
      );
      reply.status(400).send(errorResponse);
      return;
    }
    const parsed = parseResult.data;

    /* v8 ignore start -- ts-type: spread operators create type-narrowing branches for optional properties @preserve */
    const body: CreateTaskRequest = {
      taskId: parsed.taskId,
      workerType: parsed.workerType,
      prompt: parsed.prompt,
      webhookUrl: parsed.webhookUrl,
      webhookSecret: parsed.webhookSecret,
      linearIssueLabels: parsed.linearIssueLabels,
      hasChildren: parsed.hasChildren,
      ...(parsed.repository !== undefined && { repository: parsed.repository }),
      /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
      ...(parsed.baseBranch !== undefined && { baseBranch: parsed.baseBranch }),
      /* v8 ignore stop @preserve */
      /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
      ...(parsed.linearIssueId !== undefined && { linearIssueId: parsed.linearIssueId }),
      /* v8 ignore stop @preserve */
      /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
      ...(parsed.linearIssueTitle !== undefined && { linearIssueTitle: parsed.linearIssueTitle }),
      /* v8 ignore stop @preserve */
      ...(parsed.slug !== undefined && { slug: parsed.slug }),
      ...(parsed.actionId !== undefined && { actionId: parsed.actionId }),
    };
    /* v8 ignore stop @preserve */

    logger.info(
      { taskId: body.taskId, workerType: body.workerType, linearIssueId: body.linearIssueId },
      'Processing task submission'
    );

    const result = await dispatcher.submitTask(body);

    if (!result.ok) {
      const { error } = result;
      if (error.type === 'at_capacity') {
        const errorResponse = { error: error.message };
        logger.warn(
          { taskId: body.taskId, errorType: error.type, status: 503, response: errorResponse },
          'Task rejected: at capacity - returning 503'
        );
        reply.status(503).send(errorResponse);
        return;
      }
      const errorResponse = { error: error.message };
      logger.warn(
        { taskId: body.taskId, errorType: error.type, status: 400, response: errorResponse },
        'Task submission failed - returning 400'
      );
      reply.status(400).send(errorResponse);
      return;
    }

    const response = { taskId: body.taskId, status: 'accepted' };
    logger.info({ taskId: body.taskId, status: 202, response }, 'Task accepted - returning 202');
    reply.status(202).send(response);
  });

  // GET /tasks/:id - Get task status
  app.get<{ Params: TaskParams }>('/tasks/:id', async (request: TaskParamsRequest, reply) => {
    const { id } = request.params;
    const task = await dispatcher.getTask(id);

    if (task === null) {
      reply.status(404).send({ error: 'Task not found' });
      return;
    }

    reply.send(task);
  });

  // DELETE /tasks/:id - Cancel task
  app.delete<{ Params: TaskParams }>('/tasks/:id', async (request: TaskParamsRequest, reply) => {
    const { id } = request.params;
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
    const tokenExpiry = tokenService.getExpiresAt();
    const oauthState = anthropicOAuth?.getState() ?? {
      status: 'not_configured' as const,
      message: 'OAuth manager not initialized',
    };

    reply.send({
      status: 'ready',
      capacity,
      running,
      available: capacity - running,
      githubTokenExpiresAt: tokenExpiry?.toISOString() ?? null,
      anthropicOAuth: oauthState,
    });
  });

  // POST /admin/shutdown - Graceful shutdown
  app.post('/admin/shutdown', { preHandler: [verifyDispatchSignature] }, async (request, reply) => {
    logger.info({ method: request.method, url: request.url }, 'Admin endpoint called');
    // TODO: Implement graceful shutdown logic
    reply.send({ status: 'shutting_down' });
  });

  // POST /admin/refresh-token - Force token refresh
  app.post(
    '/admin/refresh-token',
    { preHandler: [verifyDispatchSignature] },
    async (request, reply) => {
      logger.info({ method: request.method, url: request.url }, 'Admin endpoint called');
      const refreshResult = await tokenService.refreshToken();

      if (!refreshResult.ok) {
        reply.status(500).send({ error: refreshResult.error.message });
        return;
      }

      const tokenExpiry = tokenService.getExpiresAt();
      reply.send({
        status: 'refreshed',
        tokenExpiresAt: tokenExpiry?.toISOString() ?? null,
      });
    }
  );
}
