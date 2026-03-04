# CLAUDE.md

**All rules verified by `pnpm run ci`. If CI passes, rules are satisfied.**

**Priority tiers:** **G**ates (always active) → **C**oding (during implementation) → **A**rchitecture (structural changes) → **W**orkflow (git/CI/deploy) → **R**eference (on-demand lookup).

# [G] GATES — Always Active

## ⛔ Commit Gate

Before commit: (1) `pnpm run ci:tracked` passed completely? (2) Not saying "other services/workspaces"? (3) Not saying "unrelated to my changes" or "not caused by my code"? **All YES = commit. Any NO = STOP.**

## User Control

**RULE: The user controls, Claude executes. Never assume permission to act.**

Questions/analysis/diagnosis → answer and STOP. Only act on explicit "implement", "fix", "do" instructions. Never auto-implement after analyzing, create commits after reviewing, fix issues discovered during investigation, or "while I'm here" scope creep. **Exception:** Only proceed automatically if user said "analyze AND fix" upfront.

## Ownership Mindset

Own everything from task acceptance until CI passes. No "pre-existing", no "other services", no "my part passes". See `.claude/reference/ownership-mindset.md`

# [C] CODING RULES — Every Code Change

## TypeScript Patterns

Strict mode: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

## Test-First Development

**RULE: Always write tests BEFORE implementation code.** Write failing test → run to confirm failure → implement minimal code → refactor. **Exception:** Pure refactoring of existing tested code.

## Testing

**No external deps.** In-memory fakes, `nock` for HTTP. Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`. Routes: `app.inject()`. Domain: unit tests. **Coverage: 100% branch.** Every branch covered by tests (preferred) or exempted with `/* v8 ignore <CATEGORY> -- reason @preserve */` (last resort).

**v8 ignore valid categories:** `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`. **Reference:** `.claude/reference/coverage-exemptions.md`

**Web App exception:** Coverage threshold not enforced. Tests OPTIONAL for UI, REQUIRED for `utils/`, `services/`, `hooks/`, calculations.

## Pre-Flight Checks

**RULE:** Read types BEFORE writing code. Most CI failures: code written from memory, not actual types.
- **Before mocks:** Read the `*Deps` type definition. Create mock with ALL required fields.
- **Before modifying ServiceContainer:** Read `services.ts`. Search `setServices(` in tests. Update ALL.
- **Before package imports:** Run `pnpm build` if "Cannot find module".
- **Before Result access:** Narrow first (`if (!result.ok) return result;`), then access `.value`.

## Prompt Versioning

**RULE:** All `PromptBuilder` prompts MUST have a `version` field following semver. Bump on edit: **Major** = behavior change, **Minor** = new examples/instructions, **Patch** = typos/formatting.

## Code Auditing

**RULE:** When fixing a pattern in one service, audit ALL other services for the same issue before committing.

## Linear MCP Query Safety

**RULE:** Never use broad text searches with high limits. Use `query: 'INT-445', limit: 10`. Children: `parentId: '<uuid>', limit: 20` — NOT `includeRelations`. If context overflows, `/clear` and retry with targeted queries.

# [A] ARCHITECTURE — Structural Decisions

## Architecture Overview

`apps/` (Fastify, Cloud Run) | `workers/` (Cloud Functions) | `packages/` (common-*, infra-*) | `terraform/` | `docs/`. Apps use `services.ts` DI; workers use lightweight direct injection. Both require 95% coverage. **Reference:** `.claude/reference/architecture.md`

## Key Architecture Rules

- **Import rules:** Apps can't import other apps. Routes use `getServices()`, not direct infra imports. ESLint enforced.
- **Service communication:** `/internal/{resource-name}` with `X-Internal-Auth` header. Use `validateInternalAuth()` server-side.
- **Route naming:** Public `/{resource-name}`, internal `/internal/{resource-name}`. `PATCH` partial, `PUT` full.
- **Endpoints:** ALL (`/internal/*`, webhooks, Pub/Sub) MUST use `logIncomingRequest()` at entry.
- **Pub/Sub:** Never use pull subscriptions — Cloud Run scales to zero. HTTP push only.
- **Use cases:** MUST accept `logger: Logger` as dependency.
- **Firestore:** Each collection owned by one service. Cross-service via HTTP only. Registry: `firestore-collections.json`.
- **Migrations:** IMMUTABLE. Never modify or delete. Create new migrations to fix bugs.
- **Multi-field queries:** Need composite indexes in `migrations/*.mjs`.

## Apps & Packages

**Apps:** `getServices()` for deps, `getFirestore()` singleton, `INTEXURAOS_*` env vars, `validateRequiredEnv()` at startup. New service: `/create-service`.
**Packages:** `common-*` (leaf, no deps), `infra-*` (external wrappers). No domain logic.
**Pub/Sub:** All publishers MUST extend `BasePubSubPublisher`. Topic names from env vars only.

## Environment Variables

**RULE:** Adding a new env var requires updating THREE locations: (1) `apps/<service>/src/index.ts` `REQUIRED_ENV`, (2) `terraform/environments/dev/main.tf`, (3) `ecosystem.config.cjs`. **Patterns:** `.claude/reference/env-vars-patterns.md`. **CI:** `scripts/verify-env-vars.mjs`.

## Web App (`apps/web/**`)

Hash routing only (`/#/path`). TailwindCSS, `@auth0/auth0-react`, `useApiClient`, SRP (~150 lines), `import.meta.env.INTEXURAOS_*`. Dev: Vite proxies `/api/*` to localhost. Prod: absolute Cloud Run URLs baked at build.

# [W] WORKFLOW — Git, CI, Deploy

## CI Failure Protocol

When `pnpm run ci:tracked` fails: capture output with `tee /tmp/ci-output-*.txt`, analyze with `bat`/`rg "error|FAIL" -C3`. Any failure in any workspace: fix it or ask user about scope. **Do not commit until ALL failures resolved.**

## Verification Protocol

Run all commands from repo root. (1) `pnpm run verify:workspace:tracked -- <app-name>` for targeted check. (2) Verify `packages/*/dist/` exists (missing = 50+ false lint errors). (3) `pnpm run ci:tracked` must pass before completion. **NEVER modify `vitest.config.ts` coverage exclusions or thresholds.**

## Git & PR Workflow

**Before EVERY commit:** Commit Gate must pass. **Before PR:** merge latest base branch. PRs target `development`. **Git worktrees NOT allowed.**

## Cross-Linking Protocol

PR titles contain `INT-XXX`. PR body: `Fixes INT-XXX`. **Reference:** `.claude/reference/cross-linking.md`

## Infrastructure

ALL infrastructure via Terraform only. SA key: `$HOME/.config/gcloud/sa-key.json`. **Reference:** `.claude/reference/infrastructure.md`

## Environments

dev=`dev.intexuraos.cloud` (PM2, home-dev) | prod=`intexuraos.cloud` (Cloud Run). No "local" environment. Firestore shared between both. **Reference:** `.claude/reference/environments.md`

# [R] REFERENCE — On-Demand Lookup

## User Communication

**RULE:** Ask ONE clarifying question at a time. Do not batch.

## Plan Documentation

Plans involving HTTP endpoints MUST include an "Endpoint Changes" section with tables for: Modified, Created, Removed, Unchanged.
