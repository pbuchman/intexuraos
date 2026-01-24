# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# IntexuraOS — Claude Instructions

**All rules below are verified by `pnpm run ci`. If CI passes, rules are satisfied.**

---

## Ownership Mindset (MANDATORY)

_Inspired by "Extreme Ownership" by Jocko Willink and Leif Babin_

### Core Principle

**There are no bad teams, only bad leaders.** In this context: there is no bad code, only unowned problems. From the moment you accept a task until CI passes successfully, YOU own everything that happens.

### Ownership Scope

**RULE:** Task ownership spans from assignment to successful CI completion.

- **Start:** Task assigned or accepted
- **End:** `pnpm run ci:tracked` passes AND PR is ready for review
- **Everything in between:** YOUR responsibility

If CI fails because of a "pre-existing" issue, that issue is now YOURS. The moment you encounter it, you own it.

### Forbidden Language

**RULE:** The following phrases are STRICTLY FORBIDDEN:

| Forbidden Phrase          | Why It's Wrong                                  |
| ------------------------- | ----------------------------------------------- |
| "pre-existing issue"      | Discovery creates ownership                     |
| "pre-existing bug"        | Same as above                                   |
| "not my fault"            | Fault is irrelevant; fix is your responsibility |
| "not my responsibility"   | If you see it, you own it                       |
| "unrelated to my changes" | If it blocks CI, it's related                   |
| "was already broken"      | Now it's yours to fix                           |
| "someone else's code"     | All code in scope is your code                  |
| "I didn't introduce this" | Irrelevant — you're fixing it now               |
| "legacy issue"            | Legacy is just code waiting for an owner        |

**Double-think before using any variation of these phrases.** If you catch yourself about to say them, stop and reframe: "How do I fix this?"

### The Extreme Ownership Standard

1. **No excuses.** When something goes wrong, own it completely
2. **No blame.** Never point fingers at "previous state" or "prior work"
3. **Proactive problem-solving.** Don't wait to be told — see problem, fix problem
4. **Cover and move.** Help fix issues even outside your immediate scope if they block success
5. **Prioritize and execute.** When overwhelmed with issues, fix the highest priority first, then move to the next

### Practical Application

```
❌ "CI failed because of a pre-existing type error in services.ts"
✅ "CI failed due to a type error in services.ts. Fixing it now."

❌ "This test was already flaky before my changes"
✅ "Found a flaky test. Stabilizing it as part of this PR."

❌ "The linter rules are too strict, this isn't my fault"
✅ "Lint error found. Updating code to comply."
```

### The Only Exception

**RULE:** The ONLY time you may acknowledge pre-existing state is when the user EXPLICITLY instructs you to ignore it:

- User says: "Ignore the type errors in legacy/, focus only on new code"
- User says: "This is a known issue, skip it for now"
- User says: "Leave that for a separate PR"

Without explicit instruction, assume responsibility for everything you encounter.

### Corollary

If you're unsure whether something is your responsibility, ASK — but phrase the question assuming ownership:

```
❌ "Is this my responsibility to fix?"
✅ "I found an issue in X. Should I fix it in this PR or create a separate issue?"
```

---

## Verification (MANDATORY)

### Step 1: Targeted Verification (per workspace)

When modifying a specific app, first verify that workspace passes all checks:

```bash
pnpm run verify:workspace:tracked -- <app-name>   # e.g. research-agent
```

This runs (in order):

1. TypeCheck (source) — workspace-specific
2. TypeCheck (tests) — workspace-specific
3. Lint — workspace-specific
4. Tests + Coverage — 95% threshold per workspace

### Step 2: Full CI

```bash
pnpm run ci:tracked            # MUST pass before task completion (auto-tracks failures)
tf fmt -check -recursive      # If terraform changed (from /terraform)
tf validate                   # If terraform changed
```

Failure data is stored in `.claude/ci-failures/` for learning. Run `pnpm run ci:report` to see patterns.

**IMPORTANT:** Use `tf` command instead of `terraform`. This alias clears emulator env vars that break Terraform:

```bash
alias tf='STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform'
```

Note: The alias may not be available in spawned subshells - if `tf` is not found, the user should run commands manually.

**Do not claim complete until verification passes.**

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

**ALWAYS commit `.claude/ci-failures/*` files with your changes.** These track verification failures for learning and pattern analysis.

### Coverage Verification Efficiency (MANDATORY)

**RULE:** When verifying coverage, NEVER run tests repeatedly just to grep different patterns from the output.

**❌ WRONG — Re-runs tests multiple times (each run = minutes wasted):**

```bash
# Run 1: Initial CI check
pnpm run ci:tracked

# Run 2: Check error message
pnpm run test:coverage 2>&1 | grep -E "(Coverage for|ERROR:|Branch coverage|% Coverage)"
# → ERROR: Coverage for branches (94.93%) does not meet global threshold (95%)

# Run 3: Find low-coverage files
pnpm run test:coverage 2>&1 | grep -E "(\s+)(\d+\.?\d*)(\s+)(\d+\.?\d*)(\s+)(\d+\.?\d*)" | awk -v threshold=95 '{if ($5+0 < threshold) print $0}'

# Run 4: Try another grep pattern...
pnpm run test:coverage 2>&1 | grep -B2 "90\." | head -50
```

**✅ RIGHT — Capture once, analyze many times:**

```bash
# Run once, save output (2-3 minutes total)
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output.txt

# Now analyze the saved output instantly (seconds)
grep -E "(Coverage for|ERROR:|Branch coverage|% Coverage)" /tmp/ci-output.txt
# → ERROR: Coverage for branches (94.93%) does not meet global threshold (95%)

grep -E "(\s+)(\d+\.?\d*)(\s+)(\d+\.?\d*)(\s+)(\d+\.?\d*)" /tmp/ci-output.txt | awk -v threshold=95 '{if ($5+0 < threshold) print $0}'

grep -B2 "90\." /tmp/ci-output.txt | head -50
```

**Why:** Each `test:coverage` run takes 2-5 minutes. Re-running 3-4 times just to grep different patterns wastes 10-15 minutes. `tee` saves output while displaying it—subsequent analysis is instantaneous.

---

## GCloud Authentication (MANDATORY)

**RULE:** NEVER claim "gcloud is not authenticated" or "unauthenticated to gcloud" without first verifying service account credentials.

### Service Account Credentials

A service account key file is available at:

```
~/personal/gcloud-claude-code-dev.json
```

### Verification Before Claiming Auth Failure

Before reporting any gcloud authentication issues, you MUST:

1. **Check if credentials file exists:**

   ```bash
   ls -la ~/personal/gcloud-claude-code-dev.json
   ```

2. **Activate service account if needed:**

   ```bash
   gcloud auth activate-service-account --key-file=~/personal/gcloud-claude-code-dev.json
   ```

3. **Verify authentication:**

   ```bash
   gcloud auth list
   ```

### When to Use Service Account

- Firestore queries for investigation
- Any `gcloud` commands requiring project access
- Accessing production/dev data for debugging
- **Terraform operations** (plan, apply, destroy)

**You are NEVER "unauthenticated" if the service account key file exists.** Activate it and proceed.

### Terraform with Service Account

**RULE:** Always use the service account for Terraform operations. Never rely on browser-based authentication.

```bash
# Set credentials and clear emulator env vars
GOOGLE_APPLICATION_CREDENTIALS=/Users/p.buchman/personal/gcloud-claude-code-dev.json \
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform plan

# Apply changes
GOOGLE_APPLICATION_CREDENTIALS=/Users/p.buchman/personal/gcloud-claude-code-dev.json \
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
terraform apply
```

**Why service account over browser auth:**

- Browser OAuth tokens expire and require re-authentication
- Service accounts provide consistent, scriptable access
- No interactive prompts that break automation

The service account `claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com` has full admin permissions for all Terraform-managed resources.

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
- Verification: `pnpm run verify:firestore`
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

Verification: `pnpm run verify:pubsub`. Docs: [docs/architecture/pubsub-standards.md](../docs/architecture/pubsub-standards.md)

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

**CI:** `.github/workflows/ci.yml` runs `pnpm run ci` on all branches (lint, typecheck, test, build)

**Deploy:** `.github/workflows/deploy.yml` triggers on push to `development` branch only:

1. Runs `.github/scripts/smart-dispatch.mjs` to analyze changes
2. Triggers Cloud Build based on strategy:
   - **MONOLITH** — Rebuild all (>3 affected OR global change) → `intexuraos-dev-deploy` trigger
   - **INDIVIDUAL** — Rebuild affected only (≤3) → `<service>` triggers in parallel
   - **NONE** — No deployable changes, skip

**Manual override:** `workflow_dispatch` with `force_strategy: monolith` to rebuild all

**Global Triggers** (force MONOLITH): `terraform/`, `cloudbuild/cloudbuild.yaml`, `cloudbuild/scripts/`, `pnpm-lock.yaml`, `tsconfig.base.json`

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

## Pre-Flight Checks (MANDATORY)

**RULE:** Read types BEFORE writing code. Most CI failures happen because code is written from memory instead of from actual type definitions.

### Before Writing Test Mocks

**ALWAYS** read the dependency interface before creating mock objects:

```typescript
// ❌ Writing mock from memory — misses new required fields
const deps = { repo: fakeRepo, logger: fakeLogger };

// ✅ Read the Deps type first, then create mock with ALL fields
// 1. Read: apps/<service>/src/domain/usecases/<usecase>.ts → find XxxDeps type
// 2. Create mock matching ALL required fields
```

**Checklist:**

1. Open the use case file and find the `*Deps` type definition
2. List all required fields
3. Create mock with ALL fields — don't guess

### Before Modifying ServiceContainer

When adding/removing services from `services.ts`:

1. **Read** `services.ts` to see current `ServiceContainer` interface
2. **Search** for `setServices(` across all test files: `grep -r "setServices(" apps/<service>/src/__tests__/`
3. **Update ALL** test files with the new field

### Before Importing from Packages

Cross-package imports require built packages:

```bash
# At session start, build all packages once
pnpm build

# If you see "Cannot find module '@intexuraos/...'" — rebuild
pnpm build
```

### Before Accessing Discriminated Unions

Result types (`Result<T, E>`) and other discriminated unions require narrowing:

```typescript
// ❌ Accessing without narrowing — TS2339: Property 'value' does not exist
const result = await repo.find(id);
return result.value;

// ✅ Narrow first, then access
const result = await repo.find(id);
if (!result.ok) return result;  // Narrows to Success<T>
return result.value;            // Now safe
```

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

### 5. Unsafe Type Operations — Resolve types before accessing

ESLint's `no-unsafe-*` rules fire when TypeScript can't resolve a type. Common causes:

```typescript
// ❌ Accessing Result without narrowing
const result = await repo.findById(id);
console.log(result.value); // no-unsafe-member-access: .value unresolved

// ✅ Narrow first, then access
const result = await repo.findById(id);
if (!result.ok) return result;
console.log(result.value); // TypeScript knows it's Success<T>

// ❌ Using enum from unresolved import
import { ModelId } from '@intexuraos/llm-factory';
const model = ModelId.Gemini25Flash; // no-unsafe-member-access

// ✅ Ensure package is built, or use string literal
const model = 'gemini-2.5-flash' as const;
```

**Root cause:** If `no-unsafe-*` errors appear, the type isn't resolving — check imports, run `pnpm build`, or add explicit type annotations.

### 6. Mock Logger — Include ALL required methods

The `Logger` interface requires `info`, `warn`, `error`, AND `debug`. Missing any causes TS2345.

```typescript
// ❌ Missing debug method
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}; // TS2345: not assignable to Logger

// ✅ Include all four methods
const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// ✅ Or use FakeLogger class if available in the service
import { FakeLogger } from './fakes.js';
const logger = new FakeLogger();
```

### 7. Empty Functions in Mocks — Use arrow functions

ESLint's `no-empty-function` forbids `() => {}`. Use explicit return or vi.fn().

```typescript
// ❌ Empty function body
const mock = { process: () => {} }; // no-empty-function

// ✅ Return undefined explicitly, or use vi.fn()
const mock = { process: (): undefined => undefined };
const mock = { process: vi.fn() };
```

### 8. Async Template Expressions — Await or wrap in `String()`

```typescript
// ❌ `Result: ${asyncFunction()}` // Promise<string> in template
// ✅ `Result: ${await asyncFunction()}`
// OR: `Result: ${String(asyncFunction())}`
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

**No external deps.** In-memory fakes, `nock` for HTTP. Just `pnpm run test`.

- TypeScript: `pnpm run typecheck:tests` (uses `tsconfig.tests-check.json`)
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

Use the same command: `pnpm run verify:workspace:tracked -- web` — adjusted behavior is automatic.

---

## Git Push Policy

**RULE: NEVER push without explicit instruction.**

- `"commit"` → local only, no push
- `"commit and push"` → push once
- Multiple commits → ask before pushing

---

## User Communication

**RULE: When asking clarifying questions, ask ONE question at a time.**

Use the AskUserQuestion tool for each question separately. Do not batch multiple questions unless the user explicitly requests it (e.g., "ask me all questions at once").

**Why:** One-by-one questioning allows focused responses and early course-correction.

---

## Pull Request Workflow (DEFAULT)

**RULE:** Before creating a PR, you MUST update your branch with the latest base branch and resolve any conflicts.

**When asked to create a PR, follow this default workflow:**

1. **Commit all changes** in the current workspace
2. **Determine base branch** — use `development` if it exists, otherwise `main`
3. **Fetch and merge base branch** — pull latest changes from the target branch into your feature branch
4. **Resolve conflicts** — if merge conflicts occur, resolve them before proceeding
5. **Push** the branch
6. **Create PR** targeting the base branch

**Commands:**

```bash
# 1. Commit your changes
git add -A && git commit -m "message"

# 2. Fetch latest from origin
git fetch origin

# 3. Determine base branch and merge it into your feature branch
# If targeting development:
git merge origin/development
# If targeting main:
git merge origin/main

# 4. If conflicts occur, resolve them and commit:
# (edit conflicting files)
git add -A && git commit -m "Resolve merge conflicts with <base-branch>"

# 5. Push your branch
git push -u origin <branch>

# 6. Create PR
gh pr create --base development  # or --base main
```

**Why merge before PR?** This ensures:

- Your branch is up-to-date with the target branch
- Merge conflicts are resolved locally (easier to debug)
- CI runs against the merged state (matches post-merge behavior)
- Reviewers see a clean diff without unrelated conflicts

---

## Linear Issue Workflow

Use the `/linear` skill for issue tracking and workflow management.

**Skill Location:** `.claude/skills/linear/SKILL.md`

**When "linear" appears in context**, the skill is automatically invoked for issue creation and workflow.

**Usage:**

```bash
/linear                    # Pick random Todo issue (cron mode)
/linear <task description> # Create new issue (auto-splits if complex)
/linear INT-123            # Work on existing issue
/linear <sentry-url>       # Create from Sentry error
```

**Examples:**

```bash
/linear Fix authentication token not refreshing
/linear INT-42
/linear https://intexuraos-dev-pbuchman.sentry.io/issues/123/
```

**Mandatory Requirements:**

1. All bugs/features must have corresponding Linear issues
2. PR descriptions must link to Linear issues (`Fixes INT-XXX`)
3. Reasoning belongs in PR descriptions, not code comments
4. State transitions happen automatically: Backlog → In Progress → In Review → QA (Done state requires explicit user instruction)
5. `pnpm run ci:tracked` MUST pass before PR creation (unless explicitly overridden)

**Cross-Linking Protocol:**

| Direction       | Method                                                             |
| --------------- | ------------------------------------------------------------------ |
| Linear → GitHub | PR title contains `INT-XXX` (enables auto-attachment)              |
| GitHub → Linear | GitHub integration attaches PR (when title + branch have issue ID) |
| Linear → GitHub | `Fixes INT-XXX` in PR body (for issue closing behavior)            |
| Sentry → Linear | `[sentry] <title>` naming + link in description                    |
| Linear → Sentry | Comment on Sentry issue                                            |

**Auto-Splitting:** For complex multi-step tasks, the skill automatically detects and offers to split into tiered child issues. See [Linear-Based Continuity Pattern](../docs/patterns/linear-continuity.md).

**Full Documentation:** `.claude/skills/linear/`

---

## Sentry Issue Workflow

Use the `/sentry` skill for error triage, investigation, and resolution.

**Skill Location:** `.claude/skills/sentry/SKILL.md`

**When Sentry URLs or error triage appears in context**, the skill is automatically invoked.

**Usage:**

```bash
/sentry                           # Batch triage unresolved issues
/sentry <sentry-url>              # Investigate specific issue
/sentry analyze <sentry-url>      # AI-powered root cause analysis (Seer)
/sentry linear <sentry-url>       # Create Linear issue from Sentry error
/sentry triage --limit 5          # Batch triage with limit
```

**Examples:**

```bash
/sentry https://intexuraos-dev-pbuchman.sentry.io/issues/123/
/sentry analyze https://intexuraos-dev-pbuchman.sentry.io/issues/456/
/sentry triage --limit 3
```

**Mandatory Requirements:**

1. Every Sentry issue MUST be linked to a Linear issue (use `[sentry] <title>` prefix)
2. Every fix PR MUST link both Sentry and Linear issues
3. No band-aid fixes — investigate root cause before implementing
4. `pnpm run ci:tracked` MUST pass before PR creation

**Cross-Linking Protocol:**

| Direction        | Method                                         |
| ---------------- | ---------------------------------------------- |
| Sentry → Linear  | Comment on Sentry with Linear issue link       |
| Linear → Sentry  | `[sentry] <title>` naming + link in description |
| Linear → GitHub  | PR title contains `INT-XXX`                    |
| GitHub → Linear  | `Fixes INT-XXX` in PR body                     |
| GitHub → Sentry  | Sentry link in PR description                  |

**Full Documentation:** `.claude/skills/sentry/`

---

## Document-Service Skill

Use the `/document-service` skill to generate comprehensive service documentation.

**Skill Location:** `.claude/skills/document-service/SKILL.md`

**Modes:**

| Mode        | Invocation                              | Behavior                        |
| ----------- | --------------------------------------- | ------------------------------- |
| Discovery   | `/document-service` (no args)           | Lists services + doc status     |
| Interactive | `/document-service <service-name>`      | Asks 3 questions (Q1, Q5, Q8)   |
| Autonomous  | Task tool → `service-scribe` subagent   | Infers all answers from code    |

**Output:** 5 files per service + website content updates

**Full Documentation:** `.claude/skills/document-service/`

---

## Claude Extensions Taxonomy

This project uses three types of Claude extensions:

### Skills (Directory-Based)

**Location:** `.claude/skills/<skill-name>/`
**Structure:** SKILL.md + workflows/ + templates/ + reference/
**Invocation:** `/skill-name` (user) or auto-trigger (model)

| Skill               | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `/linear`           | Linear issue management with auto-splitting        |
| `/sentry`           | Sentry triage with AI analysis and cross-linking   |
| `/document-service` | Service documentation (interactive + autonomous)   |

### Agents (Task-Spawned)

**Location:** `.claude/agents/<agent-name>.md`
**Invocation:** Task tool with `subagent_type: <agent-name>`
**Mode:** Autonomous, no user interaction during execution

| Agent                   | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `coverage-orchestrator` | 100% branch coverage enforcement               |
| `llm-manager`           | LLM usage audit and pricing verification       |
| `service-creator`       | New service scaffolding                        |
| `service-scribe`        | Autonomous documentation (delegates to skill)  |
| `whatsapp-sender`       | WhatsApp notification specialist               |

### Commands (Single-File)

**Location:** `.claude/commands/<command-name>.md`
**Invocation:** `/<command-name>`
**Mode:** Interactive, typically requires user input

| Command               | Purpose                           |
| --------------------- | --------------------------------- |
| `/analyze-ci-failures`| Analyze CI failure patterns       |
| `/analyze-logs`       | Production log analysis           |
| `/coverage`           | Coverage improvement suggestions  |
| `/create-service`     | New service creation wizard       |
| `/refactoring`        | Code smell detection and fixes    |
| `/semver-release`     | Semantic versioning release       |
| `/verify-deployment`  | Deployment verification           |
| `/teach-me-something` | Educational content generation    |
| `/continuity`         | (Deprecated) → Use Linear skill   |

---

## Complex Tasks — Linear Continuity

For multi-step features, use the Linear-based continuity pattern with parent-child issues.

**See:** [docs/patterns/linear-continuity.md](../docs/patterns/linear-continuity.md)

**Quick Start:**
1. Create top-level Linear issue for overall feature
2. Use `/linear` with complex description to auto-split into child issues
3. Parent issue serves as ledger (goal, decisions, state tracking)
4. Execute child issues sequentially by tier
5. Mark all as Done when complete

**Note:** The file-based `continuity/NNN-task-name/` workflow is deprecated. See `continuity/README.md` for migration details.

---

## Documentation

When creating markdown documentation in `docs/`, follow these formatting standards:

### Tables

**RULE:** All tables MUST have proper column alignment for readability.

```markdown
# ❌ Wrong — no alignment

| Method | Path    | Description | Auth |
| ------ | ------- | ----------- | ---- |
| GET    | `/docs` | Swagger UI  | None |

# ✅ Right — padded columns

| Method | Path    | Description | Auth |
| ------ | ------- | ----------- | ---- |
| GET    | `/docs` | Swagger UI  | None |
```

**Requirements:**

- Header cells padded to column width
- Separator row (`|---|`) also padded
- Data cells padded to match column max width
- Alignment markers allowed: `:---` (left), `:---:` (center), `---:` (right)

**Enforcement:** Run `pnpm run format:docs-tables` to fix all tables in `docs/`.

---

## Plan Documentation

Plans involving HTTP endpoints MUST include an "Endpoint Changes" section with tables for: Modified, Created, Removed, Unchanged.

| Service          | Method | Path                         | Change               |
| ---------------- | ------ | ---------------------------- | -------------------- |
| whatsapp-service | POST   | `/internal/.../send-message` | Remove `phoneNumber` |
