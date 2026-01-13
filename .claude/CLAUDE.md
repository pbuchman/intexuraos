# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# IntexuraOS — Claude Instructions

**All rules below are verified by `npm run ci`. If CI passes, rules are satisfied.**

---

## Ownership Mindset (MANDATORY)

**RULE:** Any issue you find in the codebase is YOUR issue to fix. NEVER claim there were "pre-existing issues" or "pre-existing bugs."

- You see a problem → you own it → you fix it
- No finger-pointing at "previous state" or "prior work"
- Unless user EXPLICITLY tells you otherwise (e.g., "ignore X", "this is a known issue"), assume responsibility

**Corollary:** If you're unsure whether something is your responsibility, ASK — don't assume it's someone else's debt.

---

## Verification (MANDATORY)

### Step 1: Targeted Verification (per workspace)

When modifying a specific app, first verify that workspace passes all checks:

```bash
npm run verify:workspace:tracked -- <app-name>   # e.g. research-agent
```

This runs (in order):

1. TypeCheck (source) — workspace-specific
2. TypeCheck (tests) — workspace-specific
3. Lint — workspace-specific
4. Tests + Coverage — 95% threshold per workspace

### Step 2: Full CI

```bash
npm run ci:tracked            # MUST pass before task completion (auto-tracks failures)
tf fmt -check -recursive      # If terraform changed (from /terraform)
tf validate                   # If terraform changed
```

Failure data is stored in `.claude/ci-failures/` for learning. Run `npm run ci:report` to see patterns.

**IMPORTANT:** Use `tf` command instead of `terraform`. This alias clears emulator env vars that break Terraform:

```bash
alias tf='STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform'
```

Note: The alias may not be available in spawned subshells - if `tf` is not found, the user should run commands manually.

**Do not claim complete until verification passes.**

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

**ALWAYS commit `.claude/ci-failures/*` files with your changes.** These track verification failures for learning and pattern analysis.

---

## Architecture

```
apps/<app>/src/
  domain/     → Business logic (no external deps)
  infra/      → Adapters (Firestore, APIs, etc.)
  routes/     → HTTP transport
  services.ts → DI container
packages/
  common-*/   → Leaf packages (Result types, HTTP helpers)
  infra-*/    → External service wrappers
terraform/    → Infrastructure as code
docs/         → Documentation
```

### Import Rules

**ESLint enforced.** Apps can't import other apps. Routes use `getServices()`, not direct infra imports.

### Service-to-Service Communication

Pattern: `/internal/{resource-name}` with `X-Internal-Auth` header. Use `validateInternalAuth()` server-side.

Docs: [docs/architecture/service-to-service-communication.md](../docs/architecture/service-to-service-communication.md)

### Route Naming Convention

- **Public routes:** `/{resource-name}` (e.g., `/todos`, `/bookmarks/:id`)
- **Internal routes:** `/internal/{resource-name}` (e.g., `/internal/todos`, `/internal/bookmarks/:id`)
- **HTTP methods:** Use `PATCH` for partial updates, `PUT` for full replacement

Avoid redundant paths like `/internal/todos/todos` — use simple `/internal/todos`.

### Endpoint Logging

**RULE:** ALL endpoints (`/internal/*`, webhooks, Pub/Sub) MUST use `logIncomingRequest()` at entry BEFORE auth/validation.

- Headers auto-redacted via `SENSITIVE_FIELDS`
- Include `messageId` for Pub/Sub, `eventId` for webhooks
- Reference: `apps/actions-agent/src/routes/internalRoutes.ts`, `apps/whatsapp-service/src/routes/webhookRoutes.ts`

### Pub/Sub Subscriptions

**RULE:** Never use pull subscriptions — Cloud Run scales to zero. Use HTTP push endpoints only.

### Use Case Logging

**RULE:** Use cases MUST accept `logger: Logger` as dependency. See [docs/patterns/use-case-logging.md](../docs/patterns/use-case-logging.md).

### Firestore Collections

**RULE:** Each collection owned by exactly ONE service. Cross-service access via HTTP only.

- Registry: `firestore-collections.json`
- Verification: `npm run verify:firestore`
- Docs: [docs/architecture/firestore-ownership.md](../docs/architecture/firestore-ownership.md)

### Firestore Composite Indexes

**RULE:** Multi-field queries require composite indexes. Define them in migrations (`migrations/*.mjs`) using `indexes` export. Queries fail in production without them.

### Migrations

**RULE:** Migrations are IMMUTABLE. Never modify or delete existing migration files. Only create new migrations with the next sequential number. If a migration has a bug, create a new migration to fix it.

---

## Apps (`apps/**`)

- Use `getServices()` for deps, `getFirestore()` singleton for DB
- Env vars: `INTEXURAOS_*` prefix (except `NODE_ENV`, `PORT`, emulators)
- Fail-fast: `validateRequiredEnv()` at startup, must match Terraform config
- New service: Use `/create-service` command

---

## Packages (`packages/**`)

`common-*` are leaf packages (no deps). `infra-*` wrap external services. No domain logic in packages.

---

## Pub/Sub Publishers (`packages/infra-pubsub`)

**RULE:** All publishers MUST extend `BasePubSubPublisher`. Topic names from env vars only (no hardcoding).

Verification: `npm run verify:pubsub`. Docs: [docs/architecture/pubsub-standards.md](../docs/architecture/pubsub-standards.md)

### New Topic Registration (MANDATORY)

**RULE:** When adding a NEW Pub/Sub topic, you MUST update THREE locations:

1. **Terraform:** `terraform/environments/dev/main.tf` — Add `module "pubsub_<topic-name>"` declaration
2. **Pub/Sub UI:** `tools/pubsub-ui/server.mjs` — Add to `TOPICS` array and `TOPIC_ENDPOINTS` mapping
3. **Test Script:** `scripts/pubsub-publish-test.mjs` — Add event template to `EVENTS` object

**Why:** The Pub/Sub UI auto-creates topics on emulator startup and provides manual testing interface. Missing registration breaks local development workflow.

**Files to update:**

- `tools/pubsub-ui/server.mjs` — TOPICS array + TOPIC_ENDPOINTS object
- `tools/pubsub-ui/index.html` — CSS styles, dropdown option, EVENT_TEMPLATES
- `tools/pubsub-ui/README.md` — Documentation tables
- `scripts/pubsub-publish-test.mjs` — Event type + usage docs

---

## Terraform (`terraform/**`)

**Gotchas:**

- Cloud Run images managed by Cloud Build, not Terraform (uses `ignore_changes`)
- "Image not found": run `./scripts/push-missing-images.sh` for new services
- Web app: backend buckets need URL rewrite for `/` → `/index.html`

---

## Cloud Build & Deployment

### Build Pipeline Architecture

**CI:** `.github/workflows/ci.yml` runs `npm run ci` on all branches (lint, typecheck, test, build)

**Deploy:** `.github/workflows/deploy.yml` triggers on push to `development` branch only:

1. Runs `.github/scripts/smart-dispatch.mjs` to analyze changes
2. Triggers Cloud Build based on strategy:
   - **MONOLITH** — Rebuild all (>3 affected OR global change) → `intexuraos-dev-deploy` trigger
   - **INDIVIDUAL** — Rebuild affected only (≤3) → `<service>` triggers in parallel
   - **NONE** — No deployable changes, skip

**Manual override:** `workflow_dispatch` with `force_strategy: monolith` to rebuild all

**Global Triggers** (force MONOLITH): `terraform/`, `cloudbuild/cloudbuild.yaml`, `cloudbuild/scripts/`, `package-lock.json`, `tsconfig.base.json`

### File Locations

| Purpose                  | File                                     |
| ------------------------ | ---------------------------------------- |
| CI workflow              | `.github/workflows/ci.yml`               |
| Deploy workflow          | `.github/workflows/deploy.yml`           |
| Smart dispatch           | `.github/scripts/smart-dispatch.mjs`     |
| Main pipeline (all)      | `cloudbuild/cloudbuild.yaml`             |
| Per-service pipeline     | `apps/<service>/cloudbuild.yaml`         |
| Deploy scripts           | `cloudbuild/scripts/deploy-<service>.sh` |
| Trigger definitions (TF) | `terraform/modules/cloud-build/main.tf`  |

### Adding a New Service to Cloud Build

1. Add build+deploy steps to `cloudbuild/cloudbuild.yaml`
2. Create `apps/<service>/cloudbuild.yaml`
3. Create `cloudbuild/scripts/deploy-<service>.sh`
4. Add to `docker_services` in `terraform/modules/cloud-build/main.tf`
5. Add to `SERVICES` array in `.github/scripts/smart-dispatch.mjs`

**First deployment:** Service must exist in Terraform before Cloud Build can deploy. Run `./scripts/push-missing-images.sh` for new services.

---

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`) — backend buckets don't support SPA fallback.

**Rules:** TailwindCSS only, `@auth0/auth0-react` for auth, `useApiClient` for API calls, SRP (split at ~150 lines), env vars via `import.meta.env.INTEXURAOS_*`.

---

## TypeScript Patterns

Strict mode enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Compiler errors guide fixes — use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

---

## Common LLM Mistakes (LEARN FROM HISTORY)

These patterns cause 80% of CI failures. Internalize them.

### 1. ESM Imports — Always use `.js` extension

```typescript
// ❌ import { foo } from '../services/bar';
// ✅ import { foo } from '../services/bar.js';
```

### 2. ServiceContainer — Check existing tests before adding services

When modifying `ServiceContainer`, **read existing test files first** to see all required fields.
New fields break ALL tests that use `setServices()`.

```typescript
// ❌ Adding new service without updating tests
setServices({ existingRepo: fakeRepo }); // Missing new required field!

// ✅ Check services.ts interface, update ALL test files
setServices({ existingRepo: fakeRepo, newService: fakeNewService });
```

### 3. exactOptionalPropertyTypes — Use `?:` not `| undefined`

```typescript
// ❌ type Deps = { logger: Logger | undefined };
// ✅ type Deps = { logger?: Logger };
```

### 4. Template Literals — Wrap non-strings with `String()`

```typescript
// ❌ `Status: ${response.status}` // status is number
// ✅ `Status: ${String(response.status)}`
```

---

## Code Smells (Fix & Document)

**RULE:** When fixing a new smell, add it here.

| Smell                      | ❌ Wrong                       | ✅ Fix                    |
| -------------------------- | ------------------------------ | ------------------------- |
| Silent catch               | `catch {}`                     | `catch { /* reason */ }`  |
| Inline error               | `error instanceof Error ? ...` | `getErrorMessage(error)`  |
| Throw in try               | `try { if (x) throw } catch`   | Separate blocks           |
| Re-export from services.ts | `export * from './infra/...'`  | Only export DI functions  |
| Module-level state         | `let logger: Logger`           | Pass to factory functions |
| Test fallback in prod      | `container ?? { fake }`        | Throw if not init         |
| Domain in infra            | `maskApiKey()` in infra        | Move to common-core       |
| Infra re-exports domain    | `export type from domain`      | Import where needed       |
| Manual header redaction    | Inline `[REDACTED]`            | `logIncomingRequest()`    |
| Redundant variable         | `const r = f(); return r`      | `return f()`              |
| Redundant check            | Check after type guard         | Trust narrowing           |
| Console logging            | `console.info()` in infra      | Accept `logger?` param    |

**Known debt:** OpenAPI schemas duplicated per server.ts (Fastify types limitation).

---

## Code Auditing & Consistency

**RULE:** When fixing a pattern in one service, audit ALL other services for the same issue before committing.

**Full guide:** [docs/patterns/auditing.md](../docs/patterns/auditing.md)

---

## Test-First Development (MANDATORY)

**RULE: Always write tests BEFORE implementation code.**

When adding new functionality:

1. **Write failing test first** — Define expected behavior in test file
2. **Run test to confirm it fails** — Validates test is actually testing something
3. **Implement minimal code** — Only enough to make the test pass
4. **Refactor if needed** — Clean up while keeping tests green

### Workflow Example

```
❌ WRONG: Write usecase → Write test → Fix coverage
✅ RIGHT: Write test (fails) → Write usecase (passes) → Verify coverage
```

### What This Means

- **New use case?** First create `__tests__/usecases.test.ts` with test cases
- **New route?** First add test in `__tests__/<routes>.test.ts`
- **New domain model?** First write validation tests

**Exception:** Pure refactoring of existing tested code doesn't require new tests first.

---

## Testing

**No external deps.** In-memory fakes, `nock` for HTTP. Just `npm run test`.

- TypeScript: `npm run typecheck:tests` (uses `tsconfig.tests-check.json`)
- Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`
- Routes: integration via `app.inject()`. Domain: unit tests. Infra: tested via routes.
- **Coverage: 95%. NEVER modify thresholds — write tests.**

### Web App Exception

The `web` workspace has adjusted verification (planned complete refactoring):

- Tests run but **coverage threshold is not enforced**
- Test typecheck step skipped (Vite-specific patterns incompatible with strict tsconfig)
- Tests remain in nested `__tests__` directories within feature folders

**Tests are OPTIONAL for UI components** (pages, layout, styling).

**Tests are REQUIRED for:**

- Helper functions (`utils/`)
- Services with logic (`services/`)
- Hooks with business logic (`hooks/`)
- Calculations, parsers, evaluators

Use the same command: `npm run verify:workspace:tracked -- web` — adjusted behavior is automatic.

---

## Git Push Policy

**RULE: NEVER push without explicit instruction.**

- `"commit"` → local only, no push
- `"commit and push"` → push once
- Multiple commits → ask before pushing

---

## Complex Tasks — Continuity Workflow

For multi-step features, use numbered directories in `continuity/`. See [continuity/README.md](../continuity/README.md).

---

## Plan Documentation

Plans involving HTTP endpoints MUST include an "Endpoint Changes" section with tables for: Modified, Created, Removed, Unchanged.

| Service          | Method | Path                         | Change               |
| ---------------- | ------ | ---------------------------- | -------------------- |
| whatsapp-service | POST   | `/internal/.../send-message` | Remove `phoneNumber` |

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

### Jan 9, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #1289 | 3:03 AM | 🔵 | New Test Directories Created for Consolidated Prompts | ~541 |

### Jan 13, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #4769 | 1:14 AM | ✅ | Committed PR workflow documentation to project | ~214 |
</claude-mem-context>
