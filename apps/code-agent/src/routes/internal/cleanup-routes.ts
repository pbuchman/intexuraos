import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { authenticateInternalScheduler } from '../helpers/internalAuth.js';
import {
  processExecutionMemoryBacklog,
  sweepErroredApplications,
  pruneStaleMemories,
} from '../../domain/usecases/processExecutionMemoryBacklog.js';
import { loadConfig } from '../../config.js';
import {
  ARCHIVE_STALE_GROUPS_SCHEMA,
  AUTO_ARCHIVE_MERGED_TASKS_SCHEMA,
  PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA,
  PRUNE_STALE_EXECUTION_MEMORY_SCHEMA,
  RECONCILE_MERGE_CONFLICTS_SCHEMA,
  SWEEP_ERRORED_EXECUTION_MEMORY_SCHEMA,
} from './schemas.js';

/**
 * Scheduler-triggered cleanup routes. All endpoints here use
 * `authenticateInternalScheduler` (accepts OIDC Bearer OR x-internal-auth).
 *
 * Endpoints:
 * - POST /internal/merge-conflicts/reconcile           (INT-1023)
 * - POST /internal/execution-memory/process
 * - POST /internal/execution-memory/sweep-errored      (INT-1352)
 * - POST /internal/execution-memory/prune-stale        (INT-1352)
 * - POST /internal/archive-stale-groups
 * - POST /internal/auto-archive-merged-tasks           (INT-1174)
 */
export const cleanupRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /internal/merge-conflicts/reconcile - triggered by Cloud Scheduler (INT-1023)
  fastify.post(
    '/internal/merge-conflicts/reconcile',
    { schema: RECONCILE_MERGE_CONFLICTS_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/merge-conflicts/reconcile',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for merge-conflicts reconcile');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for merge-conflicts reconcile');

      const { mergeConflictDetector, logger } = getServices();
      const result = await mergeConflictDetector.reconcile(logger);
      logger.info(result, 'PR state reconciliation completed');

      // @allow-raw-send: cron endpoint returns reconcile stats directly
      return await reply.send(result);
    }
  );

  fastify.post<{ Body: { limit?: number } | null }>(
    '/internal/execution-memory/process',
    { schema: PROCESS_EXECUTION_MEMORY_BACKLOG_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/execution-memory/process',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for execution-memory process');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      if (!loadConfig().executionMemoryEnabled) {
        return await reply.ok({ claimed: 0, completed: 0, skipped: 0, errored: 0, taskIds: [] });
      }

      const services = getServices();
      const result = await processExecutionMemoryBacklog({
        logger: services.logger,
        codeTaskRepo: services.codeTaskRepo,
        logLineRepo: services.logLineRepo,
        turnMetricsRepo: services.turnMetricsRepo,
        linearAgentClient: services.linearAgentClient,
        executionMemoryRepo: services.executionMemoryRepo as NonNullable<typeof services.executionMemoryRepo>,
        executionMemoryApplicationRepo:
          services.executionMemoryApplicationRepo as NonNullable<typeof services.executionMemoryApplicationRepo>,
        userServiceClient: services.userServiceClient,
        /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes is not tracked after service override tests @preserve */
        ...(services.executionMemoryEmbeddingClient !== undefined && {
          embeddingClient: services.executionMemoryEmbeddingClient,
        }),
        /* v8 ignore stop @preserve */
        limit: request.body?.limit ?? 10,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // POST /internal/execution-memory/sweep-errored - sweep permanently errored post-run tasks (INT-1352)
  fastify.post(
    '/internal/execution-memory/sweep-errored',
    { schema: SWEEP_ERRORED_EXECUTION_MEMORY_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/execution-memory/sweep-errored',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for execution-memory sweep-errored');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      if (!loadConfig().executionMemoryEnabled) {
        return await reply.ok({ requeued: 0, skipped: 0 });
      }

      const services = getServices();
      const result = await sweepErroredApplications({
        logger: services.logger,
        codeTaskRepo: services.codeTaskRepo,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // POST /internal/execution-memory/prune-stale - archive aged zero-application memories (INT-1352)
  fastify.post<{ Body: { maxAgeDays?: number; dryRun?: boolean } | null }>(
    '/internal/execution-memory/prune-stale',
    { schema: PRUNE_STALE_EXECUTION_MEMORY_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/execution-memory/prune-stale',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for execution-memory prune-stale');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      if (!loadConfig().executionMemoryEnabled) {
        return await reply.ok({ archived: 0, skipped: 0 });
      }

      const services = getServices();
      const executionMemoryRepo = services.executionMemoryRepo;
      if (executionMemoryRepo === undefined) {
        return await reply.ok({ archived: 0, skipped: 0 });
      }

      const maxAgeDays = request.body?.maxAgeDays;
      const dryRun = request.body?.dryRun;
      const result = await pruneStaleMemories(
        {
          logger: services.logger,
          executionMemoryRepo,
        },
        {
          ...(maxAgeDays !== undefined && { maxAgeDays }),
          ...(dryRun !== undefined && { dryRun }),
        },
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // POST /internal/archive-stale-groups - triggered by Cloud Scheduler hourly
  fastify.post(
    '/internal/archive-stale-groups',
    { schema: ARCHIVE_STALE_GROUPS_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/archive-stale-groups',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for archive-stale-groups');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for archive-stale-groups');

      const { archiveStaleGroups, logger } = getServices();

      const body = request.body as { staleDays?: number } | null;
      const staleDays = body?.staleDays;
      const input = staleDays !== undefined ? { staleDays } : undefined;

      const result = await archiveStaleGroups(input);
      if (!result.ok) {
        logger.error({ error: result.error.message }, 'Archive stale groups failed');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      logger.info(result.value, 'Stale issue group archival completed via route');

      // @allow-raw-send: cron endpoint returns archive stats directly
      return await reply.send(result.value);
    }
  );

  // POST /internal/auto-archive-merged-tasks - triggered by Cloud Scheduler daily (INT-1174)
  fastify.post(
    '/internal/auto-archive-merged-tasks',
    { schema: AUTO_ARCHIVE_MERGED_TASKS_SCHEMA },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/auto-archive-merged-tasks',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for auto-archive-merged-tasks');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for auto-archive-merged-tasks');

      const { autoArchiveMergedTasks, logger } = getServices();

      const body = request.body as { mergeDays?: number } | null;
      const mergeDays = body?.mergeDays;
      const input = mergeDays !== undefined ? { mergeDays } : undefined;

      const result = await autoArchiveMergedTasks(input);
      if (!result.ok) {
        logger.error({ error: result.error.message }, 'Auto-archive merged tasks failed');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      logger.info(result.value, 'Auto-archive merged tasks completed via route');

      // @allow-raw-send: cron endpoint returns archive stats directly
      return await reply.send(result.value);
    }
  );

  done();
};
