---
name: debug-code-task
description: Use when user pastes a dev.intexuraos.cloud or intexuraos.cloud code-task URL and asks to debug, investigate, or understand what went wrong. Also use when user mentions a code task ID (task_*) with investigation intent.
---

# Debug Code Task

Investigate code-agent task execution by fetching task metadata and logs from Firestore.

## Invocation Detection

| Input Pattern                                           | Action                    |
| ------------------------------------------------------- | ------------------------- |
| `https://dev.intexuraos.cloud/#/code-tasks/task_*`      | Extract task ID, env=dev  |
| `https://intexuraos.cloud/#/code-tasks/task_*`          | Extract task ID, env=prod |
| `task_<uuid>` + "debug"/"investigate"/"what went wrong" | Use task ID directly      |

## Phase 1: Environment Detection

Parse the URL. Do NOT fetch it — hash-routed SPA returns only shell HTML.

| Signal | dev                    | prod                           |
| ------ | ---------------------- | ------------------------------ |
| URL    | `dev.intexuraos.cloud` | `intexuraos.cloud` (no `dev.`) |

Run `uname -n` to confirm current machine.

## Phase 2: Fetch Task Document

Extract task ID from URL hash: `/#/code-tasks/{taskId}` — everything after the last `/`.

Run from **monorepo root** (required for `firebase-admin` module resolution):

```bash
node .claude/skills/debug-code-task/scripts/fetch-task.cjs <taskId>
```

Print key fields as a summary table: `id`, `status`, `linearIssueId`, `workerLocation`, `agentType`, `result.summary`, `error`.

## Phase 3: Fetch Log Lines

```bash
node .claude/skills/debug-code-task/scripts/fetch-task.cjs <taskId> --logs-only
```

Use `--logs` instead to fetch both task document and logs in one call. Pipe through `head -N` if user wants a subset. Logs are ordered by sequence number. Each line has format: `[sequence] HH:MM:SS.mmm [source] message`.

Present log lines to user. Do NOT analyze or speculate about root cause without evidence from the logs.

## Phase 4: Orchestrator & Container Logs (optional, on request)

Only needed when Firestore logs are insufficient.

The orchestrator runs on the same machine as the worker. Read `workerLocation` from the task document (Phase 2) to determine which machine.

### Orchestrator Logs

Check `uname -n` vs task's `workerLocation`. If on a different machine:

- From **mac-dev** → SSH to home-dev: `ssh home-dev journalctl -u intexuraos-orchestrator@pbuchman --since ... --until ...`
- From **home-dev** → cannot SSH to mac-dev. Tell the user.

| Machine      | How orchestrator runs                                      | Log command                                                                        |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **home-dev** | systemd (`intexuraos-orchestrator@pbuchman`)               | `journalctl -u intexuraos-orchestrator@pbuchman --since "<time>" --until "<time>"` |
| **mac-dev**  | `pnpm --filter orchestrator dev` in `~/deploy/intexuraos/` | Terminal output where the dev process is running. Code not auto-deployed on push.  |

Derive time window from task document `createdAt._seconds` and `completedAt._seconds`:

```bash
date -d @<createdAt._seconds> '+%Y-%m-%d %H:%M:%S'   # --since (subtract 1 min)
date -d @<completedAt._seconds> '+%Y-%m-%d %H:%M:%S'  # --until (add 1 min)
```

### Docker Container Logs

Containers are named `claude-worker-{taskId}`:

```bash
docker logs claude-worker-{taskId}
```

Only available while the container exists (running or exited but not yet removed). If the container is gone, Firestore log lines (Phase 3) are the only source.

## Critical Rules

1. **NEVER WebFetch/curl the SPA URL.** Data is in Firestore, not the HTML page.
2. **NEVER run node scripts from `/tmp`.** `firebase-admin` resolves from monorepo `node_modules`.
3. **NEVER use `node -e` for scripts with `!`.** Shell escapes `!` — use the script file.
4. **NEVER speculate about what went wrong.** Present facts from the task document and logs. Let the user drive analysis.
