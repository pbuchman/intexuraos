# Turn Metrics JSONL Collection Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `parseSessionJsonl()` so it reads JSONL files from the shared credentials directory and filters by timestamp window, restoring token/API/time metrics.

**Architecture:** Add `sharedCredsPath` to collector config. When set, glob from shared path instead of per-task path. Filter files by first-entry timestamp to isolate which files belong to the current task.

**Tech Stack:** TypeScript, Vitest, Node `fs/promises` glob

---

### Task 1: Add `sharedCredsPath` to config and update `parseSessionJsonl` signature

**Files:**

- Modify: `workers/orchestrator/src/services/turn-metrics-collector.ts:32-36` (config interface)
- Modify: `workers/orchestrator/src/services/turn-metrics-collector.ts:177-204` (parseSessionJsonl)
- Modify: `workers/orchestrator/src/services/turn-metrics-collector.ts:87-91` (collectAndPublish call site)
- Test: `workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts`

**Step 1: Write failing tests for timestamp-filtered parseSessionJsonl**

Add these tests to the `parseSessionJsonl` describe block in `turn-metrics-collector.test.ts`:

```typescript
it('reads from sharedCredsPath when configured', async () => {
  const sharedConfig: TurnMetricsCollectorConfig = {
    ...config,
    sharedCredsPath: '/tmp/shared-creds',
  };
  const sharedCollector = new TurnMetricsCollector(sharedConfig, mockLogger);

  const jsonlContent = [
    JSON.stringify({ type: 'user', timestamp: '2025-01-01T00:00:00Z' }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2025-01-01T00:00:05Z',
      message: { usage: { input_tokens: 200, output_tokens: 75 } },
    }),
  ].join('\n');

  async function* fakeGlob(): AsyncGenerator<string> {
    yield '/tmp/shared-creds/projects/-repo/session-abc.jsonl';
  }
  mockGlob.mockReturnValueOnce(fakeGlob() as never);
  mockReadFile.mockResolvedValueOnce(jsonlContent);

  const result = await sharedCollector.parseSessionJsonl('task1', {
    startedAt: '2024-12-31T23:59:00Z',
    completedAt: '2025-01-01T00:01:00Z',
  });

  expect(mockGlob).toHaveBeenCalledWith(expect.stringContaining('/tmp/shared-creds/projects'));
  expect(result.tokens.totalInputTokens).toBe(200);
  expect(result.tokens.apiCallCount).toBe(1);
});

it('excludes files outside the time window', async () => {
  const sharedConfig: TurnMetricsCollectorConfig = {
    ...config,
    sharedCredsPath: '/tmp/shared-creds',
  };
  const sharedCollector = new TurnMetricsCollector(sharedConfig, mockLogger);

  const oldContent =
    JSON.stringify({ type: 'user', timestamp: '2024-06-01T00:00:00Z' }) +
    '\n' +
    JSON.stringify({
      type: 'assistant',
      timestamp: '2024-06-01T00:00:05Z',
      message: { usage: { input_tokens: 999 } },
    });
  const newContent =
    JSON.stringify({ type: 'user', timestamp: '2025-01-01T00:00:00Z' }) +
    '\n' +
    JSON.stringify({
      type: 'assistant',
      timestamp: '2025-01-01T00:00:03Z',
      message: { usage: { input_tokens: 100 } },
    });

  async function* fakeGlob(): AsyncGenerator<string> {
    yield '/tmp/shared-creds/projects/-repo/old-session.jsonl';
    yield '/tmp/shared-creds/projects/-repo/new-session.jsonl';
  }
  mockGlob.mockReturnValueOnce(fakeGlob() as never);
  // First readFile call is for old-session (first line check), second for new-session
  mockReadFile.mockResolvedValueOnce(oldContent).mockResolvedValueOnce(newContent);

  const result = await sharedCollector.parseSessionJsonl('task1', {
    startedAt: '2024-12-31T23:59:00Z',
    completedAt: '2025-01-01T00:01:00Z',
  });

  expect(result.tokens.totalInputTokens).toBe(100);
  expect(result.tokens.apiCallCount).toBe(1);
});

it('falls back to per-task path when sharedCredsPath not set', async () => {
  const jsonlContent = [
    JSON.stringify({ type: 'user', timestamp: '2025-01-01T00:00:00Z' }),
    JSON.stringify({ type: 'assistant', timestamp: '2025-01-01T00:00:05Z' }),
  ].join('\n');

  async function* fakeGlob(): AsyncGenerator<string> {
    yield '/tmp/secrets/claude-session-task1/projects/test/session.jsonl';
  }
  mockGlob.mockReturnValueOnce(fakeGlob() as never);
  mockReadFile.mockResolvedValueOnce(jsonlContent);

  await collector.parseSessionJsonl('task1');

  expect(mockGlob).toHaveBeenCalledWith(
    expect.stringContaining('/tmp/secrets/claude-session-task1/projects')
  );
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/p.buchman/personal/intexuraos-1 && pnpm --filter orchestrator test -- --run src/__tests__/turn-metrics-collector.test.ts`

Expected: FAIL — `parseSessionJsonl` doesn't accept time window param, config doesn't have `sharedCredsPath`.

**Step 3: Update the config interface**

In `turn-metrics-collector.ts`, add `sharedCredsPath` to the config:

```typescript
export interface TurnMetricsCollectorConfig {
  codeAgentUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
  secretsBasePath: string;
  sharedCredsPath?: string;
}
```

**Step 4: Rewrite `parseSessionJsonl` with timestamp filtering**

Replace the existing `parseSessionJsonl` method:

```typescript
async parseSessionJsonl(
  taskId: string,
  timeWindow?: { startedAt: string; completedAt: string }
): Promise<{ timeClassification: TimeClassification; tokens: TokenAggregation }> {
  const entries: SessionEntry[] = [];

  // Resolve glob base path: shared creds dir or per-task session dir
  const basePath = this.config.sharedCredsPath !== undefined
    ? this.config.sharedCredsPath
    : join(this.config.secretsBasePath, `claude-session-${taskId}`);
  const pattern = join(basePath, 'projects', '**', '*.jsonl');

  const windowStart = timeWindow !== undefined ? new Date(timeWindow.startedAt).getTime() : 0;
  const windowEnd = timeWindow !== undefined ? new Date(timeWindow.completedAt).getTime() : Infinity;

  try {
    for await (const filePath of glob(pattern)) {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');

      // When using shared path, filter by first entry's timestamp
      if (this.config.sharedCredsPath !== undefined && lines.length > 0) {
        try {
          const firstEntry = JSON.parse(lines[0]) as SessionEntry;
          const ts = firstEntry.timestamp !== undefined
            ? new Date(firstEntry.timestamp).getTime()
            : 0;
          if (ts < windowStart || ts > windowEnd) {
            continue; // Skip file — outside this task's time window
          }
        } catch {
          continue; // Skip file with unparseable first line
        }
      }

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as SessionEntry);
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Glob or read failure — return zero defaults
  }

  return {
    timeClassification: this.classifyTime(entries),
    tokens: this.aggregateTokens(entries),
  };
}
```

**Step 5: Update `collectAndPublish` to pass time window**

In `collectAndPublish`, change the `parseSessionJsonl` call (line ~90):

```typescript
const [cpuTimeSeconds, peakMemoryMB, sessionData] = await Promise.all([
  this.readCpuTimeSec(cgroupPath),
  this.readPeakMemoryMB(cgroupPath),
  this.parseSessionJsonl(params.taskId, {
    startedAt: params.startedAt,
    completedAt: params.completedAt,
  }),
]);
```

**Step 6: Run tests to verify they pass**

Run: `cd /Users/p.buchman/personal/intexuraos-1 && pnpm --filter orchestrator test -- --run src/__tests__/turn-metrics-collector.test.ts`

Expected: ALL PASS

**Step 7: Commit**

```bash
git add workers/orchestrator/src/services/turn-metrics-collector.ts workers/orchestrator/src/__tests__/turn-metrics-collector.test.ts
git commit -m "fix(orchestrator): read session JSONL from shared creds path with timestamp filtering"
```

---

### Task 2: Wire `sharedCredsPath` through `start.ts`

**Files:**

- Modify: `workers/orchestrator/src/start.ts:558-566`

**Step 1: Add `sharedCredsPath` to TurnMetricsCollector instantiation**

In `start.ts` around line 558, update the constructor call:

```typescript
const turnMetricsCollector = new TurnMetricsCollector(
  {
    codeAgentUrl: config.codeAgentUrl,
    orchestratorSecret: config.orchestratorSecret,
    internalAuthToken,
    secretsBasePath,
    sharedCredsPath,
  },
  logger
);
```

`sharedCredsPath` is already defined at line 439: `const sharedCredsPath = join(orchestratorDir, 'claude-creds');`

**Step 2: Update existing tests that construct `TurnMetricsCollectorConfig`**

Check if any integration tests or main tests construct the config — update them to include `sharedCredsPath` where appropriate. The unit tests in `turn-metrics-collector.test.ts` already cover both paths (with and without `sharedCredsPath`).

**Step 3: Run full orchestrator tests**

Run: `cd /Users/p.buchman/personal/intexuraos-1 && pnpm --filter orchestrator test -- --run`

Expected: ALL PASS

**Step 4: Commit**

```bash
git add workers/orchestrator/src/start.ts
git commit -m "fix(orchestrator): pass sharedCredsPath to turn metrics collector"
```

---

### Task 3: Run full CI verification

**Step 1: Build packages**

Run: `cd /Users/p.buchman/personal/intexuraos-1 && pnpm build`

**Step 2: Run workspace verification**

Run: `cd /Users/p.buchman/personal/intexuraos-1 && pnpm run verify:workspace:tracked -- orchestrator`

Expected: TypeCheck PASS, Lint PASS, Tests + Coverage PASS

**Step 3: Run full CI**

Run: `cd /Users/p.buchman/personal/intexuraos-1 && pnpm run ci:tracked`

Expected: ALL PASS

**Step 4: Verify no terraform changes**

Run: `git diff --name-only HEAD~2 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"`

Expected: "No terraform changes"
