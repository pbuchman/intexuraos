# Interactive "Ask Agent" MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new interactive "Ask Agent" agent type that provides a conversational interface over non-interactive Claude Code, reusing the existing code task infrastructure (log viewer, --continue, task pool, orchestrator routing).

**Architecture:** Three services are modified in parallel: the web app (new page + sidebar item), code-agent (new endpoint + agent type), and orchestrator (new system prompt + completion handling). The `ask_agent` type is hidden from regular task creation flows and accessed only through its dedicated page at `/#/code-tasks/ask-agent`. It always uses the `opus` worker type, leverages the existing `--continue` mechanism for multi-turn conversations, and has no Linear issue integration. Each turn is a separate code task run that preserves the session for 3 hours.

**Tech Stack:** TypeScript, React, Fastify, Zod, Vitest, Firestore

---

## Shared Contract

All three services must agree on the following contract. Each subtask agent MUST read this section and implement accordingly.

### New Agent Type Value

```typescript
// Added to every place where AgentType is defined or validated:
'ask_agent'

// Full union after change:
type AgentType = 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent';
```

### New API Endpoint

```
POST /code/ask-agent/start
Auth: Auth0 JWT (same as POST /code/submit)
```

**Request body:**
```typescript
{
  prompt: string;  // The user's message (1–100000 chars)
}
```

**Success response (200):**
```typescript
{
  success: true;
  data: {
    status: 'submitted';
    codeTaskId: string;  // e.g. "task_<uuid>"
  }
}
```

**Error responses:** Same envelope as POST /code/submit — 401 (unauthorized), 429 (rate limited), 503 (queue full / misconfigured), 500 (internal error).

### Task Properties for ask_agent

When `agentType === 'ask_agent'`, the task has these fixed properties:
- `workerType`: always `'opus'` (hardcoded, not user-selectable)
- `linearIssueId`: always `undefined` (no Linear issue)
- `baseBranch`: `'development'`
- `repository`: `'pbuchman/intexuraos'`
- `agentType`: `'ask_agent'`

### Terminal Status

The orchestrator sends `status: 'implemented'` in the webhook callback when an ask_agent task finishes successfully. This reuses the existing terminal status — no new status value is needed.

### Continuation Protocol

Multi-turn conversation uses the existing --continue mechanism:
1. First message: `POST /code/ask-agent/start` creates a new task
2. Subsequent messages: `POST /code/tasks/{taskId}/messages` resumes via --continue
3. Cancel: `POST /code/cancel` with `{ taskId }`
4. View: `GET /code/tasks/{taskId}` (existing)

### Filtering from Task Lists

Tasks with `agentType === 'ask_agent'` MUST be excluded from:
- `GET /code/tasks` response (the main code tasks list)
- `POST /code/issue-groups` response (issue grouping)
- The `CodeTaskNewPage` UI (no "ask_agent" in the agent type / task creation list)

### Orchestrator Completion Handling

The orchestrator MUST:
- Recognize `agentType === 'ask_agent'` and use the `askAgentPrompt` system prompt
- Skip structured completion block verification (ask_agent has no `PLANNING_AGENT_FINAL` etc.)
- Finalize the task with `status: 'implemented'` and extract a summary from the last lines of logs
- Label the agent as "Ask Agent" in orchestrator logs

### System Prompt Behavior

The ask_agent system prompt tells the agent:
- It is an interactive code assistant
- Respond to user messages directly and helpfully
- Do NOT proactively create PRs, Linear issues, or commits unless explicitly asked
- Do NOT output structured completion blocks
- Complete the response fully, then stop — the user will send a follow-up via --continue

---

## Subtask 1: Frontend (apps/web)

**Service boundary:** `apps/web/`
**Depends on backend contract:** `POST /code/ask-agent/start` endpoint, task `agentType` field, existing endpoints for task view/messages/cancel.

### Task 1.1: Add API Client Function

**Files:**
- Modify: `apps/web/src/services/codeAgentApi.ts`
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1: Add type to `types/index.ts`**

Open `apps/web/src/types/index.ts` and add after the `SubmitCodeTaskResponse` interface (around line 1260):

```typescript
/**
 * Response from POST /code/ask-agent/start
 */
export interface AskAgentStartResponse {
  status: 'submitted';
  codeTaskId: string;
}
```

- [ ] **Step 2: Add API function to `codeAgentApi.ts`**

Open `apps/web/src/services/codeAgentApi.ts` and add a new import for `AskAgentStartResponse` in the type imports block, then add this function at the end of the file (before the final closing):

```typescript
/**
 * Start a new Ask Agent session
 */
export async function startAskAgent(
  accessToken: string,
  request: { prompt: string }
): Promise<AskAgentStartResponse> {
  return await apiRequest<AskAgentStartResponse>(config.codeAgentUrl, '/code/ask-agent/start', accessToken, {
    method: 'POST',
    body: request,
  });
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/services/codeAgentApi.ts apps/web/src/types/index.ts
git commit -m "feat(web): add startAskAgent API client function"
```

### Task 1.2: Add Sidebar Navigation Item

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Add menu item**

Open `apps/web/src/components/Sidebar.tsx`. Find the `codeTasksItems` array (around line 83). Add the `Bot` icon to the lucide-react imports at the top of the file. Then add a new item to the array:

```typescript
// Before (lines 83-89):
const codeTasksItems: NavItem[] = [
  { to: '/code-tasks', label: 'Battlefield', icon: List },
  { to: '/code-tasks/new', label: 'New Task', icon: Plus },
  { to: '/code-tasks/dispatch-queue', label: 'Dispatch Queue', icon: Clock },
  { to: '/code-tasks/pr-events', label: 'GitHub Event Log', icon: RadioTower },
  { to: '/code-tasks/merge-queue', label: 'Merge Queue', icon: GitMerge },
];

// After:
const codeTasksItems: NavItem[] = [
  { to: '/code-tasks', label: 'Battlefield', icon: List },
  { to: '/code-tasks/new', label: 'New Task', icon: Plus },
  { to: '/code-tasks/ask-agent', label: 'Ask Agent', icon: Bot },
  { to: '/code-tasks/dispatch-queue', label: 'Dispatch Queue', icon: Clock },
  { to: '/code-tasks/pr-events', label: 'GitHub Event Log', icon: RadioTower },
  { to: '/code-tasks/merge-queue', label: 'Merge Queue', icon: GitMerge },
];
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter web build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add Ask Agent sidebar navigation item"
```

### Task 1.3: Create useAskAgent Hook

**Files:**
- Create: `apps/web/src/hooks/useAskAgent.ts`

This hook manages the ask agent session state: current task ID, starting new sessions, continuing conversations, cancelling, and clearing.

- [ ] **Step 1: Create the hook file**

Create `apps/web/src/hooks/useAskAgent.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context';
import { startAskAgent } from '@/services/codeAgentApi';
import { useTaskView } from './useTaskView.js';
import type { CodeTask } from '@/types';

export interface AskAgentState {
  /** Current task ID (null if no session) */
  taskId: string | null;
  /** Current task data (from useTaskView) */
  task: CodeTask | null;
  /** Logs from useTaskView */
  logs: import('./useCodeTaskLogs.js').LogLine[];
  /** Whether a task is loading */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Whether the initial start request is in-flight */
  starting: boolean;
  /** Start error */
  startError: string | null;
  /** Whether cancel is in-flight */
  cancelling: boolean;
  /** Cancel error */
  cancelError: string | null;
  /** Whether agent is currently running (task is running/dispatched/queued) */
  isAgentRunning: boolean;
  /** Whether the session is idle (agent finished its turn) */
  isSessionIdle: boolean;
  /** Whether we can start (no task running) */
  canStart: boolean;
  /** Whether we can cancel (agent is mid-turn) */
  canCancel: boolean;
  /** Whether we can clear (session idle) */
  canClear: boolean;

  // --- Message input state (from useTaskView) ---
  sending: boolean;
  sendError: { code: string; message: string } | null;
  messageStatus: import('./index.js').MessageStatus;

  // --- Actions ---
  /** Start a new ask agent task with the given prompt */
  start: (prompt: string) => Promise<void>;
  /** Send a follow-up message (--continue) */
  sendMessage: (message: string) => Promise<void>;
  /** Cancel the running task */
  cancel: () => Promise<void>;
  /** Clear the session (reset to fresh state) */
  clear: () => void;

  // --- Log viewer props ---
  listenerHealthy: boolean;
  workerOnline: boolean;
  workerName: string;
}

const ACTIVE_STATUSES = new Set(['queued', 'dispatched', 'running']);
const TERMINAL_STATUSES = new Set([
  'planned', 'implemented', 'reviewed', 'failed', 'cancelled', 'interrupted',
]);

export function useAskAgent(): AskAgentState {
  const { getAccessToken } = useAuth();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // useTaskView handles real-time log streaming, task polling, messaging, and cancellation
  const {
    task,
    logs,
    loading,
    error,
    listenerHealthy,
    cancelling,
    cancelError,
    sending,
    sendError,
    messageStatus,
    cancelTask: cancelTaskFromView,
    sendMessage: sendMessageFromView,
  } = useTaskView(taskId ?? '');

  const isAgentRunning = task !== null && ACTIVE_STATUSES.has(task.status);
  const isSessionIdle = task !== null && TERMINAL_STATUSES.has(task.status);
  const canStart = !isAgentRunning && !starting;
  const canCancel = isAgentRunning;
  const canClear = isSessionIdle && !starting;

  const start = useCallback(async (prompt: string): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      const token = await getAccessToken();
      const response = await startAskAgent(token, { prompt });
      setTaskId(response.codeTaskId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start ask agent';
      setStartError(message);
    } finally {
      setStarting(false);
    }
  }, [getAccessToken]);

  const sendMessage = useCallback(async (message: string): Promise<void> => {
    if (taskId === null) {
      // No existing task — start a new one with this message
      await start(message);
      return;
    }
    if (isSessionIdle) {
      // Task finished — use --continue via sendMessage
      await sendMessageFromView(message);
      return;
    }
    // Task is running — queue message
    await sendMessageFromView(message);
  }, [taskId, isSessionIdle, start, sendMessageFromView]);

  const cancel = useCallback(async (): Promise<void> => {
    await cancelTaskFromView();
  }, [cancelTaskFromView]);

  const clear = useCallback((): void => {
    setTaskId(null);
    setStartError(null);
  }, []);

  const workerOnline = true; // Simplified for MVP — worker status handled by useTaskView
  const workerName = task?.workerLocation ?? '';

  return {
    taskId,
    task,
    logs,
    loading: taskId !== null && loading,
    error: taskId !== null ? error : null,
    starting,
    startError,
    cancelling,
    cancelError,
    isAgentRunning,
    isSessionIdle,
    canStart,
    canCancel,
    canClear,
    sending,
    sendError,
    messageStatus,
    start,
    sendMessage,
    cancel,
    clear,
    listenerHealthy,
    workerOnline,
    workerName,
  };
}
```

- [ ] **Step 2: Export from hooks index**

Open `apps/web/src/hooks/index.ts` and add the export:

```typescript
export { useAskAgent } from './useAskAgent.js';
export type { AskAgentState } from './useAskAgent.js';
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useAskAgent.ts apps/web/src/hooks/index.ts
git commit -m "feat(web): add useAskAgent hook for session management"
```

### Task 1.4: Create AskAgentPage Component

**Files:**
- Create: `apps/web/src/pages/AskAgentPage.tsx`

This is the main page. It reuses the `CodeTaskLogViewer` component for log display and message input, and adds Start, Cancel, Clear, and Stop buttons below.

- [ ] **Step 1: Create the page file**

Create `apps/web/src/pages/AskAgentPage.tsx`:

```typescript
import { useCallback, useState } from 'react';
import { Loader2, Play, Square, Trash2, XCircle } from 'lucide-react';
import { Layout, Card } from '@/components';
import { CodeTaskLogViewer } from '@/components/code-tasks/CodeTaskLogViewer.js';
import { useAskAgent } from '@/hooks';

export function AskAgentPage(): React.JSX.Element {
  const {
    task,
    logs,
    loading,
    error,
    starting,
    startError,
    cancelling,
    cancelError,
    isAgentRunning,
    isSessionIdle,
    canStart,
    canCancel,
    canClear,
    sending,
    sendError,
    messageStatus,
    start,
    sendMessage,
    cancel,
    clear,
    listenerHealthy,
    workerOnline,
    workerName,
    taskId,
  } = useAskAgent();

  const [inputValue, setInputValue] = useState('');

  const handleStart = useCallback((): void => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) return;
    setInputValue('');
    void start(trimmed);
  }, [inputValue, start]);

  const handleCancel = useCallback((): void => {
    void cancel();
  }, [cancel]);

  const handleClear = useCallback((): void => {
    clear();
    setInputValue('');
  }, [clear]);

  const hasInput = inputValue.trim().length > 0;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Ask Agent</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Interactive conversation with Claude Code. Type a message and click Start.
        </p>
      </div>

      {error !== null ? (
        <Card variant="error" className="mb-4">
          <p>{error}</p>
        </Card>
      ) : null}

      {startError !== null ? (
        <Card variant="error" className="mb-4">
          <p>{startError}</p>
        </Card>
      ) : null}

      {cancelError !== null ? (
        <Card variant="error" className="mb-4">
          <p>{cancelError}</p>
        </Card>
      ) : null}

      {/* Log viewer — reuses the same component as code task view */}
      <CodeTaskLogViewer
        logs={logs}
        isActive={isAgentRunning}
        listenerHealthy={listenerHealthy}
        taskStatus={task?.status ?? 'queued'}
        agentType="ask_agent"
        onSendMessage={taskId !== null ? sendMessage : undefined}
        sending={sending}
        sendError={sendError}
        messageStatus={messageStatus}
        workerOnline={workerOnline}
        workerName={workerName}
        readOnly={taskId === null}
      />

      {/* Input + Start button — shown when no task exists yet */}
      {taskId === null ? (
        <div className="mt-4 space-y-3">
          <textarea
            value={inputValue}
            onChange={(e): void => {
              setInputValue(e.target.value);
            }}
            onKeyDown={(e): void => {
              if (e.key === 'Enter' && !e.shiftKey && canStart && hasInput) {
                e.preventDefault();
                handleStart();
              }
            }}
            placeholder="What would you like to ask Claude?"
            rows={3}
            className="w-full resize-none rounded-lg border border-slate-300 bg-white px-4 py-3 font-mono text-sm leading-relaxed text-slate-900 placeholder-slate-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-500"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleStart}
              disabled={!canStart || !hasInput || starting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start
            </button>
          </div>
        </div>
      ) : null}

      {/* Action buttons — shown when a task exists */}
      {taskId !== null ? (
        <div className="mt-4 space-y-4">
          {/* Primary action buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!canCancel || cancelling}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {cancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Cancel
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={!canClear}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </button>
          </div>

          {/* Stop button — separate section */}
          {isAgentRunning ? (
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <button
                type="button"
                onClick={handleCancel}
                disabled={!canCancel || cancelling}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Stop &amp; Free Worker
              </button>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Kills the task and frees the worker slot.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Layout>
  );
}
```

- [ ] **Step 2: Export from pages/index.ts**

Open `apps/web/src/pages/index.ts` and add the export:

```typescript
export { AskAgentPage } from './AskAgentPage.js';
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AskAgentPage.tsx apps/web/src/pages/index.ts
git commit -m "feat(web): add AskAgentPage component with log viewer and action buttons"
```

### Task 1.5: Add Route to App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add import**

Open `apps/web/src/App.tsx`. In the imports block from `@/pages` (starting around line 21), add `AskAgentPage`:

```typescript
// Add to the import block from '@/pages':
AskAgentPage,
```

- [ ] **Step 2: Add route**

Find the Code Tasks routes section (around line 295, look for `{/* Code Tasks routes */}`). Add the new route BEFORE the `/:id` catch-all route (which is around line 328), but after the `/code-tasks/new` route:

```typescript
      <Route
        path="/code-tasks/ask-agent"
        element={
          <ProtectedRoute>
            <AskAgentPage />
          </ProtectedRoute>
        }
      />
```

**IMPORTANT:** This route MUST be placed BEFORE the `<Route path="/code-tasks/:id" ...>` route, otherwise the `:id` param will capture "ask-agent" as an ID.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): add /code-tasks/ask-agent route"
```

### Task 1.6: Run Full Frontend Verification

- [ ] **Step 1: Run full verification**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: All checks pass.

- [ ] **Step 2: Commit any fixes if needed**

---

## Subtask 2: Backend API (apps/code-agent)

**Service boundary:** `apps/code-agent/`
**Depends on:** Shared contract above. Orchestrator receives `CreateTaskRequest` with `agentType: 'ask_agent'`.

### Task 2.1: Add 'ask_agent' to AgentType

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`

- [ ] **Step 1: Write the failing test**

Create or open the test file for codeTask types. Since this is a type-level change, the "test" is verifying the type compiles. But we should also ensure the type is usable:

Open `apps/code-agent/src/domain/models/codeTask.ts` and update the `AgentType` union (line 18):

```typescript
// Before:
export type AgentType = 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation';

// After:
export type AgentType = 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent';
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter code-agent build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts
git commit -m "feat(code-agent): add ask_agent to AgentType union"
```

### Task 2.2: Create startAskAgent Use Case

**Files:**
- Create: `apps/code-agent/src/domain/usecases/startAskAgent.ts`
- Create: `apps/code-agent/src/__tests__/usecases/startAskAgent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/code-agent/src/__tests__/usecases/startAskAgent.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { startAskAgent } from '../../domain/usecases/startAskAgent.js';
import type { StartAskAgentDeps, StartAskAgentRequest } from '../../domain/usecases/startAskAgent.js';
import { createTestLogger } from '@intexuraos/common-core/test-utils';

function createMockDeps(overrides?: Partial<StartAskAgentDeps>): StartAskAgentDeps {
  return {
    logger: createTestLogger(),
    codeTaskRepo: {
      create: async () => ({
        ok: true as const,
        value: {
          id: 'task_test-123',
          userId: 'user-1',
          status: 'queued' as const,
          prompt: 'test prompt',
          sanitizedPrompt: 'test prompt',
          systemPromptHash: 'default',
          workerType: 'opus' as const,
          workerLocation: 'pending',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_test',
          dedupKey: 'abcdef1234567890',
          callbackReceived: false,
          agentType: 'ask_agent' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    } as never,
    rateLimitService: {
      checkLimits: async () => ({ ok: true as const }),
      recordTaskStart: async () => undefined,
    } as never,
    workerSettingsRepo: {
      getSettings: async () => ({
        ok: true as const,
        value: { workers: [{ name: 'home-mac', url: 'https://worker.example.com', enabled: true }] },
      }),
    } as never,
    taskEnqueueService: {
      enqueue: async () => ({ ok: true as const }),
    } as never,
    orchestratorSecret: 'test-secret',
    ...overrides,
  };
}

describe('startAskAgent', () => {
  it('creates a task with agentType ask_agent and workerType opus', async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const deps = createMockDeps({
      codeTaskRepo: {
        create: async (input: Record<string, unknown>) => {
          capturedInput = input;
          return {
            ok: true as const,
            value: { ...input, id: input.id, createdAt: new Date(), updatedAt: new Date(), callbackReceived: false, dedupKey: 'abc' },
          };
        },
      } as never,
    });

    const request: StartAskAgentRequest = {
      userId: 'user-1',
      prompt: 'How does the authentication system work?',
    };

    const result = await startAskAgent(deps, request);

    expect(result.ok).toBe(true);
    expect(capturedInput).toBeDefined();
    expect(capturedInput!.agentType).toBe('ask_agent');
    expect(capturedInput!.workerType).toBe('opus');
    expect(capturedInput!.linearIssueId).toBeUndefined();
  });

  it('returns error when rate limit exceeded', async () => {
    const deps = createMockDeps({
      rateLimitService: {
        checkLimits: async () => ({
          ok: false as const,
          error: { code: 'concurrent_limit', message: 'Too many tasks' },
        }),
        recordTaskStart: async () => undefined,
      } as never,
    });

    const result = await startAskAgent(deps, { userId: 'user-1', prompt: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate_limited');
    }
  });

  it('returns error when no workers configured', async () => {
    const deps = createMockDeps({
      workerSettingsRepo: {
        getSettings: async () => ({
          ok: true as const,
          value: { workers: [] },
        }),
      } as never,
    });

    const result = await startAskAgent(deps, { userId: 'user-1', prompt: 'test' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('worker_not_configured');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- src/__tests__/usecases/startAskAgent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the use case implementation**

Create `apps/code-agent/src/domain/usecases/startAskAgent.ts`:

```typescript
/**
 * Use case: Start a new Ask Agent session.
 *
 * Creates a code task with agentType 'ask_agent' and workerType 'opus'.
 * No Linear issue is created or linked — this is a standalone interactive session.
 * The task follows the same lifecycle as planning/execution tasks:
 * queued → dispatched → running → implemented (or failed/cancelled/interrupted).
 */

import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { RateLimitService } from '../services/rateLimitService.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import { sanitizePrompt } from '../utils/promptSanitizer.js';

export interface StartAskAgentRequest {
  userId: string;
  prompt: string;
}

export interface StartAskAgentResult {
  codeTaskId: string;
}

export interface StartAskAgentError {
  code: 'rate_limited' | 'misconfigured' | 'worker_not_configured' | 'queue_full' | 'internal_error';
  message: string;
}

export interface StartAskAgentDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  rateLimitService: RateLimitService;
  workerSettingsRepo: WorkerSettingsRepository;
  taskEnqueueService: TaskEnqueueService;
  orchestratorSecret: string;
}

function generateWebhookSecret(orchestratorSecret: string, taskId: string): string {
  return createHmac('sha256', orchestratorSecret).update(taskId).digest('hex');
}

export async function startAskAgent(
  deps: StartAskAgentDeps,
  request: StartAskAgentRequest
): Promise<Result<StartAskAgentResult, StartAskAgentError>> {
  const { logger, codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService, orchestratorSecret } = deps;
  const { userId, prompt } = request;

  // Step 1: Check rate limits
  const limitCheck = await rateLimitService.checkLimits(userId, prompt.length);
  if (!limitCheck.ok) {
    const { error } = limitCheck;
    logger.warn({ userId, error }, 'Rate limit exceeded for ask agent');
    if (error.code === 'service_unavailable') {
      return err({ code: 'misconfigured', message: error.message });
    }
    return err({ code: 'rate_limited', message: error.message });
  }

  // Step 2: Sanitize prompt
  const sanitizedPrompt = sanitizePrompt(prompt);

  // Step 3: Generate task ID and webhook secret
  const taskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(orchestratorSecret, taskId);

  // Step 4: Create the task (no Linear issue)
  const createResult = await codeTaskRepo.create({
    id: taskId,
    userId,
    prompt,
    sanitizedPrompt,
    systemPromptHash: 'ask-agent',
    workerType: 'opus',
    workerLocation: 'pending',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: `trace_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    webhookSecret,
    agentType: 'ask_agent',
  });

  if (!createResult.ok) {
    logger.warn({ error: createResult.error }, 'Failed to create ask agent task');
    return err({ code: 'internal_error', message: createResult.error.message });
  }

  // Step 5: Validate workers
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings');
    return err({ code: 'internal_error', message: 'Failed to fetch worker settings' });
  }

  const settings = settingsResult.value;
  const enabledWorkers = settings?.workers.filter((w) => w.enabled) ?? [];
  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'No workers configured for ask agent');
    return err({ code: 'worker_not_configured', message: 'Please configure your workers in Settings before using Ask Agent' });
  }

  // Step 6: Enqueue
  const enqueueResult = await taskEnqueueService.enqueue({ taskId, userId });
  if (!enqueueResult.ok) {
    if (enqueueResult.error.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  // Step 7: Record for rate limiting
  await rateLimitService.recordTaskStart(userId);

  logger.info({ taskId }, 'Ask agent task created and enqueued');

  return ok({ codeTaskId: taskId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- src/__tests__/usecases/startAskAgent.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/startAskAgent.ts apps/code-agent/src/__tests__/usecases/startAskAgent.test.ts
git commit -m "feat(code-agent): add startAskAgent use case"
```

### Task 2.3: Add POST /code/ask-agent/start Route

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts` (or new test file)

- [ ] **Step 1: Add the route handler**

Open `apps/code-agent/src/routes/codeRoutes.ts`. Find the `POST /code/submit` route (around line 1594). Add the new route BEFORE it (or after it — ordering within the file doesn't matter for Fastify):

```typescript
  // POST /code/ask-agent/start - Start a new Ask Agent session (public, Auth0 JWT)
  fastify.post(
    '/code/ask-agent/start',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'startAskAgent',
        summary: 'Start a new Ask Agent interactive session',
        description:
          'Creates a new code task with agentType ask_agent and workerType opus. ' +
          'No Linear issue is created. The task follows standard lifecycle.',
        tags: ['code-tasks'],
        body: {
          type: 'object',
          properties: {
            prompt: { type: 'string', minLength: 1, maxLength: 100000 },
          },
          required: ['prompt'],
        },
        response: {
          200: {
            description: 'Ask agent session started',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['submitted'] },
                  codeTaskId: { type: 'string' },
                },
                required: ['status', 'codeTaskId'],
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/ask-agent/start',
        includeParams: true,
      });

      const { codeTaskRepo, rateLimitService, workerSettingsRepo, taskEnqueueService } = getServices();
      const body = request.body as { prompt: string };
      /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      request.log.info({ userId, promptLength: body.prompt.length }, 'Starting ask agent session');

      const config = loadConfig();
      const result = await startAskAgent(
        {
          logger: request.log,
          codeTaskRepo,
          rateLimitService,
          workerSettingsRepo,
          taskEnqueueService,
          orchestratorSecret: config.orchestratorSecret,
        },
        { userId, prompt: body.prompt }
      );

      if (!result.ok) {
        const { error } = result;
        if (error.code === 'rate_limited') {
          return await reply.fail('RATE_LIMITED', error.message);
        }
        if (error.code === 'misconfigured') {
          return await reply.fail('MISCONFIGURED', error.message);
        }
        if (error.code === 'worker_not_configured') {
          return await reply.fail('WORKER_NOT_CONFIGURED', error.message);
        }
        if (error.code === 'queue_full') {
          return await reply.fail('QUEUE_FULL', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      request.log.info({ taskId: result.value.codeTaskId }, 'Ask agent session started');

      return await reply.ok({
        status: 'submitted',
        codeTaskId: result.value.codeTaskId,
      });
    }
  );
```

Add the import for `startAskAgent` at the top of the file:

```typescript
import { startAskAgent } from '../domain/usecases/startAskAgent.js';
```

- [ ] **Step 2: Write integration test**

Add a test in the appropriate test file (e.g., `apps/code-agent/src/__tests__/routes/codeRoutes.test.ts` or create a new `askAgent.test.ts`). Follow the pattern from `codeSubmit.test.ts`:

```typescript
describe('POST /code/ask-agent/start', () => {
  it('creates an ask_agent task with workerType opus', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/code/ask-agent/start',
      headers: { authorization: 'Bearer test-token' },
      payload: { prompt: 'How does auth work?' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('submitted');
    expect(body.data.codeTaskId).toMatch(/^task_/);
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/code/ask-agent/start',
      payload: { prompt: 'test' },
    });

    expect(response.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter code-agent test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts apps/code-agent/src/__tests__/routes/
git commit -m "feat(code-agent): add POST /code/ask-agent/start endpoint"
```

### Task 2.4: Filter ask_agent from Task Lists

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Modify: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts` (if needed)

- [ ] **Step 1: Filter from GET /code/tasks**

Find the `GET /code/tasks` route handler in `codeRoutes.ts`. After fetching tasks from the repository, add a filter to exclude ask_agent tasks:

```typescript
// Add after the tasks are fetched from the repository, before returning:
const filteredTasks = tasks.filter((t) => t.agentType !== 'ask_agent');
```

The exact location depends on the route handler structure. Look for where `codeTaskRepo.list()` is called and filter the results before serialization.

- [ ] **Step 2: Filter from POST /code/issue-groups**

Find the `POST /code/issue-groups` route handler. Add a similar filter to exclude ask_agent tasks from issue grouping.

- [ ] **Step 3: Write tests**

Add a test that verifies ask_agent tasks are excluded from the task list:

```typescript
it('excludes ask_agent tasks from GET /code/tasks', async () => {
  const repo = createFirestoreCodeTaskRepository({
    firestore: fakeFirestore as unknown as Firestore,
    logger,
  });

  // Create an ask_agent task
  const askAgentTask = await repo.create({
    userId: 'test-user-id',
    prompt: 'Ask me anything',
    sanitizedPrompt: 'ask me anything',
    systemPromptHash: 'ask-agent-auto',
    workerType: 'opus',
    workerLocation: 'vm',
    repository: 'test/repo',
    baseBranch: 'main',
    traceId: 'trace-ask-agent-filter',
    agentType: 'ask_agent',
  });
  expect(askAgentTask.ok).toBe(true);
  if (!askAgentTask.ok) return;

  // Create a regular planning task for comparison
  const planningTask = await repo.create({
    userId: 'test-user-id',
    prompt: 'Plan something',
    sanitizedPrompt: 'plan something',
    systemPromptHash: 'planning-auto',
    workerType: 'opus',
    workerLocation: 'vm',
    repository: 'test/repo',
    baseBranch: 'main',
    traceId: 'trace-planning-filter',
    agentType: 'planning',
  });
  expect(planningTask.ok).toBe(true);

  const response = await server.inject({
    method: 'GET',
    url: '/code/tasks',
    headers: { authorization: 'Bearer test-token' },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body) as { success: boolean; data: { tasks: { id: string }[] } };
  expect(body.success).toBe(true);

  // Only the planning task should be in the response
  const taskIds = body.data.tasks.map((t) => t.id);
  expect(taskIds).toContain(planningTask.value.id);
  expect(taskIds).not.toContain(askAgentTask.value.id);
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter code-agent test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts
git commit -m "feat(code-agent): filter ask_agent tasks from task list and issue groups"
```

### Task 2.5: Allow ask_agent in sendTaskMessage

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/sendTaskMessage.ts`

The existing `sendTaskMessage` use case already blocks `review` and `remediation` agent types (line 71). `ask_agent` is NOT in the block list, so it already works. Verify this:

- [ ] **Step 1: Verify the code**

Open `apps/code-agent/src/domain/usecases/sendTaskMessage.ts` line 71. Confirm the guard only blocks `review` and `remediation`:

```typescript
if (task.agentType === 'review' || task.agentType === 'remediation') {
```

`ask_agent` is NOT blocked. No code change needed.

- [ ] **Step 2: Write a test confirming ask_agent messages work**

Add a test to the sendTaskMessage test file:

```typescript
it('allows messages to ask_agent tasks', async () => {
  // Create a task with agentType: 'ask_agent', status: 'running'
  // Call sendTaskMessage
  // Verify it succeeds (not rejected with invalid_agent_type)
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter code-agent test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/__tests__/
git commit -m "test(code-agent): verify ask_agent messages are allowed in sendTaskMessage"
```

### Task 2.6: Ensure Callback Handler Accepts ask_agent Terminal Status

**Files:**
- Verify: `apps/code-agent/src/routes/codeRoutes.ts` (PATCH /internal/code-tasks/:taskId)

The callback handler at `PATCH /internal/code-tasks/:taskId` already accepts `status: 'implemented'` (line 1182). Since ask_agent tasks will send `status: 'implemented'` from the orchestrator, no code change is needed.

- [ ] **Step 1: Verify the callback handler**

Open `apps/code-agent/src/routes/codeRoutes.ts` at line 1182. Confirm the status enum includes `'implemented'`:

```typescript
status?: 'planned' | 'implemented' | 'failed' | 'interrupted';
```

`'implemented'` is already there. No change needed.

- [ ] **Step 2: Verify TERMINAL_STATUSES**

Check line 39:
```typescript
const TERMINAL_STATUSES: readonly TaskStatus[] = ['planned', 'implemented', 'reviewed', 'failed', 'cancelled', 'interrupted'];
```

`'implemented'` is already included. No change needed.

### Task 2.7: Run Full Backend Verification

- [ ] **Step 1: Run full verification**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: All checks pass including 100% coverage.

- [ ] **Step 2: Commit any fixes**

---

## Subtask 3: Orchestrator Worker (workers/orchestrator)

**Service boundary:** `workers/orchestrator/`
**Depends on:** Shared contract. Receives `CreateTaskRequest` with `agentType: 'ask_agent'` from code-agent.

### Task 3.1: Add 'ask_agent' to Schemas and Types

**Files:**
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Modify: `workers/orchestrator/src/types/api.ts`

- [ ] **Step 1: Update Zod schema**

Open `workers/orchestrator/src/types/schemas.ts`. Find the `agentType` field in `CreateTaskRequestSchema` (line 66):

```typescript
// Before:
agentType: z.enum(['planning', 'execution', 'pull_request', 'review', 'remediation']).optional(),

// After:
agentType: z.enum(['planning', 'execution', 'pull_request', 'review', 'remediation', 'ask_agent']).optional(),
```

- [ ] **Step 2: Update API types**

Open `workers/orchestrator/src/types/api.ts`. Find the `agentType` field in `CreateTaskRequest` (line 27):

```typescript
// Before:
agentType?: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation';

// After:
agentType?: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | 'ask_agent';
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter orchestrator build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/types/schemas.ts workers/orchestrator/src/types/api.ts
git commit -m "feat(orchestrator): add ask_agent to schema and API types"
```

### Task 3.2: Create askAgentPrompt System Prompt

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts`

- [ ] **Step 1: Add the askAgentPrompt builder**

Open `workers/orchestrator/src/services/system-prompt.ts`. Add the following prompt builder BEFORE the `buildSystemPrompt` function (which is near the end of the file, around line 1149):

```typescript
export const askAgentPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-ask-agent',
  description: 'Interactive ask agent system prompt for conversational code assistance',
  version: '1.0.0',
  build(params: SystemPromptParams): string {
    const { taskId, workerType, modelName } = params;
    return `[SYSTEM CONTEXT]
You are an IntexuraOS interactive code assistant running in Docker isolation.
[WORKER-MODE]
[AGENT:ASK_AGENT]
Task ID: ${taskId}
Worktree: /repo

${WORKER_INSTRUCTIONS}

[INTERACTIVE AGENT MODE]
You are an interactive code assistant. The user is having a conversation with you through a web interface. Each message from the user arrives as a new prompt. You may have prior conversation context from previous turns — use it to maintain continuity.

### Core Behavior
- Respond to the user's message directly, thoroughly, and helpfully
- You have full access to the codebase at /repo, all tools, and command execution
- Complete your response fully, then stop — the user will send a follow-up message if needed
- Do NOT proactively create PRs, Linear issues, or git commits unless the user explicitly asks
- Do NOT output structured completion blocks (PLANNING_AGENT_FINAL, EXECUTION_AGENT_FINAL, etc.)
- Just respond naturally and completely

### Capabilities
- Explore, search, and analyze the codebase
- Run bash commands and analyze their output
- Read, write, and modify files
- Run tests and analyze results
- Debug issues, trace errors, and suggest fixes
- Answer questions about code architecture, patterns, and design
- Create files, commits, branches, PRs, or Linear issues ONLY when explicitly requested
- Perform code reviews and refactoring when asked

### Response Guidelines
- Be direct and concise — avoid filler
- Show relevant code snippets when they clarify your answer
- If you make changes to files, describe what you changed and why
- If a question is ambiguous, ask for clarification rather than guessing
- When exploring the codebase, show your work so the user can follow along
- For complex questions, break your answer into clear sections

### Worker Configuration
- Worker Type: \`${workerType ?? 'opus'}\`
- Model: \`${modelName ?? 'opus'}\`

### Session Continuity
This is a multi-turn conversation. Previous turns' logs are available in the conversation context. Reference prior context when relevant, but don't repeat information the user already has.`;
  },
};
```

- [ ] **Step 2: Update buildSystemPrompt to route ask_agent**

In the same file, find the `buildSystemPrompt` function (around line 1149). Add an `ask_agent` check at the beginning, after the pull_request check:

```typescript
export function buildSystemPrompt(params: SystemPromptParams): string {
  const isPullRequestTask =
    params.agentType === 'pull_request' ||
    params.linearIssueLabels.some((label) => label.trim().toLowerCase() === 'pr-comment');
  if (isPullRequestTask) {
    return pullRequestPrompt.build(params);
  }

  // ADD THIS BLOCK:
  if (params.agentType === 'ask_agent') {
    return askAgentPrompt.build(params);
  }

  const resolvedAgentType =
    params.agentType ?? (hasCodeTaskLabel(params.linearIssueLabels) ? 'execution' : 'planning');

  // ... rest of existing code unchanged
```

- [ ] **Step 3: Write test for the system prompt**

Add a test in `workers/orchestrator/src/__tests__/system-prompt.test.ts` (or the existing test file for system prompts):

```typescript
describe('askAgentPrompt', () => {
  it('builds prompt with AGENT:ASK_AGENT header', () => {
    const result = buildSystemPrompt({
      taskId: 'task_test-123',
      linearIssueLabels: [],
      agentType: 'ask_agent',
    });

    expect(result).toContain('[AGENT:ASK_AGENT]');
    expect(result).toContain('interactive code assistant');
    expect(result).not.toContain('PLANNING_AGENT_FINAL');
    expect(result).not.toContain('[AGENT:PLANNING]');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter orchestrator test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/__tests__/
git commit -m "feat(orchestrator): add askAgentPrompt system prompt and routing"
```

### Task 3.3: Add ask_agent to CompletionAgentType and Skip Verification

**Files:**
- Modify: `workers/orchestrator/src/services/completion-verifier.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`

- [ ] **Step 1: Add 'ask_agent' to CompletionAgentType**

Open `workers/orchestrator/src/services/completion-verifier.ts`. Update the type (line 9):

```typescript
// Before:
export type CompletionAgentType =
  | 'planning'
  | 'execution'
  | 'pull_request'
  | 'review'
  | 'remediation';

// After:
export type CompletionAgentType =
  | 'planning'
  | 'execution'
  | 'pull_request'
  | 'review'
  | 'remediation'
  | 'ask_agent';
```

- [ ] **Step 2: Handle ask_agent in selectSchemaAndPrompt**

In the same file, find `selectSchemaAndPrompt` function (around line 369). Add a case for ask_agent that returns a minimal schema:

```typescript
function selectSchemaAndPrompt(
  agentType: CompletionAgentType,
  transcript: string
): { schema: z.ZodType; prompt: string } {
  // ADD THIS AT THE TOP:
  if (agentType === 'ask_agent') {
    // ask_agent has no structured completion block — return a minimal schema
    // that always passes with an empty summary
    const schema = z.object({
      summary: z.string().default('Interactive session completed'),
    });
    return { schema, prompt: `Extract a brief summary from the transcript:\n${transcript}` };
  }

  if (agentType === 'planning') {
    // ... existing code
```

- [ ] **Step 3: Handle ask_agent in toAgentData**

In the same file, find the `toAgentData` function (around line 397). Add a case for ask_agent:

```typescript
function toAgentData(
  agentType: CompletionAgentType,
  parsed: unknown
):
  | PlanningAgentData
  | ExecutionAgentData
  | PullRequestAgentData
  | ReviewAgentData
  | RemediationAgentData
  | AskAgentData {
  // ADD THIS CASE:
  if (agentType === 'ask_agent') {
    const data = parsed as { summary: string };
    return { agentType: 'ask_agent', summary: data.summary };
  }

  // ... existing cases
```

You'll also need to add the `AskAgentData` interface:

```typescript
export interface AskAgentData {
  agentType: 'ask_agent';
  summary: string;
}
```

- [ ] **Step 4: Update task-dispatcher.ts agent label**

Open `workers/orchestrator/src/services/task-dispatcher.ts`. Find the `agentLabel` determination (around line 430-442). Add ask_agent to the chain:

```typescript
// Before (around line 430):
const agentLabel = isPullRequestTask
  ? 'Pull Request Agent'
  : task.agentType === 'review'
    ? 'Review Agent'
    : task.agentType === 'remediation'
      ? 'Remediation Agent'
      : task.agentType === 'execution'
        ? 'Execution Agent'
        : task.agentType === 'planning'
          ? 'Planning Agent'
          : hasCodeTaskLabel(task.linearIssueLabels)
            ? 'Execution Agent'
            : 'Planning Agent';

// After:
const agentLabel = isPullRequestTask
  ? 'Pull Request Agent'
  : task.agentType === 'review'
    ? 'Review Agent'
    : task.agentType === 'remediation'
      ? 'Remediation Agent'
      : task.agentType === 'ask_agent'
        ? 'Ask Agent'
        : task.agentType === 'execution'
          ? 'Execution Agent'
          : task.agentType === 'planning'
            ? 'Planning Agent'
            : hasCodeTaskLabel(task.linearIssueLabels)
              ? 'Execution Agent'
              : 'Planning Agent';
```

- [ ] **Step 5: Update completionAgentType determination**

In the same file, find the `completionAgentType` determination (around line 912-924):

```typescript
// Before:
const completionAgentType: CompletionAgentType = isPullRequestTask
  ? 'pull_request'
  : task.agentType === 'review'
    ? 'review'
    : task.agentType === 'remediation'
      ? 'remediation'
      : task.agentType === 'execution'
        ? 'execution'
        : task.agentType === 'planning'
          ? 'planning'
          : hasCodeTaskLabel(task.linearIssueLabels)
            ? 'execution'
            : 'planning';

// After:
const completionAgentType: CompletionAgentType = isPullRequestTask
  ? 'pull_request'
  : task.agentType === 'review'
    ? 'review'
    : task.agentType === 'remediation'
      ? 'remediation'
      : task.agentType === 'ask_agent'
        ? 'ask_agent'
        : task.agentType === 'execution'
          ? 'execution'
          : task.agentType === 'planning'
            ? 'planning'
            : hasCodeTaskLabel(task.linearIssueLabels)
              ? 'execution'
              : 'planning';
```

- [ ] **Step 6: Handle ask_agent in result enrichment**

In `task-dispatcher.ts`, find the `enrichResultForResumedTask` method (around line 1353). Add a case for ask_agent at the end:

```typescript
// After the existing agentData type checks (around line 1337):
} else if (agentData.agentType === 'ask_agent') {
  // ask_agent has no structured result fields to enrich
  base.summary = agentData.summary;
}
```

- [ ] **Step 7: Handle ask_agent in finalizeTaskWithResult**

In `task-dispatcher.ts`, find `finalizeTaskWithResult` (around line 1412). The existing code checks for specific agent types. Ensure ask_agent falls through to the default success path. No explicit case is needed — the method already calls `finalizeTask` with 'completed' status for non-special cases.

However, we should ensure ask_agent tasks also skip the completion verification retry logic. In `onWorkerAttemptFinished`, add a fast-path for ask_agent right after `rawLogs` is obtained (around line 953):

```typescript
// ADD after rawLogs is obtained (around line 953):
if (completionAgentType === 'ask_agent') {
  // ask_agent has no structured completion block — skip verification entirely
  const summaryLines = rawLogs.split('\n').filter(l => l.startsWith('[claude]')).slice(-5);
  const summary = summaryLines.length > 0
    ? summaryLines.map(l => l.replace(/^\[claude\]\s*/, '')).join('\n')
    : 'Interactive session completed';
  const result: TaskResult = { summary };
  await this.finalizeTaskWithResult(task, 'ask_agent', result);
  return;
}
```

Note: `TaskResult` here is the orchestrator's internal type. Check the import and adjust if needed.

- [ ] **Step 8: Write tests**

Add tests for:
- ask_agent completion type determination
- ask_agent label
- ask_agent skipping verification

- [ ] **Step 9: Run tests**

Run: `pnpm --filter orchestrator test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add workers/orchestrator/src/services/completion-verifier.ts workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/
git commit -m "feat(orchestrator): handle ask_agent completion, labeling, and verification skip"
```

### Task 3.4: Allow ask_agent Messages in Orchestrator

**Files:**
- Verify: `workers/orchestrator/src/services/task-dispatcher.ts`

The existing `sendMessage` method (around line 578) blocks `review` and `remediation` agent types. Verify `ask_agent` is NOT blocked:

- [ ] **Step 1: Verify the guard**

```typescript
if (task.agentType === 'review' || task.agentType === 'remediation') {
  return { ok: false, error: { type: 'invalid_agent_type' as const, message: '...' } };
}
```

`ask_agent` is NOT blocked. No change needed.

- [ ] **Step 2: Verify in SendMessageError type**

Check `workers/orchestrator/src/types/schemas.ts` — `SendMessageError` type (line 92). Verify `'invalid_agent_type'` is already a valid error type.

### Task 3.5: Run Full Orchestrator Verification

- [ ] **Step 1: Run full verification**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: All checks pass.

- [ ] **Step 2: Commit any fixes**

---

## Endpoint Changes Summary

### Created Endpoints
| Method   | Path                    | Auth      | Description                   |
| -------- | ----------------------- | --------- | ----------------------------- |
| POST     | `/code/ask-agent/start` | Auth0 JWT | Start a new Ask Agent session |

### Modified Endpoints
| Method   | Path                 | Change                                       |
| -------- | -------------------- | -------------------------------------------- |
| GET      | `/code/tasks`        | Filter out `agentType === 'ask_agent'` tasks |
| POST     | `/code/issue-groups` | Filter out `agentType === 'ask_agent'` tasks |

### Unchanged Endpoints (reused as-is)
| Method   | Path                            | Usage by Ask Agent                    |
| -------- | ------------------------------- | ------------------------------------- |
| GET      | `/code/tasks/{taskId}`          | View ask agent task details           |
| POST     | `/code/tasks/{taskId}/messages` | Send follow-up messages (--continue)  |
| POST     | `/code/cancel`                  | Cancel running ask agent task         |
| PATCH    | `/internal/code-tasks/{taskId}` | Orchestrator callback (status update) |

### Removed Endpoints
None.

---

## Final Verification

After all three subtasks are complete, run the full CI check:

```bash
pnpm run ci:tracked
```

All workspaces must pass. If any workspace fails, fix the issue before merging.
