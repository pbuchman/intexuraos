# Turn Metrics JSONL Collection Fix

## Problem

`TurnMetricsCollector.parseSessionJsonl()` returns all zeros for session-level metrics (tokens, API calls, time classification) because it looks for JSONL files in a per-task path (`secrets/claude-session-{taskId}/projects/**/*.jsonl`) that doesn't exist when shared credentials mode is active.

In shared creds mode, all containers mount a single `.claude` directory (`claude-creds/`). JSONL files are written there by Claude Code, not in per-task session directories.

## Constraints

- Shared `.credentials.json` must remain a single shared file — cannot be copied per-task
- Shared creds mode is the production setup and non-negotiable
- Cgroup metrics (CPU, memory) work fine — only JSONL-derived metrics are broken

## Solution: Timestamp-Window Correlation

Modify `parseSessionJsonl()` to read from the shared credentials path and filter JSONL files by timestamp window.

### Changes

| File                         | Change                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `TurnMetricsCollectorConfig` | Add optional `sharedCredsPath: string`                                                           |
| `parseSessionJsonl()`        | Accept `timeWindow` param, resolve path from shared creds, filter files by first-entry timestamp |
| `collectAndPublish()`        | Pass `startedAt`/`completedAt` to `parseSessionJsonl`                                            |
| `start.ts`                   | Pass `sharedCredsPath` from orchestrator config into collector config                            |

### Signature

```typescript
// Before
async parseSessionJsonl(taskId: string): Promise<{ timeClassification; tokens }>

// After
async parseSessionJsonl(taskId: string, timeWindow: { startedAt: string; completedAt: string }): Promise<{ timeClassification; tokens }>
```

### Path Resolution

```
if sharedCredsPath is set:
  glob: {sharedCredsPath}/projects/**/*.jsonl
else:
  glob: {secretsBasePath}/claude-session-{taskId}/projects/**/*.jsonl  (original behavior)
```

### File Filtering

For each `.jsonl` file found:

1. Read first line, parse JSON
2. Check `timestamp` field
3. Include file only if timestamp falls within `[startedAt, completedAt]`

### Edge Cases

- **Concurrent tasks**: If two tasks overlap, a file may match both windows. Acceptable — slight inflation bounded by overlap duration.
- **Subagent files**: `subagents/*.jsonl` files filtered the same way.
- **No matching files**: Returns zeros (same as current behavior, no regression).
- **Multi-attempt tasks**: Each attempt passes its own time window, scoping to the right session files.

### Not Changing

- Docker bind mount setup
- `docker-provider.ts`
- Container entrypoint
- `classifyTime()` / `aggregateTokens()` logic
