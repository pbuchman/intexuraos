# Plan: Remove Process-Level Timeout from Codex Entrypoint

## Problem

The Codex entrypoint (`workers/code-worker/entrypoint.sh`) wraps the entire `codex exec` process in a 60-second `timeout` derived from the Linear MCP `timeoutMs` config. This conflates two timeout domains:

- **MCP client timeout**: How long a single Linear API call can take (60s — correct, stays)
- **Process timeout**: How long the entire Codex agent session can run (60s — wrong, kills reviews mid-work)

Evidence: `task_497e2b6d` was killed after 60s with 0 review comments posted. The Gemini verifier accepted the incomplete result, finalizing the task as "reviewed."

## Solution

Remove the process-level `timeout` wrapper from `run_codex_attempt()`. The MCP client timeout (injected into `.mcp.json` by the orchestrator's `WorktreeManager.injectLinearTimeout()`) continues to protect against hung MCP calls.

## Files Changed

### 1. `workers/code-worker/entrypoint.sh`

- **Remove** `read_linear_mcp_timeout_ms()` function (lines 216-233)
- **Remove** `linear_timeout_ms` and `timeout_s` variable assignments (lines 296-298)
- **Update** evidence echo line (line 300): remove `linear_mcp_timeout_ms=` field
- **Remove** `timeout -s TERM -k 10 "${timeout_s}s" \` prefix from all 4 `codex exec` invocations (lines 324, 332, 341, 349)
- **Remove** exit code 124 check and MCP timeout log line (lines 367-370)

### 2. `workers/orchestrator/src/services/runtime/__tests__/codex-runtime.test.ts`

- **Remove** test "preserves operator-scannable timeout marker in log stream" — the entrypoint no longer emits this marker

### 3. `workers/orchestrator/src/__tests__/integration.test.ts`

- **Update** "MCP timeout marker flows through log pipeline" test — change from MCP-timeout-specific marker to a generic entrypoint log marker
- **Keep** "completion webhook accepts failure status" test — still valid for non-timeout failures, just update the example error text

## Files Unchanged

- `workers/orchestrator/src/services/worktree-manager.ts` — `injectLinearTimeout()` and `LINEAR_MCP_TIMEOUT_MS` stay. They inject `timeoutMs` into `.mcp.json` for the MCP client, not the process timeout.
- `.mcp.json` — `timeoutMs: 60000` stays. It controls the MCP client timeout.

## Out of Scope

- Gemini verifier gap (accepting 0-comment reviews) — separate issue
- Codex non-deterministic exit behavior — upstream Codex issue
