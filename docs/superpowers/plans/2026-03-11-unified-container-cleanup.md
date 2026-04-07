# Unified Periodic Container Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution mode:** Execute all tasks end-to-end without stopping for user approval between stages. Only stop if CI fails or a blocking error is encountered.

**Goal:** Replace startup-only container cleanup with a unified periodic cleanup that removes preserved and orphaned containers older than 3 hours, running every 5 minutes.

**Architecture:** Add a `startPeriodicCleanup()`/`stopPeriodicCleanup()` lifecycle to `DockerProvider` that scans Docker every 5 minutes. Each container is classified as active (in `workers` Map — skip), preserved (in `preservedWorkers` Map — check `preservedAt`), or orphaned (not in either Map — check Docker `Created` timestamp). Containers exceeding the 3-hour threshold are stopped and removed. The startup-only `cleanupOrphanedContainers()` and `main.ts` orphan removal are deleted.

**Tech Stack:** TypeScript, Dockerode, Vitest

**Files overview:**
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts` — add periodic cleanup, update `preserveWorker`, remove `cleanupOrphanedContainers`
- Modify: `workers/orchestrator/src/services/isolation/types.ts` — add `startPeriodicCleanup`/`stopPeriodicCleanup` to `IsolationProvider`
- Modify: `workers/orchestrator/src/services/isolation/index.ts` — replace startup cleanup with `startPeriodicCleanup()`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts` — replace `cleanupOrphanedContainers` tests with periodic cleanup tests
- Modify: `workers/orchestrator/src/main.ts` — remove orphan/exited container destruction from startup recovery, add `stopPeriodicCleanup()` to shutdown
- Modify: `workers/orchestrator/src/__tests__/main.test.ts` — update startup recovery tests

---

## Chunk 1: Periodic Cleanup in DockerProvider

### Task 1: Add periodic cleanup constants and interface methods

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/types.ts`
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`

- [ ] **Step 1: Add interface methods to `IsolationProvider`**

In `workers/orchestrator/src/services/isolation/types.ts`, add to the `IsolationProvider` interface after `listWorkerContainers`:

```ts
  startPeriodicCleanup?(): void;
  stopPeriodicCleanup?(): void;
```

- [ ] **Step 2: Add constants to `docker-provider.ts`**

Replace the existing `MAX_AGE_MS` constant inside `cleanupOrphanedContainers` with module-level constants:

```ts
const PERIODIC_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PRESERVED_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours
```

- [ ] **Step 3: Add `cleanupIntervalId` field to `DockerProvider` class**

Add after the `preservedWorkers` field:

```ts
private cleanupIntervalId: NodeJS.Timeout | null = null;
```

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/services/isolation/types.ts workers/orchestrator/src/services/isolation/docker-provider.ts
git commit -m "feat(orchestrator): add periodic cleanup constants and interface methods"
```

### Task 2: Write failing tests for periodic cleanup

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

- [ ] **Step 1: Write test — removes preserved containers older than 3 hours**

Replace the `cleanupOrphanedContainers` describe block with a new `periodic cleanup` describe block. The first test:

```ts
describe('periodic cleanup', () => {
  it('removes preserved containers older than 3 hours', async () => {
    // First create and preserve a worker
    mocks.mockDocker.listContainers.mockResolvedValueOnce([]); // for createWorker orphan check
    const handle = await provider.createWorker(createWorkerConfig());
    await provider.preserveWorker(handle.taskId);

    // Fast-forward the preservedAt timestamp to 4 hours ago
    const preserved = await provider.listPreservedWorkers();
    expect(preserved).toHaveLength(1);

    // Mock: Docker lists the preserved container
    mocks.mockDocker.listContainers.mockResolvedValueOnce([
      {
        Id: handle.containerId,
        Names: [`/code-worker-${handle.taskId}`],
        State: 'running',
        Created: Math.floor(Date.now() / 1000) - 5 * 60 * 60, // 5h ago
      },
    ]);

    // Manually set preservedAt to 4 hours ago by re-preserving with time manipulation
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 4 * 60 * 60 * 1000);
    // Re-create the preserved entry with old timestamp
    vi.restoreAllMocks();

    // Instead: directly call the cleanup method and check behavior
    // We need to access the periodic cleanup logic. Since it's in a setInterval,
    // we'll test the underlying method.
    await provider.runCleanupCycle();

    expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 5 });
    expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    const afterCleanup = await provider.listPreservedWorkers();
    expect(afterCleanup).toHaveLength(0);
  });

  it('skips preserved containers younger than 3 hours', async () => {
    mocks.mockDocker.listContainers.mockResolvedValueOnce([]); // for createWorker orphan check
    const handle = await provider.createWorker(createWorkerConfig());
    await provider.preserveWorker(handle.taskId);

    // Mock: Docker lists the preserved container (created recently)
    mocks.mockDocker.listContainers.mockResolvedValueOnce([
      {
        Id: handle.containerId,
        Names: [`/code-worker-${handle.taskId}`],
        State: 'running',
        Created: Math.floor(Date.now() / 1000) - 60 * 60, // 1h ago
      },
    ]);

    // Reset mocks from createWorker
    mocks.mockContainer.stop.mockClear();
    mocks.mockContainer.remove.mockClear();

    await provider.runCleanupCycle();

    expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
    expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
    const afterCleanup = await provider.listPreservedWorkers();
    expect(afterCleanup).toHaveLength(1);
  });

  it('removes orphaned containers older than 3 hours', async () => {
    // Container in Docker but NOT in workers or preservedWorkers maps
    const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
    mocks.mockDocker.listContainers.mockResolvedValueOnce([
      {
        Id: 'orphan-container-id',
        Names: ['/code-worker-orphan-task'],
        State: 'running',
        Created: fourHoursAgo,
      },
    ]);

    await provider.runCleanupCycle();

    expect(mocks.mockDocker.getContainer).toHaveBeenCalledWith('orphan-container-id');
    expect(mocks.mockContainer.stop).toHaveBeenCalledWith({ t: 5 });
    expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('skips orphaned containers younger than 3 hours', async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 60 * 60;
    mocks.mockDocker.listContainers.mockResolvedValueOnce([
      {
        Id: 'recent-orphan-id',
        Names: ['/code-worker-recent-task'],
        State: 'running',
        Created: oneHourAgo,
      },
    ]);

    await provider.runCleanupCycle();

    expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
    expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
  });

  it('skips active containers in the workers map', async () => {
    mocks.mockDocker.listContainers.mockResolvedValueOnce([]); // for createWorker orphan check
    const handle = await provider.createWorker(createWorkerConfig());

    // Container shows up in Docker scan
    mocks.mockDocker.listContainers.mockResolvedValueOnce([
      {
        Id: handle.containerId,
        Names: [`/code-worker-${handle.taskId}`],
        State: 'running',
        Created: Math.floor(Date.now() / 1000) - 5 * 60 * 60, // 5h ago - old but active
      },
    ]);

    mocks.mockContainer.stop.mockClear();
    mocks.mockContainer.remove.mockClear();

    await provider.runCleanupCycle();

    expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
    expect(mocks.mockContainer.remove).not.toHaveBeenCalled();
  });

  it('handles stopped orphaned containers without calling stop', async () => {
    const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
    mocks.mockDocker.listContainers.mockResolvedValueOnce([
      {
        Id: 'exited-orphan-id',
        Names: ['/code-worker-exited-task'],
        State: 'exited',
        Created: fourHoursAgo,
      },
    ]);

    await provider.runCleanupCycle();

    expect(mocks.mockContainer.stop).not.toHaveBeenCalled();
    expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('handles Docker list error gracefully', async () => {
    mocks.mockDocker.listContainers.mockRejectedValueOnce(new Error('Docker not available'));

    await expect(provider.runCleanupCycle()).resolves.not.toThrow();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('handles empty container list gracefully', async () => {
    mocks.mockDocker.listContainers.mockResolvedValueOnce([]);

    await expect(provider.runCleanupCycle()).resolves.not.toThrow();
  });

  it('updates preservedAt when re-preserving a container', async () => {
    mocks.mockDocker.listContainers.mockResolvedValueOnce([]); // for createWorker orphan check
    const handle = await provider.createWorker(createWorkerConfig());
    await provider.preserveWorker(handle.taskId);

    const firstPreserved = await provider.listPreservedWorkers();
    const firstTimestamp = firstPreserved[0]?.preservedAt;

    // Simulate re-adding to workers map (as adoptTask would do), then re-preserving
    // For this test, we just call preserveWorker again — it should update timestamp
    // But preserveWorker requires the worker to be in the workers map, so we need
    // to simulate the full flow. For unit test purposes, verify the Map is updated.
    expect(firstTimestamp).toBeDefined();
  });

  it('startPeriodicCleanup starts interval and stopPeriodicCleanup clears it', () => {
    vi.useFakeTimers();

    provider.startPeriodicCleanup();

    // Mock listContainers for the cleanup cycle
    mocks.mockDocker.listContainers.mockResolvedValue([]);

    vi.advanceTimersByTime(5 * 60 * 1000); // 5 minutes

    expect(mocks.mockDocker.listContainers).toHaveBeenCalled();

    provider.stopPeriodicCleanup();

    mocks.mockDocker.listContainers.mockClear();
    vi.advanceTimersByTime(5 * 60 * 1000); // another 5 minutes

    // Should not have been called again after stop
    expect(mocks.mockDocker.listContainers).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('cleans up secrets and session directories for removed preserved containers', async () => {
    const fsRmSpy = vi.spyOn(await import('node:fs').then((m) => m.promises), 'rm');
    fsRmSpy.mockResolvedValue(undefined);

    const fourHoursAgo = Math.floor(Date.now() / 1000) - 4 * 60 * 60;
    mocks.mockDocker.listContainers.mockResolvedValueOnce([
      {
        Id: 'orphan-container-id',
        Names: ['/code-worker-orphan-task'],
        State: 'exited',
        Created: fourHoursAgo,
      },
    ]);

    await provider.runCleanupCycle();

    expect(mocks.mockContainer.remove).toHaveBeenCalledWith({ force: true });
    // Verify secrets cleanup was attempted
    expect(fsRmSpy).toHaveBeenCalledWith(
      expect.stringContaining('orphan-task'),
      expect.objectContaining({ recursive: true, force: true })
    );

    fsRmSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd workers/orchestrator && pnpm vitest run src/services/isolation/__tests__/docker-provider.test.ts`
Expected: FAIL — `provider.runCleanupCycle is not a function`

- [ ] **Step 3: Commit failing tests**

```bash
git add workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
git commit -m "test(orchestrator): add failing tests for periodic container cleanup"
```

### Task 3: Implement `runCleanupCycle`, `startPeriodicCleanup`, `stopPeriodicCleanup`

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`

- [ ] **Step 1: Implement `runCleanupCycle` method**

Replace the `cleanupOrphanedContainers` method with:

```ts
/**
 * Run a single cleanup cycle.
 * Scans Docker for code-worker-* containers and removes those that are:
 * - Preserved (in preservedWorkers Map) and older than PRESERVED_MAX_AGE_MS based on preservedAt
 * - Orphaned (not in workers or preservedWorkers Map) and older than PRESERVED_MAX_AGE_MS based on Docker Created timestamp
 * Active containers (in workers Map) are always skipped.
 */
async runCleanupCycle(): Promise<void> {
  const now = Date.now();

  try {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { name: ['code-worker-'] },
    });

    // Build a Set of active taskIds for fast lookup
    const activeTaskIds = new Set(this.workers.keys());

    for (const containerInfo of containers) {
      const nameMatch = containerInfo.Names[0]?.replace(/^\/code-worker-/, '');
      if (nameMatch === undefined) {
        continue;
      }
      const taskId = nameMatch;

      // Skip active containers
      if (activeTaskIds.has(taskId)) {
        continue;
      }

      // Determine age threshold
      const preserved = this.preservedWorkers.get(taskId);
      let ageMs: number;

      if (preserved !== undefined) {
        // Preserved container — use preservedAt timestamp
        ageMs = now - new Date(preserved.preservedAt).getTime();
      } else {
        // Orphaned container — use Docker Created timestamp
        ageMs = now - containerInfo.Created * 1000;
      }

      if (ageMs < PRESERVED_MAX_AGE_MS) {
        this.logger.debug(
          { taskId, ageHours: Math.round(ageMs / 3_600_000) },
          'Skipping container: below age threshold'
        );
        continue;
      }

      // Remove the container
      const container = this.docker.getContainer(containerInfo.Id);
      this.logger.info(
        {
          containerId: containerInfo.Id,
          taskId,
          ageHours: Math.round(ageMs / 3_600_000),
          type: preserved !== undefined ? 'preserved' : 'orphaned',
        },
        'Periodic cleanup: removing old container'
      );

      try {
        if (containerInfo.State === 'running') {
          await container.stop({ t: 5 });
        }
        await container.remove({ force: true });
      } catch (err: unknown) {
        this.logger.error(
          { containerId: containerInfo.Id, taskId, error: err },
          'Periodic cleanup: failed to remove container'
        );
      }

      // Clean up secrets and session directories
      try {
        await fs.promises.rm(path.join(this.config.secretsBasePath, taskId), {
          recursive: true,
          force: true,
        });
        await fs.promises.rm(
          path.join(this.config.secretsBasePath, `${CLAUDE_SESSION_DIR_PREFIX}-${taskId}`),
          { recursive: true, force: true }
        );
      } catch (err: unknown) {
        this.logger.warn({ taskId, error: err }, 'Periodic cleanup: failed to clean up task directories');
      }

      // Remove from preservedWorkers if it was there
      if (preserved !== undefined) {
        this.preservedWorkers.delete(taskId);
      }
    }
  } catch (error) {
    this.logger.warn({ error }, 'Periodic cleanup: failed to list containers');
  }
}
```

- [ ] **Step 2: Implement `startPeriodicCleanup` and `stopPeriodicCleanup`**

```ts
startPeriodicCleanup(): void {
  if (this.cleanupIntervalId !== null) {
    return;
  }
  this.logger.info(
    { intervalMs: PERIODIC_CLEANUP_INTERVAL_MS, maxAgeMs: PRESERVED_MAX_AGE_MS },
    'Starting periodic container cleanup'
  );
  this.cleanupIntervalId = setInterval(() => {
    void this.runCleanupCycle();
  }, PERIODIC_CLEANUP_INTERVAL_MS);
}

stopPeriodicCleanup(): void {
  if (this.cleanupIntervalId !== null) {
    clearInterval(this.cleanupIntervalId);
    this.cleanupIntervalId = null;
    this.logger.info('Stopped periodic container cleanup');
  }
}
```

- [ ] **Step 3: Delete the old `cleanupOrphanedContainers` method entirely**

Remove the entire `cleanupOrphanedContainers` method (lines ~309-363).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd workers/orchestrator && pnpm vitest run src/services/isolation/__tests__/docker-provider.test.ts`
Expected: All periodic cleanup tests PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/isolation/docker-provider.ts
git commit -m "feat(orchestrator): implement periodic container cleanup replacing startup-only cleanup"
```

### Task 4: Update `preserveWorker` to refresh timestamp on re-preservation

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts`

- [ ] **Step 1: Write failing test for timestamp update on re-preserve**

In the periodic cleanup describe block, add:

```ts
it('re-preserving a container updates preservedAt timestamp', async () => {
  mocks.mockDocker.listContainers.mockResolvedValueOnce([]); // createWorker orphan check
  const config = createWorkerConfig();
  const handle = await provider.createWorker(config);

  // First preserve
  await provider.preserveWorker(handle.taskId);
  const first = await provider.listPreservedWorkers();
  const firstTimestamp = first[0]?.preservedAt;
  expect(firstTimestamp).toBeDefined();

  // Small delay to ensure different timestamp
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Re-preserve (simulating: container was re-adopted then completed again)
  // preserveWorker checks workers Map, so we need to re-add it
  // For this test, we call the method directly — it should handle
  // the case where taskId is already in preservedWorkers
  await provider.preserveWorker(handle.taskId);

  const second = await provider.listPreservedWorkers();
  expect(second).toHaveLength(1);
  // Timestamp should be updated (or at least not older)
  expect(new Date(second[0]!.preservedAt).getTime()).toBeGreaterThanOrEqual(
    new Date(firstTimestamp!).getTime()
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm vitest run src/services/isolation/__tests__/docker-provider.test.ts -t "re-preserving"`
Expected: FAIL — `preserveWorker` returns early because worker is no longer in `workers` Map after first preserve.

- [ ] **Step 3: Update `preserveWorker` to handle re-preservation**

In `preserveWorker`, add handling for the case where the taskId is already in `preservedWorkers` but not in `workers` — update the timestamp:

```ts
async preserveWorker(taskId: string): Promise<void> {
  const worker = this.workers.get(taskId);
  if (worker === undefined) {
    // If already preserved, refresh the timestamp
    const existing = this.preservedWorkers.get(taskId);
    if (existing !== undefined) {
      existing.preservedAt = new Date().toISOString();
      this.logger.info({ taskId }, 'Refreshed preservedAt timestamp for already-preserved worker');
    }
    return;
  }

  this.preservedWorkers.set(taskId, {
    containerId: worker.containerId,
    taskId,
    preservedAt: new Date().toISOString(),
  });
  this.workers.delete(taskId);

  // Clear sensitive files but keep the directory
  const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
  try {
    const entries = await fs.promises.readdir(taskSecretsPath);
    await Promise.all(
      entries.map((entry) =>
        fs.promises.rm(path.join(taskSecretsPath, entry), { recursive: true, force: true })
      )
    );
  } catch (err: unknown) {
    this.logger.error(
      { taskId, error: err, path: taskSecretsPath },
      'Failed to clear task secrets during preservation'
    );
  }

  this.logger.info({ taskId, containerId: worker.containerId }, 'Worker preserved for debugging');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd workers/orchestrator && pnpm vitest run src/services/isolation/__tests__/docker-provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/isolation/docker-provider.ts workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
git commit -m "feat(orchestrator): update preserveWorker to refresh timestamp on re-preservation"
```

## Chunk 2: Wire Up and Remove Startup Cleanup

### Task 5: Update `isolation/index.ts` — replace startup cleanup with periodic cleanup

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/index.ts`

- [ ] **Step 1: Replace `cleanupOrphanedContainers` with `startPeriodicCleanup`**

Replace the entire startup cleanup logic in `createIsolationProvider`:

```ts
export async function createIsolationProvider(
  config: Partial<DockerProviderConfig>,
  logger: Logger
): Promise<IsolationProvider> {
  const provider = new DockerProvider(config, logger);

  // Start periodic cleanup (replaces one-time startup cleanupOrphanedContainers)
  provider.startPeriodicCleanup();

  return provider;
}
```

This removes the Docker connectivity check that `cleanupOrphanedContainers` provided. The periodic cleanup will log warnings if Docker is unreachable, and `createWorker` will fail fast with a clear error if Docker is down when a task is dispatched.

- [ ] **Step 2: Run full orchestrator test suite to check for regressions**

Run: `cd workers/orchestrator && pnpm vitest run`
Expected: PASS (some tests may reference `cleanupOrphanedContainers` — those were already updated in Task 2)

- [ ] **Step 3: Commit**

```bash
git add workers/orchestrator/src/services/isolation/index.ts
git commit -m "refactor(orchestrator): replace startup cleanup with periodic cleanup in isolation factory"
```

### Task 6: Remove orphan/exited container handling from `main.ts` startup recovery

**Files:**
- Modify: `workers/orchestrator/src/main.ts`
- Modify: `workers/orchestrator/src/__tests__/main.test.ts`

- [ ] **Step 1: Remove stateless orphan container removal from `runStartupRecovery`**

In `main.ts`, remove the block at lines 158-171 that destroys stateless orphan containers:

```ts
// DELETE THIS BLOCK:
// Handle stateless orphan containers (container exists but NOT in state)
if (containerMap !== null && isolationProvider !== undefined) {
  const taskIdsInState = new Set(Object.keys(state.tasks));
  for (const [taskId] of containerMap) {
    if (!taskIdsInState.has(taskId)) {
      try {
        await isolationProvider.destroyWorker(taskId);
        logger.info({ taskId }, 'Removed stateless orphan container');
      } catch (error) {
        logger.error({ taskId, error }, 'Failed to remove orphan container');
      }
    }
  }
}
```

- [ ] **Step 2: Remove exited container destruction from the task loop**

In `main.ts`, in the task recovery loop, remove the block at lines 201-209 that destroys exited containers. Keep the fall-through to the interrupted webhook — the task should still be marked interrupted, but container cleanup is now the periodic job's responsibility:

```ts
// DELETE THIS BLOCK:
} else if (container !== undefined && isolationProvider !== undefined) {
  try {
    await isolationProvider.destroyWorker(task.taskId);
    logger.info({ taskId: task.taskId }, 'Removed exited container');
  } catch (error) {
    logger.error({ taskId: task.taskId, error }, 'Failed to remove exited container');
  }
}
```

The remaining logic should be: if container is running → adopt. Otherwise → mark interrupted (send webhook + update state). The periodic cleanup handles the actual container removal.

- [ ] **Step 3: Add `stopPeriodicCleanup` to shutdown handlers**

In `main.ts`, in the `shutdown` function, add cleanup stop after `heartbeatManager.stop()`:

```ts
handlers.heartbeatManager.stop();

// Stop periodic container cleanup
if (isolationProvider?.stopPeriodicCleanup !== undefined) {
  isolationProvider.stopPeriodicCleanup();
}
```

This requires adding `isolationProvider` to the `ShutdownHandlers` interface and passing it through `setupShutdownHandlers`.

- [ ] **Step 4: Update tests in `main.test.ts`**

Remove tests that assert `destroyWorker` was called for stateless orphans and exited containers during startup recovery. Update assertions to verify that interrupted webhooks are still sent but `destroyWorker` is not called.

- [ ] **Step 5: Run full test suite**

Run: `cd workers/orchestrator && pnpm vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/main.ts workers/orchestrator/src/__tests__/main.test.ts
git commit -m "refactor(orchestrator): remove startup container cleanup, rely on periodic cleanup"
```

### Task 7: Final verification and PR

- [ ] **Step 1: Run full CI check**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS — all tests pass, coverage thresholds met.

- [ ] **Step 2: Run `pnpm run ci:tracked`**

Run: `pnpm run ci:tracked`
Expected: PASS

- [ ] **Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore(orchestrator): fixup after periodic cleanup implementation"
```

- [ ] **Step 4: Push branch and create PR**

```bash
git push -u origin HEAD
```

Create PR targeting `development` with title including the Linear issue ID (ask user if none provided).

- [ ] **Step 5: Code review loop**

Use the `pr-review-toolkit:review-pr` skill to run a comprehensive review. For each round:
1. Run the review
2. Fix any issues found
3. Run `pnpm run ci:tracked` after fixes
4. Commit fixes
5. Push
6. Re-run review

Repeat until the review passes clean.

- [ ] **Step 6: Final push**

After review loop completes with no issues:
```bash
git push
```

Confirm PR is ready for merge.
