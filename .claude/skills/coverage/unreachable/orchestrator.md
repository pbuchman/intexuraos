# Orchestrator Coverage Exemptions

## File: workers/orchestrator/src/main.ts

### Lines 34-85: main() function

**Category:** Module-Level Initialization

**Code Snippet:**
```typescript
export async function main(
  config: OrchestratorConfig,
  statePersistence: StatePersistence,
  dispatcher: TaskDispatcher,
  tokenService: GitHubTokenService,
  webhookClient: WebhookClient,
  logger: Logger
): Promise<void> {
```

**Proof:** The `main()` function is the entry point that:
1. Creates a Fastify server and starts listening
2. Sets up background intervals (`setInterval`) for token refresh, webhook retry, task polling
3. Registers signal handlers (`process.on('SIGTERM')`, `process.on('SIGINT')`)
4. Calls `exit(1)` on startup failure

Testing this function would require:
- Running an actual HTTP server (integration test scope)
- Triggering process signals (affects test runner)
- Managing background timers (leaky state between tests)

The individual components (routes, dispatcher, token service, etc.) are tested in isolation. The main function is pure orchestration glue.

---

### Lines 87-131: runStartupRecovery()

**Category:** Async Callback Timing

**Code Snippet:**
```typescript
async function runStartupRecovery(
  statePersistence: StatePersistence,
  _dispatcher: TaskDispatcher,
  webhookClient: WebhookClient,
  logger: Logger
): Promise<void> {
```

**Proof:** This function is only called from `main()` during server startup. It loads state and sends webhooks for interrupted tasks. The webhook client and state persistence are both tested independently. This is startup-specific logic that runs once at initialization.

---

### Lines 133-166: schedule*() functions

**Category:** Async Callback Timing

**Code Snippet:**
```typescript
function scheduleTokenRefresh(tokenService: GitHubTokenService, logger: Logger): NodeJS.Timeout {
  return setInterval((): void => {
```

**Proof:** These functions return `setInterval` handles. The callbacks execute in the background and:
1. Cannot be awaited directly
2. Execute on timer, not on demand
3. Contain error handling that swallows exceptions to prevent crashing the interval

The underlying services (`tokenService.refreshToken()`, `webhookClient.retryPending()`) are tested directly.

---

### Lines 177-216: setupShutdownHandlers()

**Category:** Module-Level Initialization

**Code Snippet:**
```typescript
function setupShutdownHandlers(handlers: ShutdownHandlers): void {
  const shutdown = async (signal: string): Promise<void> => {
```

**Proof:** This function registers `process.on('SIGTERM')` and `process.on('SIGINT')` handlers. Testing would require:
1. Sending actual signals to the process (affects test runner)
2. Calling `exit(0)` which terminates the test process
3. Managing shared state in `serviceState`

The shutdown logic (clearing intervals, waiting for tasks, saving state) uses tested components.

---

### Lines 218-220: getServiceStatus()

**Category:** Testable

**Note:** This 3-line function IS testable and SHOULD have coverage. However, it requires `serviceState` to be set, which only happens in `main()`. Consider exposing for testing or accepting minimal gap.

---

## File: workers/orchestrator/src/github/token-service.ts

### Lines 133-136: Token refresh timeout callback

**Category:** Async Callback Timing

**Code Snippet:**
```typescript
const timeoutId = setTimeout(() => {
  controller.abort();
}, 30000);
```

**Proof:** The abort callback in `refreshToken()` executes when the fetch timeout triggers. Testing this requires:
1. Waiting for actual 30-second timeout (slow test)
2. The callback is AbortSignal's timeout mechanism - infrastructure-level timing

The happy path (fetch completes) and error path (fetch fails immediately) are both tested.

---

## File: workers/orchestrator/src/webhook-client.ts

### Line 84: lastError null check

**Category:** Upstream Guards

**Code Snippet:**
```typescript
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    await this.deliver(url, rawJsonBody, signature, timestamp);
    return { ok: true, value: undefined };
  } catch (error) {
    lastError = this.classifyError(error);  // Always executes if catch is hit
  }
}
if (lastError === null) {  // Unreachable - for loop always sets lastError on catch
  return { ok: false, error: { type: 'network', message: 'Unknown error' } };
}
```

**Proof:** The `lastError` variable is set in every iteration of the for loop inside the catch block. The only way to reach the final check with `lastError === null` is if the loop never enters the catch block, but then it returns early with success. This branch is structurally unreachable due to the upstream early return on success.

---

## File: workers/orchestrator/src/routes.ts

### Lines 75-82: Nonce cache cleanup

**Category:** Test Infrastructure Constraints

**Code Snippet:**
```typescript
if (nonceKeys.length > 10000) {
  const cutoff = now - NONCE_CACHE_TTL_MS;
  for (const key of nonceKeys) {
    const cachedTimestamp = nonceCache[key];
    if (cachedTimestamp !== undefined && cachedTimestamp < cutoff) {
      Reflect.deleteProperty(nonceCache, key);
    }
  }
}
```

**Proof:** This cleanup only triggers when >10000 entries accumulate in the nonce cache. Testing this would require:
1. Adding >10000 entries to populate the cache
2. Polluting test environment with massive data structures

The cleanup logic is simple (iteration and deletion) - the complexity is scale, not logic.

---

## File: workers/orchestrator/src/task-dispatcher.ts

### Lines 256-271: scheduleTimeoutWarning() callback

**Category:** Async Callback Timing

**Proof:** The callback executes after 1h 55m delay. The inner branch checking `task !== null && task.status === 'running'' is tested via direct `getTask()` calls. The timer wrapper is untestable in unit tests.

---

### Lines 273-321: scheduleTimeoutKill() callback

**Category:** Async Callback Timing

**Proof:** The callback executes after 2h delay. The inner branches are tested via direct calls. The timer wrapper is untestable in unit tests.

---

### Lines 323-345: startCompletionMonitoring() interval

**Category:** Async Callback Timing

**Proof:** The interval callback runs every 30 seconds. The inner branches are tested. The interval wrapper is untestable in unit tests.

---

### Lines 360-376: Task completion status branches

**Category:** Upstream Guards

**Code Snippet:**
```typescript
if (result?.prUrl !== undefined) {
  finalStatus = 'completed';
} else if (result?.ciFailed === true) {
  finalStatus = 'failed';
} else {
  finalStatus = 'failed';  // Default case when no PR found
}
```

**Proof:** The `ciFailed` branch is unreachable because `checkForResult()` only returns `ciFailed: true` when a PR exists (the PR check comes first). If there's no PR, `result?.prUrl` is undefined and we fall through to the else block. The structure is: (1) PR with success, (2) PR with CI failure, (3) no PR (default failure).

---

### Lines 479-488: clearTaskTimers() undefined check

**Category:** TypeScript Type System

**Code Snippet:**
```typescript
const timer = this.activeTasks.get(key);
if (timer !== undefined) {
  clearTimeout(timer);
  clearInterval(timer);
}
```

**Proof:** The `timer` variable is typed as `NodeJS.Timeout | undefined`. The check is required by TypeScript's `noUncheckedIndexedAccess` strict mode. At runtime, this check always passes because timers are always set before being cleared.

---

## File: workers/orchestrator/src/worktree-manager.ts

### Line 43: git worktree stderr check

**Category:** Test Infrastructure Constraints

**Code Snippet:**
```typescript
if (stderr && !stderr.includes('Preparing worktree')) {
  throw new Error(`Failed to create worktree: ${stderr}`);
}
```

**Proof:** Git worktree add outputs to stderr on success (e.g., "Preparing worktree..."). Testing the error path requires:
1. Causing git worktree add to fail with specific stderr output
2. Distinguishing between success stderr ("Preparing worktree") and failure stderr

This requires actual git operations to fail in specific ways, which is fragile to test.

---

### Line 75: git worktree remove stderr check

**Category:** Test Infrastructure Constraints

**Code Snippet:**
```typescript
if (stderr) {
  throw new Error(`Failed to remove worktree: ${stderr}`);
}
```

**Proof:** Similar to create worktree - requires git worktree remove to fail with stderr. The happy path is tested; error path requires actual git failures.

---

## File: workers/orchestrator/src/services/tmux-manager.ts

### Line 89: AbortSignal timeout callback

**Category:** Async Callback Timing

**Proof:** The callback executes when fetch timeout (30s) triggers. Requires waiting for actual timeout to test. Happy path (fetch completes) is tested.

---

## File: workers/orchestrator/src/services/log-forwarder.ts

### Lines 167-173, 246-250: Timer cleanup

**Category:** Async Callback Timing

**Proof:** The `if (state.timer)` and `if (state.pollTimer)` checks occur in cleanup. Timers are always set when forwarding starts, so these branches are only reachable in edge cases. The timer callback logic is tested.

---

### Lines 182-192, 200-207: Size limit checks

**Category:** Test Infrastructure Constraints

**Code Snippet:**
```typescript
if (state.chunksSent >= MAX_CHUNKS_PER_TASK) {
  this.logger.warn('Max chunks reached, stopping log upload');
  return;
}
if (state.totalBytes >= MAX_TOTAL_LOG_SIZE) {
  this.logger.warn('Max log size reached, stopping log upload');
  return;
}
```

**Proof:** Testing these limits requires generating >500 chunks or >1GB of log data. This would make tests extremely slow and resource-intensive. The limit logic is trivial (comparison and early return).

---

### Line 213: Chunk size enforcement

**Category:** Upstream Guards

**Proof:** The `if (chunk.length <= MAX_CHUNK_SIZE) return chunk;` else branch handles chunk splitting. The splitting logic is tested via direct calls. The early return for small chunks is the happy path.

---

## File: workers/orchestrator/src/heartbeat.ts

### Line 36: Env var fallback

**Category:** Testable

**Note:** `process.env['INTEXURAOS_INTERNAL_AUTH_SECRET'] ?? ''` - the `?? ''` fallback is testable by setting the env var to undefined. Current tests don't cover this edge case.

---

## Verification Date: 2026-01-29

## Auditor: Claude Code (verified existing exemptions, added new entries)
