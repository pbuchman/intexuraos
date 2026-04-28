# INT-1580 — Simplify Code Search Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `tool-recommendations.sh` PreToolUse hook (and its tests/registration) so Bash `grep -r` and `find -name` invocations are no longer soft-blocked. This reduces friction during onboarding and routine code search.

**Architecture:** A single PreToolUse Bash hook (`.claude/hooks/tool-recommendations.sh`) currently issues a JSON `decision: block` whenever Claude runs `grep -r` or `find -name` from Bash, recommending the built-in `Grep`/`Glob` tools or `rg`/`fd`. Removing the script (a) deletes the script itself, (b) drops its registration from `.claude/settings.json`, and (c) removes the matching Vitest spec file. After removal, no documentation under `docs/` or `.claude/` references the script (verified via repo-wide sweep), so no documentation rewrites are required — only a brief verification step.

**Tech Stack:** Bash hook, Vitest (`pnpm vitest`), Claude Code settings.json hook registry, ripgrep-based verification.

**Endpoint Changes:** None — this plan modifies developer tooling only. No HTTP routes, services, or workers are touched.

---

## Scope (what changes vs. what stays)

**Removed:**
- `.claude/hooks/tool-recommendations.sh` — the soft-block hook script
- `.claude/hooks/__tests__/tool-recommendations.test.ts` — its Vitest spec (~275 lines, 27 cases)
- One entry in `.claude/settings.json` `hooks.PreToolUse[matcher=Bash]` (line 70-73 in current file) that registers the script

**Kept (intentionally unchanged):**
- All other PreToolUse hooks (`log-command-start.sh`, `validate-coverage-commands.sh`, `validate-terraform.sh`, …, `validate-no-direct-hook-exec.sh`).
- All `grep -r` / `find -name` example commands in agent prompts (`.claude/agents/llm-manager.md`, `.claude/agents/doc-validator.md`, `.claude/commands/refactoring.md`, `.claude/commands/create-service.md`, `.claude/skills/document-service/reference/*.md`, `.claude/reference/refactoring-tasks/image-service.md`). These are pre-written example commands inside agent/skill prompts, not references to the hook script. They will continue to work correctly after the hook is removed (they no longer trigger a soft-block).
- CLAUDE.md `CI Failure` line `analyze with rg "error|FAIL" -C3` — independent guidance, not related to this hook.

**Documentation references audited (zero hits):** A repo-wide sweep for the strings `tool-recommendations`, `grep-recursive`, `find-search`, `Content search: Use Grep`, and `File search: Use Glob` shows the only files referencing the script are the three files being deleted/edited. No `docs/**` or `.claude/reference/**` markdown file references the hook by name or by its log-pattern identifiers. The "documentation sweep" step in this plan is therefore a *verification* step rather than a *rewrite* step.

---

## File Structure

| Path                                                   | Action                             | Responsibility                                                           |
| ------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| `.claude/hooks/tool-recommendations.sh`                | **Delete**                         | The soft-block hook itself                                               |
| `.claude/hooks/__tests__/tool-recommendations.test.ts` | **Delete**                         | Vitest spec for the hook                                                 |
| `.claude/settings.json`                                | **Modify** (remove one hook entry) | Hook registry; drop the entry that wires the script into PreToolUse Bash |

---

## Task 1: Confirm baseline (read-only)

**Files:**
- Read: `.claude/hooks/tool-recommendations.sh`
- Read: `.claude/hooks/__tests__/tool-recommendations.test.ts`
- Read: `.claude/settings.json` (lines 18–94 — the PreToolUse Bash matcher block)

- [ ] **Step 1: Confirm the three target files exist and the registration is at the expected position**

Run:
```bash
test -f .claude/hooks/tool-recommendations.sh && \
test -f .claude/hooks/__tests__/tool-recommendations.test.ts && \
echo "files present"
```

Expected output:
```
files present
```

Then verify the registration exists exactly once:
```bash
node -e "const s=require('./.claude/settings.json'); \
const bash=s.hooks.PreToolUse.find(h=>h.matcher==='Bash'); \
const hits=bash.hooks.filter(h=>h.command.includes('tool-recommendations.sh')); \
console.log('matches=', hits.length);"
```

Expected output:
```
matches= 1
```

- [ ] **Step 2: Capture the green test count for `tool-recommendations` so we can prove its tests are gone after removal**

Run:
```bash
pnpm --filter @intexura/claude-hooks-tests vitest run tool-recommendations 2>&1 | tail -20
```
(Or if the hooks tests live at the repo root, fall back to: `pnpm vitest run .claude/hooks/__tests__/tool-recommendations.test.ts 2>&1 | tail -20`)

Expected: tests pass (e.g., `Test Files 1 passed`, `Tests 27 passed`). Record the count — Task 4 will assert this file is gone.

- [ ] **Step 3: Repo-wide sweep to re-confirm no other docs/code reference the hook**

Run:
```bash
rg -n --hidden \
  --glob '!node_modules/**' \
  --glob '!pnpm-lock.yaml' \
  --glob '!**/dist/**' \
  --glob '!**/.git/**' \
  -e 'tool-recommendations' \
  -e 'grep-recursive' \
  -e 'find-search' \
  -e "Content search: Use Grep" \
  -e "File search: Use Glob"
```

Expected: hits ONLY in the three target files
- `.claude/hooks/tool-recommendations.sh`
- `.claude/hooks/__tests__/tool-recommendations.test.ts`
- `.claude/settings.json`

If any other file matches, STOP — extend the plan with a documentation rewrite task before proceeding.

---

## Task 2: Remove the hook registration from `settings.json`

**Files:**
- Modify: `.claude/settings.json` (delete one object inside `hooks.PreToolUse[matcher='Bash'].hooks`)

- [ ] **Step 1: Delete the registration entry**

Use the `Edit` tool to remove this exact block (currently at lines 70–73, including the leading comma on line 69):

```json
,
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-recommendations.sh"
          }
```

The preceding entry (`validate-no-direct-hook-exec.sh` at lines 66–69) must end without a trailing comma after edit. Concretely, transform the tail of the Bash matcher's `hooks` array from:

```json
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/validate-no-direct-hook-exec.sh"
          },
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-recommendations.sh"
          }
        ]
```

into:

```json
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/validate-no-direct-hook-exec.sh"
          }
        ]
```

- [ ] **Step 2: Validate JSON syntax**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('valid JSON')"
```

Expected output:
```
valid JSON
```

- [ ] **Step 3: Confirm the registration is gone and no other Bash hook entry was disturbed**

Run:
```bash
node -e "const s=require('./.claude/settings.json'); \
const bash=s.hooks.PreToolUse.find(h=>h.matcher==='Bash'); \
console.log('bash hook count=', bash.hooks.length); \
console.log('tool-recommendations refs=', bash.hooks.filter(h=>h.command.includes('tool-recommendations.sh')).length);"
```

Expected output:
```
bash hook count= 12
tool-recommendations refs= 0
```

(Today there are 13 Bash hooks; after removal there must be 12 and zero `tool-recommendations` references.)

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "chore(hooks): unregister tool-recommendations soft-block (INT-1580)

Removes the PreToolUse Bash hook entry that wired
.claude/hooks/tool-recommendations.sh into the hook registry. The
script and its tests are deleted in the next commit."
```

---

## Task 3: Delete the hook script

**Files:**
- Delete: `.claude/hooks/tool-recommendations.sh`

- [ ] **Step 1: Remove the file**

Run:
```bash
git rm .claude/hooks/tool-recommendations.sh
```

Expected output:
```
rm '.claude/hooks/tool-recommendations.sh'
```

- [ ] **Step 2: Confirm no other hook (or any file) references the deleted script by path**

Run:
```bash
rg -n --hidden \
  --glob '!node_modules/**' \
  --glob '!pnpm-lock.yaml' \
  --glob '!**/dist/**' \
  --glob '!**/.git/**' \
  -e 'tool-recommendations\.sh'
```

Expected output: empty (no hits — the only remaining match would otherwise have been `.claude/settings.json`, which Task 2 already cleaned).

- [ ] **Step 3: Confirm a sample `grep -r` invocation is no longer soft-blocked**

We cannot easily simulate a PreToolUse hook from the shell, but we CAN confirm no other registered hook intercepts `grep -r`. Search the remaining hooks for any pattern that would block `grep`:

```bash
rg -n 'grep.*-r|grep.*recursive|find.*-name' .claude/hooks/*.sh
```

Expected: no hits (none of the surviving hooks match `grep -r` for blocking purposes; only the deleted file did).

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/tool-recommendations.sh
git commit -m "chore(hooks): delete tool-recommendations soft-block script (INT-1580)

The grep -r → Grep / find -name → Glob soft-block is removed in
favor of relying on Bash tool descriptions and CLAUDE.md guidance."
```

---

## Task 4: Delete the Vitest spec

**Files:**
- Delete: `.claude/hooks/__tests__/tool-recommendations.test.ts`

- [ ] **Step 1: Remove the spec file**

Run:
```bash
git rm .claude/hooks/__tests__/tool-recommendations.test.ts
```

Expected output:
```
rm '.claude/hooks/__tests__/tool-recommendations.test.ts'
```

- [ ] **Step 2: Confirm the test helpers (`fixtures.ts`, `assertions.ts`, `executeHook.ts`) are still consumed by other hook tests and stay**

Run:
```bash
rg -l "from './helpers" .claude/hooks/__tests__/*.test.ts | head -5
```

Expected: at least one OTHER test file uses the helpers (sanity check that we are not accidentally orphaning the helper directory). If zero results, STOP — the helpers were only used by the deleted spec and would need to be removed separately.

- [ ] **Step 3: Run the hook test suite**

Run:
```bash
pnpm vitest run .claude/hooks/__tests__ 2>&1 | tail -10
```

Expected: all remaining hook tests pass and `tool-recommendations` does NOT appear in the test list.

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/__tests__/tool-recommendations.test.ts
git commit -m "test(hooks): remove tool-recommendations spec (INT-1580)

Spec deleted alongside the hook script it covered."
```

---

## Task 5: Documentation sweep (verification only)

The Task 1 sweep already showed zero documentation references to the script. This task formally re-runs the sweep AFTER all deletions to leave a recorded artifact in the PR.

**Files:** none modified — verification only.

- [ ] **Step 1: Re-run the comprehensive sweep**

Run:
```bash
rg -n --hidden \
  --glob '!node_modules/**' \
  --glob '!pnpm-lock.yaml' \
  --glob '!**/dist/**' \
  --glob '!**/.git/**' \
  -e 'tool-recommendations' \
  -e 'grep-recursive' \
  -e 'find-search'
```

Expected: NO hits anywhere in the repo.

- [ ] **Step 2: Sanity-check that we have not broken any agent example that uses `grep -r`**

Run:
```bash
rg -n 'grep -r' .claude/agents/ .claude/commands/ .claude/skills/ .claude/reference/ | head -20
```

Expected: existing example commands in agent/skill/command/reference docs are untouched (these are intentional examples; their behavior is now to actually run rather than be soft-blocked). Confirm count is non-zero — they must still exist.

- [ ] **Step 3: No commit needed** — this task produces no file changes; its evidence lives in the PR description.

---

## Task 6: CI verification

**Files:** none.

- [ ] **Step 1: Run the tracked CI gate**

Run:
```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1580.txt | tail -40
```

Expected: green. If anything fails, capture and grep:
```bash
rg "error|FAIL" -C3 /tmp/ci-output-int-1580.txt
```
…and fix before proceeding to PR.

- [ ] **Step 2: No commit** — CI evidence belongs in the PR description.

---

## Task 7: Open the PR

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin plan/int-1580-simplify-code-search-hook
```

- [ ] **Step 2: Create the PR against `development`**

```bash
gh pr create --base development --title "[INT-1580] Simplify code search hook" --body "$(cat <<'EOF'
## Summary
- Removes `.claude/hooks/tool-recommendations.sh` (the soft-block recommending `Grep`/`rg` over `grep -r`, and `Glob`/`fd` over `find -name`) along with its Vitest spec and registry entry.
- No documentation rewrites required — repo-wide sweep confirmed zero references to the script outside the three files modified/deleted.

## Test plan
- [ ] `pnpm run ci:tracked` passes
- [ ] `rg 'tool-recommendations'` returns zero hits across the repo
- [ ] `node -e "..."` shows the Bash PreToolUse hook count dropped by exactly one
- [ ] No surviving hook intercepts `grep -r` or `find -name`

Fixes INT-1580

- Linear: [INT-1580](https://linear.app/pbuchman/issue/INT-1580)
- IntexuraOS Code Task: [View task](https://intexuraos.cloud/#/code-tasks/task_a0a87fd5-774b-4639-8c18-c520b5f080e8)
- Worker Type: `auto`
- Model: `default`
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

1. **Spec coverage:**
   - Spec bullet 1 ("Get rid of this requirement in hooks") → Tasks 2–4 (registration, script, spec).
   - Spec bullet 2 ("documentation sweep so we don't have a reference to the script") → Task 1 Step 3 (pre-sweep) + Task 5 (post-sweep verification).
   - Spec bullet 3 ("Create a plan for implementation") → this document.

2. **Placeholder scan:** No "TBD", no "implement later", no vague "handle edge cases". All commands and JSON edits are exact.

3. **Type / signature consistency:** N/A — no new code; all changes are deletions and one JSON edit.

4. **Risks considered:**
   - JSON syntax breakage in `settings.json` → guarded by `JSON.parse` validation step.
   - Helpers becoming orphaned → guarded by Task 4 Step 2 sanity check.
   - Other hooks accidentally still blocking `grep -r` → guarded by Task 3 Step 3 sweep.
   - Stray doc reference → guarded by both pre-sweep (Task 1 Step 3) and post-sweep (Task 5 Step 1).
