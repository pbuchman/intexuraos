# Linear MCP Timeout Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a stalled Linear MCP call from hanging a code-worker attempt indefinitely by enforcing a 60 second timeout end-to-end.

**Architecture:** Keep the timeout contract declarative in the worktree MCP config and enforce it at runtime inside the code-worker entrypoint. The orchestrator owns generation of the worktree `.mcp.json` file and preservation of timeout evidence in task logs; the code-worker owns honoring the timeout contract during Codex execution and exiting cleanly when the Linear MCP server exceeds the bound.

**Tech Stack:** JSON MCP config, TypeScript orchestrator services/tests, Bash entrypoint runtime, Docker image packaging, existing Codex log processing.

---

## Requirements

1. The worktree MCP config copied into every task worktree must include `mcpServers.linear.timeoutMs = 60000`.
2. The Linear timeout must apply to Codex worker runs, including resumed attempts.
3. A timed out Linear MCP call must fail the active attempt instead of wedging the worker process forever.
4. Timeout evidence must be visible in task logs with a stable marker containing `MCP timeout` and `server=linear`.
5. Existing auth/token substitution for `.mcp.json` must continue to work unchanged.
6. Existing worker cleanup after each attempt must still terminate lingering child processes.

## Acceptance Criteria

- A created worktree contains `.mcp.json` with the Linear server timeout set to `60000`.
- Codex execution uses the worktree `.mcp.json` and honors the Linear timeout during fresh and resumed runs.
- When the Linear MCP server stalls past 60 seconds, the worker exits with a failed attempt instead of remaining hung.
- The runtime/orchestrator-visible logs contain a stable timeout marker with both `MCP timeout` and `server=linear`.
- Existing non-Linear MCP behavior and Sentry MCP configuration remain unchanged.
- Tests cover config generation, runtime enforcement, log propagation, and cleanup behavior.

## Test Plan

- Unit test `workers/orchestrator/src/__tests__/worktree-manager.test.ts` for generated `.mcp.json` content and environment substitution.
- Unit test `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` or the relevant runtime log processor tests for timeout marker propagation.
- Runtime/integration test `workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts` for Codex failure behavior when a mocked Linear MCP call exceeds the timeout.
- Integration test `workers/orchestrator/src/__tests__/integration.test.ts` for attempt completion and cleanup after timeout.
- Manual verification in a worker container by inspecting the copied worktree `.mcp.json` and simulating a stalled Linear MCP endpoint.

## Endpoint Changes

**Modified:** None

**Created:** None

**Removed:** None

**Unchanged:**

- Worker task dispatch API surface
- Existing webhook completion endpoints
- Existing Sentry MCP configuration

## File Structure

### Orchestrator-owned files

| File | Action | Responsibility |
| --- | --- | --- |
| `.mcp.json` | Modify | Declare the Linear timeout contract in the template copied into worktrees |
| `workers/orchestrator/src/services/worktree-manager.ts` | Modify | Preserve timeout config while substituting secrets into copied worktree files |
| `workers/orchestrator/src/services/task-dispatcher.ts` | Modify | Ensure timeout evidence from runtime output is retained in forwarded task logs |
| `workers/orchestrator/src/services/runtime/processors/codex-log-processor.ts` | Modify | Preserve or normalize the stable timeout marker in Codex log output |
| `workers/orchestrator/src/__tests__/worktree-manager.test.ts` | Modify | Assert generated MCP config includes `timeoutMs: 60000` |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` | Modify | Assert stable timeout evidence reaches the task log stream |

### Code-worker-owned files

| File | Action | Responsibility |
| --- | --- | --- |
| `workers/code-worker/entrypoint.sh` | Modify | Run Codex with explicit runtime enforcement for the Linear MCP timeout and surface failure evidence |
| `workers/code-worker/Dockerfile` | Modify | Add any required runtime utility or environment support for timeout enforcement |
| `workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts` | Modify | Assert runtime failure behavior for timed out Linear MCP calls |
| `workers/orchestrator/src/__tests__/integration.test.ts` | Modify | Assert end-to-end timeout completion and cleanup behavior |
| `docs/setup/11-claude-code-mcp-setup.md` | Modify | Document the enforced Linear MCP timeout contract if operator-visible behavior changes |

## Parallel Breakdown

### Subtask INT-1204: Orchestrator timeout contract ownership

**Boundary:** owns worktree MCP config generation and timeout evidence forwarding.  
**Input contract:** existing repository `.mcp.json`, task worktree copy flow, Codex runtime log lines.  
**Output contract:** copied worktree `.mcp.json` contains `mcpServers.linear.timeoutMs = 60000`; orchestrator-visible logs preserve a stable timeout marker containing `MCP timeout` and `server=linear`.  
**Non-ownership:** does not enforce the timeout in the worker process itself.

### Subtask INT-1205: Code-worker runtime enforcement ownership

**Boundary:** owns Codex process execution inside the worker container.  
**Input contract:** worktree `.mcp.json` may contain `mcpServers.linear.timeoutMs = 60000`; timeout marker contract is `MCP timeout` plus `server=linear`.  
**Output contract:** a stalled Linear MCP call fails the attempt within the 60 second bound and emits the stable timeout marker; cleanup still terminates child processes after attempt exit.  
**Non-ownership:** does not generate the worktree `.mcp.json` template.

These subtasks are parallel-safe because the interface between them is only the copied `.mcp.json` timeout field plus the stable log marker grammar. Each agent can implement its side against that contract without waiting for the sibling task.

## Task 1: Orchestrator timeout contract

**Files:**
- Modify: `.mcp.json`
- Modify: `workers/orchestrator/src/services/worktree-manager.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/services/runtime/processors/codex-log-processor.ts`
- Test: `workers/orchestrator/src/__tests__/worktree-manager.test.ts`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Write the failing config-generation test**

Add an assertion in `workers/orchestrator/src/__tests__/worktree-manager.test.ts` that the copied `.mcp.json` contains:

```json
{
  "mcpServers": {
    "linear": {
      "timeoutMs": 60000
    }
  }
}
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run: `pnpm vitest workers/orchestrator/src/__tests__/worktree-manager.test.ts`
Expected: failure because the generated worktree config does not yet include `timeoutMs`.

- [ ] **Step 3: Implement the config contract**

Update `.mcp.json` so the Linear server entry becomes:

```json
"linear": {
  "type": "sse",
  "url": "https://mcp.linear.app/sse",
  "timeoutMs": 60000,
  "headers": {
    "Authorization": "Bearer ${LINEAR_API_KEY}"
  }
}
```

Keep `worktree-manager.ts` secret substitution behavior intact so only token placeholders change during copy.

- [ ] **Step 4: Add failing timeout-log propagation coverage**

Add a test in `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` or the closest runtime log processor test that feeds a Codex/runtime line containing:

```text
MCP timeout server=linear timeout_ms=60000
```

and asserts the task log stream retains the same marker content.

- [ ] **Step 5: Implement timeout marker preservation**

Adjust `task-dispatcher.ts` and/or `codex-log-processor.ts` so a timeout line containing `MCP timeout` and `server=linear` is forwarded without being dropped, rewritten, or truncated past recognition.

- [ ] **Step 6: Verify orchestrator tests**

Run:

```bash
pnpm vitest workers/orchestrator/src/__tests__/worktree-manager.test.ts
pnpm vitest workers/orchestrator/src/__tests__/task-dispatcher.test.ts
```

Expected: both targeted suites pass.

## Task 2: Code-worker runtime timeout enforcement

**Files:**
- Modify: `workers/code-worker/entrypoint.sh`
- Modify: `workers/code-worker/Dockerfile`
- Test: `workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts`
- Test: `workers/orchestrator/src/__tests__/integration.test.ts`
- Modify: `docs/setup/11-claude-code-mcp-setup.md`

- [ ] **Step 1: Write the failing runtime test**

Add a test in `workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts` that simulates a Codex attempt where the Linear MCP path stalls beyond 60 seconds and asserts the runtime emits an `attempt_failed` event instead of hanging.

- [ ] **Step 2: Run the targeted runtime test to confirm failure**

Run: `pnpm vitest workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts`
Expected: failure because the current worker runtime has no explicit Linear MCP timeout enforcement behavior.

- [ ] **Step 3: Implement minimal runtime enforcement**

Update `workers/code-worker/entrypoint.sh` to wrap `codex exec` with timeout behavior derived from the worktree `.mcp.json` contract and emit a stable evidence line such as:

```text
[entrypoint] MCP timeout server=linear timeout_ms=60000
```

If a helper utility is required, add it in `workers/code-worker/Dockerfile` without changing unrelated runtime behavior.

- [ ] **Step 4: Add end-to-end cleanup coverage**

Add or extend `workers/orchestrator/src/__tests__/integration.test.ts` so a timed out attempt still reaches completion handling and child-process cleanup.

- [ ] **Step 5: Verify runtime and integration coverage**

Run:

```bash
pnpm vitest workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts
pnpm vitest workers/orchestrator/src/__tests__/integration.test.ts
```

Expected: timeout attempts fail cleanly and tests complete without hanging.

- [ ] **Step 6: Update operator documentation**

Document the enforced 60 second Linear MCP timeout and expected timeout marker in `docs/setup/11-claude-code-mcp-setup.md`.

## Final Verification

- [ ] Run `pnpm run verify:workspace:tracked -- orchestrator`
- [ ] Run `pnpm run verify:workspace:tracked -- code-worker`
- [ ] Run `pnpm run ci:tracked`
- [ ] Confirm the plan branch PR title uses `[INT-1203] [plan] ...`
- [ ] Confirm the Linear issue description points at `docs/plans/2026-04-02-int-1203-linear-mcp-timeout.md`
