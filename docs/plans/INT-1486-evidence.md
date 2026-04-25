# INT-1486 — Plan Evidence

- **Linear issue:** [INT-1486](https://linear.app/pbuchman/issue/INT-1486/sec-e2e-modetrue-env-var-disables-jwt-auth-without-production-guard)
- **Classification:** SIMPLE (single-file mechanical fix in `apps/code-agent`, with tests)
- **Planned at:** 2026-04-25
- **Worker Type:** opus
- **Model:** opus

## Summary

`apps/code-agent/src/infra/auth/jwtValidator.ts:49-57` swaps the real Auth0 JWT validator for a mock when `E2E_MODE=true` with no environment guard, allowing any caller to impersonate any user if that env var ever leaks into a production Cloud Run revision.

The plan is captured **in-place on the Linear issue description**: requirements, fix specification, file list, TDD test plan (5 cases), acceptance criteria, and verification commands. This file exists as auditable evidence that planning ran against INT-1486.

## Implementation Sketch (executor reads the Linear issue for the full plan)

1. In `createJwtValidator()`, before the `E2E_MODE === 'true'` branch, throw a descriptive `Error` when `INTEXURAOS_ENVIRONMENT === 'production'` AND `E2E_MODE === 'true'`. Error message must reference both env var names.
2. Otherwise keep current behavior: mock validator for non-prod E2E, real Auth0 validator otherwise.
3. Add 5 new tests in `apps/code-agent/src/__tests__/infra/auth/jwtValidator.test.ts` using `vi.stubEnv` / `vi.unstubAllEnvs`:
   - prod + E2E → throws
   - dev + E2E → mock validator
   - unset env + E2E → mock validator
   - prod, no E2E → real validator
   - prod + `E2E_MODE=false` → real validator
4. Verify with `pnpm run verify:workspace:tracked -- code-agent` then `pnpm run ci:tracked`.

## Memory Application

- `mem_1b75663c` — applied: production guard + verification step matches AC #1 / #2.
- `mem_6067c42b` — applied: tests follow project convention (env stubbing block already used in the file; no service container shortcuts).
- `mem_e75168f2` — rejected: OIDC audience verification is unrelated to this E2E mock guard.
