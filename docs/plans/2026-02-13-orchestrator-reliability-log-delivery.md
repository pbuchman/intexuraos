# Orchestrator Reliability + Guaranteed Log Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate retry/runtime ambiguity and guarantee all task logs are delivered to code-agent (or fail the task explicitly).

**Architecture:** Split DockerProvider worker tracking into active vs preserved maps so preserved debug containers don't block capacity. Add readiness gate before first attempt. Replace ephemeral log forwarding with a durable spool + ACK protocol ensuring at-least-once delivery with idempotent persistence. Harden startup cleanup and image observability.

**Tech Stack:** TypeScript, Dockerode, Fastify, Firestore, JSONL file spool, HMAC-signed webhooks.

**Design reference:** `.claude/reference/orchestrator-reliability-log-delivery-remediation-plan.md`

---

## Phase 1: Safety Foundations

### Task 1: Provider Concurrency Split (Active vs Preserved Workers)

**Files:**

- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts:36-60` (WorkerEntry, workers Map)
- Modify: `workers/orchestrator/src/services/isolation/types.ts:68-121` (IsolationProvider interface)
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:762-811` (finalizeTask)
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write failing tests for preserved worker non-counting behavior**

In `docker-provider.test.ts`, add:

```typescript
describe('preserved workers', () => {
  it('does not count preserved workers toward maxConcurrent', async () => {
    const provider = new TestableDockerProvider(
      createTestConfig({ maxConcurrent: 1, keepContainersAlive: true }),
      mockLogger
    );
    const config1 = createWorkerConfig({ taskId: 'task-1' });
    await provider.createWorker(config1);

    // Preserve the worker (simulates failed task kept for debugging)
    await provider.preserveWorker('task-1');

    // Should succeed because preserved workers don't count
    const config2 = createWorkerConfig({ taskId: 'task-2' });
    await expect(provider.createWorker(config2)).resolves.toBeDefined();
  });

  it('preserved worker is not in active list but is discoverable', async () => {
    const provider = new TestableDockerProvider(
      createTestConfig({ maxConcurrent: 2, keepContainersAlive: true }),
      mockLogger
    );
    await provider.createWorker(createWorkerConfig({ taskId: 'task-1' }));
    await provider.preserveWorker('task-1');

    const activeWorkers = await provider.listWorkers();
    expect(activeWorkers).toHaveLength(0);

    const preservedWorkers = await provider.listPreservedWorkers();
    expect(preservedWorkers).toHaveLength(1);
    expect(preservedWorkers[0]?.taskId).toBe('task-1');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: FAIL — `preserveWorker` and `listPreservedWorkers` don't exist

**Step 3: Implement the concurrency split**

In `docker-provider.ts`:

1. Add `PreservedWorkerEntry` interface and `preservedWorkers` Map (line ~45):

```typescript
interface PreservedWorkerEntry {
  containerId: string;
  taskId: string;
  preservedAt: string;
}
```

2. Add `preservedWorkers` map to `DockerProvider` class (line ~54):

```typescript
private readonly preservedWorkers = new Map<string, PreservedWorkerEntry>();
```

3. Add `preserveWorker` method:

```typescript
async preserveWorker(taskId: string): Promise<void> {
  const worker = this.workers.get(taskId);
  if (worker === undefined) {
    this.logger.warn({ taskId }, 'Cannot preserve: worker not found');
    return;
  }

  this.preservedWorkers.set(taskId, {
    containerId: worker.containerId,
    taskId,
    preservedAt: new Date().toISOString(),
  });
  this.workers.delete(taskId);

  // Clean up secrets but keep container running
  const taskSecretsPath = path.join(this.config.secretsBasePath, taskId);
  try {
    await fs.promises.rm(taskSecretsPath, { recursive: true, force: true });
  } catch (err: unknown) {
    this.logger.error({ taskId, error: err, path: taskSecretsPath }, 'Failed to remove task secrets for preserved worker');
  }

  this.logger.info({ taskId, containerId: worker.containerId }, 'Worker preserved for debugging');
}
```

4. Add `listPreservedWorkers` method:

```typescript
async listPreservedWorkers(): Promise<PreservedWorkerEntry[]> {
  return Array.from(this.preservedWorkers.values());
}
```

5. Update `IsolationProvider` interface in `types.ts` to add:

```typescript
preserveWorker?(taskId: string): Promise<void>;
listPreservedWorkers?(): Promise<Array<{ containerId: string; taskId: string; preservedAt: string }>>;
```

**Step 4: Update task-dispatcher finalizeTask**

In `task-dispatcher.ts`, change `finalizeTask` (line ~767-780):

Replace:

```typescript
const preserveContainer =
  this.preserveFailedContainers && (finalStatus === 'failed' || finalStatus === 'interrupted');
```

With logic that calls `provider.preserveWorker(taskId)` instead of passing `preserveContainer` to `teardownAttempt`:

```typescript
const shouldPreserve =
  this.preserveFailedContainers && (finalStatus === 'failed' || finalStatus === 'interrupted');

if (shouldPreserve) {
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Preserving worker container for debugging: taskId=${task.taskId} status=${finalStatus}`
  );
  await this.isolation.provider.preserveWorker?.(task.taskId);
} else {
  await this.teardownAttempt(task.taskId, false);
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS

**Step 6: Commit**

```
orchestrator: split active/preserved worker tracking for concurrency
```

---

### Task 2: Readiness Gate Before First Attempt

**Files:**

- Modify: `workers/claude-worker/entrypoint.sh:176-186` (add readiness marker)
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts:273-327` (add readiness wait)
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts:7-19` (DockerProviderConfig)
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

**Step 1: Add readiness marker to entrypoint.sh**

After dependency install (line 176) and before managed idle loop (line 181), add:

```bash
# Write readiness marker after all startup tasks complete
echo "[entrypoint] Writing readiness marker"
touch /tmp/worker-ready
```

Also add defensive check at top of `run-attempt` handler (after line ~70):

```bash
if [ ! -f "/tmp/worker-ready" ]; then
    echo "[entrypoint] ERROR: Worker not ready — readiness marker missing"
    exit 1
fi
```

**Step 2: Write failing tests for readiness gate**

In `docker-provider.test.ts`:

```typescript
describe('readiness gate', () => {
  it('waits for readiness marker after container start', async () => {
    const provider = new TestableDockerProvider(
      createTestConfig({ managedAttemptsMode: true }),
      mockLogger
    );
    const config = createWorkerConfig({ taskId: 'task-1' });
    await provider.createWorker(config);

    // Verify exec was called to check readiness
    expect(mockContainer.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining(['test', '-f', '/tmp/worker-ready']),
      })
    );
  });

  it('fails with readiness timeout error and cleans up', async () => {
    // Mock exec to always return exit code 1 (file not found)
    mockContainer.exec.mockResolvedValue({
      start: vi.fn().mockResolvedValue(createMockExecStream()),
      inspect: vi.fn().mockResolvedValue({ ExitCode: 1 }),
    });

    const provider = new TestableDockerProvider(
      createTestConfig({
        managedAttemptsMode: true,
        workerReadyTimeoutMs: 100, // very short for test
      }),
      mockLogger
    );

    await expect(provider.createWorker(createWorkerConfig({ taskId: 'task-1' }))).rejects.toThrow(
      /readiness/i
    );
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: FAIL — no readiness check exists

**Step 4: Implement readiness gate in DockerProvider**

1. Add `workerReadyTimeoutMs` to `DockerProviderConfig` (default: `600_000`):

```typescript
workerReadyTimeoutMs: number;
```

2. Add `waitForWorkerReady` private method:

```typescript
private async waitForWorkerReady(taskId: string, container: Docker.Container): Promise<void> {
  const timeoutMs = this.config.workerReadyTimeoutMs;
  const pollIntervalMs = 2000;
  const startTime = Date.now();

  this.logger.info({ taskId, timeoutMs }, 'Waiting for worker readiness');

  while (Date.now() - startTime < timeoutMs) {
    try {
      const execInstance = await container.exec({
        Cmd: ['test', '-f', '/tmp/worker-ready'],
        AttachStdout: false,
        AttachStderr: false,
        Tty: false,
      });
      const execStream = await execInstance.start({ hijack: false, stdin: false });
      const exitCode = await this.waitForExecCompletion(taskId, execInstance, execStream);
      if (exitCode === 0) {
        this.logger.info({ taskId, elapsedMs: Date.now() - startTime }, 'Worker ready');
        return;
      }
    } catch (error) {
      this.logger.debug({ taskId, error }, 'Readiness check failed, retrying');
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Worker readiness timeout after ${String(timeoutMs)}ms`);
}
```

3. In `createWorker`, after `assertManagedEntrypointSupport` (line ~289) and before creating WorkerEntry, call:

```typescript
await this.waitForWorkerReady(taskId, container);
```

4. Wrap the section from `container.start()` through WorkerEntry creation in try/catch that cleans up `taskSecretsPath`, `taskSessionPath`, and container on failure.

**Step 5: Run tests to verify they pass**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS

**Step 6: Commit**

```
orchestrator: add readiness gate before first worker attempt
```

---

### Task 3: Startup Failure Cleanup Hardening

**Files:**

- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts:119-348` (createWorker try/finally)
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

**Step 1: Write failing tests**

```typescript
describe('startup failure cleanup', () => {
  it('cleans up secrets and session dirs on image pull failure', async () => {
    mockDocker.pull.mockRejectedValue(new Error('pull failed'));
    const provider = new TestableDockerProvider(createTestConfig(), mockLogger);

    await expect(provider.createWorker(createWorkerConfig({ taskId: 'task-1' }))).rejects.toThrow(
      'pull failed'
    );

    // Verify directories were cleaned up
    expect(fs.promises.rm).toHaveBeenCalledWith(
      expect.stringContaining('task-1'),
      expect.objectContaining({ recursive: true, force: true })
    );
  });

  it('cleans up secrets, session dirs, and container on readiness failure', async () => {
    // readiness check always fails
    // Verify container.remove, fs.rm for secrets and session dirs
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run verify:workspace:tracked -- orchestrator`

**Step 3: Implement cleanup hardening**

Wrap the body of `createWorker` (after `taskSecretsPath`/`taskSessionPath` creation at line ~167) in a try/catch with cleanup:

```typescript
let container: Docker.Container | undefined;
try {
  // ... existing code: pull image, create container, start, readiness, etc.
} catch (error) {
  // Clean up secrets dir
  await fs.promises.rm(taskSecretsPath, { recursive: true, force: true }).catch((e) => {
    this.logger.warn({ taskId, error: e }, 'Failed to clean up task secrets on startup failure');
  });
  // Clean up session dir
  await fs.promises.rm(taskSessionPath, { recursive: true, force: true }).catch((e) => {
    this.logger.warn({ taskId, error: e }, 'Failed to clean up task session on startup failure');
  });
  // Remove partially created container
  if (container !== undefined) {
    try {
      await container.remove({ force: true });
    } catch (e) {
      this.logger.warn({ taskId, error: e }, 'Failed to remove container on startup failure');
    }
  }
  throw error;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm run verify:workspace:tracked -- orchestrator`

**Step 5: Commit**

```
orchestrator: harden startup failure cleanup for secrets and containers
```

---

### Task 4: Image Digest Logging Enhancement

**Files:**

- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts:558-607` (pullAndResolveImage)
- Modify: `workers/orchestrator/src/routes.ts` (add `/meta/worker-image` endpoint)
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

**Step 1: Write failing tests**

```typescript
it('logs mutable tag warning when image uses :latest', async () => {
  const provider = new TestableDockerProvider(
    createTestConfig({ imageName: 'registry/image:latest' }),
    mockLogger
  );
  await provider.createWorker(createWorkerConfig({ taskId: 'task-1' }));
  expect(mockLogger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ imageName: expect.stringContaining(':latest') }),
    expect.stringContaining('mutable tag')
  );
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement**

1. In `pullAndResolveImage`, after resolving the digest, add mutable tag warning:

```typescript
if (imageName.includes(':latest') || !imageName.includes('@sha256:')) {
  this.logger.warn(
    { taskId, imageName },
    'Worker image uses mutable tag — consider pinning to digest for reproducibility'
  );
}
```

2. Store last resolved digest as instance field for the `/meta/worker-image` endpoint:

```typescript
private lastResolvedDigest: string | null = null;
```

3. Add `getImageInfo()` method returning `{ configuredRef, lastResolvedDigest, pullPolicy, managedAttemptsMode }`.

4. In `routes.ts`, add read-only `GET /meta/worker-image` endpoint (no auth required):

```typescript
app.get('/meta/worker-image', async (_request, reply) => {
  const info = isolationProvider.getImageInfo?.() ?? null;
  reply.send(info ?? { error: 'Not available' });
});
```

**Step 4: Run tests**

Run: `pnpm run verify:workspace:tracked -- orchestrator`

**Step 5: Commit**

```
orchestrator: add image digest logging and /meta/worker-image endpoint
```

---

## Phase 2: Log Protocol v2 (Spool + ACK + Idempotency)

### Task 5: Code-Agent ACK Response and Deterministic Doc IDs

**Files:**

- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:379-540` (response payload)
- Modify: `apps/code-agent/src/infra/repositories/firestoreLogChunkRepository.ts:36-40` (doc ID)
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/repositories/firestoreLogChunkRepository.test.ts`

**Step 1: Write failing tests for deterministic doc IDs**

```typescript
it('uses zero-padded sequence as doc ID for idempotent writes', async () => {
  const chunk: LogChunk = {
    id: 'ignored',
    sequence: 42,
    content: 'test log',
    timestamp: Timestamp.now(),
    size: 8,
  };
  await repo.storeBatch('task-1', [chunk]);

  expect(mockFirestore.collection).toHaveBeenCalledWith('code_tasks');
  // Verify doc ID is zero-padded sequence
  expect(mockDoc).toHaveBeenCalledWith('000000000042');
});
```

Write failing test for ACK response:

```typescript
it('returns acknowledgedSequences in response', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/internal/logs',
    headers: validHeaders,
    payload: {
      taskId: 'task-1',
      chunks: [
        { sequence: 0, content: 'line 1', timestamp: new Date().toISOString() },
        { sequence: 1, content: 'line 2', timestamp: new Date().toISOString() },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  expect(body.received).toBe(true);
  expect(body.acknowledgedSequences).toEqual([0, 1]);
  expect(body.count).toBe(2);
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm run verify:workspace:tracked -- code-agent`

**Step 3: Implement deterministic doc IDs**

In `firestoreLogChunkRepository.ts`, change `.doc()` to `.doc(String(chunk.sequence).padStart(12, '0'))`:

```typescript
const docRef = this.firestore
  .collection('code_tasks')
  .doc(taskId)
  .collection('logs')
  .doc(String(chunk.sequence).padStart(12, '0'));
```

**Step 4: Implement ACK response**

In `webhookRoutes.ts`, change the response (line ~538):

```typescript
const acknowledgedSequences = body.chunks.map((c) => c.sequence);
reply.send({
  received: true,
  acknowledgedSequences,
  count: acknowledgedSequences.length,
});
```

Update response schema (line ~416) to include new fields.

**Step 5: Run tests to verify they pass**

Run: `pnpm run verify:workspace:tracked -- code-agent`

**Step 6: Commit**

```
code-agent: add deterministic doc IDs and ACK response for log chunks
```

---

### Task 6: Orchestrator Log Spool and Monotonic Sequence

**Files:**

- Modify: `workers/orchestrator/src/services/log-forwarder.ts` (major rewrite of state management)
- Test: `workers/orchestrator/src/services/__tests__/log-forwarder.test.ts`

**Step 1: Write failing tests for monotonic sequence across flushes**

```typescript
describe('monotonic sequence', () => {
  it('never resets sequence after flushAndStop and new appendChunk', async () => {
    forwarder.registerTask('task-1', 'secret-1');
    forwarder.appendChunk('task-1', 'line 1\n');
    await forwarder.flushAndStop('task-1');

    // Append again (simulates retry or new attempt)
    forwarder.appendChunk('task-1', 'line 2\n');
    await forwarder.flush('task-1');

    // Verify second batch starts from sequence 1, not 0
    const calls = fetchMock.calls();
    const firstBatch = JSON.parse(calls[0].body);
    const secondBatch = JSON.parse(calls[1].body);
    expect(firstBatch.chunks[0].sequence).toBe(0);
    expect(secondBatch.chunks[0].sequence).toBe(1);
  });
});
```

**Step 2: Write failing tests for drain barrier**

```typescript
describe('drain barrier', () => {
  it('awaitDrain resolves when all chunks are acknowledged', async () => {
    forwarder.registerTask('task-1', 'secret-1');
    forwarder.appendChunk('task-1', 'data\n');
    fetchMock.mockResponseOnce(
      JSON.stringify({
        received: true,
        acknowledgedSequences: [0],
        count: 1,
      })
    );
    await forwarder.flush('task-1');
    await expect(forwarder.awaitDrain('task-1', 5000)).resolves.toBeUndefined();
  });

  it('awaitDrain rejects on timeout with pending sequences', async () => {
    forwarder.registerTask('task-1', 'secret-1');
    forwarder.appendChunk('task-1', 'data\n');
    fetchMock.mockResponseOnce('', { status: 500 });
    await forwarder.flush('task-1');
    await expect(forwarder.awaitDrain('task-1', 100)).rejects.toThrow(/drain timeout/i);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm run verify:workspace:tracked -- orchestrator`

**Step 4: Implement monotonic sequence and drain barrier**

Key changes to `LogForwarder`:

1. **Replace per-task sequence tracking**: Instead of deleting state in `flushAndStop`, preserve `sequence` counter in a separate map `taskSequences: Map<string, number>` that persists across flush/stop cycles.

2. **Track ACK state**: Add `lastAckedSequence` and `lastProducedSequence` fields:

```typescript
private readonly taskSequences = new Map<string, { produced: number; acked: number }>();
```

3. **Parse ACK response** in `sendWithRetry`:

```typescript
if (response.ok) {
  const ackBody = (await response.json()) as { acknowledgedSequences?: number[] };
  return { success: true, acknowledgedSequences: ackBody.acknowledgedSequences ?? [] };
}
```

4. **Update sendBatch** to track acked sequences:

```typescript
if (result.success) {
  state.sequence += chunks.length;
  state.chunksSent += chunks.length;
  // Update acked tracking
  const seqState = this.taskSequences.get(taskId);
  if (seqState !== undefined) {
    seqState.produced = state.sequence;
    const maxAcked = Math.max(...result.acknowledgedSequences);
    seqState.acked = Math.max(seqState.acked, maxAcked);
  }
}
```

5. **Add `flush(taskId)` method** (separate from `flushAndStop`):

```typescript
async flush(taskId: string): Promise<void> {
  await this.flushBuffer(taskId, true);
}
```

6. **Add `awaitDrain(taskId, timeoutMs)` method**:

```typescript
async awaitDrain(taskId: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const seqState = this.taskSequences.get(taskId);
    if (seqState === undefined || seqState.acked >= seqState.produced - 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const seqState = this.taskSequences.get(taskId);
  throw new Error(
    `Log drain timeout after ${String(timeoutMs)}ms: produced=${String(seqState?.produced ?? 0)} acked=${String(seqState?.acked ?? 0)}`
  );
}
```

7. **Update `flushAndStop`** to NOT delete sequence tracking (only delete buffer state):

```typescript
async flushAndStop(taskId: string): Promise<void> {
  // ... existing flush logic ...
  // Delete forwarding state but keep sequence tracking
  this.forwarders.delete(taskId);
  // DO NOT delete from taskSequences — sequence must survive across attempts
}
```

8. **Add `close(taskId)` method** for final cleanup (called after drain or terminal fail):

```typescript
close(taskId: string): void {
  this.forwarders.delete(taskId);
  this.taskSequences.delete(taskId);
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm run verify:workspace:tracked -- orchestrator`

**Step 6: Commit**

```
orchestrator: monotonic log sequence and drain barrier for reliable delivery
```

---

### Task 7: Finalization Drain Barrier in Task Dispatcher

**Files:**

- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:762-811` (finalizeTask)
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:53-57` (CompletionControlConfig)
- Modify: `workers/orchestrator/src/start.ts` (add `logDrainTimeoutMs` config)
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Step 1: Write failing tests**

```typescript
describe('log drain barrier', () => {
  it('waits for log drain before sending terminal webhook', async () => {
    // Submit task, trigger completion, verify awaitDrain called before webhook
  });

  it('forces task failure with LOG_DELIVERY_FAILED when drain times out', async () => {
    // Submit task, make drain timeout, verify webhook has LOG_DELIVERY_FAILED error code
  });
});
```

**Step 2: Run tests, verify fail**

**Step 3: Implement**

1. Add `logDrainTimeoutMs` to `CompletionControlConfig`:

```typescript
export interface CompletionControlConfig {
  maxAttempts: number;
  verifier: CompletionVerifier;
  preserveFailedContainers?: boolean;
  logDrainTimeoutMs?: number;
}
```

2. In `finalizeTask`, before sending the terminal webhook, add drain barrier:

```typescript
// Drain log delivery
try {
  await this.logForwarder.flush(task.taskId);
  await this.logForwarder.awaitDrain(task.taskId, this.logDrainTimeoutMs);
} catch (drainError) {
  this.logger.error({ taskId: task.taskId, error: drainError }, 'Log drain failed');
  finalStatus = 'failed';
  payload.error = {
    code: 'LOG_DELIVERY_FAILED',
    message: drainError instanceof Error ? drainError.message : String(drainError),
  };
}
this.logForwarder.close(task.taskId);
```

3. In `start.ts`, wire `logDrainTimeoutMs` from env:

```typescript
const logDrainTimeoutMs = parseInt(getOptionalEnv('INTEXURAOS_LOG_DRAIN_TIMEOUT_MS', '30000'), 10);
```

**Step 4: Run tests, verify pass**

Run: `pnpm run verify:workspace:tracked -- orchestrator`

**Step 5: Commit**

```
orchestrator: add log drain barrier before terminal task webhook
```

---

## Phase 3: Operational Hardening

### Task 8: Task Log Event Contract (Observability)

**Files:**

- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (add structured log events)
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts` (add structured log events)

**Step 1: Audit existing log events against the required contract**

The plan requires these task-log events:

- dispatch accepted ✅ (exists in `submitTask`)
- container create started/finished — add
- image pull requested/resolved ✅ (exists in `pullAndResolveImage`)
- readiness wait start/success/failure — added in Task 2
- attempt start/complete ✅ (exists)
- verification request start + verdict summary ✅ (exists)
- retry decision and reason ✅ (exists)
- log delivery stats (produced/acked/pending) — add
- terminal finalize reason ✅ (exists)

**Step 2: Add missing log events**

In `docker-provider.ts createWorker`, add structured task log calls:

```typescript
this.logger.info({ taskId }, 'Container creation started');
// ... after container.start():
this.logger.info({ taskId, containerId: container.id }, 'Container creation finished');
```

In `task-dispatcher.ts finalizeTask`, after drain:

```typescript
const logStats = this.logForwarder.getDeliveryStats(task.taskId);
this.appendOrchestratorTaskLog(
  task.taskId,
  `Log delivery stats: produced=${String(logStats.produced)} acked=${String(logStats.acked)} pending=${String(logStats.pending)}`
);
```

**Step 3: Add `getDeliveryStats` to LogForwarder**

```typescript
getDeliveryStats(taskId: string): { produced: number; acked: number; pending: number } {
  const seqState = this.taskSequences.get(taskId);
  if (seqState === undefined) return { produced: 0, acked: 0, pending: 0 };
  return {
    produced: seqState.produced,
    acked: seqState.acked,
    pending: seqState.produced - seqState.acked,
  };
}
```

**Step 4: Run full verification**

Run: `pnpm run verify:workspace:tracked -- orchestrator`

**Step 5: Commit**

```
orchestrator: complete task log event contract for observability
```

---

### Task 9: Final Verification

**Step 1: Run full CI**

```bash
pnpm run ci:tracked
```

**Step 2: Check terraform changes**

```bash
git diff --name-only HEAD~1 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"
```

**Step 3: Verify no new env vars without registration**

If any new env vars were added (`INTEXURAOS_WORKER_READY_TIMEOUT_MS`, `INTEXURAOS_LOG_DRAIN_TIMEOUT_MS`), verify they are:

1. In `src/start.ts` (already using `getOptionalEnv` with defaults — no REQUIRED_ENV needed)
2. In `ecosystem.config.cjs` if needed for local dev
3. In terraform if they need cloud deployment values

Since both use `getOptionalEnv` with sensible defaults, they don't need to be in `REQUIRED_ENV` or terraform. Document in DEPLOYMENT.md.

**Step 4: Commit final state**

```
orchestrator: final verification pass for reliability remediation
```
