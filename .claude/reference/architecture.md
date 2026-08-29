# Architecture Overview

## Directory Structure

```
apps/<app>/src/
  domain/     → Business logic (no external deps)
  infra/      → Adapters (Firestore, APIs, etc.)
  routes/     → HTTP transport
  services.ts → DI container
workers/<worker>/src/
  index.ts    → Cloud Functions Framework entry point
  main.ts     → Business logic
  logger.ts   → Pino logger
packages/
  common-*/   → Leaf packages (Result types, HTTP helpers)
  infra-*/    → External service wrappers
terraform/    → Infrastructure as code
docker/       → Container images (code-worker, etc.)
docs/         → Documentation
```

## Apps vs Workers vs VM-Hosted Services

The monorepo has three deployment modes: Cloud Run apps, Cloud Functions workers, and VM-hosted long-running services. `workers/orchestrator` is an example of the third mode — a long-running Fastify service supervised by systemd on the `home-dev` VM (or LaunchAgent on macOS worker machines), NOT a Cloud Function — even though it lives under `workers/`.

| Aspect      | Cloud Run Apps                | Cloud Functions Workers (`log-cleanup`, `transcription`, `vm-lifecycle`) | VM-Hosted Services (`workers/orchestrator`)                               |
| ----------- | ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Deploy      | Cloud Run                     | Cloud Functions                                                          | Native Node.js process on worker machine (`systemd`/LaunchAgent)          |
| Framework   | Fastify                       | Cloud Functions Framework                                                | Fastify                                                                   |
| Scaling     | Min 0, persistent connections | Scale to zero, event-driven                                              | Long-running, single-process                                              |
| Entry Point | `server.ts`                   | `index.ts` with `functions.cloudEvent()`                                 | `main.ts` (Fastify `app.listen`)                                          |
| DI Pattern  | Full `services.ts` container  | Lightweight, direct dependency injection                                 | Lightweight, direct dependency injection (own logger, own env validation) |
| Dockerfile  | Yes (multi-stage esbuild)     | No (zip deployment)                                                      | No (managed outside `ecosystem.config.cjs`)                               |
| Coverage    | 95% required                  | 95% required                                                             | 95% required                                                              |

## CodeTask Linear Data

- `apps/code-agent` persists only `linearIssueId` on `CodeTask`.
- `linearIssueTitle`, `linearIssueUrl`, `linearIssueType`, `linearIssueLabels`, and `linearFallback` MUST NOT be stored on `CodeTask` or returned from code-agent task APIs as denormalized task fields.
- Any code path that needs Linear display data MUST REPLACE stored task-field reads with live hydration through `linearAgentClient`.
- When an API endpoint changes its task payload, update the route schema, endpoint tests, web types, API client, and consumer pages/hooks in the same change.

## Code Task Callback Model

Code-agent owns callback URL generation when it creates or drains a task. Orchestrator owns execution only. This keeps orchestrator independent from deployment environments and lets any worker machine execute tasks for any code-agent instance.

Every new public callback is production-owned and MUST use
`https://intexuraos.cloud/api/code/internal/...`. A persisted legacy DEV callback may be read for
historical investigation or a controlled recovery drill, but it is never an orchestrator fallback.
Direct `/internal/...` callback URLs are valid only for localhost/test or explicitly host-local
service URLs. `workerLocation` selects an execution machine and never selects a callback owner.
