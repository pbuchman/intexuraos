# Code Worker Log Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex/code-worker log lines readable in the code-task web log viewer instead of showing raw `item.completed` JSON envelopes.

**Architecture:** Keep the fix at the existing log formatting boundary. `/internal/logs` will continue storing raw chunks for audit/debugging, but `log_lines` will store human-readable Codex lines produced by `apps/code-agent` before the web app reads Firestore. The web app only gains tag styling for new formatted line types; it should not parse Codex JSON.

**Tech Stack:** TypeScript, Fastify/code-agent, Firestore `code_tasks/{taskId}/log_lines`, React web app, Vitest.

---

## Investigation Findings

- Orchestrator sends log chunks to `POST /internal/logs` through `workers/orchestrator/src/services/log-forwarder.ts`.
- Code-agent persists raw chunks and formatted UI lines in `apps/code-agent/src/domain/usecases/recordTaskEvent.ts`.
- The formatter switch is `formatLogChunkForRuntime()` in `apps/code-agent/src/domain/services/logFormatter.ts`.
- Claude log chunks are humanized by `formatLogChunk()`, but Codex chunks currently pass through `formatRawCodexLogChunk()` in `apps/code-agent/src/domain/services/logFormatter/progressFormatter.ts`.
- The web app reads `code_tasks/{taskId}/log_lines` directly in `apps/web/src/hooks/useCodeTaskLogs.ts`, then renders text in `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`.
- The orchestrator already has a useful Codex formatting pattern in `workers/orchestrator/src/services/runtime/processors/codex-log-processor.ts`: `[codex]`, `[msg]`, `[cmd]`, `[error]`, command output gutters, and event suppression for `item.started`.
- The sample bad lines are Codex `item.completed` events with `item.type === "file_change"` and a `changes` array. These need a dedicated formatter path; relying on indentation/grouping alone will not make them readable.

## Endpoint Changes

- Modified: none.
- Created: none.
- Removed: none.
- Unchanged: `POST /internal/logs` keeps the same request/response contract and continues storing raw log chunks.

## File Map

- Modify: `apps/code-agent/src/domain/services/logFormatter/progressFormatter.ts`
  - Add Codex JSON event formatting for persisted `log_lines`.
  - Preserve partial-line buffering and non-JSON passthrough behavior.
- Modify: `apps/code-agent/src/__tests__/domain/services/logFormatter/progressFormatter.test.ts`
  - Unit-test Codex formatter behavior directly, including `file_change`, command, message, lifecycle, unknown, split, and flush cases.
- Modify: `apps/code-agent/src/__tests__/domain/logFormatter.test.ts`
  - Update runtime-level expectations from “preserve raw Codex JSON exactly” to “format Codex JSON into readable log lines”.
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`
  - Update `/internal/logs` route regression tests so Codex `log_lines` are readable while raw chunk storage remains unchanged.
- Modify: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`
  - Add `[file]` tag styling and worker-filter inclusion if file changes should remain visible in focused worker output.
- Modify: `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`
  - Cover `[file]` rendering and worker-filter behavior.

## Log Format Contract

- `thread.started` -> `[codex] Session started: thread=<thread_id>`
- `turn.started` -> `[codex] Turn started`
- `turn.completed` -> `[codex] Turn completed | input: <n|?> tokens (<percent>% cached) | output: <n|?> tokens`
- `turn.failed` -> `[error] <message>`
- `error` -> `[error] <message>`
- `item.started` -> no persisted UI line
- `item.completed` with `agent_message` -> `[msg] <text>`
- `item.completed` with `command_execution` -> existing `[cmd] $ <command>  -> <ok|EXIT n> (<line-count> lines)` plus gutter output
- `item.completed` with `file_change` -> one line per changed file: `[file] <kind> <repo-relative path>`
- Unknown JSON event -> `[event] <type>`
- Non-JSON text -> unchanged
- Incomplete Codex JSON across chunks -> buffer until complete, then format once

## Task 1: Add Codex UI Formatter Tests

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/services/logFormatter/progressFormatter.test.ts`

- [ ] **Step 1: Add failing tests for readable Codex events**

Append tests under `describe('formatRawCodexLogChunk', () => { ... })`:

```typescript
it('formats Codex file_change items into repo-relative [file] lines', () => {
  const state = newState();
  const input = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item_105',
      type: 'file_change',
      changes: [
        {
          path: '/repo/apps/mobile-notifications-service/src/routes/internalRoutes.ts',
          kind: 'update',
        },
      ],
      status: 'completed',
    },
  }) + '\n';

  const result = formatRawCodexLogChunk(input, 0, ts(), state);

  expect(result.map((line) => line.text)).toEqual([
    '[file] update apps/mobile-notifications-service/src/routes/internalRoutes.ts',
  ]);
});

it('formats Codex agent messages into [msg] lines', () => {
  const state = newState();
  const input = JSON.stringify({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: 'Focused tests are green.' },
  }) + '\n';

  const result = formatRawCodexLogChunk(input, 0, ts(), state);

  expect(result.map((line) => line.text)).toEqual(['[msg] Focused tests are green.']);
});

it('formats Codex command executions with bounded output gutters', () => {
  const state = newState();
  const input = JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item_2',
      type: 'command_execution',
      command: '/bin/sh -lc "pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx"',
      aggregated_output: 'PASS apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx\n',
      exit_code: 0,
      status: 'completed',
    },
  }) + '\n';

  const result = formatRawCodexLogChunk(input, 0, ts(), state);

  expect(result.map((line) => line.text)).toEqual([
    '[cmd] $ pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx  -> ok (1 lines)\n' +
      '    | PASS apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx',
  ]);
});
```

- [ ] **Step 2: Add mixed-format regression tests**

Add tests proving the formatter handles multiple expected formats rather than assuming one shape:

```typescript
it('formats lifecycle and error events while preserving non-JSON text', () => {
  const state = newState();
  const input = [
    '[entrypoint] Code worker starting',
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 2 },
    }),
    JSON.stringify({ type: 'error', message: 'rate limited' }),
  ].join('\n') + '\n';

  const result = formatRawCodexLogChunk(input, 0, ts(), state);

  expect(result.map((line) => line.text)).toEqual([
    '[entrypoint] Code worker starting',
    '[codex] Session started: thread=thread-123',
    '[codex] Turn started',
    '[codex] Turn completed | input: 10 tokens (50% cached) | output: 2 tokens',
    '[error] rate limited',
  ]);
});

it('suppresses item.started and emits compact labels for unknown JSON events', () => {
  const state = newState();
  const input = [
    JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }),
    JSON.stringify({ type: 'unknown_event', data: 123 }),
  ].join('\n') + '\n';

  const result = formatRawCodexLogChunk(input, 0, ts(), state);

  expect(result.map((line) => line.text)).toEqual(['[event] unknown_event']);
});
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/services/logFormatter/progressFormatter.test.ts
```

Expected before implementation: failures showing raw JSON text where formatted `[file]`, `[msg]`, `[cmd]`, `[codex]`, `[error]`, or `[event]` lines are expected.

## Task 2: Implement Codex Event Formatting in Code-Agent

**Files:**
- Modify: `apps/code-agent/src/domain/services/logFormatter/progressFormatter.ts`

- [ ] **Step 1: Add Codex event types and helpers**

Add local interfaces and helpers near the existing constants:

```typescript
interface CodexFileChange {
  path?: string;
  kind?: string;
}

interface CodexLogObject {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  item?: {
    type?: string;
    text?: string;
    message?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    changes?: CodexFileChange[];
  };
}

function formatRepoRelativePath(path: string): string {
  return path.startsWith('/repo/') ? path.slice('/repo/'.length) : path;
}
```

- [ ] **Step 2: Port the established Codex formatting behavior**

Implement the same display contract already used by `workers/orchestrator/src/services/runtime/processors/codex-log-processor.ts`, adjusted to the existing code-agent formatter file:

```typescript
function formatCodexJsonLine(jsonLine: string): string | null {
  try {
    const obj = JSON.parse(jsonLine) as CodexLogObject;

    if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
      return `[codex] Session started: thread=${obj.thread_id}`;
    }
    if (obj.type === 'turn.started') return '[codex] Turn started';
    if (obj.type === 'turn.completed') return formatCodexTurnCompleted(obj);
    if (obj.type === 'turn.failed') return `[error] ${obj.error?.message ?? 'Codex turn failed'}`;
    if (obj.type === 'error' && typeof obj.message === 'string') return `[error] ${obj.message}`;
    if (obj.type === 'item.started') return null;
    if (obj.type === 'item.completed') return formatCodexItemCompleted(obj) ?? `[event] item.completed`;
    if (typeof obj.type === 'string') return `[event] ${obj.type}`;
    return jsonLine;
  } catch {
    return jsonLine;
  }
}
```

- [ ] **Step 3: Change `formatRawCodexLogChunk()` to format completed lines**

Keep partial-line buffering unchanged, but run each complete non-empty line through `formatCodexJsonLine()` before pushing output:

```typescript
const formatted = formatCodexJsonLine(line);
if (formatted === null || formatted.trim() === '') continue;
result.push({ sequence: seq++, text: formatted, timestamp });
```

- [ ] **Step 4: Update `flushCodexPartial()` to format the buffered line**

Apply the same formatting during terminal flush so trailing JSON without a newline does not leak raw JSON:

```typescript
const formatted = formatCodexJsonLine(line);
if (formatted === null || formatted.trim() === '') return [];
return [{ sequence: startSequence * 1000, text: formatted, timestamp }];
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
pnpm vitest run apps/code-agent/src/__tests__/domain/services/logFormatter/progressFormatter.test.ts
```

Expected: pass.

## Task 3: Update Runtime and Webhook Regressions

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/logFormatter.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

- [ ] **Step 1: Update runtime-level Codex formatter expectations**

Replace assertions that expect raw Codex JSON with assertions for readable lines. For example:

```typescript
expect(result).toHaveLength(1);
expect(result[0]?.text).toBe('[msg] READY');
```

For long messages, assert the formatted message remains readable and is not JSON:

```typescript
expect(result[0]?.text).toMatch(/^\[msg\] /);
expect(result[0]?.text).not.toContain('"type":"item.completed"');
```

- [ ] **Step 2: Update split and flush tests**

Keep the same partial buffering assertions, but change the final text expectation:

```typescript
expect(result2[0]?.text).toBe('[msg] split-message');
```

For `turn.failed` flush:

```typescript
expect(flushed[0]?.text).toBe('[error] boom');
```

- [ ] **Step 3: Update `/internal/logs` Codex persistence test**

In the test named `stores raw Codex JSON log lines without Claude formatting`, rename it to `stores readable Codex log lines while preserving raw chunks`, and assert:

```typescript
expect(storedEntries).toHaveLength(1);
expect(storedEntries?.[0]?.text).toBe('[msg] READY');
```

Leave raw chunk repository assertions intact where present; raw chunks must still preserve original content.

- [ ] **Step 4: Add route-level file-change regression**

Add a `/internal/logs` test that posts the sample `file_change` JSON and verifies `logLineRepo.storeBatch()` receives:

```typescript
expect(storedEntries?.[0]?.text).toBe(
  '[file] update apps/mobile-notifications-service/src/infra/firestore/firestoreNotificationRepository.ts'
);
```

- [ ] **Step 5: Run code-agent focused tests**

Run:

```bash
pnpm vitest run \
  apps/code-agent/src/__tests__/domain/services/logFormatter/progressFormatter.test.ts \
  apps/code-agent/src/__tests__/domain/logFormatter.test.ts \
  apps/code-agent/src/__tests__/routes/webhooks.test.ts
```

Expected: pass.

## Task 4: Add Web Viewer Styling for File Events

**Files:**
- Modify: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`
- Modify: `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`

- [ ] **Step 1: Write web tests for `[file]` lines**

Add tests covering display and worker filtering:

```typescript
it('renders formatted file change log lines', () => {
  const logs: LogLine[] = [
    makeLog(1, '[file] update apps/mobile-notifications-service/src/routes/internalRoutes.ts'),
  ];

  render(<CodeTaskLogViewer {...makeProps({ logs })} />);

  expect(screen.getByText('[file] update apps/mobile-notifications-service/src/routes/internalRoutes.ts')).toBeInTheDocument();
});

it('keeps [file] lines visible when worker filter is active', async () => {
  const logs: LogLine[] = [
    makeLog(1, '[file] update apps/mobile-notifications-service/src/routes/internalRoutes.ts'),
    makeLog(2, '[tool] Read: package.json'),
  ];

  render(<CodeTaskLogViewer {...makeProps({ logs })} />);

  const workerButton = screen.getByRole('button', { name: 'Worker' });
  await userEvent.click(workerButton);

  expect(screen.getByText(/\[file\] update/)).toBeInTheDocument();
  expect(screen.queryByText(/\[tool\] Read/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the web test and confirm failure**

Run:

```bash
pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx
```

Expected before implementation: worker-filter test fails because `[file]` is not included.

- [ ] **Step 3: Add `[file]` styling and filter inclusion**

In `TAG_STYLES`, add:

```typescript
file: { text: 'text-emerald-700 dark:text-emerald-300' },
```

In the worker filter guard, include `file` with the existing user-visible worker tags:

```typescript
if (tag !== 'claude' && tag !== 'msg' && tag !== 'codex' && tag !== 'file') return null;
```

- [ ] **Step 4: Run the web test**

Run:

```bash
pnpm vitest run apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx
```

Expected: pass.

## Task 5: Verification

**Files:**
- No additional files.

- [ ] **Step 1: Run focused suites**

Run:

```bash
pnpm vitest run \
  apps/code-agent/src/__tests__/domain/services/logFormatter/progressFormatter.test.ts \
  apps/code-agent/src/__tests__/domain/logFormatter.test.ts \
  apps/code-agent/src/__tests__/routes/webhooks.test.ts \
  apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run tracked workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- web
```

Expected: both pass.

- [ ] **Step 3: Run final CI gate**

Run:

```bash
pnpm run ci:tracked
```

Expected: pass completely before commit/PR delivery.

## Self-Review Notes

- This plan avoids web-side parsing of raw Codex JSON because `CodeTaskLogViewer` already operates on plain `LogLine.text` and should remain a renderer.
- The applicable execution memory is addressed by testing several distinct log structures: file-change JSON, agent-message JSON, command JSON with output, lifecycle JSON, unknown JSON, suppressed `item.started`, and non-JSON passthrough.
- No Firestore schema change is required. Existing `log_lines.text` remains a string.
- No endpoint contract change is required. Existing `/internal/logs` payload and response stay unchanged.
