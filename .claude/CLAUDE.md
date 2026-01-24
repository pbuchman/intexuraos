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

```bash
pnpm run verify:workspace:tracked -- <app-name>   # e.g. research-agent
```

Runs: TypeCheck (source + tests) → Lint → Tests + Coverage (95% threshold)

### Step 2: Full CI

```bash
pnpm run ci:tracked            # MUST pass before task completion
tf fmt -check -recursive      # If terraform changed
tf validate                   # If terraform changed
```

**IMPORTANT:** Use `tf` alias instead of `terraform` — clears emulator env vars. See `.claude/reference/infrastructure.md`.

**Do not claim complete until verification passes.**

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

**ALWAYS commit `.claude/ci-failures/*` files with your changes.**

### Coverage Verification Efficiency

**RULE:** Capture CI output once, analyze many times:

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output.txt
grep -E "(Coverage for|ERROR:)" /tmp/ci-output.txt
```

Never re-run tests just to grep different patterns — each run takes 2-5 minutes.

---

## Infrastructure

**Service account:** `~/personal/gcloud-claude-code-dev.json`

**Full reference:** `.claude/reference/infrastructure.md` (GCloud auth, Terraform, Cloud Build, Pub/Sub)

**Quick commands:**
- Activate: `gcloud auth activate-service-account --key-file=~/personal/gcloud-claude-code-dev.json`
- Terraform: Use `tf` alias (clears emulator vars)
- New service image: `./scripts/push-missing-images.sh`

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

### Route Naming Convention

- **Public routes:** `/{resource-name}` (e.g., `/todos`, `/bookmarks/:id`)
- **Internal routes:** `/internal/{resource-name}` (e.g., `/internal/todos`)
- **HTTP methods:** Use `PATCH` for partial updates, `PUT` for full replacement

### Key Rules

| Rule | Summary |
| ---- | ------- |
| Endpoint Logging | ALL endpoints MUST use `logIncomingRequest()` at entry |
| Pub/Sub | HTTP push only — Cloud Run scales to zero |
| Use Case Logging | Use cases MUST accept `logger: Logger` as dependency |
| Firestore | Each collection owned by ONE service. Cross-service via HTTP only |
| Composite Indexes | Multi-field queries require indexes in migrations |
| Migrations | IMMUTABLE — never modify, only create new ones |

---

## Apps & Packages

**Apps (`apps/**`):**
- Use `getServices()` for deps, `getFirestore()` singleton for DB
- Env vars: `INTEXURAOS_*` prefix (except `NODE_ENV`, `PORT`, emulators)
- Fail-fast: `validateRequiredEnv()` at startup
- New service: Use `/create-service` command

**Packages (`packages/**`):**
- `common-*` are leaf packages (no deps)
- `infra-*` wrap external services
- No domain logic in packages

**Pub/Sub Publishers:**
- All publishers MUST extend `BasePubSubPublisher`
- Topic names from env vars only (no hardcoding)
- Verification: `pnpm run verify:pubsub`

---

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`) — backend buckets don't support SPA fallback.

**Rules:** TailwindCSS only, `@auth0/auth0-react` for auth, `useApiClient` for API calls, SRP (split at ~150 lines), env vars via `import.meta.env.INTEXURAOS_*`.

---

## TypeScript Patterns

Strict mode enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Compiler errors guide fixes — use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

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

**RULE: NEVER push without explicit instruction.**

- `"commit"` → local only, no push
- `"commit and push"` → push once

**PR Workflow:**

```bash
git add -A && git commit -m "message"
git fetch origin && git merge origin/development
git push -u origin <branch>
gh pr create --base development
```

---

## User Communication

**RULE: When asking clarifying questions, ask ONE question at a time.**

Use the AskUserQuestion tool for each question separately. Do not batch multiple questions unless explicitly requested.

---

## Cross-Linking Protocol

All artifacts must be connected:

| From    | To      | Method                                          |
| ------- | ------- | ----------------------------------------------- |
| Linear  | GitHub  | PR title contains `INT-XXX`                     |
| GitHub  | Linear  | `Fixes INT-XXX` in PR body                      |
| Sentry  | Linear  | `[sentry] <title>` prefix + link in description |
| PR      | Sentry  | Sentry link in PR description                   |

---

## Linear Issue Workflow

Use the `/linear` command for issue tracking and workflow management.

**Usage:**

```bash
/linear                    # Pick random backlog issue (cron mode)
/linear <task description> # Create new issue
/linear INT-123            # Work on existing issue
/linear <sentry-url>       # Create from Sentry error
```

**Mandatory Requirements:**

1. All bugs/features must have corresponding Linear issues
2. PR descriptions must link to Linear issues (`Fixes INT-XXX`)
3. Reasoning belongs in PR descriptions, not code comments
4. State transitions: Backlog → In Progress → In Review → Done
5. `pnpm run ci:tracked` MUST pass before PR creation

**See:** `.claude/commands/linear.md` for complete workflow documentation.

---

## Complex Tasks — Continuity Workflow

For multi-step features, use numbered directories in `continuity/`. See [continuity/README.md](../continuity/README.md).

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

<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

_No recent activity_
</claude-mem-context>
