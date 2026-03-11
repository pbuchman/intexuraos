---
name: debug-code-task
description: Investigate IntexuraOS code-task executions when the user shares a `dev.intexuraos.cloud` or `intexuraos.cloud` code-task URL, or provides a `task_*` ID and asks to debug, investigate, or understand what happened.
---

# Debug Code Task

Use this skill for code-task investigations backed by Firestore data.

## Trigger patterns

- `https://dev.intexuraos.cloud/#/code-tasks/task_*`
- `https://intexuraos.cloud/#/code-tasks/task_*`
- `task_*` plus intent such as `debug`, `investigate`, or `what went wrong`

## Workflow

1. Extract the task ID from the URL hash or direct `task_*` input.
2. Detect the environment from the URL.
   - `dev.intexuraos.cloud` = dev
   - `intexuraos.cloud` without `dev.` = prod
3. Never fetch the SPA URL. The page is hash-routed; the task data lives in Firestore.
4. Confirm the current machine with `uname -n`.
5. Prefer the bundled wrapper `scripts/fetch-task.sh`, which resolves the local repo and runs the repo script.

## Task document

Run:

```bash
scripts/fetch-task.sh <taskId>
```

The wrapper uses the checked-out repo for `firebase-admin` module resolution and expects credentials at `~/.config/gcloud/sa-key.json`.

Summarize these fields for the user when present:

- `id`
- `status`
- `linearIssueId`
- `workerLocation`
- `agentType`
- `result.summary`
- `error`

## Log lines

Run:

```bash
scripts/fetch-task.sh <taskId> --logs-only
```

Use `--logs` if you want the task document and logs in one call. Logs are ordered by sequence number and printed as `[sequence] message`.

Present log evidence directly. Do not infer a root cause unless the logs or task document support it.

## Optional follow-up logs

Only do this when Firestore logs are not enough or the user asks.

- Read `workerLocation` from the task document first.
- If the task ran on `home-dev` and you are elsewhere, use `ssh home-dev`.
- Orchestrator logs on `home-dev`:

```bash
journalctl -u intexuraos-orchestrator@pbuchman --since "<time>" --until "<time>"
```

- Docker container logs while the container still exists:

```bash
docker logs claude-worker-<taskId>
```

Derive the time window from the task document timestamps and pad it by about one minute on each side.

## Rules

- Never `curl` or web-fetch the code-task SPA URL.
- Never run the Firestore script from `/tmp`.
- Never use `node -e` for commands that may include `!`.
- Stay factual. Show the task document and logs before offering conclusions.
