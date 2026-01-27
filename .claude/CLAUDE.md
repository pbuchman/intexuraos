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

| Transition              | Allowed?                                  |
| ----------------------- | ----------------------------------------- |
| Backlog → In Progress   | ✅ Yes                                    |
| In Progress → In Review | ✅ Yes                                    |
| In Review → QA          | ✅ Yes                                    |
| QA → Done               | ❌ **REQUIRES EXPLICIT USER INSTRUCTION** |
| Any status → Done       | ❌ **REQUIRES EXPLICIT USER INSTRUCTION** |

**The "Done" status is NEVER automatic.** Even if PR merged, tests pass, code deployed.

### The Rationalization Trap

| Your Thought                                  | Reality                          |
| --------------------------------------------- | -------------------------------- |
| "The PR is merged, so it's obviously done"    | Merged ≠ Done. User decides.     |
| "All child issues are complete"               | Complete ≠ Done. User confirms.  |
| "This is just bookkeeping, I'll mark it done" | Bookkeeping requires permission. |

### Correct Behavior

```
❌ WRONG: "PR #600 merged. Marking INT-245 as Done."
✅ RIGHT: "PR #600 merged. INT-245 should move to QA. Mark as Done?"
```

**Why:** Done = business decision (deployment, production check, release timing).

---

## Ownership Mindset (MANDATORY)

### Core Principle

From task acceptance until successful CI, you own everything. No bad teams—only unowned problems.

- **Start:** Task assigned or accepted
- **End:** `pnpm run ci:tracked` passes AND PR ready for review
- **Everything in between:** YOUR responsibility

If CI fails due to a "pre-existing" issue, that issue is now YOURS.

### Forbidden Language

| Forbidden                          | Why                            |
| ---------------------------------- | ------------------------------ |
| "pre-existing issue/bug"           | Discovery = ownership          |
| "not my fault/responsibility"      | Fault irrelevant; fix is yours |
| "unrelated to my changes"          | Blocks CI = related            |
| "was already broken"               | Now yours to fix               |
| "legacy issue"                     | Legacy = code awaiting owner   |
| **"OTHER services/workspaces"**    | No "other" in CI               |
| **"my code/part passes"**          | CI passes or doesn't           |
| **"global CI fails but X passes"** | This phrase = violation        |

Catch yourself using these? Stop. Reframe: "How do I fix this?"

### Ownership Standard

1. **No excuses** — own problems completely
2. **No blame** — don't point at "previous state"
3. **Proactive** — see problem, fix problem
4. **Cover and move** — fix issues outside your scope if they block success

### Real Violation Example

```
❌ ACTUAL VIOLATION:
   "All code-agent checks pass. The global CI fails on OTHER services,
    not the INT-252 changes. Let me commit..."
   [Agent commits despite CI failure]

✅ CORRECT:
   "CI failed with coverage threshold error.
    Fix gaps here or handle separately?"
   [Wait for instruction before ANY commit]
```

**Why violated:** Used "OTHER services", used "not the INT-252 changes", committed despite failure.

**Correct behavior:** CI fails → STOP → Ask or fix → Never commit until CI passes.

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

**Full reference:** `.claude/reference/infrastructure.md` (GCloud auth, Terraform, Cloud Build, Pub/Sub)

**Quick commands:**

- GCloud CLI: `gcloud auth activate-service-account --key-file=$HOME/personal/gcloud-claude-code-dev.json`
- New service image: `./scripts/push-missing-images.sh`

### Running Terraform

**Always clear emulator env vars and set credentials:**

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/personal/gcloud-claude-code-dev.json \
terraform plan
```

### Terraform-Only Resource Creation

**RULE: ALL persistent infrastructure MUST be created via Terraform. Direct CLI resource creation is FORBIDDEN.**

| Command                          | What It Creates        | Use Terraform Instead          |
| -------------------------------- | ---------------------- | ------------------------------ |
| `gsutil mb`                      | GCS buckets            | `google_storage_bucket`        |
| `gcloud pubsub topics create`    | Pub/Sub topics         | `google_pubsub_topic`          |
| `gcloud pubsub subscriptions`    | Pub/Sub subscriptions  | `google_pubsub_subscription`   |
| `gcloud run deploy`              | Cloud Run services     | `google_cloud_run_service`     |
| `gcloud secrets create`          | Secret Manager secrets | `google_secret_manager_secret` |
| `gcloud sql instances create`    | Cloud SQL instances    | `google_sql_database_instance` |
| `gcloud compute instances`       | Compute Engine VMs     | `google_compute_instance`      |
| `gcloud iam service-accounts`    | Service accounts       | `google_service_account`       |
| `gcloud projects add-iam-policy` | IAM bindings           | `google_*_iam_*`               |

**Why:** Terraform tracks state, enables reproducibility, version control, drift detection. CLI creates "orphan" resources invisible to IaC.

```
❌ WRONG: Need a bucket → gsutil mb gs://my-bucket → Done
✅ RIGHT: Need a bucket → Add to terraform/ → terraform plan → terraform apply → PR
```

**Exception:** Truly ephemeral resources for debugging. Never new named resources.

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
| 3    | `scripts/dev.mjs`                    | Add to `COMMON_SERVICE_ENV`, `COMMON_SERVICE_URLS`, or `SERVICE_ENV_MAPPINGS` |

**Failure to update all three causes:**

- Missing in Terraform → **Startup probe failure** (22% of build failures)
- Missing in dev.mjs → Local development broken
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
- **Coverage: 95%. NEVER modify thresholds — write tests.**

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

## Linear Issue Workflow

Use the `/linear` skill for issue tracking and workflow management.

**Skill Location:** `.claude/skills/linear/SKILL.md`

**Usage:**

```bash
/linear                    # Pick random Todo issue (cron mode)
/linear <task description> # Create new issue (auto-splits if complex)
/linear INT-123            # Work on existing issue
/linear <sentry-url>       # Create from Sentry error
```

**Mandatory Requirements:**

1. All bugs/features must have corresponding Linear issues
2. PR descriptions must link to Linear issues (`Fixes INT-XXX`)
3. Reasoning belongs in PR descriptions, not code comments
4. **State transitions: See [Linear State Transition Gate](#-linear-state-transition-gate-read-before-updating-issues) — Done requires explicit user instruction**
5. `pnpm run ci:tracked` MUST pass before PR creation

**Auto-Splitting:** For complex multi-step tasks, the skill automatically detects and offers to split into tiered child issues. See [Linear-Based Continuity Pattern](../docs/patterns/linear-continuity.md).

**Full Documentation:** `.claude/skills/linear/`

---

## Sentry Issue Workflow

Use the `/sentry` skill for error triage, investigation, and resolution.

**Skill Location:** `.claude/skills/sentry/SKILL.md`

**Usage:**

```bash
/sentry                           # NON-INTERACTIVE: Batch triage unresolved issues
/sentry <sentry-url>              # Investigate specific issue
/sentry INT-123                   # Find Sentry issues linked to Linear issue
/sentry triage --limit 5          # Batch triage with limit
/sentry analyze <sentry-url>      # AI-powered root cause analysis (Seer)
/sentry linear <sentry-url>       # Create Linear issue from Sentry error
```

**Mandatory Requirements:**

1. Every Sentry issue MUST be linked to a Linear issue (use `[sentry] <title>` prefix)
2. Every fix PR MUST link both Sentry and Linear issues
3. No band-aid fixes — investigate root cause before implementing
4. `pnpm run ci:tracked` MUST pass before PR creation

**Full Documentation:** `.claude/skills/sentry/`

---

## Document-Service Skill

Use the `/document-service` skill to generate comprehensive service documentation.

**Skill Location:** `.claude/skills/document-service/SKILL.md`

**Modes:**

| Mode        | Invocation                            | Behavior                      |
| ----------- | ------------------------------------- | ----------------------------- |
| Discovery   | `/document-service` (no args)         | Lists services + doc status   |
| Interactive | `/document-service <service-name>`    | Asks 3 questions (Q1, Q5, Q8) |
| Autonomous  | Task tool → `service-scribe` subagent | Infers all answers from code  |

**Output:** 5 files per service + website content updates

**Full Documentation:** `.claude/skills/document-service/`

---

## Release Skill

Use the `/release` skill to orchestrate comprehensive release workflows.

**Skill Location:** `.claude/skills/release/SKILL.md`

**Usage:**

```bash
/release                # Full 6-phase release workflow
/release --skip-docs    # Skip service documentation phase
/release --phase 3      # Resume from specific phase
```

**Phases:**

| Phase | Name            | Interaction    | Key Actions                               |
| ----- | --------------- | -------------- | ----------------------------------------- |
| 1     | Kickoff         | User Input     | Semver analysis, detect modified services |
| 2     | Service Docs    | Silent Batch   | Spawn service-scribe agents in parallel   |
| 3     | High-Level Docs | **Checkpoint** | Propose docs/overview.md updates          |
| 4     | README          | **Checkpoint** | Propose "What's New" section              |
| 5     | Website         | **Checkpoint** | 3 improvement suggestions                 |
| 6     | Finalize        | Automatic      | CI check, commit, tag push                |

**Full Documentation:** `.claude/skills/release/`

---

## Claude Extensions Taxonomy

This project uses three types of Claude extensions:

### Skills (Directory-Based)

**Location:** `.claude/skills/<skill-name>/`
**Invocation:** `/skill-name` (user) or auto-trigger (model)

| Skill               | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `/linear`           | Linear issue management with auto-splitting      |
| `/sentry`           | Sentry triage with AI analysis and cross-linking |
| `/document-service` | Service documentation (interactive + autonomous) |
| `/release`          | 6-phase release workflow with checkpoints        |
| `/coverage`         | Branch coverage analysis and issue creation      |

### Agents (Task-Spawned)

**Location:** `.claude/agents/<agent-name>.md`
**Invocation:** Task tool with `subagent_type: <agent-name>`

| Agent             | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `llm-manager`     | LLM usage audit and pricing verification      |
| `service-creator` | New service scaffolding                       |
| `service-scribe`  | Autonomous documentation (delegates to skill) |
| `whatsapp-sender` | WhatsApp notification specialist              |

### Commands (Single-File)

**Location:** `.claude/commands/<command-name>.md`
**Invocation:** `/<command-name>`

| Command                | Purpose                         |
| ---------------------- | ------------------------------- |
| `/analyze-ci-failures` | Analyze CI failure patterns     |
| `/analyze-logs`        | Production log analysis         |
| `/create-service`      | New service creation wizard     |
| `/refactoring`         | Code smell detection and fixes  |
| `/semver-release`      | Semantic versioning release     |
| `/teach-me-something`  | Learn and persist tech insights |
| `/verify-deployment`   | Deployment verification         |

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
