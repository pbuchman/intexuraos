# INT-1237: Delete v8-ignore-overrides.json and Remove Override Mechanism

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the entire `v8-ignore-overrides.json` override mechanism from the codebase — the file, the script logic that reads it, and all documentation references to it.

**Architecture:** Sequential cleanup: first verify all overridden files now pass strict validation, then fix any that don't, then delete the override file and strip the dead code from `scripts/verify-v8-ignore.mjs`, then remove all doc references.

**Tech Stack:** Node.js ESM script (scripts/verify-v8-ignore.mjs), TypeScript (apps, workers, packages), Markdown docs.

---

## Pre-read: What You're Cleaning Up

`v8-ignore-overrides.json` (repo root) lists files that were granted exceptions from strict v8 ignore validation. The mechanism works in `scripts/verify-v8-ignore.mjs`:

- `loadOverrides()` reads the JSON and builds two `Set`/`Map` structures: `overriddenFiles` and `taskMap`.
- `checkOverride()` is called in Phase C (`validatePatterns`) and Phase C-1 (`validateNeverValidPatterns`): if a comment's file appears in `overriddenFiles`, the validation error is suppressed (the block is "skipped").
- `--no-overrides` flag bypasses the override file (returns empty sets from `loadOverrides()`), giving strict validation.

After this task, `--no-overrides` no longer exists (it becomes the only mode). ALL v8 ignore blocks must pass Phase C and C-1 without any skip logic.

**Current override entries (in v8-ignore-overrides.json):**

| Task ID   | Files                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INT-1294  | `apps/code-agent/src/domain/usecases/startAskAgent.ts`                                                                                                                                                                                                                                                                                                                       |
| INT-1071  | `workers/orchestrator/src/services/isolation/docker-provider.ts`, `workers/orchestrator/src/services/task-dispatcher.ts`, `workers/orchestrator/src/services/worktree-manager.ts`, `workers/orchestrator/src/start.ts`                                                                                                                                                       |
| INT-1011  | `apps/research-agent/src/routes/internalRoutes.ts`, `packages/infra-openrouter/src/client.ts`                                                                                                                                                                                                                                                                                |
| INT-1085  | `apps/code-agent/src/domain/services/automationCommentRenderer.ts`, `apps/code-agent/src/domain/services/gitHubDispatchService.ts`, `apps/code-agent/src/domain/services/gitHubWebhookRules.ts`, `apps/code-agent/src/domain/services/unifiedEvaluator.ts`, `apps/code-agent/src/infra/github-event-parser.ts`, `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` |

---

## File Map

| File                                                                    | Change                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v8-ignore-overrides.json`                                              | Delete                                                                                                                                                                                                         |
| `scripts/verify-v8-ignore.mjs`                                          | Remove `NO_OVERRIDES` const, `loadOverrides()` fn, `checkOverride()` fn, override params from `validatePatterns()` + `validateNeverValidPatterns()`, override skip reporting block, `--no-overrides` help text |
| `.claude/reference/coverage-exemptions.md`                              | Remove "Override Mechanism" section (lines 65–67)                                                                                                                                                              |
| `.claude/CLAUDE.md`                                                     | Remove line: `Override: blocks with planned fixes tracked in \`v8-ignore-overrides.json\` with Linear task ID.`                                                                                                |
| `docs/services/whatsapp-service/technical.md`                           | Update historical sentence to past tense / remove stale reference                                                                                                                                              |
| `docs/services/commands-agent/technical-debt.md`                        | Update historical sentence to past tense / remove stale reference                                                                                                                                              |
| Possibly: `apps/code-agent/src/domain/usecases/startAskAgent.ts` et al. | Fix any v8 ignore blocks that fail strict validation                                                                                                                                                           |

---

## Task 1: Run Pre-flight — Verify All Overridden Files Pass Strict Validation

**Files:** None modified — diagnostic only.

- [ ] **Step 1: Run strict validation**

  ```bash
  cd /repo && pnpm run verify:v8-ignore -- --no-overrides 2>&1 | tee /tmp/v8-preflight.txt
  ```

  Expected: Exit 0, no errors. If exit 0 → skip Task 2 and proceed to Task 3.
  If exit non-zero → examine `/tmp/v8-preflight.txt` and proceed to Task 2 for each failing block.

---

## Task 2: Fix Any v8 Ignore Blocks That Fail Strict Validation (conditional)

**Only execute this task if Task 1 reported errors.**

For each error reported by `--no-overrides`, the fix depends on the failure type:

### Phase C failure (pattern validation) — `ts-type` most common

The `ts-type` detector checks for these patterns within a 20-line window around the comment:
```
/\.length\s*[><=!]+/
/\.filter\s*\(/
/typeof\s+\w+/
/instanceof\s+\w+/
/\?\?/
/\?\./
/!==?\s*null/
/===?\s*null/
/!==?\s*undefined/
```

If the block is at e.g. `apps/code-agent/src/domain/usecases/startAskAgent.ts:94`:

**Files:**
- Modify: the file that failed (shown in error output)

- [ ] **Step 1: Read the failing file around the reported line number**

  ```bash
  sed -n '$((LINE-5)),$((LINE+15))p' <failing-file>
  ```

- [ ] **Step 2: Change category if necessary**

  If the block doesn't actually have a type-narrowing pattern visible to the detector, change the category to one that matches. For example:
  - If it's a fake/testing limitation → `test-infra`
  - If upstream code guarantees the branch is unreachable → `upstream`
  - If the v8 source map misattributes the hit → `source-map`

  Format: `/* v8 ignore start -- <NEW_CATEGORY>: <blocker reason> @preserve */`

  The blocker reason MUST contain at least one keyword from `.claude/reference/coverage-exemptions.md` (e.g. `cannot`, `always returns`, `unreachable`, `defensive`, etc.).

- [ ] **Step 3: Run strict validation again to confirm the fix**

  ```bash
  cd /repo && pnpm run verify:v8-ignore -- --no-overrides 2>&1
  ```

  Expected: The previously failing file no longer appears in errors.

- [ ] **Step 4: Repeat for every remaining error**

- [ ] **Step 5: Commit interim fixes**

  ```bash
  git add <changed-files>
  git commit -m "fix(v8): fix v8 ignore categories to pass strict validation without overrides"
  ```

---

## Task 3: Delete `v8-ignore-overrides.json`

**Files:**
- Delete: `v8-ignore-overrides.json`

- [ ] **Step 1: Delete the file**

  ```bash
  rm /repo/v8-ignore-overrides.json
  ```

- [ ] **Step 2: Confirm deletion**

  ```bash
  ls /repo/v8-ignore-overrides.json 2>&1
  ```

  Expected: `ls: cannot access '/repo/v8-ignore-overrides.json': No such file or directory`

---

## Task 4: Simplify `scripts/verify-v8-ignore.mjs` — Remove All Override Logic

**Files:**
- Modify: `scripts/verify-v8-ignore.mjs`

The goal is to make the script always run in what was previously the `--no-overrides` mode. Remove all dead code.

- [ ] **Step 1: Read the current file**

  Read `/repo/scripts/verify-v8-ignore.mjs` lines 1–50 and lines 660–720 and lines 1080–1210 to confirm current state before editing.

- [ ] **Step 2: Remove `NO_OVERRIDES` constant (line 11)**

  Delete this line:
  ```js
  const NO_OVERRIDES = process.argv.includes('--no-overrides');
  ```

- [ ] **Step 3: Remove the entire `OVERRIDE MECHANISM` block (lines 14–41)**

  Delete everything between (and including) these markers:
  ```js
  // ============================================================================
  // OVERRIDE MECHANISM
  // ============================================================================
  
  function loadOverrides() {
    ...
  }
  ```

  The section ends after the closing `}` of `loadOverrides()`.

- [ ] **Step 4: Remove the `checkOverride()` helper function (lines 699–710)**

  Delete:
  ```js
  // ============================================================================
  // Override helper (shared by Phase C and C-1)
  // ============================================================================
  
  function checkOverride(comment, overriddenFiles, taskMap, overrideSkips) {
    if (overriddenFiles.has(comment.file)) {
      const taskId = taskMap.get(comment.file) ?? 'UNKNOWN';
      overrideSkips.push({ file: comment.file, line: comment.line, taskId });
      return true;
    }
    return false;
  }
  ```

- [ ] **Step 5: Simplify `validatePatterns()` — remove override params and call**

  Change the function signature and body. Remove `overriddenFiles`, `taskMap`, and `overrideSkips` from the function entirely.

  Before:
  ```js
  function validatePatterns(comments, overriddenFiles, taskMap) {
    const errors = [];
    const overrideSkips = [];
    
    for (const comment of comments) {
      const detector = CATEGORY_DETECTORS[comment.category];
  
      // source-map has no static detection
      if (!detector || detector.detect === null) {
        continue;
      }
  
      const filePath = resolve(ROOT_DIR, comment.file);
      const sourceCode = readFileSync(filePath, 'utf8');
  
      const result = detector.detect(sourceCode, comment.line, comment.file);
  
      if (!result.valid) {
        if (checkOverride(comment, overriddenFiles, taskMap, overrideSkips)) continue;
  
        errors.push({
          file: comment.file,
          line: comment.line,
          message: `Pattern validation failed for category "${comment.category}": ${result.suggestion}`,
        });
      }
    }
  
    return { errors, overrideSkips };
  }
  ```

  After:
  ```js
  function validatePatterns(comments) {
    const errors = [];
  
    for (const comment of comments) {
      const detector = CATEGORY_DETECTORS[comment.category];
  
      // source-map has no static detection
      if (!detector || detector.detect === null) {
        continue;
      }
  
      const filePath = resolve(ROOT_DIR, comment.file);
      const sourceCode = readFileSync(filePath, 'utf8');
  
      const result = detector.detect(sourceCode, comment.line, comment.file);
  
      if (!result.valid) {
        errors.push({
          file: comment.file,
          line: comment.line,
          message: `Pattern validation failed for category "${comment.category}": ${result.suggestion}`,
        });
      }
    }
  
    return { errors };
  }
  ```

- [ ] **Step 6: Simplify `validateNeverValidPatterns()` — remove override params and call**

  Before:
  ```js
  function validateNeverValidPatterns(comments, overriddenFiles, taskMap) {
    const errors = [];
    const overrideSkips = [];
    ...
        if (checkOverride(comment, overriddenFiles, taskMap, overrideSkips)) break;
    ...
    return { errors, overrideSkips };
  }
  ```

  After:
  ```js
  function validateNeverValidPatterns(comments) {
    const errors = [];
    ...
        // (remove the checkOverride call and break — just push the error directly)
    ...
    return { errors };
  }
  ```

  Full after version of the inner loop body (replace the `for` loop's `if (pattern.test(ignoredBlock))` block):
  ```js
      for (const { pattern, message } of NEVER_VALID_PATTERNS) {
        if (pattern.test(ignoredBlock)) {
          errors.push({
            file: comment.file,
            line: comment.line,
            message: `NEVER-valid pattern in ignored code: ${message}`,
          });
          break; // One NEVER-valid match is enough to fail
        }
      }
  ```

- [ ] **Step 7: Update the main execution section — remove loadOverrides call and override skip reporting**

  In the main script body (around lines 1132–1203), replace:
  ```js
  // Load overrides
  const { overriddenFiles, taskMap } = loadOverrides();

  // Phase C: Pattern validation
  const { errors: patternErrors, overrideSkips: patternOverrideSkips } = validatePatterns(
    Array.from(validComments),
    overriddenFiles,
    taskMap
  );

  // Phase C-1: NEVER-valid pattern blocklist
  const { errors: neverValidErrors, overrideSkips: neverValidOverrideSkips } =
    validateNeverValidPatterns(Array.from(validComments), overriddenFiles, taskMap);
  ```

  With:
  ```js
  // Phase C: Pattern validation
  const { errors: patternErrors } = validatePatterns(Array.from(validComments));

  // Phase C-1: NEVER-valid pattern blocklist
  const { errors: neverValidErrors } = validateNeverValidPatterns(Array.from(validComments));
  ```

  Also remove the override skip reporting block:
  ```js
  // Report override skips
  const allOverrideSkips = [...patternOverrideSkips, ...neverValidOverrideSkips];
  if (allOverrideSkips.length > 0) {
    console.log(`\n⏭ ${allOverrideSkips.length} block(s) skipped via overrides:`);
    for (const skip of allOverrideSkips) {
      console.log(`  ⏭ OVERRIDE: ${skip.file}:${skip.line} (${skip.taskId})`);
    }
  }
  ```

- [ ] **Step 8: Remove `--no-overrides` from the help text**

  Find and delete this line from the `--help` section:
  ```js
  console.log('  --no-overrides  Ignore v8-ignore-overrides.json (strict auditing)');
  ```

- [ ] **Step 9: Also remove the `existsSync` import if it's now unused**

  Check: `existsSync` is still used for `overridesPath` check... but after removing `loadOverrides()`, confirm whether `existsSync` is still used elsewhere in the file (it is used for `coveragePath` checks). Keep it.

- [ ] **Step 10: Run the script to verify it still works**

  ```bash
  cd /repo && pnpm run verify:v8-ignore 2>&1 | head -20
  ```

  Expected: Exits 0, shows `✓ N v8 ignore comments validated` with no override mentions.

- [ ] **Step 11: Commit**

  ```bash
  git add scripts/verify-v8-ignore.mjs
  git commit -m "refactor(scripts): remove v8-ignore-overrides.json override mechanism from verify script"
  ```

---

## Task 5: Update `.claude/reference/coverage-exemptions.md` — Remove Override Mechanism Section

**Files:**
- Modify: `.claude/reference/coverage-exemptions.md`

- [ ] **Step 1: Read the file to confirm current state**

  Read `/repo/.claude/reference/coverage-exemptions.md`.

- [ ] **Step 2: Remove the "Override Mechanism" section**

  Delete lines 65–67 (the entire section):
  ```markdown
  ## Override Mechanism
  
  Blocks that fail tightened validation but have planned fixes are tracked in `v8-ignore-overrides.json` at repo root, keyed by Linear task ID. The CI script skips validation for files listed under an override entry. Run `pnpm run verify:v8-ignore -- --no-overrides` for strict auditing.
  ```

  Also update the `**Validation:**` line (currently line 27) to remove the `--no-overrides` mention if it's there. Currently reads:
  ```markdown
  **Validation:** `pnpm run verify:v8-ignore` (runs in CI Static Validation phase)
  ```
  This is already correct — no change needed there.

- [ ] **Step 3: Commit**

  ```bash
  git add .claude/reference/coverage-exemptions.md
  git commit -m "docs: remove Override Mechanism section from coverage-exemptions.md"
  ```

---

## Task 6: Update `CLAUDE.md` — Remove Override Reference

**Files:**
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Read the relevant section**

  Search for the override line:
  ```bash
  grep -n "v8-ignore-overrides" /repo/.claude/CLAUDE.md
  ```

- [ ] **Step 2: Remove the override sentence**

  The line to remove is:
  ```
  Override: blocks with planned fixes tracked in `v8-ignore-overrides.json` with Linear task ID.
  ```

  It appears in the `**v8 Ignore Proof:**` entry under the Coding section. After removal, the entry should read:
  ```markdown
  **v8 Ignore Proof:** explanation MUST name the testing BLOCKER, not describe the code. BAD: `-- error handling for failed request`. GOOD: `-- FakeHttpClient cannot simulate AbortError`.
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add .claude/CLAUDE.md
  git commit -m "docs(claude): remove v8-ignore-overrides.json reference from CLAUDE.md"
  ```

---

## Task 7: Remove Stale References From Service Docs

**Files:**
- Modify: `docs/services/whatsapp-service/technical.md`
- Modify: `docs/services/commands-agent/technical-debt.md`

These files reference `v8-ignore-overrides.json` as historical context. Since plans/docs are historical records, the approach is to update sentences to reflect the past tense rather than delete them.

- [ ] **Step 1: Read the whatsapp-service technical doc around the reference**

  ```bash
  grep -n -B2 -A2 "v8-ignore-overrides" /repo/docs/services/whatsapp-service/technical.md
  ```

  Current text (line ~137):
  > Standardized the v8-ignore format across the service to use the canonical category-based format. Removed the whatsapp-service entry from `v8-ignore-overrides.json`. Added a missing persistence error test case.

  Change: The file has already been cleaned up — this is historical documentation of that cleanup. No change needed (it correctly describes a past action). **Skip if already past-tense.**

- [ ] **Step 2: Read the commands-agent technical-debt doc around the reference**

  ```bash
  grep -n -B2 -A2 "v8-ignore-overrides" /repo/docs/services/commands-agent/technical-debt.md
  ```

  Current text (line ~176):
  > Replaced all v8 ignore blocks with actual test cases covering those branches. The override entry was also removed from `v8-ignore-overrides.json`.

  This is also historical past-tense documentation. **Skip if already past-tense.**

- [ ] **Step 3: Only commit if changes were needed**

  If no changes were needed (both docs are already past-tense historical records), skip this commit.

---

## Task 8: Final Verification

- [ ] **Step 1: Run verify:v8-ignore to confirm it passes**

  ```bash
  cd /repo && pnpm run verify:v8-ignore 2>&1
  ```

  Expected: Exit 0, no errors, no override skip messages.

- [ ] **Step 2: Run full CI**

  ```bash
  cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-int-1237.txt
  ```

  Expected: All checks pass, zero failures.

- [ ] **Step 3: If CI fails, fix the issue**

  Read `/tmp/ci-int-1237.txt`, locate the failure. Most likely causes:
  - TypeScript type error: check imports, function signatures
  - Lingering reference to removed function: search for `loadOverrides`, `checkOverride`, `NO_OVERRIDES`, `overriddenFiles`, `taskMap` in the script
  - v8 ignore validation failure: check which file/line failed and fix the block category

---

## Key Decisions

1. **Piotr comment (2026-04-05):** "If there are any more v8 ignore overrides, then take care of getting rid of them as a part of this task." → Task 2 covers fixing any remaining invalid v8 ignore blocks before deleting the override file.

2. **Service docs** (`whatsapp-service/technical.md`, `commands-agent/technical-debt.md`) reference the file as historical past-tense records, so no substantive changes are expected.

3. **Plan docs** (`docs/plans/2026-03-19-evaluate-pending-v8-ignores.md`, `docs/plans/2026-03-23-v8-ignore-triage.md`) are immutable historical artifacts and should NOT be modified.

## Acceptance Criteria (from issue)

1. `v8-ignore-overrides.json` deleted from repo root.
2. `scripts/verify-v8-ignore.mjs` simplified — no `loadOverrides`, `checkOverride`, `NO_OVERRIDES`, or `overriddenFiles`/`taskMap` variables remain.
3. Documentation references to override mechanism removed from `coverage-exemptions.md` and `CLAUDE.md`.
4. `pnpm run verify:v8-ignore` passes (now the only mode, equivalent to old `--no-overrides`).
5. `pnpm run ci:tracked` passes.
