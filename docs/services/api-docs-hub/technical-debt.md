# API Docs Hub — Technical Debt

**Last Updated:** 2026-03-22
**Analysis Run:** [2026-03-22 entry](../../documentation-runs.md)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 1     | Low      |
| Test Gaps   | 0     | -        |
| Type Issues | 0     | -        |
| TODOs       | 0     | -        |
| **Total**   | **1** | Low      |

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

The `/health` endpoint uses `reply.send()` directly rather than `reply.ok()`. This is a deliberate exception: health check response format must be stable for infrastructure monitoring, independent of app-level response envelope changes. Adding a `// @allow-raw-send: health check format must be stable` comment would make the intent explicit and pass the `verify:reply-send` check.

---

## Test Coverage Gaps

Tests were added in v3.4.0 (`server.test.ts`) covering:
- Health endpoint response shape and status
- Swagger UI serving and OpenAPI spec generation

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
- `config.ts` — environment variable validation and source loading via shared catalog
- `server.ts` — Fastify setup with Swagger UI and health endpoint
- `index.ts` — entry point with Sentry initialization

---

## Code Duplicates

None identified. The v3.4.0 refactor eliminated the primary duplication (hardcoded env var list) by adopting the shared `INTERNAL_API_SERVICE_CATALOG` from `@intexuraos/common-core`.

---

## Deprecations

None.

---

## Resolved Issues

| Date       | Issue                                             | Resolution                                                                |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| 2026-03-22 | Hardcoded 18-service config in config.ts          | Replaced with shared `INTERNAL_API_SERVICE_CATALOG` from common-core      |
| 2026-03-22 | No test coverage                                  | Added `server.test.ts` with health check and Swagger UI tests             |
| 2026-03-22 | Missing cron-agent and hellscript-agent specs     | Added via shared catalog (20 services total)                              |
| 2026-03-15 | Package version bump to 3.3.0                     | Release v3.3.0 — no source changes, package.json version updated          |
| 2026-03-07 | Package version bump to 3.2.0                     | Release v3.2.0 — no source changes, package.json version updated          |
| 2026-02-22 | Missing code-agent, linear-agent, web-agent specs | Added 3 new `INTEXURAOS_*_OPENAPI_URL` env vars, bumped spec to 0.0.5     |
| 2026-02-16 | Dash0 OTel integration                            | `@intexuraos/infra-otel` added; log pipeline forwards to Dash0 via OTLP   |
| 2026-02-16 | Dev-mode log formatting                           | `createLogStream()` now emits human-readable output under PM2             |
| 2026-02-14 | Broken start:local script                         | Fixed to use `tsx` instead of `node --experimental-strip-types`           |
| 2026-02-01 | Chat Agent spec missing                           | Added `INTEXURAOS_CHAT_AGENT_OPENAPI_URL` env var (INT-431)               |
| 2026-01-26 | PromptVault reference after removal               | Removed `INTEXURAOS_PROMPTVAULT_SERVICE_OPENAPI_URL` env var (INT-319)    |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
