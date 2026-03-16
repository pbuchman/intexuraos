# API Docs Hub — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** [2026-03-15 entry](../../documentation-runs.md)

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

No test files exist for this service. Coverage is not enforced because the service has no domain logic, no business rules, and no complex branching. All behavior is configuration-driven.

---

## TypeScript Issues

None. No `any` types, no `@ts-ignore` comments, no `@ts-expect-error` annotations.

---

## TODOs / FIXMEs

None found in the codebase.

---

## SRP Violations

None. All three files have clear, single responsibilities:
- `config.ts` — environment variable validation and source loading
- `server.ts` — Fastify setup with Swagger UI and health endpoint
- `index.ts` — entry point with Sentry initialization

---

## Code Duplicates

None identified.

---

## Deprecations

None.

---

## Resolved Issues

| Date       | Issue                                             | Resolution                                                                |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
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
