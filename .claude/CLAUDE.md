# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Reference Documentation:** Detailed reference material is available in:
- `.claude/reference/common-mistakes.md` — Common LLM mistakes and code smells
- `.claude/reference/infrastructure.md` — GCloud, Terraform, and Cloud Build

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

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`) — backend buckets don't support SPA fallback.

**Rules:** TailwindCSS only, `@auth0/auth0-react` for auth, `useApiClient` for API calls, SRP (split at ~150 lines), env vars via `import.meta.env.INTEXURAOS_*`.

---

## TypeScript Patterns

Strict mode enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Compiler errors guide fixes — use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

**Common Mistakes & Code Smells:** See `.claude/reference/common-mistakes.md` for detailed patterns that cause 80% of CI failures.

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

- TypeScript: `pnpm run typecheck:tests` (uses `tsconfig.tests-check.json` for test files only)
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

**When asked to create a PR, follow this default workflow:**

1. **Commit all changes** in the current workspace
2. **Fetch origin** and merge `origin/development` if it exists
3. **Push** the branch
4. **Create PR** targeting `development` (if it exists), otherwise `main`

**Commands:**

```bash
git add -A && git commit -m "message"
git fetch origin
git merge origin/development  # if exists, skip if not
git push -u origin <branch>
gh pr create --base development  # or --base main if development doesn't exist
```

---

## Linear Issue Workflow

Use the `/linear` command for issue tracking and workflow management.

**When "linear" appears in context**, the agent should reference `/linear` for issue creation and workflow.

**Usage:**

```bash
/linear                    # Pick random backlog issue (cron mode)
/linear <task description> # Create new issue
/linear LIN-123            # Work on existing issue
/linear <sentry-url>       # Create from Sentry error
```

**Examples:**

```bash
/linear Fix authentication token not refreshing
/linear LIN-42
/linear https://intexuraos-dev-pbuchman.sentry.io/issues/123/
```

**Mandatory Requirements:**

1. All bugs/features must have corresponding Linear issues
2. PR descriptions must link to Linear issues (`Fixes LIN-XXX`)
3. Reasoning belongs in PR descriptions, not code comments
4. State transitions happen automatically: Backlog → In Progress → In Review → Done
5. `pnpm run ci:tracked` MUST pass before PR creation (unless explicitly overridden)

**Cross-Linking Protocol:**

| Direction       | Method                                          |
| --------------- | ----------------------------------------------- |
| Linear → GitHub | `Fixes LIN-XXX` in PR body                      |
| GitHub → Linear | PR URL in issue comments                        |
| Sentry → Linear | `[sentry] <title>` naming + link in description |
| Linear → Sentry | Comment on Sentry issue with Linear link        |

**See:** `.claude/commands/linear.md` for complete workflow documentation.

---

## Complex Tasks — Continuity Workflow

For multi-step features, use numbered directories in `continuity/`. See [continuity/README.md](../continuity/README.md).

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

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

_No recent activity_
</claude-mem-context>
