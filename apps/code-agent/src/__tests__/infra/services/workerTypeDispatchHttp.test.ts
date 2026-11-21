import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Timestamp } from '@google-cloud/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import type { CodeTaskWorkerType } from '@intexuraos/code-task-domain';
import { TASK_ACCESS_HEADER, verifyTaskAccess } from '@intexuraos/code-task-domain/task-access';
import type { DispatchRequest, TaskDispatcherDeps } from '../../../domain/services/taskDispatcher.js';
import type { DispatchRetry } from '../../../domain/models/dispatchRetry.js';
import { drainRetryQueue, type DrainRetryQueueDeps } from '../../../domain/usecases/drainRetryQueue.js';
import { sendTaskMessage, type SendTaskMessageDeps } from '../../../domain/usecases/sendTaskMessage.js';
import { createTaskDispatcherService } from '../../../infra/services/taskDispatcherImpl.js';
import { createWorkerHealthProbe } from '../../../infra/services/workerHealthProbe.js';
import { createFakeTask } from '../../helpers/mockFirestore.js';
import { orchestratorHealthV2 } from '../../helpers/orchestratorHealth.js';

type WorkerCredentials = DispatchRequest['workerCredentials']['workers'][number];
const { privateKey: taskAccessKey, publicKey } = generateKeyPairSync('ed25519');
const servers: Server[] = [];

async function startWorker(name: string, options: {
  types?: CodeTaskWorkerType[];
  revision?: number;
  available?: number;
  healthStatus?: number;
  dispatchStatus?: number;
  dispatchResponse?: Record<string, unknown> | string;
  messageTask?: { workerType: CodeTaskWorkerType; action: 'queued' | 'resumed' };
  claudeAuth?: 'active' | 'not_configured';
  missingWorkerAuths?: boolean;
} = {}): Promise<{
  credentials: WorkerCredentials;
  events: { probes: number; posts: string[] };
  messagePosts: { path: string; status: number }[];
}> {
  const events = { probes: 0, posts: [] as string[] };
  const messagePosts: { path: string; status: number }[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/health') {
      events.probes += 1;
      response.statusCode = options.healthStatus ?? 200;
      response.end(JSON.stringify(orchestratorHealthV2({
        available: options.available ?? 2,
        workerAuths: options.missingWorkerAuths === true
          ? {}
          : { claude: { status: options.claudeAuth ?? 'active' }, codex: { status: 'active' } },
        ...(options.types !== undefined && { enabledWorkerTypes: options.types }),
        ...(options.revision !== undefined && { workerTypesRevision: options.revision }),
      })));
      return;
    }
    if (request.method === 'POST' && request.url === '/tasks') {
      let body = '';
      request.setEncoding('utf8').on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        const task = JSON.parse(body) as { workerType: string; taskId: string };
        events.posts.push(task.workerType);
        const proof = request.headers[TASK_ACCESS_HEADER.toLowerCase()];
        const access = typeof proof === 'string' ? verifyTaskAccess(publicKey, proof, {
          taskId: task.taskId, path: '/tasks', method: 'POST', body,
          audience: `http://${request.headers.host ?? ''}`,
        }) : null;
        if (access?.ownerId !== 'user_test' || access.worker !== name) {
          response.statusCode = 401;
          response.end('{}');
          return;
        }
        response.statusCode = options.dispatchStatus ?? 200;
        response.end(typeof options.dispatchResponse === 'string'
          ? options.dispatchResponse
          : JSON.stringify(options.dispatchResponse ?? { status: 'accepted' }));
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/tasks/task_worker_type_dispatch/message') {
      request.resume();
      const task = options.messageTask;
      let body: object;
      if (task === undefined) {
        response.statusCode = 404;
        body = { error: 'Task not found' };
      } else if (options.types?.includes(task.workerType) === false) {
        response.statusCode = 409;
        body = {
          code: 'worker_type_disabled',
          error: `Worker type '${task.workerType}' is disabled on this host. Enable it in Worker types or select another worker.`,
        };
      } else {
        body = { action: task.action };
      }
      messagePosts.push({ path: request.url, status: response.statusCode });
      response.end(JSON.stringify(body));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a local HTTP listener');
  return {
    credentials: {
      name,
      url: `http://127.0.0.1:${String(address.port)}`,
      cfAccessClientId: 'test-client',
      cfAccessClientSecret: 'test-access-secret',
      dispatchSigningSecret: 'test-signing-secret',
    },
    events,
    messagePosts,
  };
}

function dispatch(
  workerType: CodeTaskWorkerType,
  workers: WorkerCredentials[],
  failedWorkerLocation?: string,
  workerSettingsRepo?: TaskDispatcherDeps['workerSettingsRepo'],
): ReturnType<ReturnType<typeof createTaskDispatcherService>['dispatch']> {
  const service = createTaskDispatcherService({
    taskAccessKey,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workerHealthProbe: createWorkerHealthProbe(),
    ...(workerSettingsRepo !== undefined && { workerSettingsRepo }),
  });
  return service.dispatch({
    taskId: 'task_worker_type_dispatch',
    ownerId: 'user_test',
    workerType,
    workerCredentials: { workers },
    prompt: 'Apply the requested test change',
    repository: 'intexuraos/test-repo',
    baseBranch: 'development',
    systemPromptHash: 'test-system-prompt',
    webhookUrl: 'https://code-agent.example.test/webhook',
    webhookSecret: 'test-webhook-secret',
    linearIssueLabels: [],
    hasChildren: false,
    ...(failedWorkerLocation !== undefined && { failedWorkerLocation }),
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error); });
    });
  }));
});

describe('per-host task type dispatch over HTTP', () => {
  it('sends each type only to its eligible host regardless of priority, capacity, and failed-worker preference', async () => {
    const codex = await startWorker('codex-host', { types: ['codex'], revision: 1, available: 2 });
    const claude = await startWorker('claude-host', { types: ['auto'], revision: 1, available: 1 });

    expect(await dispatch('auto', [codex.credentials, claude.credentials], 'claude-host')).toMatchObject({
      ok: true, value: { workerLocation: 'claude-host' },
    });
    expect(await dispatch('codex', [claude.credentials, codex.credentials])).toMatchObject({
      ok: true, value: { workerLocation: 'codex-host' },
    });
    expect(codex.events).toEqual({ probes: 2, posts: ['codex'] });
    expect(claude.events).toEqual({ probes: 2, posts: ['auto'] });
  });

  it('applies auth and capacity to every POST candidate', async () => {
    const unauthenticated = await startWorker('unauthenticated-host', { claudeAuth: 'not_configured' });
    const eligible = await startWorker('eligible-host', { available: 1, dispatchStatus: 503 });

    expect(await dispatch('auto', [unauthenticated.credentials, eligible.credentials])).toMatchObject({
      ok: false, error: { code: 'at_capacity' },
    });
    expect(unauthenticated.events.posts).toEqual([]);
    expect(eligible.events.posts).toEqual(['auto']);
  });

  it.each([
    { workerType: 'auto' as const, reason: 'claude_auth_unavailable' },
    { workerType: 'codex' as const, reason: 'codex_auth_unavailable' },
  ])('blocks $workerType when a reachable worker omits the provider auth', async ({ workerType, reason }) => {
    const worker = await startWorker('worker-with-missing-auth', { missingWorkerAuths: true });

    expect(await dispatch(workerType, [worker.credentials])).toMatchObject({
      ok: false, error: { blocker: { reason } },
    });
    expect(worker.events.posts).toEqual([]);
  });

  it('returns a terminal policy blocker without POSTing when all enabled hosts exclude the type', async () => {
    const codex = await startWorker('codex-host', { types: ['codex'], revision: 3 });
    const empty = await startWorker('empty-host', { types: [], revision: 4 });

    expect(await dispatch('auto', [codex.credentials, empty.credentials])).toMatchObject({
      ok: false, error: { code: 'worker_type_disabled', blocker: { reason: 'worker_type_disabled' } },
    });
    expect(codex.events.posts).toEqual([]);
    expect(empty.events.posts).toEqual([]);
  });

  it('keeps offline potentially capable hosts recoverable when reachable hosts exclude the type', async () => {
    const codex = await startWorker('codex-host', { types: ['codex'], revision: 1 });
    const offline = await startWorker('offline-host', { healthStatus: 503 });

    expect(await dispatch('auto', [codex.credentials, offline.credentials])).toMatchObject({
      ok: false, error: { blocker: { reason: 'workers_unreachable', workerNames: ['offline-host'] } },
    });
    expect(codex.events.posts).toEqual([]);
    expect(offline.events.posts).toEqual([]);
  });

  it('honors an offline host’s confirmed exclusion without POSTing to either host', async () => {
    const codex = await startWorker('codex-host', { types: ['codex'], revision: 1 });
    const offline = await startWorker('offline-host', { healthStatus: 503 });

    expect(await dispatch('auto', [codex.credentials, {
      ...offline.credentials, enabledWorkerTypes: ['codex'], workerTypesRevision: 2,
    }])).toMatchObject({
      ok: false, error: { blocker: { reason: 'worker_type_disabled', workerNames: ['codex-host', 'offline-host'] } },
    });
    expect(codex.events.posts).toEqual([]);
    expect(offline.events).toEqual({ probes: 1, posts: [] });
  });

  it('uses fresh policy after another alias enabled the type and preserves a known exclusion on downgrade', async () => {
    const legacy = await startWorker('downgraded-host');
    const updated = await startWorker('updated-host', { types: ['auto'], revision: 3, available: 1 });

    expect(await dispatch('auto', [
      { ...legacy.credentials, enabledWorkerTypes: ['codex'], workerTypesRevision: 2 },
      { ...updated.credentials, enabledWorkerTypes: [], workerTypesRevision: 2 },
    ])).toMatchObject({ ok: true, value: { workerLocation: 'updated-host' } });
    expect(legacy.events).toEqual({ probes: 1, posts: [] });
    expect(updated.events).toEqual({ probes: 1, posts: ['auto'] });
  });

  it('records a newly discovered policy against the correct account and worker registration', async () => {
    const changed = await startWorker('changed-host', { types: [], revision: 3 });
    const legacy = await startWorker('legacy-host');
    const confirmWorkerTypePolicy = vi.fn().mockResolvedValue(ok({ enabledWorkerTypes: [], workerTypesRevision: 3 }));

    expect(await dispatch('auto', [
      { ...changed.credentials, registrationId: 'changed-registration' },
      { ...legacy.credentials, registrationId: 'legacy-registration' },
    ], undefined, { confirmWorkerTypePolicy })).toMatchObject({
      ok: true, value: { workerLocation: 'legacy-host' },
    });
    expect(confirmWorkerTypePolicy).toHaveBeenCalledExactlyOnceWith('user_test', expect.objectContaining({
      name: 'changed-host', url: changed.credentials.url, registrationId: 'changed-registration',
    }), { enabledWorkerTypes: [], workerTypesRevision: 3 });
    expect(changed.events.posts).toEqual([]);
    expect(legacy.events.posts).toEqual(['auto']);
  });

  it('routes using live policy when recording it fails', async () => {
    const worker = await startWorker('updated-host', { types: ['auto'], revision: 2 });
    const confirmWorkerTypePolicy = vi.fn().mockRejectedValue(new Error('Policy cache unavailable'));

    expect(await dispatch('auto', [{
      ...worker.credentials, enabledWorkerTypes: [], workerTypesRevision: 1,
    }], undefined, { confirmWorkerTypePolicy })).toMatchObject({
      ok: true, value: { workerLocation: 'updated-host' },
    });
    expect(worker.events.posts).toEqual(['auto']);
  });

  it('preserves a newer recorded exclusion when a host reports an older policy', async () => {
    const worker = await startWorker('downgraded-host', { types: ['auto'], revision: 2 });
    const confirmWorkerTypePolicy = vi.fn();

    expect(await dispatch('auto', [{
      ...worker.credentials, enabledWorkerTypes: [], workerTypesRevision: 3,
    }], undefined, { confirmWorkerTypePolicy })).toMatchObject({
      ok: false, error: { code: 'worker_type_disabled' },
    });
    expect(confirmWorkerTypePolicy).not.toHaveBeenCalled();
    expect(worker.events.posts).toEqual([]);
  });

  it('falls back on an explicit policy race to the next eligible host', async () => {
    const changed = await startWorker('changed-host', {
      types: ['auto'], revision: 1, dispatchStatus: 409,
      dispatchResponse: { code: 'worker_type_disabled', error: 'This worker no longer accepts auto' },
    });
    const legacy = await startWorker('legacy-host', { available: 1 });

    expect(await dispatch('auto', [changed.credentials, legacy.credentials])).toMatchObject({
      ok: true, value: { workerLocation: 'legacy-host' },
    });
    expect(changed.events.posts).toEqual(['auto']);
    expect(legacy.events.posts).toEqual(['auto']);
  });

  it.each([
    { options: { types: [] as CodeTaskWorkerType[], revision: 1 }, reason: 'worker_type_disabled' },
    { options: { healthStatus: 503 }, reason: 'workers_unreachable' },
    { options: { types: ['auto'] as CodeTaskWorkerType[], revision: 1, available: 0 }, reason: 'workers_at_capacity' },
  ])('reclassifies a policy refusal with the remaining host as $reason', async ({ options, reason }) => {
    const changed = await startWorker('changed-host', {
      types: ['auto'], revision: 1, dispatchStatus: 409,
      dispatchResponse: { code: 'worker_type_disabled', error: 'This worker no longer accepts auto' },
    });
    const backup = await startWorker('backup-host', options);

    expect(await dispatch('auto', [changed.credentials, backup.credentials])).toMatchObject({
      ok: false, error: { blocker: { reason } },
    });
    expect(changed.events.posts).toEqual(['auto']);
    expect(backup.events.posts).toEqual([]);
  });

  it.each([
    { status: 409, response: { code: 'worker_type_disabled' }, error: { code: 'dispatch_failed' } },
    { status: 409, response: 'Malformed conflict text', error: { code: 'dispatch_failed' } },
    { status: 502, response: { code: 'worker_type_disabled', error: 'Gateway error' }, error: { code: 'network_error', outcomeUnknown: true } },
  ])('stops on HTTP $status without a definite policy refusal', async ({ status, response, error }) => {
    const primary = await startWorker('primary-host', { dispatchStatus: status, dispatchResponse: response });
    const backup = await startWorker('backup-host');

    expect(await dispatch('auto', [primary.credentials, backup.credentials])).toMatchObject({ ok: false, error });
    expect(primary.events.posts).toEqual(['auto']);
    expect(backup.events.posts).toEqual([]);
  });

  it.each([
    {
      name: 'resumes a finished task after the host re-enables its type',
      delivery: 'direct', status: 'implemented', types: ['auto'], probes: 1, action: 'resumed', httpStatus: 200,
      expected: ok({ action: 'resumed' }),
    },
    {
      name: 'queues a message when the running task type is enabled',
      delivery: 'direct', status: 'running', types: ['auto'], probes: 0, action: 'queued', httpStatus: 200,
      expected: ok({ action: 'queued' }),
    },
    {
      name: 'surfaces the assigned host refusal when the running task type is disabled',
      delivery: 'direct', status: 'running', types: [], probes: 0, action: 'queued', httpStatus: 409,
      expected: err({
        code: 'worker_type_disabled',
        message: "Worker type 'auto' is disabled on this host. Enable it in Worker types or select another worker.",
      }),
    },
    {
      name: 'queues a delayed message when the running task type is enabled',
      delivery: 'retry', status: 'running', types: ['auto'], probes: 0, action: 'queued', httpStatus: 200,
      expected: ok({ action: 'message_sent', taskId: 'task_worker_type_dispatch' }),
    },
    {
      name: 'drops a delayed message refused by its assigned host',
      delivery: 'retry', status: 'running', types: [], probes: 0, action: 'queued', httpStatus: 409,
      expected: ok({ action: 'failed', taskId: 'task_worker_type_dispatch' }),
    },
  ] as const)('$name', async ({ delivery, status, types, probes, action, httpStatus, expected }) => {
    const other = await startWorker('other-host');
    const assigned = await startWorker('assigned-host', {
      types: [...types], revision: 2, messageTask: { workerType: 'auto', action },
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const taskDispatcher = createTaskDispatcherService({
      logger,
      workerHealthProbe: createWorkerHealthProbe(),
    });
    const task = createFakeTask({
      id: 'task_worker_type_dispatch',
      userId: 'user_test', workerType: 'auto', workerLocation: 'assigned-host',
      workerAudience: `${assigned.credentials.url}/`, status,
    });
    const message = 'Please check the tests';
    const deps: SendTaskMessageDeps = {
      logger,
      taskDispatcher,
      codeTaskRepo: {
        findByIdForUser: vi.fn().mockResolvedValue(ok(task)), update: vi.fn().mockResolvedValue(ok(task)),
      } as unknown as SendTaskMessageDeps['codeTaskRepo'],
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(ok({ workers: [
          { ...other.credentials, enabled: true },
          { ...assigned.credentials, enabled: true, enabledWorkerTypes: [], workerTypesRevision: 1 },
        ] })),
      } as unknown as SendTaskMessageDeps['workerSettingsRepo'],
      logLineRepo: { storeBatch: vi.fn().mockResolvedValue(ok(undefined)) } as unknown as SendTaskMessageDeps['logLineRepo'],
      whatsappNotifier: { notifyTaskResumed: vi.fn().mockResolvedValue(ok(undefined)) } as unknown as SendTaskMessageDeps['whatsappNotifier'],
    };
    if (delivery === 'direct') {
      expect(await sendTaskMessage(deps, { taskId: task.id, userId: task.userId, message })).toEqual(expected);
    } else {
      const entry: DispatchRetry = {
        id: 'dispatch-retry', type: 'task_message', eventId: 'event-id', repository: task.repository,
        pullRequestNumber: 1, senderLogin: 'test-user', taskId: task.id, userId: task.userId, message,
        attempts: 1, maxAttempts: 3, lastError: 'worker_unavailable', createdAt: Timestamp.now(), ttlMinutes: 10,
      };
      const deleteRetry = vi.fn().mockResolvedValue(ok(undefined));
      expect(await drainRetryQueue({
        ...deps,
        dispatchRetryRepo: {
          findOldest: vi.fn().mockResolvedValue(ok(entry)), claimForProcessing: vi.fn().mockResolvedValue(ok(true)),
          delete: deleteRetry,
        } as unknown as DrainRetryQueueDeps['dispatchRetryRepo'],
        linearAgentClient: { validateIssue: vi.fn() } as unknown as DrainRetryQueueDeps['linearAgentClient'],
      })).toEqual(expected);
      expect(deleteRetry).toHaveBeenCalledExactlyOnceWith(entry.id);
    }
    expect(assigned.messagePosts).toEqual([{ path: '/tasks/task_worker_type_dispatch/message', status: httpStatus }]);
    expect(assigned.events.probes).toBe(probes);
    expect(other.messagePosts).toEqual([]);
    expect(other.events.probes).toBe(0);
  });
});
