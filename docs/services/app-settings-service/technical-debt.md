# App Settings Service — Technical Debt

**Last Updated:** 2026-04-22
**Analysis Run:** [2026-04-22 entry](#)

---

## Summary

| Category    | Count | Severity |
| ----------- | ----- | -------- |
| Code Smells | 3     | High     |
| Test Gaps   | 1     | High     |
| Type Issues | 0     | ---      |
| TODOs       | 0     | ---      |
| **Total**   | **4** | ---      |

---

## Future Plans

1. **Evaluate decommissioning** — The service has no business endpoints after v3.6.0. Determine whether it should be retired entirely or repurposed for new platform-wide settings (budget management, feature flags, etc.)
2. **Remove startup dependency chain** — If decommissioned, update `ecosystem.config.cjs` `waitForService` entries for user-service, commands-agent, actions-agent, and research-agent
3. **Clean up Firestore registry** — The `settings` collection in `firestore-collections.json` is still owned by this service but unused
4. **Remove stale package dependency** — `@intexuraos/llm-contract` is listed in `package.json` but no source file imports it

---

## Code Smells

### High Priority

| File                    | Issue                                  | Impact                                                                                |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Entire service          | Service is an empty shell              | Consumes Cloud Run resources, CI time, and developer attention with no business value |
| `ecosystem.config.cjs`  | 5 services depend on health endpoint   | Creates a false startup dependency on a service with no functionality                 |
| `package.json`          | `@intexuraos/llm-contract` dependency  | Unused dependency increases build/install time                                        |

**Details:** After INT-1387 and INT-1342 migrated all LLM pricing and usage cost functionality to `llm-usage-service`, the service retains only system endpoints (`/health`, `/openapi.json`, `/docs`). The domain ports, Firestore infra, and service container are all empty scaffolds. Five downstream services still poll its health endpoint at startup despite no business reason to do so.

**Resolution path:** Either (a) decommission the service and remove startup dependencies, or (b) repurpose it for new platform configuration features (e.g., budget management, feature flags, notification preferences).

---

## Test Coverage Gaps

| File/Module   | Coverage | Missing                                                    |
| ------------- | -------- | ---------------------------------------------------------- |
| `server.ts`   | 0%       | All test files were removed with the pricing migration     |
| `index.ts`    | 0%       | Entry point untested                                       |
| `services.ts` | 0%       | DI container untested (though it holds no real services)   |

**Note:** The `vitest run` command will find no test files. This is a coverage enforcement gap.

---

## TypeScript Issues

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

---

## TODOs / FIXMEs

No TODO, FIXME, or HACK comments found in source code.

---

## SRP Violations

| File        | Issue                                                                   | Suggestion                                            |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `server.ts` | Handles server setup, OpenAPI config, schema registration, health check | Minor concern given the service's minimal scope       |

---

## Code Duplicates

None found. The service has minimal code.

---

## Deprecations

| Item                              | Location                        | Replacement                              | Deadline    |
| --------------------------------- | ------------------------------- | ---------------------------------------- | ----------- |
| Entire pricing domain             | Removed in v3.6.0               | `llm-usage-service`                      | Completed   |
| `settings` Firestore collection   | `firestore-collections.json`    | Needs ownership transfer or removal      | TBD         |

---

## Resolved Issues

| Date       | Issue                                    | Resolution                                                                                                          |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-04-11 | LLM pricing owned by settings service    | Migrated to llm-usage-service (INT-1339, INT-1342, INT-1387)                                                        |
| 2026-04-11 | Usage costs page and backend             | Deleted — functionality moved to llm-usage-service                                                                  |
| 2026-04-11 | Duplicated parallel-provider-fetch logic | Moot — all pricing code removed                                                                                     |
| 2026-04-11 | Hardcoded Firestore collection path      | Moot — Firestore pricing infra removed                                                                              |
| 2026-03-24 | v8 ignore comment wording non-standard   | Updated to stricter blocker-keyword format                                                                          |
| 2026-03-12 | ZAI provider and GLM-4.7 models stale    | Removed ZAI provider, finalized GLM-5 models                                                                        |
| 2026-02-02 | 100% branch coverage not enforced        | Strict enforcement enabled (now moot — no test files remain)                                                        |
| 2026-02-01 | Response contract violations             | Internal route migrated to standardized `reply.ok()` / `reply.fail()`                                               |
| 2026-02-01 | Direct `pino()` usage                    | Replaced with `createAppLogger()` from `@intexuraos/infra-sentry`                                                   |
| 2026-02-01 | Inconsistent internal error format       | Standardized to `{ success: false, error: { code, message } }`                                                      |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Documentation Run Log](../../documentation-runs.md)
