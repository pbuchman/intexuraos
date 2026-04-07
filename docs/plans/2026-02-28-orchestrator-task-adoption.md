# Orchestrator Task Adoption Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the orchestrator restarts, adopt running Docker containers and resume tasks instead of abandoning them.

**Architecture:** Replace `runStartupRecovery()` with a container-aware adoption flow. Running containers with matching persisted state are adopted via `--continue` attempts. Exited containers are removed with `interrupted` webhooks. Also fix the broken `detect-zombies` endpoint as a safety net.

**Tech Stack:** Docker API (dockerode), orchestrator state persistence, Fastify routes

**Design doc:** `docs/plans/2026-02-28-orchestrator-task-adoption-design.md`

---

### Task 1: Add `listWorkerContainers()` to DockerProvider

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

**Step 1: Write the failing test**

```typescript
describe('listWorkerContainers', () => {
  it('returns running and exited containers with taskId extracted from name', async () => {
    // Mock docker.listContainers to return two containers:
    // - code-worker-task_abc running
    // - code-worker-task_def exited
    mockDocker.listContainers.mockResolvedValue([
      {
        Id: 'container-1',
        Names: ['/code-worker-task_abc'],
        State: 'running',
        Created: Math.floor(Date.now() / 1000),
      },
      {
        Id: 'container-2',
        Names: ['/code-worker-task_def'],
        State: 'exited',
        Created: Math.floor(Date.now() / 1000),
      },
    ]);

    const result = await provider.listWorkerContainers();

    expect(result).toEqual([
      { containerId: 'container-1', taskId: 'task_abc', state: 'running' },
      { containerId: 'container-2', taskId: 'task_def', state: 'exited' },
    ]);
    expect(mockDocker.listContainers).toHaveBeenCalledWith({
      all: true,
      filters: { name: ['code-worker-'] },
    });
  });

  it('returns empty array when Docker daemon is unreachable', async () => {
    mockDocker.listContainers.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await provider.listWorkerContainers();

    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm vitest run src/services/isolation/__tests__/docker-provider.test.ts -t "listWorkerContainers"`
Expected: FAIL — `listWorkerContainers` not defined

**Step 3: Write minimal implementation**

Add to `DockerProvider` class (after `cleanupOrphanedContainers`):

```typescript
export interface DiscoveredContainer {
  containerId: string;
  taskId: string;
  state: 'running' | 'exited' | string;
}

async listWorkerContainers(): Promise<DiscoveredContainer[]> {
  try {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { name: ['code-worker-'] },
    });

    return containers.map((c) => ({
      containerId: c.Id,
      taskId: c.Names[0]!.replace(/^\/code-worker-/, ''),
      state: c.State,
    }));
  } catch (error) {
    this.logger.warn({ error }, 'Failed to list worker containers');
    return [];
  }
}
```

Also add `listWorkerContainers` to the `IsolationProvider` interface in `types.ts`:

```typescript
listWorkerContainers?(): Promise<DiscoveredContainer[]>;
```

**Step 4: Run test to verify it passes**

Run: `cd workers/orchestrator && pnpm vitest run src/services/isolation/__tests__/docker-provider.test.ts -t "listWorkerContainers"`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/orchestrator/src/services/isolation/docker-provider.ts \
       workers/orchestrator/src/services/isolation/types.ts \
       workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
git commit -m "feat(orchestrator): add listWorkerContainers to DockerProvider"
```

---

### Task 2: Add `adoptTask()` to TaskDispatcher

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write the failing test**

```typescript
describe('adoptTask', () => {
  it('re-registers task, increments runningCount, and calls createWorker with continueSession', async () => {
    const task: Task = {
      taskId: 'task_orphan',
      workerType: 'opus',
      prompt: 'test prompt',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      status: 'running',
      worktreePath: '/tmp/worktrees/task_orphan',
      containerId: 'container-123',
      startedAt: new Date().toISOString(),
      linearIssueLabels: [],
      attemptCount: 1,
      maxAttempts: 3,
      verificationHistory: [],
    };

    const result = await dispatcher.adoptTask(task);

    expect(result.ok).toBe(true);
    expect(dispatcher.getRunningCount()).toBe(1);
    // Verify createWorker was called with continueSession: true
    expect(mockIsolationProvider.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_orphan',
        continueSession: true,
      })
    );
  });

  it('skips adoption when task is at maxAttempts', async () => {
    const task: Task = {
      taskId: 'task_maxed',
      workerType: 'opus',
      prompt: 'test',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      status: 'running',
      worktreePath: '/tmp/worktrees/task_maxed',
      containerId: 'container-456',
      startedAt: new Date().toISOString(),
      linearIssueLabels: [],
      attemptCount: 3,
      maxAttempts: 3,
      verificationHistory: [],
    };

    const result = await dispatcher.adoptTask(task);

    expect(result.ok).toBe(false);
    expect(dispatcher.getRunningCount()).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts -t "adoptTask"`
Expected: FAIL — `adoptTask` not defined

**Step 3: Write minimal implementation**

Add to `TaskDispatcher` class:

```typescript
async adoptTask(task: Task): Promise<Result<void, DispatchError>> {
  const attempt = task.attemptCount ?? 1;
  const maxAttempts = task.maxAttempts ?? this.completionMaxAttempts;

  if (attempt >= maxAttempts) {
    this.logger.info(
      { taskId: task.taskId, attempt, maxAttempts },
      'Task at max attempts, skipping adoption'
    );
    return { ok: false, error: { type: 'at_capacity', message: 'Task at max attempts' } };
  }

  // Atomic capacity check
  const capacityCheck = await this.capacityMutex.runExclusive(() => {
    if (this.runningCount >= this.config.capacity) {
      return { ok: false as const, error: { type: 'at_capacity' as const, message: 'Service at capacity' } };
    }
    this.runningCount++;
    return { ok: true as const, value: undefined };
  });

  if (!capacityCheck.ok) {
    return capacityCheck;
  }

  this.logger.info(
    { taskId: task.taskId, attempt, containerId: task.containerId },
    'Adopting orphaned task'
  );

  // Update attempt count
  task.attemptCount = attempt + 1;
  await this.saveTask(task);

  // Register log forwarder
  this.logForwarder.registerTask(task.taskId, task.webhookSecret);

  // Start worker attempt with continueSession
  const startResult = await this.startWorkerAttempt(task, {
    prompt: task.prompt,
    hasChildren: task.hasChildren,
    continueSession: true,
  });

  if (!startResult.ok) {
    if (this.runningCount > 0) this.runningCount--;
    this.logForwarder.unregisterTask(task.taskId);
    return { ok: false, error: { type: 'invalid_status', message: 'Failed to start adopted worker' } };
  }

  return { ok: true, value: undefined };
}
```

**Step 4: Run test to verify it passes**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/task-dispatcher.test.ts -t "adoptTask"`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts \
       workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat(orchestrator): add adoptTask method to TaskDispatcher"
```

---

### Task 3: Replace `runStartupRecovery()` with Adoption Flow

**Files:**
- Modify: `workers/orchestrator/src/main.ts`
- Test: `workers/orchestrator/src/__tests__/main.test.ts`

**Step 1: Write the failing tests**

Add tests covering all four container states (adapt existing `runStartupRecovery` tests):

```typescript
describe('runStartupRecovery with container adoption', () => {
  it('adopts running container with matching state', async () => {
    // State has task_abc as running
    mockStatePersistence.load.mockResolvedValue({
      tasks: {
        task_abc: {
          taskId: 'task_abc',
          status: 'running',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
          workerType: 'opus',
          worktreePath: '/tmp/worktrees/task_abc',
          containerId: 'container-1',
          startedAt: new Date().toISOString(),
          linearIssueLabels: [],
          attemptCount: 1,
          maxAttempts: 3,
        },
      },
      pendingWebhooks: [],
    });

    // Docker shows container running
    mockIsolationProvider.listWorkerContainers.mockResolvedValue([
      { containerId: 'container-1', taskId: 'task_abc', state: 'running' },
    ]);

    await main(mockConfig, mockStatePersistence, mockDispatcher, ...);

    expect(mockDispatcher.adoptTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' })
    );
    // Should NOT send interrupted webhook
    expect(mockWebhookClient.send).not.toHaveBeenCalled();
  });

  it('sends interrupted webhook for running state with no container', async () => {
    mockStatePersistence.load.mockResolvedValue({
      tasks: {
        task_gone: {
          taskId: 'task_gone',
          status: 'running',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
          containerId: 'container-gone',
          startedAt: new Date().toISOString(),
          linearIssueLabels: [],
        },
      },
      pendingWebhooks: [],
    });
    mockIsolationProvider.listWorkerContainers.mockResolvedValue([]);

    await main(mockConfig, mockStatePersistence, mockDispatcher, ...);

    expect(mockWebhookClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: 'interrupted' }),
      })
    );
  });

  it('removes exited container and sends interrupted webhook', async () => {
    mockStatePersistence.load.mockResolvedValue({
      tasks: {
        task_exited: {
          taskId: 'task_exited',
          status: 'running',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
          containerId: 'container-2',
          startedAt: new Date().toISOString(),
          linearIssueLabels: [],
        },
      },
      pendingWebhooks: [],
    });
    mockIsolationProvider.listWorkerContainers.mockResolvedValue([
      { containerId: 'container-2', taskId: 'task_exited', state: 'exited' },
    ]);

    await main(mockConfig, mockStatePersistence, mockDispatcher, ...);

    expect(mockIsolationProvider.destroyWorker).toHaveBeenCalledWith('task_exited');
    expect(mockWebhookClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: 'interrupted' }),
      })
    );
  });

  it('removes running container with no state (stateless orphan)', async () => {
    mockStatePersistence.load.mockResolvedValue({
      tasks: {},
      pendingWebhooks: [],
    });
    mockIsolationProvider.listWorkerContainers.mockResolvedValue([
      { containerId: 'container-unknown', taskId: 'task_unknown', state: 'running' },
    ]);

    await main(mockConfig, mockStatePersistence, mockDispatcher, ...);

    expect(mockIsolationProvider.destroyWorker).toHaveBeenCalledWith('task_unknown');
    expect(mockWebhookClient.send).not.toHaveBeenCalled();
  });

  it('falls back to state-only recovery when Docker is unavailable', async () => {
    mockStatePersistence.load.mockResolvedValue({
      tasks: {
        task_noDocker: {
          taskId: 'task_noDocker',
          status: 'running',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
          containerId: 'c',
          startedAt: new Date().toISOString(),
          linearIssueLabels: [],
        },
      },
      pendingWebhooks: [],
    });
    // listWorkerContainers returns empty on Docker failure (handled internally)
    mockIsolationProvider.listWorkerContainers.mockResolvedValue([]);

    await main(mockConfig, mockStatePersistence, mockDispatcher, ...);

    // Falls back to interrupted webhook (no container found for this task)
    expect(mockWebhookClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: 'interrupted' }),
      })
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/main.test.ts -t "runStartupRecovery with container adoption"`
Expected: FAIL

**Step 3: Write the implementation**

Replace `runStartupRecovery` in `main.ts`:

```typescript
async function runStartupRecovery(
  statePersistence: StatePersistence,
  dispatcher: TaskDispatcher,
  webhookClient: WebhookClient,
  logger: Logger,
  isolationProvider?: IsolationProvider
): Promise<void> {
  logger.info({ message: 'Running startup recovery with container adoption' });

  const state = await statePersistence.load();
  const runningTasks = Object.values(state.tasks).filter((t) => t.status === 'running');

  // Discover Docker containers
  const containers = await isolationProvider?.listWorkerContainers?.() ?? [];
  const containerMap = new Map(containers.map((c) => [c.taskId, c]));

  logger.info(
    { runningTasks: runningTasks.length, containers: containers.length },
    'Startup recovery: discovered state'
  );

  // Handle containers WITHOUT matching state (stateless orphans)
  for (const container of containers) {
    const hasState = runningTasks.some((t) => t.taskId === container.taskId);
    if (!hasState) {
      logger.info(
        { taskId: container.taskId, state: container.state },
        'Removing stateless orphan container'
      );
      try {
        await isolationProvider?.destroyWorker(container.taskId);
      } catch (error) {
        logger.error({ taskId: container.taskId, error }, 'Failed to remove orphan container');
      }
    }
  }

  // Handle tasks in state
  for (const task of runningTasks) {
    const container = containerMap.get(task.taskId);

    if (container?.state === 'running') {
      // ADOPT: running container with matching state
      try {
        const result = await dispatcher.adoptTask(task);
        if (result.ok) {
          logger.info({ taskId: task.taskId }, 'Adopted orphaned task');
          continue;
        }
        logger.warn(
          { taskId: task.taskId, error: result.error },
          'Failed to adopt task, falling back to interrupted'
        );
      } catch (error) {
        logger.error({ taskId: task.taskId, error }, 'Error adopting task');
      }
    }

    // NUKE: exited container, no container, or failed adoption
    if (container !== undefined) {
      try {
        await isolationProvider?.destroyWorker(task.taskId);
      } catch (error) {
        logger.error({ taskId: task.taskId, error }, 'Failed to remove container');
      }
    }

    // Send interrupted webhook
    try {
      await webhookClient.send({
        url: task.webhookUrl,
        secret: task.webhookSecret,
        payload: {
          taskId: task.taskId,
          status: 'interrupted',
          duration: 0,
        },
        taskId: task.taskId,
      });

      task.status = 'interrupted';
      await statePersistence.save(state);

      logger.info({ taskId: task.taskId }, 'Notified code-agent of interrupted task');
    } catch (error) {
      logger.error(
        { taskId: task.taskId, error },
        'Failed to notify code-agent of interrupted task'
      );
    }
  }
}
```

Update `main()` to pass `isolationProvider` to `runStartupRecovery`:

```typescript
await runStartupRecovery(statePersistence, dispatcher, webhookClient, logger, isolationProvider);
```

**Step 4: Run tests to verify they pass**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/main.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add workers/orchestrator/src/main.ts workers/orchestrator/src/__tests__/main.test.ts
git commit -m "feat(orchestrator): replace startup recovery with container adoption flow"
```

---

### Task 4: Investigate and Fix `detect-zombies` Endpoint

**Files:**
- Investigate: `apps/code-agent/src/routes/codeRoutes.ts:2533-2602`
- Investigate: `apps/code-agent/src/services.ts:264-267`
- Test: `apps/code-agent/src/__tests__/usecases/detectZombieTasks.test.ts`

**Context:** The endpoint returns `INTERNAL_ERROR` in 2ms with message "Internal error" (not the route's "Failed to detect zombie tasks"), suggesting the error occurs before the route handler runs — possibly a Fastify schema validation error or service initialization issue.

**Step 1: Reproduce locally**

```bash
curl -s -X POST "http://localhost:8128/internal/code/detect-zombies" \
  -H "X-Internal-Auth: ${INTEXURAOS_INTERNAL_AUTH_TOKEN}" \
  -H "Content-Type: application/json" | jq '.'
```

Expected: `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"Internal error"}}`

**Step 2: Investigate root cause**

Check if the error is:
1. Missing/failing Firestore composite index for `status IN + updatedAt <` query
2. Service initialization failure (`getServices().detectZombieTasks` returning undefined)
3. Fastify response schema validation (the 200 response schema might not match the actual response shape)

Add temporary debug logging before `detectZombieTasks()` call to narrow down. Check Firestore index requirements for the composite query at `firestoreCodeTaskRepository.ts:518-521`.

**Step 3: Fix the identified issue**

Depends on investigation. If it's a missing composite index, add a migration. If it's a schema mismatch, fix the response schema.

**Step 4: Write/update test to cover the fix**

Ensure the test in `detectZombieTasks.test.ts` covers the specific failure case.

**Step 5: Verify the fix**

```bash
curl -s -X POST "http://localhost:8128/internal/code/detect-zombies" \
  -H "X-Internal-Auth: ${INTEXURAOS_INTERNAL_AUTH_TOKEN}" \
  -H "Content-Type: application/json" | jq '.'
```

Expected: `{"success":true,"data":{"detected":N,"interrupted":N,"errors":[]}}`

**Step 6: Commit**

```bash
git add -A
git commit -m "fix(code-agent): fix detect-zombies endpoint returning INTERNAL_ERROR"
```

---

### Task 5: Manual Cleanup of Stuck Tasks

**Context:** Before deploying the adoption flow, clean up the currently stuck tasks in Firestore.

**Step 1: Identify stuck tasks**

```bash
node -e "
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const sa = require(process.env.HOME + '/.config/gcloud/sa-key.json');
initializeApp({ credential: cert(sa), projectId: process.env.INTEXURAOS_GCP_PROJECT_ID });
const db = getFirestore();
db.collection('code_tasks')
  .where('status', 'in', ['running', 'dispatched'])
  .get()
  .then(snap => {
    snap.forEach(doc => {
      const d = doc.data();
      console.log(JSON.stringify({
        id: doc.id,
        status: d.status,
        updatedAt: d.updatedAt?.toDate?.(),
        lastHeartbeat: d.lastHeartbeat?.toDate?.(),
      }));
    });
  });
"
```

**Step 2: Mark genuinely stuck tasks as interrupted**

For each task that is not actively running (no recent heartbeat, no matching Docker container):

```bash
node -e "
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const sa = require(process.env.HOME + '/.config/gcloud/sa-key.json');
initializeApp({ credential: cert(sa), projectId: process.env.INTEXURAOS_GCP_PROJECT_ID });
const db = getFirestore();
// Replace TASK_ID with each stuck task ID
const taskId = 'task_26834405-97bd-42b4-926e-6bc82df10485';
db.collection('code_tasks').doc(taskId).update({
  status: 'interrupted',
  updatedAt: FieldValue.serverTimestamp(),
  completedAt: FieldValue.serverTimestamp(),
}).then(() => console.log('Updated:', taskId));
"
```

**Step 3: Verify cleanup**

Re-run the query from Step 1. Only actively running tasks should remain.

---

### Task 6: Integration Verification

**Step 1: Run full orchestrator test suite**

```bash
cd workers/orchestrator && pnpm vitest run
```

Expected: ALL PASS

**Step 2: Run workspace verification**

```bash
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: TypeCheck + Lint + Tests + Coverage all pass

**Step 3: If detect-zombies fix touched code-agent, verify that too**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

**Step 4: Full CI**

```bash
pnpm run ci:tracked
```

Expected: ALL PASS

**Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "test(orchestrator): integration verification for task adoption"
```
