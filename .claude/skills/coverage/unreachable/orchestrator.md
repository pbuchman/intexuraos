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

## Verification Date: 2026-01-26

## Auditor: Claude Code
