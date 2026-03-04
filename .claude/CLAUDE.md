# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**All rules below are verified by `pnpm run ci`. If CI passes, rules are satisfied.**

**Priority tiers:** **G**ates (always active) → **C**oding (during implementation) → **A**rchitecture (structural changes) → **W**orkflow (git/CI/deploy) → **R**eference (on-demand lookup).

---

# [G] GATES — Always Active

These rules are checked on EVERY action. No exceptions.

---

## ⛔ Commit Gate

| Question                                       | Required Answer |
| ---------------------------------------------- | --------------- |
| Did `pnpm run ci:tracked` pass?                | YES             |
| Did it pass completely, not "my part passed"?  | YES             |
| Am I about to say "other services/workspaces"? | NO              |
| Am I about to say "unrelated to my changes"?   | NO              |
| Am I about to say "not caused by my code"?     | NO              |

**Wrong answer = NO COMMIT. No partial pass.**

---

## User Control

**RULE: The user controls, Claude executes. Never assume permission to act.**

| User Says                        | User Wants         | Claude Does                          |
| -------------------------------- | ------------------ | ------------------------------------ |
| "What went wrong?"               | Analysis           | Explain the issue, wait for decision |
| "What can be improved?"          | Suggestions        | List options, wait for selection     |
| "Look at X — what do you think?" | Opinion/assessment | Provide assessment, wait             |
| "Why did this fail?"             | Diagnosis          | Diagnose, wait for next instruction  |
| "Implement X" / "Fix X" / "Do X" | Action             | Execute the task                     |

**Forbidden auto-actions** (NEVER without explicit instruction):

- Start implementing after analyzing
- Create branches or commits after reviewing
- Fix issues discovered during investigation
- "While I'm here, let me also..."

**Checkpoint pattern:** Present findings → STOP → Wait for explicit "proceed" / "implement" / "fix it".

**Exception:** Only proceed automatically if user said "analyze AND fix" upfront.

---

## Evidence Before Assertions

Hook-enforced by `evidence-check.sh`. No claim without proof — run it, show output, or say "I haven't verified yet."

---

## ⛔ Linear State Gate

Hook-enforced by `validate-linear-state.sh`. Max agent state: **In Review**. QA/Done = user decision.

---

## Ownership Mindset

Hook-enforced by `ownership-check.sh`. Own everything from task acceptance until CI passes. No "pre-existing", no "other services", no "my part passes". See `.claude/reference/ownership-mindset.md`

---

# [C] CODING RULES — Every Code Change

---

## Common LLM Mistakes

Hook-enforced by `detect-common-patterns.sh`. See `.claude/reference/common-mistakes.md`

---

## TypeScript Patterns

Strict mode enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Compiler errors guide fixes — use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

---

## Test-First Development

**RULE: Always write tests BEFORE implementation code.**

1. **Write failing test first** — Define expected behavior
2. **Run test to confirm it fails** — Validates test works
3. **Implement minimal code** — Only enough to pass
4. **Refactor if needed** — Keep tests green

**Exception:** Pure refactoring of existing tested code doesn't require new tests first.

---

## Testing

**No external deps.** In-memory fakes, `nock` for HTTP. Just `pnpm run test`.

- Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`
- Routes: integration via `app.inject()`. Domain: unit tests.
- **Coverage: 100% branch coverage required.** Every branch must be:
  1. Covered by tests (**STRONGLY preferred**), OR
  2. Exempted with `/* v8 ignore <CATEGORY> -- reason @preserve */` (**LAST RESORT only**)

CI fails on any unaccounted branch. No exceptions.

### Coverage Exemptions

**RULE:** `v8 ignore` is a LAST RESORT. Always write a test first. Hook-enforced by PostToolUse soft-block.

**Valid categories:** `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

**Reference:** `.claude/reference/coverage-exemptions.md`

### Web App Exception

- Coverage threshold not enforced (planned refactoring)
- Tests OPTIONAL for UI components
- Tests REQUIRED for: `utils/`, `services/`, `hooks/`, calculations

---

## Pre-Flight Checks

**RULE:** Read types BEFORE writing code. Most CI failures: code written from memory, not actual types.

- **Before mocks:** Read the `*Deps` type definition. Create mock with ALL required fields.
- **Before modifying ServiceContainer:** Read `services.ts`. Search `setServices(` in tests. Update ALL.
- **Before package imports:** Run `pnpm build` if "Cannot find module".
- **Before Result access:** Narrow first (`if (!result.ok) return result;`), then access `.value`.

---

## Prompt Versioning

**RULE:** All `PromptBuilder` prompts MUST have a `version` field following semver.

When editing a prompt's content, bump the version:

- **Major** (X.0.0): Behavior change (default inversion, category change, output format)
- **Minor** (x.Y.0): New examples, refined instructions, edge cases
- **Patch** (x.y.Z): Typos, formatting

---

## Code Auditing

**RULE:** When fixing a pattern in one service, audit ALL other services for the same issue before committing.

**Full guide:** [docs/patterns/auditing.md](../docs/patterns/auditing.md)

---

## Linear MCP Query Safety

**RULE:** Never use broad text searches with high limits. Causes context overflow.

```typescript
// BAD:  list_issues({ query: 'fix', limit: 50 })
// GOOD: list_issues({ query: 'INT-445', limit: 10 })
// Children: list_issues({ parentId: '<uuid>', limit: 20 }) — NOT includeRelations
```

**Recovery:** If context overflows, `/clear` and use targeted queries.

---

## Session Start Protocol

Hook automates via `session-start-build.sh`. Signs it failed: 50+ lint errors, `Cannot find module '@intexuraos/...'`.

---

# [A] ARCHITECTURE — Structural Decisions

---

## Architecture Overview

`apps/` (Fastify, Cloud Run) | `workers/` (Cloud Functions) | `packages/` (common-*, infra-*) | `terraform/` | `docs/`. Apps use `services.ts` DI; workers use lightweight direct injection. Both require 95% coverage. **Reference:** `.claude/reference/architecture.md`

---

## Key Architecture Rules

- **Import rules:** Apps can't import other apps. Routes use `getServices()`, not direct infra imports. ESLint enforced.
- **Service communication:** `/internal/{resource-name}` with `X-Internal-Auth` header. Use `validateInternalAuth()` server-side.
- **Route naming:** Public `/{resource-name}`, internal `/internal/{resource-name}`. `PATCH` partial, `PUT` full.
- **Endpoints:** ALL (`/internal/*`, webhooks, Pub/Sub) MUST use `logIncomingRequest()` at entry.
- **Pub/Sub:** Never use pull subscriptions — Cloud Run scales to zero. Use HTTP push only.
- **Use cases:** MUST accept `logger: Logger` as dependency.
- **Firestore:** Each collection owned by one service. Cross-service via HTTP only. Registry: `firestore-collections.json`.
- **Migrations:** IMMUTABLE. Never modify or delete existing files. Create new migrations to fix bugs.
- **Multi-field queries:** Need composite indexes in `migrations/*.mjs`. Fail without them.

---

## Response Contract

**RULE:** ALL HTTP responses MUST use `reply.ok(data)` or `reply.fail(code, message)`. Raw `reply.send()` is **FORBIDDEN** unless annotated with `// @allow-raw-send: <reason>`. Hook-enforced by `detect-common-patterns.sh`.

---

## Logging

**RULE:** Never use `pino()` directly in `apps/`. Use `createAppLogger()` from `@intexuraos/infra-sentry`. Hook-enforced by `detect-common-patterns.sh`.

---

## Apps & Packages

**Apps:** `getServices()` for deps, `getFirestore()` singleton, `INTEXURAOS_*` env vars, `validateRequiredEnv()` at startup. New service: `/create-service`.
**Packages:** `common-*` (leaf, no deps), `infra-*` (external wrappers). No domain logic.
**Pub/Sub:** All publishers MUST extend `BasePubSubPublisher`. Topic names from env vars only.

---

## Environment Variables

**RULE:** Adding a new env var requires updating THREE locations: (1) `apps/<service>/src/index.ts` `REQUIRED_ENV`, (2) `terraform/environments/dev/main.tf`, (3) `ecosystem.config.cjs`. **Patterns:** `.claude/reference/env-vars-patterns.md`. **CI:** `scripts/verify-env-vars.mjs`.

---

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`). TailwindCSS, `@auth0/auth0-react`, `useApiClient`, SRP (~150 lines), `import.meta.env.INTEXURAOS_*`. Dev: Vite proxies `/api/*` to localhost. Prod: absolute Cloud Run URLs baked at build.

---

# [W] WORKFLOW — Git, CI, Deploy

---

## CI Failure Protocol

When `pnpm run ci:tracked` fails, follow this protocol:

### Step 1: Capture and Analyze

```bash
BRANCH=$(git branch --show-current | sed 's/\//-/g')
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-${BRANCH}-$(date +%Y%m%d-%H%M%S).txt
```

Then analyze: `bat`, `rg "error|FAIL" -C3`, or `jq '.total.branches.pct' coverage/coverage-summary.json`.

### Step 2: Fix or Ask

| Failure Location    | Action                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| Workspace I touched | Fix immediately                                                            |
| Any other workspace | Fix immediately OR ask: "Found X errors in Y. Fix here or separate issue?" |
| Flaky test          | Stabilize it                                                               |
| Type/lint error     | Fix it                                                                     |
| Coverage threshold  | Write tests OR ask about scope                                             |

**Do not commit until ALL failures are resolved.** See [Commit Gate](#-commit-gate).

---

## Verification Protocol

**RULE:** Run all verification commands from the repository top-level root, not from subdirectories.

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

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

---

## Git & PR Workflow

**Before EVERY commit:** [Commit Gate](#-commit-gate) must pass.

**Before creating a PR:** merge latest base branch and resolve conflicts. PRs target `development`.

**Git worktrees are NOT allowed.** Work directly on feature branches or `development`.

```bash
pnpm run ci:tracked              # MUST pass first
git add -A && git commit -m "message"
git fetch origin && git merge origin/development
git push -u origin <branch>
gh pr create --base development
```

---

## Token Efficiency

Hook-enforced by `validate-polling.sh`. Use `--watch` not `sleep`+poll.

---

## Cross-Linking Protocol

PR titles contain `INT-XXX`. PR body: `Fixes INT-XXX`. **Reference:** `.claude/reference/cross-linking.md`

---

## Infrastructure

ALL infrastructure via Terraform only. SA key: `$HOME/.config/gcloud/sa-key.json`. **Reference:** `.claude/reference/infrastructure.md`

---

## Environments

dev=`dev.intexuraos.cloud` (PM2, home-dev) | prod=`intexuraos.cloud` (Cloud Run). No "local" environment. Firestore shared between both. **Reference:** `.claude/reference/environments.md`

---

# [R] REFERENCE — On-Demand Lookup

---

## User Communication

**RULE: When asking clarifying questions, ask ONE question at a time.**

Use the AskUserQuestion tool for each question separately. Do not batch multiple questions unless explicitly requested.

---

## Documentation

Hook-enforced by `format-docs-tables-after-edit.sh`. Tables must have proper column alignment.

---

## Plan Documentation

Plans involving HTTP endpoints MUST include an "Endpoint Changes" section with tables for: Modified, Created, Removed, Unchanged.
