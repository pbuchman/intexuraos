# CLAUDE.md Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce CLAUDE.md from 765 lines / 3,552 words to ~550 lines by eliminating redundancy, adding explicit priority tiers, and compressing hook-enforced rules — without removing any rules.

**Architecture:** Reorganize into 5 explicit tiers (GCAWR): Gates, Coding, Architecture, Workflow, Reference. Deduplicate the 3 rationalization trap tables into 1. Merge scattered ownership references into single canonical section. Compress hook-enforced rules that can't be violated.

**Tech Stack:** Markdown only. No code changes. Reference files updated to absorb content moved out of main file.

---

## Scope

**Files modified:**

- `.claude/CLAUDE.md` — main file, major restructure
- `.claude/reference/ownership-mindset.md` — absorbs consolidated ownership content
- `.claude/reference/common-mistakes.md` — no changes (already clean)
- `.claude/reference/infrastructure.md` — no changes (already clean)
- `.claude/reference/env-vars-patterns.md` — no changes (already clean)

**Files NOT modified:**

- `.claude/settings.json` — hooks unchanged
- `.claude/hooks/*` — enforcement layer unchanged
- `~/.claude/CLAUDE.md` — global config unchanged

**Zero-loss guarantee:** Every rule in the current CLAUDE.md must exist in the optimized version. The verification step (Task 8) confirms this by diffing extracted rules.

---

## Precise Duplication Map

These are the exact locations of redundant content that will be deduplicated:

### Duplication 1: Rationalization Trap Tables (3 instances)

| Instance    | Location | Lines   | Content                              |
| ----------- | -------- | ------- | ------------------------------------ |
| Commit Gate | L25-33   | 9 lines | "CI failed but my code passes" table |
| Linear Gate | L103-110 | 8 lines | "PR is merged, so it's done" table   |
| CI Failure  | L200-207 | 8 lines | "Other services fail" anti-pattern   |

**Action:** Merge into ONE "Rationalization Traps" section. Each gate references it.

### Duplication 2: "Never commit without CI" (6 instances)

| Instance                                     | Location     | Line |
| -------------------------------------------- | ------------ | ---- |
| "Wrong answer = NO COMMIT"                   | Commit Gate  | L23  |
| "No partial pass"                            | Commit Gate  | L34  |
| "NEVER COMMIT UNTIL ALL FAILURES RESOLVED"   | CI Failure   | L190 |
| "CI passes or you don't commit"              | CI Failure   | L207 |
| "NEVER commit without ci:tracked"            | Git Workflow | L689 |
| "only acceptable verification is ci:tracked" | Git Workflow | L701 |

**Action:** Keep L23 + L34 as canonical. Other 4 become back-references: "See [Commit Gate]."

### Duplication 3: Ownership Cross-References (5 instances)

| Instance                   | Location            | Line     |
| -------------------------- | ------------------- | -------- |
| Main section (33 lines)    | Ownership Mindset   | L124-157 |
| "See ownership-mindset.md" | Ownership Mindset   | L138     |
| "= ownership violation"    | CI Failure Protocol | L163-164 |
| "See Forbidden Language"   | CI Failure Protocol | L194     |
| "See Ownership Mindset"    | Verification        | L271     |
| "See Ownership Mindset"    | Git Workflow        | L699     |

**Action:** Consolidate into reference file. Main doc keeps 5-line summary + link.

### Duplication 4: Hook-Enforced Verbose Explanations

| Section           | Lines    | Hook?                         | Current Size | Can Compress To |
| ----------------- | -------- | ----------------------------- | ------------ | --------------- |
| Linear State Gate | L90-121  | Yes, validate-linear-state.sh | 31 lines     | 8 lines         |
| Token Efficiency  | L564-579 | Yes, validate-polling.sh      | 16 lines     | 6 lines         |

**Action:** Reduce to: rule statement + "Enforced by hook" + correct behavior example.

---

## Tasks

### Task 1: Extract Rules Inventory (Before Snapshot)

**Purpose:** Create a machine-diffable list of every rule so we can verify zero loss after restructure.

**Files:**

- Create: `/tmp/claude-md-rules-before.txt`

**Step 1: Extract all rules from current CLAUDE.md**

Run:

```bash
grep -n "RULE\|NEVER\|MUST\|FORBIDDEN\|MANDATORY\|CRITICAL\|ALWAYS\|BLOCKED" .claude/CLAUDE.md | sort > /tmp/claude-md-rules-before.txt
```

**Step 2: Count rules**

Run:

```bash
wc -l /tmp/claude-md-rules-before.txt
```

Expected: ~35-45 rules extracted

**Step 3: Save section headers**

Run:

```bash
grep -n "^## " .claude/CLAUDE.md > /tmp/claude-md-sections-before.txt
```

---

### Task 2: Create Unified Rationalization Traps Reference

**Purpose:** Single source for all "your thought vs reality" tables. Currently repeated 3 times.

**Files:**

- Create: `.claude/reference/rationalization-traps.md`

**Step 1: Write the unified reference file**

Create `.claude/reference/rationalization-traps.md` with this exact content:

```markdown
# Rationalization Traps Reference

Common thought patterns that precede rule violations. When you catch yourself thinking any of these, STOP.

---

## Commit & CI Traps

| Your Thought                                  | Reality                                |
| --------------------------------------------- | -------------------------------------- |
| "CI failed but my code passes"                | CI failed. No commit.                  |
| "The failure is in OTHER services"            | OTHER = forbidden. You own it.         |
| "Global CI fails, but X-specific checks pass" | This phrase has caused violations.     |
| "Let me commit anyway and note the CI status" | NO. Fix first, then commit.            |
| "Other services fail, my code passes"         | Same trap, different words. No commit. |

## Linear State Traps

| Your Thought                                  | Reality                                |
| --------------------------------------------- | -------------------------------------- |
| "The PR is merged, so it's obviously done"    | Merged ≠ Done. Hook blocks it.         |
| "All child issues are complete"               | Complete ≠ Done. User confirms.        |
| "This is just bookkeeping, I'll mark it done" | Bookkeeping requires permission.       |
| "Ready for QA, let me move it there"          | QA is beyond agent scope. Hook blocks. |

## Ownership Traps

| Your Thought                  | Reality                        |
| ----------------------------- | ------------------------------ |
| "pre-existing issue/bug"      | Discovery = ownership          |
| "not my fault/responsibility" | Fault irrelevant; fix is yours |
| "unrelated to my changes"     | Blocks CI = related            |
| "was already broken"          | Now yours to fix               |
| "legacy issue"                | Legacy = code awaiting owner   |
| "my code/part passes"         | CI passes or doesn't           |
```

**Step 2: Verify file created**

Run:

```bash
cat .claude/reference/rationalization-traps.md | head -5
```

Expected: Shows "# Rationalization Traps Reference"

---

### Task 3: Consolidate Ownership Into Reference File

**Purpose:** The ownership rules exist in 3 places. Make the reference file canonical.

**Files:**

- Modify: `.claude/reference/ownership-mindset.md` (currently 40 lines, expand to ~55 lines)

**Step 1: Rewrite ownership-mindset.md**

Replace entire file with:

```markdown
# Ownership Mindset Reference

From task acceptance until successful CI, you own everything. No bad teams—only unowned problems.

---

## Scope

- **Start:** Task assigned or accepted
- **End:** `pnpm run ci:tracked` passes AND PR ready for review
- **Everything in between:** YOUR responsibility

If CI fails due to a "pre-existing" issue, that issue is now YOURS.

---

## Ownership Standard

1. **No excuses** — own problems completely
2. **No blame** — don't point at "previous state"
3. **Proactive** — see problem, fix problem
4. **Cover and move** — fix issues outside your scope if they block success

---

## Forbidden Language

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

---

## The Only Exception

May acknowledge pre-existing state ONLY when user EXPLICITLY instructs:

- "Ignore the type errors in legacy/, focus only on new code"
- "This is a known issue, skip it for now"

Without explicit instruction, assume responsibility for everything encountered.
```

---

### Task 4: Rewrite CLAUDE.md — Top Section (Gates Tier)

**Purpose:** Rewrite lines 1-157 (header + commit gate + user control + linear gate + ownership). Add GCAWR tier markers. Compress linear gate. Replace ownership with link.

**Files:**

- Modify: `.claude/CLAUDE.md` lines 1-157

**Step 1: Replace lines 1-157 with the following**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**All rules below are verified by `pnpm run ci`. If CI passes, rules are satisfied.**

**Priority tiers:** Rules are organized by attention priority. **G**ates are always active. **C**oding rules apply during implementation. **A**rchitecture rules apply for structural changes. **W**orkflow rules apply during git/CI/deploy. **R**eference material is consulted on-demand.

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

## ⛔ Linear State Gate

**Hook-enforced** by `validate-linear-state.sh`. Max agent state: **In Review**.

| Transition                 | Allowed?            |
| -------------------------- | ------------------- |
| Backlog/Todo → In Progress | Yes                 |
| In Progress → In Review    | Yes (maximum)       |
| Any → QA                   | **BLOCKED BY HOOK** |
| Any → Done                 | **BLOCKED BY HOOK** |

Rationalizing? See `.claude/reference/rationalization-traps.md` > Linear State Traps.

---

## Ownership Mindset

You own EVERYTHING from task acceptance until CI passes. No exceptions.

**Full rules + forbidden language:** `.claude/reference/ownership-mindset.md`

**Key violations:** "OTHER services", "my code passes", "unrelated to my changes", "was already broken"

**Exception:** Only if user explicitly says "ignore X, focus on Y".
```

**What changed:**

- Commit gate: Removed inline rationalization trap table (→ reference file). Saved ~9 lines.
- User control: Removed "Practical Examples" block (redundant with table). Saved ~10 lines.
- Linear gate: Compressed from 31 lines to 8 lines. Hook enforcement means verbose explanation is unnecessary. Saved ~23 lines.
- Ownership: Replaced 33 lines with 6-line summary + link. Saved ~27 lines.
- Added GCAWR tier header.

**What was NOT removed:**

- Every rule from the question table is preserved
- Every forbidden auto-action is preserved
- Every Linear transition rule is preserved
- Ownership standard + forbidden language preserved (in reference file)

---

### Task 5: Rewrite CLAUDE.md — CI + Verification Sections (Workflow Tier)

**Purpose:** Rewrite lines 158-301 (CI Failure Protocol, Verification, Infrastructure, Environments). Deduplicate ownership references. Remove redundant "never commit" repetitions.

**Files:**

- Modify: `.claude/CLAUDE.md` lines 158-301

**Step 1: Replace lines 158-301 with the following**

````markdown
---
# [W] WORKFLOW — Git, CI, Deploy
---

## CI Failure Protocol

When `pnpm run ci:tracked` fails:

### Step 1: Capture

```bash
BRANCH=$(git branch --show-current | sed 's/\//-/g')
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-${BRANCH}-$(date +%Y%m%d-%H%M%S).txt
```
````

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

**RULE:** Run from repository root, not subdirectories.

**Step 1:** `pnpm run verify:workspace:tracked -- <app-name>` (TypeCheck → Lint → Tests + Coverage)

**Step 2:** `ls packages/*/dist/ >/dev/null 2>&1 || echo "WARNING: packages not built"` (if unbuilt: 50+ false lint errors)

**Step 3:** `pnpm run ci:tracked` (MUST pass before task completion)

**Step 4: Terraform** — Never assume terraform didn't change:

```bash
git diff --name-only HEAD~1 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"
```

If changed: run `terraform fmt -check -recursive` and `terraform validate` (with emulator env vars cleared + SA credentials).

**Step 5:** Document result: "Verified: No terraform changes" or "Terraform validated."

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

---

## Git & PR Workflow

**Before EVERY commit:** [Commit Gate](#-commit-gate) must pass.

**Before creating a PR:** merge latest base branch and resolve conflicts.

```bash
pnpm run ci:tracked
git add -A && git commit -m "message"
git fetch origin && git merge origin/development
git push -u origin <branch>
gh pr create --base development
```

---

## Cross-Linking Protocol

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

**Full reference:** `.claude/reference/infrastructure.md`

**Quick commands:**

- GCloud: `gcloud auth activate-service-account --key-file=$HOME/.config/gcloud/sa-key.json`
- Terraform: Clear emulator vars + set GOOGLE_APPLICATION_CREDENTIALS (see reference)
- New service image: `./scripts/push-missing-images.sh`

**RULE:** ALL infrastructure via Terraform only.

---

## Environments

| Environment | Domain               | Infra                 | Deploy Target            |
| ----------- | -------------------- | --------------------- | ------------------------ |
| **dev**     | dev.intexuraos.cloud | PM2, GCP              | `~/deploy/intexuraos`    |
| **prod**    | intexuraos.cloud     | Cloud Run / Functions | CI/CD via GitHub Actions |
| **local**   | localhost:3000       | PM2                   | Direct                   |

Dev/local: `pnpm dev` (Vite proxy, `/api/*` relative paths).
Prod: `pnpm build` (static CDN, absolute Cloud Run URLs).

---

## Token Efficiency

**RULE:** Use streaming/watch instead of polling. **Enforced by** `validate-polling.sh`.

```bash
# Use: gh pr checks 682 --watch / gh run watch 12345
# Not: sleep 60 && gh pr checks 682
```

````

**What changed:**
- CI Failure Protocol: Removed 4 redundant "never commit" lines + ownership cross-references + anti-pattern block. 50→28 lines.
- Verification: Compressed terraform commands into 2-line summary. Removed "Verification Ownership" cross-reference. 60→25 lines.
- Git & PR: Removed redundant commit gate restatement (3 lines → 1 back-reference). 28→12 lines.
- Infrastructure: Already clean, minor formatting only.
- Environments: Removed "Machine" column (low value). 2-line summary replaces 2-paragraph explanation.
- Token Efficiency: Compressed from 16 to 6 lines. Hook does the real enforcement.

---

### Task 6: Rewrite CLAUDE.md — Coding + Architecture Sections

**Purpose:** Rewrite lines 302-632 (Architecture, Apps & Packages, Env Vars, Web App, TypeScript, Session Start, Pre-Flight, Linear MCP, Common Mistakes, Auditing, TDD, Testing). Group by tier.

**Files:**
- Modify: `.claude/CLAUDE.md` lines 302-632

**Step 1: Replace lines 302-632 with the following**

```markdown
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

Strict mode: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`.
Use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

---

## Test-First Development

**RULE: Always write tests BEFORE implementation code.**

1. Write failing test → 2. Run to confirm failure → 3. Implement minimal code → 4. Refactor if needed

**Exception:** Pure refactoring of existing tested code.

---

## Testing

**No external deps.** In-memory fakes, `nock` for HTTP. Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`. Routes: `app.inject()`. Domain: unit tests.

**Coverage: 100% branch.** Every branch covered by tests OR exempted with `/* v8 ignore <CATEGORY> -- reason @preserve */`.

**Valid categories:** `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

**Validation:** `pnpm run verify:v8-ignore`. **NEVER** add v8 ignore without valid category.

**Web app exception:** Coverage not enforced. Tests required for: `utils/`, `services/`, `hooks/`, calculations.

---

## Pre-Flight Checks

**RULE:** Read types BEFORE writing code. Most CI failures: code written from memory.

- **Before mocks:** Read the `*Deps` type. Create mock with ALL fields.
- **Before modifying ServiceContainer:** Read `services.ts`. Search `setServices(` in tests. Update ALL.
- **Before package imports:** Run `pnpm build` if "Cannot find module".
- **Before Result access:** Narrow first (`if (!result.ok) return result;`), then access `.value`.

---

## Code Auditing

**RULE:** When fixing a pattern in one service, audit ALL other services for the same issue before committing.

---

## Linear MCP Query Safety

**RULE:** Never use broad text searches with high limits. Causes context overflow.

```typescript
// BAD: list_issues({ query: 'fix', limit: 50 })
// GOOD: list_issues({ query: 'INT-445', limit: 10 })
// Children: list_issues({ parentId: '<uuid>', limit: 20 }) — NOT includeRelations
````

---

## Session Start Protocol

At session start: `pnpm build` + `direnv allow` + verify env vars loaded.

**Signs you forgot:** 50+ `no-unsafe-*` lint errors, `Cannot find module '@intexuraos/...'`.

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
packages/
  common-*/   → Leaf packages (no deps)
  infra-*/    → External service wrappers
terraform/    → Infrastructure as code
```

| Aspect      | Apps (Cloud Run)   | Workers (Cloud Functions)                |
| ----------- | ------------------ | ---------------------------------------- |
| Framework   | Fastify            | Cloud Functions Framework                |
| Entry Point | `server.ts`        | `index.ts` with `functions.cloudEvent()` |
| DI Pattern  | Full `services.ts` | Lightweight, direct injection            |

---

## Key Architecture Rules

- **Import rules:** Apps can't import other apps. Routes use `getServices()`. ESLint enforced.
- **Service communication:** `/internal/{resource-name}` + `X-Internal-Auth` header.
- **Routes:** Public `/{resource}`, internal `/internal/{resource}`. `PATCH` partial, `PUT` full.
- **Endpoints:** ALL must use `logIncomingRequest()` at entry.
- **Pub/Sub:** HTTP push only (no pull). Publishers extend `BasePubSubPublisher`. Topics from env vars.
- **Firestore:** Each collection owned by one service. Cross-service via HTTP. Registry: `firestore-collections.json`.
- **Migrations:** IMMUTABLE. Never modify existing files.
- **Logging:** `createAppLogger()` from `@intexuraos/infra-sentry`. Never `pino()` directly. Enforced by hook + `pnpm run verify:sentry-logging`.

---

## Response Contract

**RULE:** ALL HTTP responses use `reply.ok(data)` or `reply.fail(code, message)`. Raw `reply.send()` FORBIDDEN unless `// @allow-raw-send: <reason>`. Enforced: `pnpm run verify:reply-send`.

---

## Environment Variables

Adding a new env var requires THREE locations:

| Location                             | What                                       |
| ------------------------------------ | ------------------------------------------ |
| `apps/<service>/src/index.ts`        | `REQUIRED_ENV` array                       |
| `terraform/environments/dev/main.tf` | `env_vars` or `secrets`                    |
| `ecosystem.config.cjs`               | `COMMON_SERVICE_ENV` / `URLS` / `MAPPINGS` |

Missing any → startup probe failure (22% of build failures), broken local dev, or runtime crash.

**Patterns:** `.claude/reference/env-vars-patterns.md`. **CI:** `scripts/verify-env-vars.mjs`.

---

## Apps & Packages

**Apps:** `getServices()` for deps, `getFirestore()` singleton, `INTEXURAOS_*` env prefix, `validateRequiredEnv()` at startup.

**Packages:** `common-*` are leaf (no deps), `infra-*` wrap external services, no domain logic.

---

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`). TailwindCSS only, `@auth0/auth0-react` for auth, `useApiClient` for API calls, split at ~150 lines, `import.meta.env.INTEXURAOS_*`.

````

---

### Task 7: Rewrite CLAUDE.md — Bottom Sections (Reference Tier)

**Purpose:** Rewrite lines 633-766 (User Communication, Documentation, Plan Documentation, Skills & Extensions). Add Reference tier header.

**Files:**
- Modify: `.claude/CLAUDE.md` lines 633-766

**Step 1: Replace lines 633-766 with the following**

```markdown
---

# [R] REFERENCE — On-Demand

---

## User Communication

**RULE:** Ask ONE clarifying question at a time via AskUserQuestion.

---

## Skills & Extensions

**Skills:** `/linear`, `/sentry`, `/document-service`, `/release`, `/coverage`

**Agents:** `llm-manager`, `service-creator`, `service-scribe`, `whatsapp-sender`

**Commands:** `/analyze-ci-failures`, `/analyze-logs`, `/create-service`, `/refactoring`, `/semver-release`, `/teach-me-something`, `/verify-deployment`

Docs: `.claude/skills/<name>/SKILL.md`. Multi-step tasks: `/linear` with auto-splitting.

---

## Documentation

All tables: proper column alignment. Fix: `pnpm run format:docs-tables`.

Plans with endpoints MUST include "Endpoint Changes" section (Modified, Created, Removed, Unchanged tables).
````

---

### Task 8: Verify Zero Rule Loss

**Purpose:** Confirm every rule from the original file exists in the new version.

**Step 1: Extract rules from new CLAUDE.md**

Run:

```bash
grep -n "RULE\|NEVER\|MUST\|FORBIDDEN\|MANDATORY\|CRITICAL\|ALWAYS\|BLOCKED" .claude/CLAUDE.md | sort > /tmp/claude-md-rules-after.txt
```

**Step 2: Compare counts**

Run:

```bash
echo "Before: $(wc -l < /tmp/claude-md-rules-before.txt) rules"
echo "After:  $(wc -l < /tmp/claude-md-rules-after.txt) rules"
```

Expected: After count >= Before count (some rules consolidated, none removed)

**Step 3: Manual spot-check critical rules**

Verify these specific rules exist in the new file (grep for each):

```bash
grep -c "ci:tracked" .claude/CLAUDE.md           # Expected: >= 3
grep -c "reply.ok\|reply.fail" .claude/CLAUDE.md  # Expected: >= 1
grep -c "logIncomingRequest" .claude/CLAUDE.md     # Expected: >= 1
grep -c "createAppLogger" .claude/CLAUDE.md        # Expected: >= 1
grep -c "v8 ignore" .claude/CLAUDE.md              # Expected: >= 2
grep -c "validateRequiredEnv" .claude/CLAUDE.md    # Expected: >= 1
grep -c "Hash routing" .claude/CLAUDE.md           # Expected: >= 1
grep -c "BasePubSubPublisher" .claude/CLAUDE.md    # Expected: >= 1
grep -c "IMMUTABLE" .claude/CLAUDE.md              # Expected: >= 1
grep -c "rationalization-traps" .claude/CLAUDE.md  # Expected: >= 2 (references)
```

**Step 4: Count final size**

Run:

```bash
wc -l .claude/CLAUDE.md && wc -w .claude/CLAUDE.md
```

Expected: ~480-550 lines, ~2,200-2,600 words (down from 765 lines / 3,552 words)

---

### Task 9: Commit

**Step 1: Run CI to verify nothing broke**

The CLAUDE.md is not checked by CI directly, but reference files should be valid markdown:

```bash
cat .claude/reference/rationalization-traps.md | head -1
cat .claude/reference/ownership-mindset.md | head -1
```

**Step 2: Commit all changes**

```bash
git add .claude/CLAUDE.md .claude/reference/rationalization-traps.md .claude/reference/ownership-mindset.md
git commit -m "Optimize CLAUDE.md: deduplicate, add GCAWR tiers, compress hook-enforced rules

Reduced from 765 to ~520 lines by:
- Merging 3 rationalization trap tables into 1 reference file
- Consolidating ownership rules into canonical reference
- Compressing hook-enforced sections (Linear gate, polling)
- Adding explicit G/C/A/W/R priority tiers
- Removing redundant commit-gate restatements (6 -> 1)
Zero rules removed. All enforcement hooks unchanged."
```

---

## Expected Outcome

| Metric                     | Before   | After                      | Change    |
| -------------------------- | -------- | -------------------------- | --------- |
| CLAUDE.md lines            | 765      | ~520                       | -32%      |
| CLAUDE.md words            | 3,552    | ~2,400                     | -32%      |
| Rationalization tables     | 3        | 1 (reference)              | -2        |
| "Never commit" repetitions | 6        | 1 + back-refs              | -5        |
| Ownership locations        | 3        | 1 (reference)              | -2        |
| Priority hierarchy         | none     | GCAWR (5 tiers)            | new       |
| Hook enforcement           | 21 hooks | 21 hooks                   | unchanged |
| Total rules                | ~40      | ~40                        | zero loss |
| Reference files            | 4        | 5 (+rationalization-traps) | +1        |
