import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TASK_ACCESS_HEADER } from '@intexuraos/code-task-domain/task-access';
import { isCodeTaskWorkerTypePolicy } from '@intexuraos/code-task-domain/worker-types';
import { TaskAccess, type TaskAccessConfig } from './services/task-access.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Task } from './types/task.js';
import type { TaskDispatcher } from './services/task-dispatcher.js';
import type { GitHubTokenService } from './github/token-service.js';
import type { IsolationProvider } from './services/isolation/types.js';
import type { WorkerAuthRegistry } from './services/worker-auth/index.js';
import type { OrchestratorStatus } from './types/state.js';
import type { Logger } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import type { CreateTaskRequest, ProviderApiKeyHealth } from './types/api.js';
import {
  CreateTaskRequestSchema,
  SendMessageRequestSchema,
  TaskStatusSchema,
} from './types/schemas.js';
import { isOrchestratorAdmissionFrozen } from './admission-freeze.js';
import { defaultWorkerTypePolicy, type WorkerTypePolicy } from './services/worker-type-policy.js';

export interface WorkerTypeControls {
  policy: WorkerTypePolicy;
  credentialWatchdog: { idleTicks: number };
}

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
  config: { orchestratorSecret: string; taskAccess?: TaskAccessConfig },
  logger: Logger,
  getStatus?: () => OrchestratorStatus,
  workerAuthRegistry?: WorkerAuthRegistry,
  isolationProvider?: IsolationProvider,
  providerApiKeys: Record<string, ProviderApiKeyHealth> = {},
  readAdmissionFreeze: () => boolean = isOrchestratorAdmissionFrozen,
  workerTypeControls?: WorkerTypeControls
): void {
  const access = config.taskAccess === undefined ? undefined : new TaskAccess(config.taskAccess);
  const nonceCache = Object.create(null) as NonceCache;
  const activeAdmissionRequests = new WeakMap<
    FastifyRequest,
    { handlerSettled: boolean; transportSettled: boolean }
  >();
  let pendingAdmissions = 0;
  let admissionActivityTotal = 0;

  const finishTaskMutationIfSettled = (request: FastifyRequest): void => {
    const state = activeAdmissionRequests.get(request);
    if (state?.handlerSettled === true && state.transportSettled) {
      activeAdmissionRequests.delete(request);
      pendingAdmissions -= 1;
    }
  };

  const settleTaskMutationHandler = (request: FastifyRequest): void => {
    const state = activeAdmissionRequests.get(request);
    /* v8 ignore start -- upstream: beginTaskMutation synchronously guarantees this state, and only this handler-settlement path can make it eligible for deletion; the missing-state arm is a defensive lifecycle no-op @preserve */
    if (state !== undefined) {
      state.handlerSettled = true;
      finishTaskMutationIfSettled(request);
    }
    /* v8 ignore stop @preserve */
  };

  const settleTaskMutationTransport = (request: FastifyRequest): void => {
    const state = activeAdmissionRequests.get(request);
    if (state !== undefined) {
      state.transportSettled = true;
      finishTaskMutationIfSettled(request);
    }
  };

  const readAdmissionFrozenFailClosed = (): boolean => {
    try {
      return readAdmissionFreeze();
    } catch {
      return true;
    }
  };

  const beginTaskMutation = (request: FastifyRequest, reply: FastifyReply): boolean => {
    activeAdmissionRequests.set(request, {
      handlerSettled: false,
      transportSettled:
        Reflect.get(request.raw, 'aborted') || request.raw.destroyed || reply.raw.destroyed,
    });
    pendingAdmissions += 1;
    reply.raw.once('close', () => {
      settleTaskMutationTransport(request);
    });

    /* v8 ignore start -- upstream: the finite process lifetime guarantees this private counter cannot reach Number.MAX_SAFE_INTEGER; the guard defensively saturates before precision loss @preserve */
    if (admissionActivityTotal < Number.MAX_SAFE_INTEGER) {
      admissionActivityTotal += 1;
    }
    /* v8 ignore stop @preserve */

    if (readAdmissionFrozenFailClosed()) {
      reply.status(503).send({ error: 'Orchestrator admission is frozen' });
      return false;
    }
    return true;
  };

  const runTaskMutation = async (
    request: FastifyRequest,
    reply: FastifyReply,
    handler: () => Promise<void>
  ): Promise<void> => {
    const admitted = beginTaskMutation(request, reply);
    try {
      if (admitted) {
        await handler();
      }
    } finally {
      settleTaskMutationHandler(request);
    }
  };

  // Transport and handler completion are tracked independently. An aborted
  // client cannot hide a dispatcher mutation that is still settling, and
  // multiple lifecycle signals still produce one decrement.
  app.addHook('onResponse', async (request) => {
    settleTaskMutationTransport(request);
  });
  app.addHook('onError', async (request) => {
    settleTaskMutationTransport(request);
  });
  app.addHook('onRequestAbort', async (request) => {
    settleTaskMutationTransport(request);
  });

  // Emit one concise line per completed HTTP request.
  app.addHook('onResponse', async (request, reply) => {
    const level = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      reply.statusCode >= 400 && reply.statusCode < 500 ? { [SKIP_SENTRY_KEY]: true } : {},
      `${request.method} ${String(reply.statusCode)} ${request.url}`
    );
  });

  const verifySignature = (request: TaskBodyRequest, reply: FastifyReply, prefix = ''): void => {
    const timestamp = request.headers['x-dispatch-timestamp'];
    const signature = request.headers['x-dispatch-signature'];
    const nonce = request.headers['x-dispatch-nonce'];

    if (
      typeof timestamp !== 'string' ||
      typeof signature !== 'string' ||
      typeof nonce !== 'string'
    ) {
      reply.status(401).send({ error: 'Missing authentication headers' });
      return;
    }

    const timestampNum = Number(timestamp);
    const now = Date.now();

    // Check timestamp freshness
    if (!/^\d+$/.test(timestamp) || Math.abs(now - timestampNum) > TIMESTAMP_TOLERANCE_MS) {
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
    const message = `${prefix}${timestamp}.${nonce}.${JSON.stringify(request.body)}`;
    const expectedSignature = createHmac('sha256', config.orchestratorSecret)
      .update(message)
      .digest();

    if (
      !/^[0-9a-f]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature, 'hex'), expectedSignature)
    ) {
      reply.status(401).send({ error: 'Invalid signature' });
      return;
    }

    // Store nonce
    nonceCache[nonce] = timestampNum;

    // Clean up old nonces periodically
    cleanUpExpiredNonces(nonceCache, now);
  };

  const verifyDispatchSignature = async (
    request: TaskBodyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    verifySignature(request, reply);
  };

  // POST /tasks - Submit new task
  app.post('/tasks', { preHandler: [verifyDispatchSignature] }, async (request, reply) => {
    await runTaskMutation(request, reply, async () => {
      const parseResult = CreateTaskRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errorResponse = { error: parseResult.error.message };
        logger.warn(
          {
            taskId: 'unknown',
            validationError: parseResult.error.message,
            response: errorResponse,
          },
          'Task validation failed - returning 400'
        );
        reply.status(400).send(errorResponse);
        return;
      }
      const parsed = parseResult.data;
      if (access === undefined) {
        reply.status(401).send({ error: 'Unauthorized' });
        return;
      }
      const proof = await access.authenticate(
        request.headers[TASK_ACCESS_HEADER],
        'POST',
        request.url,
        parsed.taskId,
        JSON.stringify(request.body)
      );
      if (proof === null) {
        reply.status(401).send({ error: 'Unauthorized' });
        return;
      }

      const existing = await dispatcher.getTask(parsed.taskId);
      if (existing !== null && !(await access.ownsTask(proof, existing))) {
        reply.status(409).send({ error: 'Task is already assigned' });
        return;
      }

      const body: CreateTaskRequest = {
        taskId: parsed.taskId,
        accessBinding: { ownerId: proof.ownerId, worker: proof.worker, audience: proof.audience },
        workerType: parsed.workerType,
        prompt: parsed.prompt,
        webhookUrl: parsed.webhookUrl,
        webhookSecret: parsed.webhookSecret,
        linearIssueLabels: parsed.linearIssueLabels,
        hasChildren: parsed.hasChildren,
        ...(parsed.repository !== undefined && { repository: parsed.repository }),
        ...(parsed.baseBranch !== undefined && { baseBranch: parsed.baseBranch }),
        ...(parsed.linearIssueId !== undefined && { linearIssueId: parsed.linearIssueId }),
        ...(parsed.linearIssueTitle !== undefined && { linearIssueTitle: parsed.linearIssueTitle }),
        ...(parsed.slug !== undefined && { slug: parsed.slug }),
        ...(parsed.actionId !== undefined && { actionId: parsed.actionId }),
        ...(parsed.agentType !== undefined && { agentType: parsed.agentType }),
        ...(parsed.sentryIssue !== undefined && { sentryIssue: parsed.sentryIssue }),
        ...(parsed.continuationPrNumber !== undefined && {
          continuationPrNumber: parsed.continuationPrNumber,
        }),
        ...(parsed.continuationPrBranch !== undefined && {
          continuationPrBranch: parsed.continuationPrBranch,
        }),
        ...(parsed.prNumber !== undefined && { prNumber: parsed.prNumber }),
        ...(parsed.executionMemoryContext !== undefined && {
          executionMemoryContext: parsed.executionMemoryContext,
        }),
        ...(parsed.trackingCommentId !== undefined && {
          trackingCommentId: parsed.trackingCommentId,
        }),
        ...(parsed.reviewTypes !== undefined && { reviewTypes: parsed.reviewTypes }),
        ...(parsed.retriedFrom !== undefined && { retriedFrom: parsed.retriedFrom }),
        // INT-1585: forward optional per-task timeout override
        ...(parsed.timeoutHours !== undefined && { timeoutHours: parsed.timeoutHours }),
      };

      logger.info(
        { taskId: body.taskId, workerType: body.workerType, linearIssueId: body.linearIssueId },
        'Processing task submission'
      );

      const result = await dispatcher.submitTask(body);

      if (!result.ok) {
        const { error } = result;
        if (error.type === 'worker_type_disabled') {
          reply.status(409).send({ code: error.type, error: error.message });
          return;
        }
        if (
          error.type === 'at_capacity' ||
          error.type === 'docker_unavailable' ||
          error.type === 'auth_unavailable'
        ) {
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
  });

  const authorizeTask = async (
    request: TaskParamsRequest,
    reply: FastifyReply
  ): Promise<Task | null> => {
    const { id } = request.params;
    const path = '/tasks/' + encodeURIComponent(id);
    if (
      access === undefined ||
      request.body !== undefined ||
      request.url !== path ||
      request.headers['transfer-encoding'] !== undefined ||
      (request.headers['content-length'] ?? '0') !== '0'
    ) {
      reply.status(401).send({ error: 'Unauthorized' });
      return null;
    }
    const proof = await access.authenticate(
      request.headers[TASK_ACCESS_HEADER],
      request.method,
      path,
      id,
      ''
    );
    if (proof === null) {
      reply.status(401).send({ error: 'Unauthorized' });
      return null;
    }
    const task = await dispatcher.getTask(id);
    if (task?.taskId !== id || !(await access.ownsTask(proof, task))) {
      reply.status(404).send({ error: 'Task not found' });
      return null;
    }
    return task;
  };

  // Fastify also registers HEAD and passes its actual method to authorization.
  app.get<{ Params: TaskParams }>('/tasks/:id', async (request, reply) => {
    const task = await authorizeTask(request, reply);
    if (task === null) return;
    const status = TaskStatusSchema.safeParse(task.status);
    if (!status.success) {
      reply.status(500).send({ error: 'Invalid stored task status' });
      return;
    }
    reply.send({ taskId: task.taskId, status: status.data });
  });

  app.delete<{ Params: TaskParams }>('/tasks/:id', async (request, reply) => {
    const task = await authorizeTask(request, reply);
    if (task === null) return;
    await runTaskMutation(request, reply, async () => {
      const id = task.taskId;
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
  });

  // POST /tasks/:id/message - Send message to task
  app.post<{ Params: TaskParams; Body: unknown }>(
    '/tasks/:id/message',
    { preHandler: [verifyDispatchSignature] },
    async (request, reply) => {
      await runTaskMutation(request, reply, async () => {
        const { id } = request.params;
        logger.info(
          { taskId: id, method: 'POST', path: `/tasks/${id}/message` },
          'Task message received'
        );

        const parseResult = SendMessageRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          reply.status(400).send({ error: parseResult.error.message });
          return;
        }

        const result = await dispatcher.sendMessage(id, parseResult.data.message);

        if (!result.ok) {
          const { error } = result;
          if (error.type === 'worker_type_disabled') {
            reply.status(409).send({ code: error.type, error: error.message });
            return;
          }
          if (error.type === 'not_found') {
            reply.status(404).send({ error: error.message });
            return;
          }
          if (error.type === 'invalid_status') {
            reply.status(409).send({ error: error.message });
            return;
          }
          if (error.type === 'session_expired') {
            reply.status(410).send({ error: error.message });
            return;
          }
          reply.status(500).send({ error: error.message });
          return;
        }

        reply.send(result.value);
      });
    }
  );

  // GET /health - Health check
  app.get('/health', async (_request, reply) => {
    const running = dispatcher.getRunningCount();
    const capacity = dispatcher.getCapacity();
    const drainOwnership = await dispatcher.getDrainOwnershipSnapshot();
    const tokenExpiry = tokenService.getExpiresAt();
    /* v8 ignore start -- ts-type: nullish coalescing fallback for optional workerAuthRegistry parameter @preserve */
    const workerAuths = workerAuthRegistry?.getStates() ?? {
      claude: {
        status: 'not_configured' as const,
        authMode: null,
        refreshSupported: false,
        message: 'Worker auth registry not initialized',
      },
      codex: {
        status: 'not_configured' as const,
        authMode: null,
        refreshSupported: false,
        message: 'Worker auth registry not initialized',
      },
    };
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- ts-type: nullish coalescing fallback for optional isolationProvider parameter @preserve */
    const healthDetails = isolationProvider?.getHealthDetails?.() ?? { docker: true, disk: true };
    /* v8 ignore stop @preserve */
    const admissionFrozen = readAdmissionFrozenFailClosed();
    const policy = workerTypeControls?.policy.snapshot() ?? defaultWorkerTypePolicy();

    reply.send({
      healthContractVersion: 2,
      ...policy,
      credentialWatchdog: workerTypeControls?.credentialWatchdog ?? { idleTicks: 0 },
      admissionFrozen,
      pendingAdmissions,
      admissionActivityTotal,
      status: getStatus?.() ?? 'ready',
      capacity,
      running,
      available: capacity - running,
      ...drainOwnership,
      githubTokenExpiresAt: tokenExpiry?.toISOString() ?? null,
      workerAuths,
      providerApiKeys,
      dockerHealthy: healthDetails.docker,
      diskHealthy: healthDetails.disk,
      logForwarderDrain: dispatcher.getLogForwarderDrainSnapshot(),
    });
  });

  app.put<{ Body: unknown }>(
    '/admin/worker-types',
    {
      preHandler: [
        async (request, reply): Promise<void> => {
          verifySignature(request, reply, 'PUT /admin/worker-types\n');
        },
      ],
    },
    async (request, reply) => {
      const body = request.body;
      if (
        typeof body !== 'object' ||
        body === null ||
        !('enabledWorkerTypes' in body) ||
        !('expectedRevision' in body)
      ) {
        reply.status(400).send({ error: 'Invalid worker type policy request' });
        return;
      }
      const proposed = {
        enabledWorkerTypes: body.enabledWorkerTypes,
        workerTypesRevision: body.expectedRevision,
      };
      if (!isCodeTaskWorkerTypePolicy(proposed)) {
        reply.status(400).send({ error: 'Invalid worker type policy request' });
        return;
      }
      if (workerTypeControls === undefined) {
        reply.status(503).send({ error: 'Worker type policy unavailable' });
        return;
      }
      try {
        const saved = await workerTypeControls.policy.apply(
          proposed.enabledWorkerTypes,
          proposed.workerTypesRevision
        );
        if (saved === null) {
          reply.status(409).send({ error: 'Worker type policy revision conflict' });
          return;
        }
        reply.send(saved);
      } catch (error) {
        logger.error({ error }, 'Failed to apply worker type policy');
        reply.status(500).send({ error: 'Failed to apply worker type policy' });
      }
    }
  );

  // GET /meta/worker-image - Worker image diagnostics
  app.get('/meta/worker-image', async (_request, reply) => {
    const imageInfo = isolationProvider?.getImageInfo?.() ?? null;
    reply.send(imageInfo ?? { error: 'Image info not available' });
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
