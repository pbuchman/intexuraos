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

Catch yourself rationalizing? See `.claude/reference/rationalization-traps.md`.

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

**RULE: Never claim an outcome without proof. Guessing is failure.**

Every assertion about code behavior MUST be backed by evidence:

| Assertion Type           | Required Evidence                     |
| ------------------------ | ------------------------------------- |
| "This will work"         | Test output showing it passes         |
| "This fixes the bug"     | Before/after test or reproduction     |
| "This import resolves X" | Ran typecheck, showed zero errors     |
| "This was caused by X"   | Stack trace, log, or reproduction     |
| "The service is running" | Health check response or process list |

**What counts:** Command output, file content showing expected state, error message confirming diagnosis.

**What does NOT count:** Reasoning without execution. "I added X so it should work" is not evidence.

```
WRONG: [make change] → "This should work now."
RIGHT: [make change] → [run test/typecheck/build] → "Verified: [exact output]"
```

**No proof = no claim.** Run it, show it, or say "I haven't verified yet."

Rationalizing? See `.claude/reference/rationalization-traps.md` > Evidence Traps.

---

## ⛔ Linear State Gate

**Hook-enforced** by `validate-linear-state.sh`. Max agent state: **In Review**.

| Transition                 | Allowed?            |
| -------------------------- | ------------------- |
| Backlog/Todo → In Progress | Yes                 |
| In Progress → In Review    | Yes (maximum)       |
| Any → QA                   | **BLOCKED BY HOOK** |
| Any → Done                 | **BLOCKED BY HOOK** |

QA and Done = business decisions. User confirms, not agent.

Rationalizing? See `.claude/reference/rationalization-traps.md` > Linear State Traps.

---

## Ownership Mindset

You own EVERYTHING from task acceptance until CI passes. No exceptions.

**Full rules + forbidden language:** `.claude/reference/ownership-mindset.md`

### Forbidden Language

| Forbidden                       | Why                            |
| ------------------------------- | ------------------------------ |
| "pre-existing issue/bug"        | Discovery = ownership          |
| "not my fault/responsibility"   | Fault irrelevant; fix is yours |
| **"OTHER services/workspaces"** | No "other" in CI               |
| **"my code/part passes"**       | CI passes or doesn't           |

**Standard:** No excuses → No blame → Proactive → Cover and move.

**Exception:** Only if user explicitly says "ignore X, focus on Y".

---

# [C] CODING RULES — Every Code Change

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

**RULE:** `v8 ignore` is a LAST RESORT, not a shortcut. Always write a test first.

**Before adding ANY v8 ignore comment, you MUST:**

1. Write a test that exercises the branch
2. Confirm the branch is **genuinely untestable** (not just inconvenient)
3. Verify the category matches a canonical pattern from the list below

**NEVER valid for v8 ignore** — these are ALWAYS testable:

| Pattern              | How to Test It                          |
| -------------------- | --------------------------------------- |
| Catch blocks         | Throw in the test (mock the dependency) |
| Error paths          | Mock the dependency to return an error  |
| Validation branches  | Pass invalid input                      |
| Conditional returns  | Test both branches with different input |
| If/else branches     | Test both conditions                    |
| Default switch cases | Pass an unmatched value                 |
| Null guards          | Pass null/undefined input               |

**Valid categories:** `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

**Validation:** `pnpm run verify:v8-ignore` (runs in CI Static Validation phase)

**Hook-enforced:** Adding `v8 ignore` triggers a PostToolUse soft-block reminder.

**NEVER** add v8 ignore comments without a valid category. CI will fail.

**Reference:** `.claude/skills/coverage/reference/canonical-categories.md`

Rationalizing? See `.claude/reference/rationalization-traps.md` > V8 Ignore Traps.

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

**Enforcement:** `pnpm run verify:prompt-versions` (CI Static Validation phase)
**Reference:** `docs/patterns/prompt-versioning.md`

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

**RULE:** At the start of every fresh session, build all packages and verify environment:

```bash
pnpm build
```

Then verify critical environment variables are loaded:

```bash
node -e "
  const vars = [
    'INTEXURAOS_GCP_PROJECT_ID',
    'INTEXURAOS_INTERNAL_AUTH_TOKEN',
    'INTEXURAOS_AUTH_JWKS_URL',
    'INTEXURAOS_ZAI_APP_API_KEY',
    'INTEXURAOS_OPENAI_APP_API_KEY',
    'INTEXURAOS_SENTRY_DSN',
  ];
  const missing = vars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.log('⚠ MISSING ENV VARS: ' + missing.join(', '));
    console.log('Run: direnv allow');
  } else {
    console.log('✓ All critical env vars loaded');
  }
"
```

**Print the result to the user.** If vars are missing, run `direnv allow` before proceeding.

**Environment variables require `direnv`.** The `.envrc` file loads all `INTEXURAOS_*` vars. **Always run `direnv allow` at session start.**

**Signs you forgot:** 50+ `no-unsafe-*` lint errors, `Cannot find module '@intexuraos/...'`, errors only in `apps/` not `packages/`.

---

# [A] ARCHITECTURE — Structural Decisions

---

## Architecture Overview

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

**RULE:** ALL HTTP responses MUST use `reply.ok(data)` or `reply.fail(code, message)`.

Raw `reply.send()` is **FORBIDDEN** unless annotated with `// @allow-raw-send: <reason>`.

| Method           | Returns                                              | Use For               |
| ---------------- | ---------------------------------------------------- | --------------------- |
| `reply.ok(data)` | `{ success: true, data: T }`                         | Success responses     |
| `reply.fail()`   | `{ success: false, error: { code, message } }` + 4xx | Expected error states |

**Verification:** `pnpm run verify:reply-send` (CI Static Validation phase)

**Full documentation:** [docs/patterns/response-contract.md](../docs/patterns/response-contract.md)

---

## Logging

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

## Environment Variables

**RULE:** Adding a new environment variable requires updating THREE locations:

| Step | Location                             | What to Update                                                                |
| ---- | ------------------------------------ | ----------------------------------------------------------------------------- |
| 1    | `apps/<service>/src/index.ts`        | Add to `REQUIRED_ENV` array                                                   |
| 2    | `terraform/environments/dev/main.tf` | Add to service's `env_vars` or `secrets`                                      |
| 3    | `ecosystem.config.cjs`               | Add to `COMMON_SERVICE_ENV`, `COMMON_SERVICE_URLS`, or `SERVICE_ENV_MAPPINGS` |

**Failure to update all three causes:**

- Missing in Terraform → **Startup probe failure** (22% of build failures)
- Missing in ecosystem.config.cjs → Local development broken
- Missing in REQUIRED_ENV → Runtime crash when var accessed

**Patterns:** See `.claude/reference/env-vars-patterns.md`. **CI:** `scripts/verify-env-vars.mjs`.

---

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`) — backend buckets don't support SPA fallback.

**Rules:** TailwindCSS only, `@auth0/auth0-react` for auth, `useApiClient` for API calls, SRP (split at ~150 lines), env vars via `import.meta.env.INTEXURAOS_*`.

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

### Step 4: Terraform Verification (ALWAYS CHECK)

**RULE:** Never assume terraform didn't change. Always verify explicitly.

```bash
git diff --name-only HEAD~1 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"
```

If changed: run `terraform fmt -check -recursive` and `terraform validate` (with emulator env vars cleared + SA credentials set).

### Step 5: Document Verification Result

- "Verified: No terraform files changed"
- "Terraform changed. Ran `terraform fmt` and `terraform validate` — both passed"

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

---

## Git & PR Workflow

**Before EVERY commit:** [Commit Gate](#-commit-gate) must pass.

**Before creating a PR:** merge latest base branch and resolve conflicts.

```bash
pnpm run ci:tracked              # MUST pass first
git add -A && git commit -m "message"
git fetch origin && git merge origin/development
git push -u origin <branch>
gh pr create --base development
```

---

## Token Efficiency

**RULE:** Use streaming/watch instead of polling. **Enforced by** `validate-polling.sh`.

```bash
# Use: gh pr checks 682 --watch / gh run watch 12345
# Not: sleep 60 && gh pr checks 682
```

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

## Infrastructure

**Service account:** `$HOME/.config/gcloud/sa-key.json`

**Full reference:** `.claude/reference/infrastructure.md` (GCloud auth, Terraform, Cloud Build, Pub/Sub, resource creation rules)

**Quick commands:**

- GCloud CLI: `gcloud auth activate-service-account --key-file=$HOME/.config/gcloud/sa-key.json`
- Terraform: Clear emulator vars + set GOOGLE_APPLICATION_CREDENTIALS (see reference)
- New service image: `./scripts/push-missing-images.sh`

**RULE:** ALL infrastructure via Terraform only. See reference for CLI-to-Terraform mapping.

---

## Environments

| Environment | Domain               | Infra                 | Machine                             | Deploy Target            |
| ----------- | -------------------- | --------------------- | ----------------------------------- | ------------------------ |
| **local**   | localhost:3000       | PM2                   | Any dev machine (`uname -s`=Darwin) | Direct                   |
| **dev**     | dev.intexuraos.cloud | PM2, GCP              | home-dev (`uname -n`=home-dev)      | `~/deploy/intexuraos`    |
| **prod**    | intexuraos.cloud     | Cloud Run / Functions | GCloud                              | CI/CD via GitHub Actions |

**How to detect which environment you are on:**

| Check              | local                | dev (home-dev)         | prod             |
| ------------------ | -------------------- | ---------------------- | ---------------- |
| `uname -s`         | Darwin               | Linux                  | N/A (Cloud Run)  |
| `uname -n`         | ≠ home-dev           | home-dev               | N/A              |
| Platform (context) | darwin               | linux                  | N/A              |
| Logs               | PM2 logs / stdout    | PM2 logs / stdout      | `gcloud logging` |
| Firestore          | Emulator (port 8101) | Emulator or production | Production       |

**local** = wherever you run code that is NOT prod or dev. No assumptions about specific machine.

**Dev** and **local** both use `pnpm dev` (Vite dev server with proxy). Service URLs are `/api/*` relative paths proxied by Vite.
**Prod** uses `pnpm build` (static bundle on CDN). Service URLs are absolute Cloud Run URLs baked at build time.

### ⛔ Environment Awareness — BEFORE Investigating Any Runtime Issue

**RULE: Identify WHERE you are running before investigating.** Wrong assumptions waste time.

```
STEP 1: Check `uname -n`. Is it home-dev? If not, am I analyzing prod (gcloud) logs or local?
STEP 2: If home-dev → everything is co-located. No SSH needed. Direct access.
STEP 3: If analyzing a failure → check where the failure HAPPENED (prod Cloud Run logs vs local PM2 logs).
STEP 4: Check service status with the right tool (see below).
```

**On home-dev — all services run on the SAME machine:**

| Component                 | Manager        | Commands                                                         |
| ------------------------- | -------------- | ---------------------------------------------------------------- |
| Apps (18 services + web)  | PM2            | `pm2 status`, `pm2 logs <name>`, `pm2 restart <name>`            |
| Orchestrator              | systemd        | `sudo systemctl status/restart intexuraos-orchestrator@pbuchman` |
| Workers (cloud functions) | Direct process | `pnpm dev` (tsx watch) or `node dist/index.js`                   |

**Orchestrator is NOT in PM2.** It runs under systemd as `intexuraos-orchestrator@pbuchman`, executing compiled `dist/index.js`. Check with `systemctl status`, not `pm2 status`.

**Auto-deploy via webhook handler.** A GitHub webhook at `~/tools/webhook-handler/` receives push events to `development`, detects changed files, and restarts affected services. PM2 services restart via `pm2 restart`; the orchestrator rebuilds (`pnpm --filter orchestrator build`) then restarts via `systemctl restart`. PM2 file watching is disabled (`watch: false`).

**Key port map** (full list in `ecosystem.config.cjs`):

| Service      | Port |
| ------------ | ---- |
| code-agent   | 8128 |
| chat-agent   | 8129 |
| web-agent    | 8127 |
| user-service | 8110 |

**Forbidden assumptions:**

- "Platform is darwin therefore home-dev" — WRONG. darwin = local macOS, home-dev is Linux.
- "This is a prod issue" — verify first by checking where the logs came from.
- "I can't access that service" — on home-dev, you CAN. It's localhost.
- "Not related to my changes" — if it's on the same machine, investigate it.
- "We need to restart/deploy" — webhook auto-deploys on push to development. Just push.

---

# [R] REFERENCE — On-Demand Lookup

---

## User Communication

**RULE: When asking clarifying questions, ask ONE question at a time.**

Use the AskUserQuestion tool for each question separately. Do not batch multiple questions unless explicitly requested.

---

## Skills & Extensions

**Skills** (invoke via `/skill-name`): `/linear`, `/sentry`, `/document-service`, `/release`, `/coverage`, `/tech-debt-triage`, `/share`, `/features-rewrite`

**Agents** (Task tool): `llm-manager`, `service-creator`, `service-scribe`, `whatsapp-sender`

**Commands**: `/analyze-ci-failures`, `/analyze-logs`, `/create-service`, `/features-rewrite`, `/refactoring`, `/teach-me-something`, `/verify-deployment`

All skill documentation in `.claude/skills/<name>/SKILL.md`. For complex multi-step tasks, use `/linear` with auto-splitting. See [Linear Continuity Pattern](../docs/patterns/linear-continuity.md).

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
