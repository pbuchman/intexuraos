import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';
import type { JobExecutionToken, JobHeartbeatStore } from '@intexuraos/infra-firestore';
import { authenticateInternalScheduler } from './helpers/internalAuth.js';

export const CODE_SCHEDULER_JOBS: Readonly<Record<string, string>> = {
  '/internal/drain-queue': 'drain_task_queue',
  '/internal/merge-conflicts/reconcile': 'merge_conflict_reconcile',
  '/internal/merge-queue/tick': 'merge_queue_tick',
  '/internal/code/detect-zombies': 'code_tasks_zombie_sweep',
  '/internal/archive-stale-groups': 'archive_stale_groups',
  '/internal/auto-archive-merged-tasks': 'auto_archive_merged_tasks',
  '/internal/execution-memory/process': 'execution_memory_process',
  '/internal/execution-memory/sweep-errored': 'execution_memory_sweep_errored',
  '/internal/execution-memory/prune-stale': 'execution_memory_prune_stale',
};

/** Hooks are installed on the app before scheduler plugins to include every route scope. */
export function registerCodeJobMonitoring(
  app: FastifyInstance,
  getStore: () => JobHeartbeatStore | undefined
): void {
  const executions = new WeakMap<
    FastifyRequest,
    { store: JobHeartbeatStore; token: JobExecutionToken }
  >();
  app.addHook('preHandler', async (request, reply) => {
    const key =
      request.method === 'POST' ? CODE_SCHEDULER_JOBS[request.routeOptions.url ?? ''] : undefined;
    if (key === undefined) return;
    if (!(await authenticateInternalScheduler(request)).authenticated) {
      await reply.fail('UNAUTHORIZED', 'Unauthorized');
      return;
    }
    const store = getStore();
    if (store !== undefined) executions.set(request, { store, token: await store.start(key) });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const execution = executions.get(request);
    if (execution === undefined) return payload;
    executions.delete(request);
    const failed = reply.statusCode >= 400 || responseFailed(payload);
    await execution.store.finish(execution.token, failed ? 'failed' : 'succeeded');
    return payload;
  });
  app.get('/internal/monitoring/status', async (request, reply) => {
    if (!validateInternalAuth(request).valid)
      return await reply.fail('UNAUTHORIZED', 'Unauthorized');
    const store = getStore();
    if (store === undefined)
      return await reply.fail('SERVICE_UNAVAILABLE', 'Monitoring unavailable');
    return await reply.ok({
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      jobs: await store.list(Object.values(CODE_SCHEDULER_JOBS)),
    });
  });
}

function responseFailed(payload: unknown): boolean {
  if (typeof payload !== 'string') return true;
  try {
    return hasLogicalFailure(JSON.parse(payload) as unknown);
  } catch {
    return true;
  }
}

function hasLogicalFailure(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasLogicalFailure);
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record['ok'] === false ||
    record['success'] === false ||
    ['failed', 'error', 'retry_failed', 'exhausted'].includes(String(record['action'])) ||
    record['status'] === 'failed'
  )
    return true;
  for (const field of ['error', 'errors', 'errored', 'failed', 'failedCount', 'tasksFailed']) {
    const entry = record[field];
    if ((typeof entry === 'number' && entry > 0) || (typeof entry === 'string' && entry !== ''))
      return true;
    if (Array.isArray(entry) && entry.length > 0) return true;
  }
  return Object.values(record).some(hasLogicalFailure);
}
