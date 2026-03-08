# Orchestrator Task Adoption on Restart

**Date:** 2026-02-28
**Status:** Approved
**Linear:** (to be created)

## Problem

When the orchestrator restarts, it loses in-memory task state. Currently, `runStartupRecovery()` marks all persisted running tasks as `interrupted` and sends webhooks — but Docker containers survive the restart. This leads to:

1. Running containers with active Claude sessions are abandoned (Claude is killed when the exec stream disconnects, but the container stays alive)
2. If the `interrupted` webhook fails, tasks get permanently stuck in `running` state in Firestore
3. The `detect-zombies` safety net endpoint returns `INTERNAL_ERROR`, so no fallback catches stuck tasks

**Evidence (task_26834405):** Task completed successfully, webhook delivery failed, orchestrator restarted before retry succeeded, in-memory retry queue was lost, zombie detection broken. Task stayed `running` in Firestore for 24+ hours.

## Approach: Adopt Running, Nuke Exited

On startup, the orchestrator discovers orphaned containers via Docker and cross-references them with persisted state. Running containers with matching state are adopted (new `--continue` attempt). Everything else is cleaned up.

## Startup Adoption Flow

```
1. Docker: list all claude-worker-* containers (running + exited)
2. State: load state.json tasks with status=running
3. For each container:
   ├─ Running + has state → ADOPT (re-register, --continue attempt)
   ├─ Running + no state  → STOP & REMOVE
   ├─ Exited + has state  → REMOVE + send interrupted webhook
   └─ Exited + no state   → REMOVE (silent)
4. For tasks in state with NO container → send interrupted webhook
5. Retry any pending webhooks from state.json
6. Start heartbeat, accept new tasks
```

## Container Discovery & Matching

TaskId is extracted from container name via existing pattern `claude-worker-{taskId}`.

Two data sources are joined by taskId:
- **Docker containers** — discovered via `docker ps -a --filter name=claude-worker-`
- **State.json tasks** — persisted task objects with `status: running`

### Adoption details

"Adopt" means:
1. Re-register the container in the `workers` map
2. Call `runAttemptInContainer()` with `continueSession: true`
3. Task dispatcher re-registers timeout timers and monitor interval
4. Heartbeat automatically picks up the task via `getRunningTaskIds()`

This reuses the existing orphan detection code path at `docker-provider.ts:424-487`.

### State required for adoption

From `state.json`: `webhookUrl`, `webhookSecret`, `workerType`, `worktreePath`, `agentType`, `attemptCount`, `maxAttempts`.

## Edge Cases

| Scenario                                       | Behavior                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Docker daemon unreachable on startup           | Log error, fall back to state-only recovery. Orchestrator still starts.                   |
| Container running but state.json empty         | No state → STOP & REMOVE. Firestore relies on zombie detection as safety net.             |
| Adoption succeeds but --continue attempt fails | Normal attempt failure flow — completion verifier runs, webhook sent.                     |
| Multiple rapid restarts                        | Each restart lists containers fresh. Already-adopted tasks are in-memory, not re-adopted. |
| Container running but worktree deleted         | runAttemptInContainer fails. Treated as failed attempt — webhook sent with error.         |
| Task already at maxAttempts                    | Don't adopt — STOP & REMOVE, send interrupted webhook.                                    |
| Adoption phase exceeds 60s deadline            | Skip remaining containers, remove them.                                                   |

## Changes

| File                   | Change                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `main.ts`              | Replace `runStartupRecovery()` with new adoption flow coordinating Docker + state          |
| `docker-provider.ts`   | New `listWorkerContainers()` method to discover all `claude-worker-*` containers           |
| `task-dispatcher.ts`   | New `adoptTask()` method that re-registers timers/monitors and triggers --continue attempt |
| `detect-zombies` route | Fix `INTERNAL_ERROR` in the code-agent endpoint                                            |

## What doesn't change

- Container naming convention (`claude-worker-{taskId}`)
- Webhook client / retry mechanism
- Heartbeat system (automatically picks up adopted tasks)
- `state.json` persistence format

## Key architectural constraint

Docker exec streams are client-side. When the orchestrator dies, Docker kills the exec'd Claude process. The container stays alive (managed mode idle loop), but Claude is dead. "Resume monitoring" is impossible — the only option is starting a new `--continue` attempt.
