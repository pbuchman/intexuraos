# API Docs Hub — Technical Debt

**Last Updated:** 2026-04-07
**Analysis Run:** [2026-04-07 entry](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 2     | Low      |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |
| **Total**   | **2** | Low      |

---

## Future Plans

1. **Dynamic config reload** — Reload OpenAPI sources without requiring a full redeployment
2. **Spec caching** — Cache fetched specs server-side to improve load times and reduce dependency on service availability
3. **Authentication helper** — Built-in token management in the Swagger UI to reduce friction during API testing
4. **API version selector** — Support displaying multiple versions of each service's API
5. **Cross-spec search** — Global endpoint search across all aggregated services
6. **ecosystem.config.cjs integration** — Add api-docs-hub to the PM2 ecosystem config for local development parity

---

## Code Smells

### Low Priority

| File                               | Issue                                   | Impact                                                                                             |
| ---------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/api-docs-hub/src/server.ts`  | Health endpoint uses raw `reply.send()` | Bypasses the `reply.ok()` / `reply.fail()` response contract; intentional but undocumented in code |
| `apps/api-docs-hub/package.json`   | Unused `@intexuraos/common-core` dep    | Adds unnecessary weight to the dependency graph; import was removed from `config.ts` in v3.5.0     |

The `/health` endpoint uses `reply.send()` directly rather than `reply.ok()`. This is a deliberate exception: health check response format must be stable for infrastructure monitoring, independent of app-level response envelope changes. Adding a `// @allow-raw-send: health check format must be stable` comment would make the intent explicit.

The `@intexuraos/common-core` package is still listed as a dependency in `package.json` but is no longer imported anywhere in the source code. The shared `INTERNAL_API_SERVICE_CATALOG` was replaced by a local `OPEN_API_SOURCE_CATALOG` in `config.ts`. Removing the dependency would clean up the graph.

---

## Test Coverage Gaps

Tests cover both source files:
- `server.test.ts` — Health endpoint response shape and status, Swagger UI serving and OpenAPI spec generation
- `config.test.ts` — Environment variable validation (missing vars throw), URL trimming behavior

Coverage is adequate for this service's scope. There are no untested code paths in the current source.

---

## TypeScript Issues

None. No `any` types, no `@ts-ignore` comments, no `@ts-expect-error` annotations.

---

## TODOs / FIXMEs

None found in the codebase.

---

## SRP Violations

None. All three files have clear, single responsibilities:
- `config.ts` — Service catalog definition, environment variable validation, source list construction
- `server.ts` — Fastify setup with Swagger UI and health endpoint
- `index.ts` — Entry point with Sentry initialization

---

## Code Duplicates

The local `OPEN_API_SOURCE_CATALOG` in `config.ts` duplicates service names and env var mappings that also exist in `@intexuraos/common-core`'s `INTERNAL_API_SERVICE_CATALOG`. This was an intentional revert from the shared catalog approach. The duplication is limited to this one file and the catalog changes infrequently.

---

## Deprecations

None.

---

## Resolved Issues

| Date       | Issue                                             | Resolution                                                                |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| 2026-04-07 | Shared catalog import from common-core            | Reverted to local `OPEN_API_SOURCE_CATALOG` for self-contained config     |
| 2026-04-07 | No config.test.ts                                 | Added `config.test.ts` covering env var validation and URL trimming       |
| 2026-03-22 | Hardcoded 18-service config in config.ts          | Replaced with shared `INTERNAL_API_SERVICE_CATALOG` from common-core      |
| 2026-03-22 | No test coverage                                  | Added `server.test.ts` with health check and Swagger UI tests             |
| 2026-03-22 | Missing cron-agent and hellscript-agent specs     | Added via shared catalog (20 services total)                              |
| 2026-03-15 | Package version bump to 3.3.0                     | Release v3.3.0 — no source changes, package.json version updated          |
| 2026-03-07 | Package version bump to 3.2.0                     | Release v3.2.0 — no source changes, package.json version updated          |
| 2026-02-22 | Missing code-agent, linear-agent, web-agent specs | Added 3 new `INTEXURAOS_*_OPENAPI_URL` env vars, bumped spec to 0.0.5     |
| 2026-02-16 | Dev-mode log formatting                           | `createLogStream()` now emits human-readable output under PM2             |
| 2026-02-14 | Broken start:local script                         | Fixed to use `tsx` instead of `node --experimental-strip-types`           |
| 2026-02-01 | Chat Agent spec missing                           | Added `INTEXURAOS_CHAT_AGENT_OPENAPI_URL` env var (INT-431)               |
| 2026-01-26 | PromptVault reference after removal               | Removed `INTEXURAOS_PROMPTVAULT_SERVICE_OPENAPI_URL` env var (INT-319)    |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
