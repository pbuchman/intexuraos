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
docs/         → Documentation
```

## Apps vs Workers

| Aspect      | Apps                          | Workers                                  |
| ----------- | ----------------------------- | ---------------------------------------- |
| Deploy      | Cloud Run                     | Cloud Functions                          |
| Framework   | Fastify                       | Cloud Functions Framework                |
| Scaling     | Min 0, persistent connections | Scale to zero, event-driven              |
| Entry Point | `server.ts`                   | `index.ts` with `functions.cloudEvent()` |
| DI Pattern  | Full `services.ts` container  | Lightweight, direct dependency injection |
| Dockerfile  | Yes (multi-stage esbuild)     | No (zip deployment)                      |
| Coverage    | 95% required                  | 95% required                             |

## CodeTask Linear Data

- `apps/code-agent` persists only `linearIssueId` on `CodeTask`.
- `linearIssueTitle`, `linearIssueUrl`, `linearIssueType`, `linearIssueLabels`, and `linearFallback` MUST NOT be stored on `CodeTask` or returned from code-agent task APIs as denormalized task fields.
- Any code path that needs Linear display data MUST REPLACE stored task-field reads with live hydration through `linearAgentClient`.
- When an API endpoint changes its task payload, update the route schema, endpoint tests, web types, API client, and consumer pages/hooks in the same change.
