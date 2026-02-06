# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# IntexuraOS — Claude Instructions

**All rules below are verified by `pnpm run ci`. If CI passes, rules are satisfied.**

---

## ⛔ HARD GATE: Before ANY Commit (READ FIRST)

| Question                                       | Required Answer |
| ---------------------------------------------- | --------------- |
| Did `pnpm run ci:tracked` pass?                | YES             |
| Did it pass completely, not "my part passed"?  | YES             |
| Am I about to say "other services/workspaces"? | NO              |
| Am I about to say "unrelated to my changes"?   | NO              |
| Am I about to say "not caused by my code"?     | NO              |

**Wrong answer = NO COMMIT.**

### The Rationalization Trap

| Your Thought                                  | Reality                            |
| --------------------------------------------- | ---------------------------------- |
| "CI failed but my code passes"                | CI failed. No commit.              |
| "The failure is in OTHER services"            | OTHER = forbidden. You own it.     |
| "Global CI fails, but X-specific checks pass" | This phrase has caused violations. |
| "Let me commit anyway and note the CI status" | NO. Fix first, then commit.        |

**No partial pass.**

---

## User Control (MANDATORY)

**RULE: The user controls, Claude executes. Never assume permission to act.**

### Questions Get Answers, Not Implementations

When the user asks a question, they want an **answer** — not code changes.

| User Says                        | User Wants         | Claude Does                          |
| -------------------------------- | ------------------ | ------------------------------------ |
| "What went wrong?"               | Analysis           | Explain the issue, wait for decision |
| "What can be improved?"          | Suggestions        | List options, wait for selection     |
| "Look at X — what do you think?" | Opinion/assessment | Provide assessment, wait             |
| "Why did this fail?"             | Diagnosis          | Diagnose, wait for next instruction  |
| "Implement X" / "Fix X" / "Do X" | Action             | Execute the task                     |

### Forbidden Auto-Actions

**NEVER** do the following without explicit instruction:

- Start implementing after analyzing (ask first: "Should I implement this?")
- Create branches or commits after reviewing
- Fix issues discovered during investigation
- "While I'm here, let me also..."
- Assume a plan approval means "start coding now"

### The Checkpoint Pattern

After completing any analysis, investigation, or review phase:

```
1. Present findings
2. STOP
3. Wait for explicit instruction: "proceed", "implement", "fix it", etc.
```

**Exception:** Only proceed automatically if the user said "analyze AND fix" upfront.

### Practical Examples

```
❌ User: "What went wrong with INT-218?"
   Claude: "The issue is X. Let me fix it..." [starts coding]

✅ User: "What went wrong with INT-218?"
   Claude: "The issue is X because Y. Here are options: A, B, C."
   User: "Do option B"
   Claude: [now implements option B]
```

---

## ⛔ Linear State Transition Gate (READ BEFORE UPDATING ISSUES)

| Transition                 | Allowed?                                |
| -------------------------- | --------------------------------------- |
| Backlog/Todo → In Progress | ✅ Yes                                  |
| In Progress → In Review    | ✅ Yes (maximum agent-controlled state) |
| Any → QA                   | ❌ **BLOCKED BY HOOK**                  |
| Any → Done                 | ❌ **BLOCKED BY HOOK**                  |

**Enforcement:** The `validate-linear-state.sh` hook blocks all Linear MCP calls that attempt to set status to QA or Done. This is a hard gate — agents cannot bypass it.

**The maximum state an agent can set is "In Review".** Even if PR merged, tests pass, code deployed.

### The Rationalization Trap

| Your Thought                                  | Reality                                |
| --------------------------------------------- | -------------------------------------- |
| "The PR is merged, so it's obviously done"    | Merged ≠ Done. Hook blocks it.         |
| "All child issues are complete"               | Complete ≠ Done. User confirms.        |
| "This is just bookkeeping, I'll mark it done" | Bookkeeping requires permission.       |
| "Ready for QA, let me move it there"          | QA is beyond agent scope. Hook blocks. |

### Correct Behavior

```
❌ WRONG: "PR #600 merged. Marking INT-245 as Done."
❌ WRONG: "PR #600 merged. Moving INT-245 to QA."
✅ RIGHT: "PR #600 opened. Moving INT-245 to In Review."
```

**Why:** QA and Done = business decisions (testing schedules, deployment, production checks).

---

## Ownership Mindset (MANDATORY)

### Core Principle

From task acceptance until successful CI, you own everything. No bad teams—only unowned problems.

- **Start:** Task assigned or accepted
- **End:** `pnpm run ci:tracked` passes AND PR ready for review
- **Everything in between:** YOUR responsibility

If CI fails due to a "pre-existing" issue, that issue is now YOURS.

### Forbidden Language

See `.claude/reference/ownership-mindset.md` for full table and examples.

**Key violations:** "OTHER services", "my code passes", "unrelated to my changes", "was already broken"

### Ownership Standard

1. **No excuses** — own problems completely
2. **No blame** — don't point at "previous state"
3. **Proactive** — see problem, fix problem
4. **Cover and move** — fix issues outside your scope if they block success

### The Only Exception

May acknowledge pre-existing state ONLY when user EXPLICITLY instructs:

- "Ignore the type errors in legacy/, focus only on new code"
- "This is a known issue, skip it for now"

Without explicit instruction, assume responsibility for everything encountered.

---

## CI Failure Protocol (MANDATORY)

**RULE:** When `pnpm run ci:tracked` fails, follow this protocol.

Thinking "this failure isn't mine" = ownership violation. See [Ownership Mindset](#ownership-mindset-mandatory).

### Step 1: Capture and Analyze

```bash
BRANCH=$(git branch --show-current | sed 's/\//-/g')
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-${BRANCH}-$(date +%Y%m%d-%H%M%S).txt
```

Then analyze with proper tools (in priority order):

1. `bat /tmp/ci-output-*.txt` — syntax highlighting
2. `rg "error|FAIL" /tmp/ci-*.txt -C3` — fast search with context
3. For coverage: `jq '.total.branches.pct' coverage/coverage-summary.json`

### Step 2: Fix or Ask (No Skipping, No Committing)

| Failure Location    | Action                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| Workspace I touched | Fix immediately                                                            |
| Any other workspace | Fix immediately OR ask: "Found X errors in Y. Fix here or separate issue?" |
| Flaky test          | Stabilize it                                                               |
| Type error          | Fix it                                                                     |
| Lint error          | Fix it                                                                     |
| Coverage threshold  | Write tests OR ask about scope                                             |

**⛔ NEVER COMMIT UNTIL ALL FAILURES ARE RESOLVED OR USER-APPROVED TO SKIP.**

### Forbidden Responses

See [Ownership Mindset > Forbidden Language](#forbidden-language).

### Required Response

✅ "CI failed with X errors. Fixing them now." OR "CI failed. Fix here or separate issue?"

### The Anti-Pattern

```
❌ CI fails → "Other services fail, my code passes" → Commit → Push
✅ CI fails → Own ALL failures → Fix or ask → CI PASSES → Then commit
```

**No "committing with CI notes". CI passes or you don't commit.**

---

## Verification (MANDATORY)

### Step 1: Targeted Verification (per workspace)

```bash
pnpm run verify:workspace:tracked -- <app-name>   # e.g. research-agent
```

Runs: TypeCheck (source + tests) → Lint → Tests + Coverage (95% threshold)

### Step 2: Verify Packages Built (Safety Net)

```bash
ls packages/*/dist/ >/dev/null 2>&1 || echo "WARNING: Some packages not built. Run 'pnpm build' first."
```

**If packages aren't built:** 50+ lint errors that look like type errors but are missing dependencies.

### Step 3: Full CI

```bash
pnpm run ci:tracked            # MUST pass before task completion
```

### Step 4: Terraform Verification (ALWAYS CHECK)

**RULE:** Never assume terraform didn't change. Always verify explicitly.

```bash
# 1. Check if terraform files changed (ALWAYS RUN THIS)
git diff --name-only HEAD~1 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"

# 2. IF terraform changed, run validation (with env var clearing):
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json \
terraform fmt -check -recursive

STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json \
terraform validate
```

### Step 5: Document Verification Result

- ✅ "Verified: No terraform files changed"
- ✅ "Terraform changed. Ran `terraform fmt` and `terraform validate` — both passed"

```
❌ WRONG: Assume "probably didn't change" → Skip checks → Hope
✅ RIGHT: Verify with git diff → Run checks if needed → Document result
```

**Do not claim complete until verification passes.**

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

### Verification Ownership

**All failures are YOUR responsibility.** See [Ownership Mindset](#ownership-mindset-mandatory).

---

## Infrastructure (MANDATORY)

**Service account:** `$HOME/personal/gcloud-claude-code-dev.json`

**Full reference:** `.claude/reference/infrastructure.md` (GCloud auth, Terraform, Cloud Build, Pub/Sub, resource creation rules)

**Quick commands:**

- GCloud CLI: `gcloud auth activate-service-account --key-file=$HOME/personal/gcloud-claude-code-dev.json`
- Terraform: Clear emulator vars + set GOOGLE_APPLICATION_CREDENTIALS (see reference)
- New service image: `./scripts/push-missing-images.sh`

**RULE:** ALL infrastructure via Terraform only. See reference for CLI-to-Terraform mapping.

---

## Architecture

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

### Apps vs Workers

| Aspect      | Apps                          | Workers                                  |
| ----------- | ----------------------------- | ---------------------------------------- |
| Deploy      | Cloud Run                     | Cloud Functions                          |
| Framework   | Fastify                       | Cloud Functions Framework                |
| Scaling     | Min 0, persistent connections | Scale to zero, event-driven              |
| Entry Point | `server.ts`                   | `index.ts` with `functions.cloudEvent()` |
| DI Pattern  | Full `services.ts` container  | Lightweight, direct dependency injection |
| Dockerfile  | Yes (multi-stage esbuild)     | No (zip deployment)                      |
| Coverage    | 95% required                  | 95% required                             |

### Import Rules

**ESLint enforced.** Apps can't import other apps. Routes use `getServices()`, not direct infra imports.

### Service-to-Service Communication

Pattern: `/internal/{resource-name}` with `X-Internal-Auth` header. Use `validateInternalAuth()` server-side.

### Route Naming Convention

- **Public routes:** `/{resource-name}` (e.g., `/todos`, `/bookmarks/:id`)
- **Internal routes:** `/internal/{resource-name}` (e.g., `/internal/todos`)
- **HTTP methods:** Use `PATCH` for partial updates, `PUT` for full replacement

### Key Rules

**RULE:** ALL endpoints (`/internal/*`, webhooks, Pub/Sub) MUST use `logIncomingRequest()` at entry.

**RULE:** Never use pull subscriptions — Cloud Run scales to zero. Use HTTP push only.

**RULE:** Use cases MUST accept `logger: Logger` as dependency.

**RULE:** Each Firestore collection owned by one service. Cross-service via HTTP only. Registry: `firestore-collections.json`.

**RULE:** Multi-field queries need composite indexes in `migrations/*.mjs`. Fail without them.

**RULE:** Migrations are IMMUTABLE. Never modify or delete existing files. Create new migrations to fix bugs.

### Response Contract

**RULE:** ALL HTTP responses MUST use `reply.ok(data)` or `reply.fail(code, message)`.

Raw `reply.send()` is **FORBIDDEN** unless annotated with `// @allow-raw-send: <reason>`.

| Method           | Returns                                              | Use For               |
| ---------------- | ---------------------------------------------------- | --------------------- |
| `reply.ok(data)` | `{ success: true, data: T }`                         | Success responses     |
| `reply.fail()`   | `{ success: false, error: { code, message } }` + 4xx | Expected error states |

**Verification:** `pnpm run verify:reply-send` (CI Static Validation phase)

**Full documentation:** [docs/patterns/response-contract.md](../docs/patterns/response-contract.md)

### Logging (MANDATORY)

**RULE:** Never use `pino()` directly in `apps/`. Use `createAppLogger()` from `@intexuraos/infra-sentry`.

```typescript
// WRONG - logs won't reach Sentry
import pino from 'pino';
const logger = pino({ name: 'my-service' });

// CORRECT - errors automatically sent to Sentry
import { createAppLogger } from '@intexuraos/infra-sentry';
const logger = createAppLogger({ name: 'my-service' });
```

**Verification:** `pnpm run verify:sentry-logging` (CI Static Validation phase)

**Why:** Direct `pino()` creates loggers without Sentry integration. Errors are silently lost.

**Full documentation:** [docs/patterns/logging.md](../docs/patterns/logging.md)

---

## Apps & Packages

**Apps (`apps/**`):\*\*

- Use `getServices()` for deps, `getFirestore()` singleton for DB
- Env vars: `INTEXURAOS_*` prefix (except `NODE_ENV`, `PORT`, emulators)
- Fail-fast: `validateRequiredEnv()` at startup
- New service: Use `/create-service` command

**Packages (`packages/**`):\*\*

- `common-*` are leaf packages (no deps)
- `infra-*` wrap external services
- No domain logic in packages

**Pub/Sub Publishers:**

**RULE:** All publishers MUST extend `BasePubSubPublisher`. Topic names from env vars only. Verification: `pnpm run verify:pubsub`.

---

## Environment Variables (MANDATORY)

**RULE:** Adding a new environment variable requires updating THREE locations:

| Step | Location                             | What to Update                                                                |
| ---- | ------------------------------------ | ----------------------------------------------------------------------------- |
| 1    | `apps/<service>/src/index.ts`        | Add to `REQUIRED_ENV` array                                                   |
| 2    | `terraform/environments/dev/main.tf` | Add to service's `env_vars` or `secrets`                                      |
| 3    | `ecosystem.config.cjs`               | Add to `COMMON_SERVICE_ENV`, `COMMON_SERVICE_URLS`, or `SERVICE_ENV_MAPPINGS` |

**CI Enforcement:**

- `scripts/verify-env-vars.mjs` automatically validates all three locations
- Runs in Static Validation phase of CI pipeline
- Fails immediately if any location is missing
- Error format: `file:line: Undeclared env var 'VAR_NAME' used. Add to REQUIRED_ENV in src/index.ts.`

**Failure to update all three causes:**

- Missing in Terraform → **Startup probe failure** (22% of build failures)
- Missing in ecosystem.config.cjs → Local development broken
- Missing in REQUIRED_ENV → Runtime crash when var accessed

**Patterns:** See `.claude/reference/env-vars-patterns.md`

---

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`) — backend buckets don't support SPA fallback.

**Rules:** TailwindCSS only, `@auth0/auth0-react` for auth, `useApiClient` for API calls, SRP (split at ~150 lines), env vars via `import.meta.env.INTEXURAOS_*`.

---

## TypeScript Patterns

Strict mode enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Compiler errors guide fixes — use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

---

## Session Start Protocol (MANDATORY)

**RULE:** At the start of every fresh session, build all packages:

```bash
pnpm build
```

**Why:** Apps depend on packages. Without built `dist/` directories, apps fail typecheck.

**Signs you forgot:**

- 50+ `no-unsafe-*` lint errors in apps
- `Cannot find module '@intexuraos/...'`
- Errors only in `apps/` not `packages/`

**When to run:** Fresh clone, switched branches, after pulling changes that touched `packages/`.

---

## Pre-Flight Checks (MANDATORY)

**RULE:** Read types BEFORE writing code. Most CI failures: code written from memory, not actual types.

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
pnpm build   # At session start, or if "Cannot find module '@intexuraos/...'"
```

### Before Accessing Discriminated Unions

Result types (`Result<T, E>`) and other discriminated unions require narrowing:

```typescript
// ❌ Accessing without narrowing — TS2339: Property 'value' does not exist
const result = await repo.find(id);
return result.value;

// ✅ Narrow first, then access
const result = await repo.find(id);
if (!result.ok) return result;
return result.value;
```

---

## Token Efficiency

**RULE:** Use streaming/watch instead of polling.

```bash
# ❌ Polling (wastes 2-5x tokens)
sleep 60 && gh pr checks 682
sleep 300 && gcloud builds describe <id>

# ✅ Streaming (blocks until done)
gh pr checks 682 --watch
gh run watch 12345
gcloud builds log <id> --stream --region=<region>
```

**Enforced by:** `.claude/hooks/validate-polling.sh`

---

## Linear MCP Query Safety (MANDATORY)

**RULE:** Never use broad text searches with high limits. Causes context overflow.

### Patterns

```typescript
// ❌ DANGEROUS - returns 15k+ tokens
list_issues({ query: 'fix', limit: 50 });
get_issue({ id: 'INT-445', includeRelations: true }); // Does NOT return children

// ✅ SAFE
list_issues({ query: 'INT-445', limit: 10 }); // Specific ID
list_issues({ parentId: '<uuid>', limit: 20 }); // Children by parentId
get_issue({ id: 'INT-445' }); // Single issue
```

### Finding Child Issues

`includeRelations` returns blocks/blockedBy/relatedTo - NOT children. Query by `parentId`:

```typescript
const parent = await get_issue({ id: 'INT-445' });
const children = await list_issues({ parentId: parent.id, limit: 20 });
```

**Recovery:** If context overflows, `/clear` and use targeted queries.

---

## Common LLM Mistakes

**Full reference:** `.claude/reference/common-mistakes.md`

**Key patterns (80% of CI failures):**

- ESM imports need `.js` extension
- Use `?:` not `| undefined` for optional props
- Wrap non-strings in `String()` for templates
- Narrow Result types before accessing `.value`
- Mock Logger needs all 4 methods: `info`, `warn`, `error`, `debug`

---

## Code Auditing

**RULE:** When fixing a pattern in one service, audit ALL other services for the same issue before committing.

**Full guide:** [docs/patterns/auditing.md](../docs/patterns/auditing.md)

---

## Test-First Development (MANDATORY)

**RULE: Always write tests BEFORE implementation code.**

1. **Write failing test first** — Define expected behavior
2. **Run test to confirm it fails** — Validates test works
3. **Implement minimal code** — Only enough to pass
4. **Refactor if needed** — Keep tests green

```
❌ WRONG: Write usecase → Write test → Fix coverage
✅ RIGHT: Write test (fails) → Write usecase (passes) → Verify coverage
```

**Exception:** Pure refactoring of existing tested code doesn't require new tests first.

---

## Testing

**No external deps.** In-memory fakes, `nock` for HTTP. Just `pnpm run test`.

- Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`
- Routes: integration via `app.inject()`. Domain: unit tests.
- **Coverage: 100% branch coverage required.** Every branch must be:
  1. Covered by tests, OR
  2. Exempted with `/* v8 ignore <CATEGORY> -- reason @preserve */`

CI fails on any unaccounted branch. No exceptions.

### Coverage Exemptions

**RULE:** All uncovered branches must have a `/* v8 ignore <CATEGORY> -- reason */` comment with valid category.

**Valid categories:** `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

**Format:** `/* v8 ignore <CATEGORY> -- <explanation> */`

**Validation:** `pnpm run verify:v8-ignore` (runs in CI Static Validation phase)

**NEVER** add v8 ignore comments without a valid category. CI will fail.

**Reference:** `.claude/skills/coverage/reference/canonical-categories.md`

### Web App Exception

- Coverage threshold not enforced (planned refactoring)
- Tests OPTIONAL for UI components
- Tests REQUIRED for: `utils/`, `services/`, `hooks/`, calculations

---

## Git & PR Workflow

**RULE: NEVER commit without `pnpm run ci:tracked` passing first.**

This is non-negotiable. Running only package-level tests (`vitest`, `tsc`) is NOT sufficient.

### ⛔ THE COMMIT GATE

**Before EVERY commit:** See [HARD GATE](#-hard-gate-before-any-commit-read-first).

### Forbidden Shortcuts

See [Ownership Mindset > Forbidden Language](#forbidden-language). Same rules apply to shortcuts.

**The only acceptable verification is `pnpm run ci:tracked` passing locally — COMPLETELY, not partially.**

**RULE:** Before creating a PR, merge latest base branch and resolve conflicts.

```bash
pnpm run ci:tracked              # MUST pass first
git add -A && git commit -m "message"
git fetch origin && git merge origin/development
git push -u origin <branch>
gh pr create --base development
```

**Why merge before PR?** Ensures CI runs against merged state and reviewers see clean diff.

---

## User Communication

**RULE: When asking clarifying questions, ask ONE question at a time.**

Use the AskUserQuestion tool for each question separately. Do not batch multiple questions unless explicitly requested.

---

## Cross-Linking Protocol

All artifacts must be connected:

| From   | To     | Method                                          |
| ------ | ------ | ----------------------------------------------- |
| Linear | GitHub | PR title contains `INT-XXX`                     |
| GitHub | Linear | `Fixes INT-XXX` in PR body                      |
| Sentry | Linear | `[sentry] <title>` prefix + link in description |
| Linear | Sentry | Comment on Sentry issue with Linear link        |
| PR     | Sentry | Sentry link in PR description                   |

---

## Skills & Extensions

**Skills** (invoke via `/skill-name`): `/linear`, `/sentry`, `/document-service`, `/release`, `/coverage`

**Agents** (Task tool): `llm-manager`, `service-creator`, `service-scribe`, `whatsapp-sender`

**Commands**: `/analyze-ci-failures`, `/analyze-logs`, `/create-service`, `/refactoring`, `/semver-release`, `/teach-me-something`, `/verify-deployment`

All skill documentation in `.claude/skills/<name>/SKILL.md`. For complex multi-step tasks, use `/linear` with auto-splitting. See [Linear Continuity Pattern](../docs/patterns/linear-continuity.md).

---

## GLM-Coder MCP (Code Generation)

**Tools:** `generate_code`, `generate_tests`, `glm_stats` — GLM-4.7 via MCP.

**Conditional:** When running on Opus (not Z.ai), a SessionStart hook injects usage instructions. See `.claude/reference/glm-coder.md` for full documentation.

**Quick reference:** Use for isolated code generation (new functions, tests). Don't use for debugging, small edits, or multi-file refactoring.

---

## Documentation

**RULE:** All tables MUST have proper column alignment for readability.

**Enforcement:** Run `pnpm run format:docs-tables` to fix all tables in `docs/`.

---

## Plan Documentation

Plans involving HTTP endpoints MUST include an "Endpoint Changes" section with tables for: Modified, Created, Removed, Unchanged.

| Service          | Method | Path                         | Change               |
| ---------------- | ------ | ---------------------------- | -------------------- |
| whatsapp-service | POST   | `/internal/.../send-message` | Remove `phoneNumber` |
