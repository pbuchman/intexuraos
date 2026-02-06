# Plan Splitting Workflow (Auto-Splitting)

**Trigger:** Detected automatically when working with complex multi-step tasks, or user explicitly says "split this into subtasks".

---

## Verbose Transition Logging (MANDATORY)

```
📋 SPLIT: Analyzing issue for splitting...
📋 SPLIT: Detected 4 phases, creating tiered children
🔗 PARENT: Using INT-456 as ledger (existing issue)
👶 CHILD: Created INT-457 "[tier-0] Setup infrastructure"
🏷️ LABEL: Added 'code-task' to INT-457
👶 CHILD: Created INT-458 "[tier-1] Implement core logic"
🏷️ LABEL: Added 'code-task' to INT-458
👶 CHILD: Created INT-459 "[tier-2] Integration tests"
🏷️ LABEL: Added 'code-task' to INT-459
🏷️ LABEL: Added 'code-task' to parent INT-456
✅ SPLIT COMPLETE: 3 children created under INT-456
⏹️ STOPPING: User must re-invoke `/linear INT-456` to start execution
```

---

## 🚨 CRITICAL: Mandatory Rules for ALL Created Subtasks

When creating multiple subtasks in a row, **EACH subtask MUST contain**:

1. **Mandatory branch creation instruction** — Task fails if work starts on `development`/`main`
2. **Full CI verification requirement** — `pnpm run ci:tracked` must pass, non-negotiable
3. **Continuation instruction** — Agent MUST proceed to next task after completion
4. **95% coverage is MINIMUM** — Do NOT simplify work to save tokens/time
5. **All tests required** — Every test scenario in the issue MUST be implemented

**These rules are embedded in the subtask-description.md template. NEVER remove them.**

---

## Detection Heuristics

Auto-splitting is triggered when ANY of:

1. Issue description has numbered phases (Phase 1, Phase 2...)
2. Issue description has >5 checkbox items
3. Issue description >2000 characters with clear sections
4. User explicitly says "split this into subtasks"
5. Issue title contains "multi-step", "comprehensive", "end-to-end"

## Tier Classification

Tasks are classified into tiers based on dependency and execution order:

| Tier | Name         | Keywords & Patterns                                    |
| ---- | ------------ | ------------------------------------------------------ |
| 0    | Setup        | setup, scaffold, terraform, config, prerequisite, init |
| 1    | Independent  | domain, model, adapter, implement, create, add         |
| 2    | Integration  | integrate, webhook, route, wire, connect, link         |
| 3    | Verification | test, coverage, verify, UI, e2e                        |
| 4+   | Finalization | documentation, deploy, cleanup, polish                 |

### Tier Rules

- **Tier 0**: No dependencies, can run first. Setup/foundation work.
- **Tier 1**: Depends on Tier 0. Independent deliverables that can run in parallel.
- **Tier 2**: Depends on Tier 1. Integration work connecting components.
- **Tier 3+**: Sequential, depends on all prior tiers. Verification and finalization.

## Creation Algorithm

```
1. PARSE plan → extract phases, tasks, dependencies
2. CLASSIFY tasks into tiers (0/1/2/3+)
3. REUSE existing issue as parent (ledger) OR create new if none exists
4. CREATE child issues with parentId parameter
5. SET dependencies via blockedBy arrays
6. VERIFY parent-child links in Linear UI
```

### Step-by-Step

#### Step 1: Parse Plan

Extract from plan/description:

- Numbered sections (Phase 1, Phase 2...)
- Checkbox items (- [ ] ...)
- Headings (## ..., ### ...)
- Dependencies mentioned ("after", "once", "requires")

#### Step 2: Classify Tasks

For each extracted task:

1. Scan for tier keywords (see table above)
2. Check explicit dependencies mentioned
3. Assign tier number (0 = setup, 1 = independent, 2+ = dependent)
4. Group tasks by tier

#### Step 3: Use Existing Issue as Parent (Ledger)

**IMPORTANT:** This workflow is ONLY invoked from `create-issue.md` Step 6, so an issue ALWAYS exists.
REUSE the existing issue as the parent — do NOT create a new one.

```
- Use the issue from create-issue.md Step 4 as the parent
- UPDATE its description to ledger format
- State remains unchanged (Phase 2 sets "In Progress" when execution begins)
```

Use [ledger-template.md](../templates/ledger-template.md) format for the description:

```
Title: [feature] <original plan title>  (update if needed)
Team: IntexuraOS
Description: Full ledger format (see template)
```

#### Step 4: Create Child Issues

For each task, use [subtask-description.md](../templates/subtask-description.md):

```
Title: [tier-X] <task title>
State: Backlog
Team: IntexuraOS
parentId: <parent issue ID>
Labels: ["code-task"]  ← MANDATORY: Children are execution-ready
Description: Subtask template format
```

**CRITICAL: All children MUST have `code-task` label.**

The splitting process IS the Phase 1 design work. Children are created ready for Phase 2 execution.

**⚠️ CRITICAL: Every child issue description MUST include:**

1. The `🚨 MANDATORY EXECUTION RULES` section at the TOP
2. Branch creation instruction with the specific issue ID
3. Full CI verification requirement (`pnpm run ci:tracked`)
4. 95% coverage as MINIMUM (not target)
5. Continuation instruction pointing to the NEXT issue ID
6. All test scenarios listed — agents MUST implement them ALL

**DO NOT create "simplified" issues.** The template exists for a reason. Use it fully.

#### Step 5: Set Dependencies

After all issues created:

```javascript
// Tier 1 blocked by ALL Tier 0
for each tier1Issue:
  update_issue(tier1Issue, { blockedBy: allTier0IssueIds })

// Tier 2 blocked by ALL Tier 1
for each tier2Issue:
  update_issue(tier2Issue, { blockedBy: allTier1IssueIds })

// And so on...
```

#### Step 6: Verify Parent-Child Links

After creating child issues with `parentId`:

1. **Verify in Linear UI** that children appear under parent's "Sub-issues" section
2. **Parent's "Scope" section** describes what's covered (no IDs needed)
3. **Linear handles linking automatically** via `parentId` — no manual ID maintenance

**Why no Child Issues table?**

- Sequential ID assignment makes pre-listing impossible
- When parent is created before children, placeholder IDs like `INT-XXX-1` never match real IDs
- Linear's parent-child hierarchy is the source of truth
- Scope section describes WHAT, Linear tracks WHO

#### Step 7: Add `code-task` Label to Parent (MANDATORY)

**After all children are created, add `code-task` label to the PARENT issue:**

```
Call mcp__linear__update_issue:
  - Issue: Parent issue
  - Labels: Add 'code-task' to existing labels
```

**Why this matters:**

- Parent needs `code-task` so next invocation routes to `parent-execution.md`
- Without this label, `/linear INT-parent` would route to Phase 1 (wrong!)
- Splitting IS the Phase 1 design work — parent is now ready for execution

## Naming Convention for Child Issues

Format: `[tier-X] <action> <subject>`

| Tier | Example Title                                 |
| ---- | --------------------------------------------- |
| 0    | `[tier-0] Setup skill directory structure`    |
| 1    | `[tier-1] Implement auto-splitting detection` |
| 1    | `[tier-1] Create ledger template`             |
| 2    | `[tier-2] Wire up skill to command system`    |
| 3    | `[tier-3] Add tests for plan parsing`         |
| 4    | `[tier-4] Update documentation`               |

## Implementation Detail Level

When creating subtasks, the level of detail determines LLM agent success rate.

### Required Detail by Task Type

| Task Type          | Code Snippets | Line Numbers | Edge Cases | Staleness Warning |
| ------------------ | ------------- | ------------ | ---------- | ----------------- |
| Migration/Refactor | ✓ Required    | ✓ Required   | ✓ Required | ✓ Required        |
| Bug Fix            | ✓ Required    | ✓ Required   | Optional   | ✓ Required        |
| New Feature        | Recommended   | Recommended  | ✓ Required | If provided       |
| Documentation      | Optional      | N/A          | N/A        | N/A               |
| Configuration      | Optional      | Optional     | Optional   | If provided       |

### Code Snippet Freshness Warning

**ALWAYS** include this warning when providing implementation code:

```markdown
> ⚠️ **Point-in-Time Accuracy:** Code snippets below reflect codebase state at issue creation (YYYY-MM-DD).
> Before implementing, verify file contents match these assumptions.
```

### Pre-Flight Verification Checklist

For tasks with code snippets, include verification steps:

```markdown
### Pre-Flight Verification

Before implementing, confirm:

- [ ] File exists at specified path
- [ ] Line numbers roughly match (±10 lines acceptable)
- [ ] Dependencies/imports are available
- [ ] Type signatures haven't changed
```

### Edge Case Enumeration

For validation/parsing tasks, enumerate 8-10 edge cases:

```markdown
### Edge Cases to Cover

1. Valid input (happy path)
2. Empty/null input
3. Boundary values (min, max)
4. Invalid types (string vs number)
5. Missing required fields
6. Extra unknown fields
7. Malformed structure
8. Concurrent operations (if applicable)
```

This detail level enables less specialized LLM agents to execute tasks reliably.

## Continuation Directive

Each child issue (except the final one) includes:

```markdown
---

## 🚨 AFTER COMPLETION — MANDATORY NEXT STEPS

1. ✅ Verify `pnpm run ci:tracked` passes (NON-NEGOTIABLE)
2. ✅ Commit all changes with message: `INT-XXX <task description>`
3. ✅ **IMMEDIATELY proceed to INT-YYY** — DO NOT STOP

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next unblocked task without waiting for user input.
```

### Why This Matters

LLM agents tend to:

- Stop after each task waiting for user input
- Simplify work to save tokens/time
- Skip "optional" tests or edge cases
- Run partial CI checks instead of full `pnpm run ci:tracked`

**These tendencies are UNACCEPTABLE.** The continuation directive and mandatory rules counteract them.

The final task does NOT include the continuation directive, allowing natural completion.

### Continuation Directive Scope

The "DO NOT STOP" continuation directive ONLY applies to:

- ✅ Child issues created by auto-splitting in the SAME session
- ✅ Tiered execution of a planned multi-step task

It does NOT apply to:

- ❌ Independent Todo issues (each is a separate task)
- ❌ Epic child issues created in Linear UI (not auto-split)
- ❌ Issues that require separate PRs
- ❌ Any issue where the user didn't explicitly request batch execution

**When in doubt:** STOP and checkpoint. User can always say "continue".

### Distinguishing Auto-Split vs Independent Issues

| Scenario                          | Continuation Applies? | Reason                                   |
| --------------------------------- | --------------------- | ---------------------------------------- |
| `/linear` creates parent + 5 kids | ✅ Yes                | Same session, auto-split, shared context |
| User manually creates epic + kids | ❌ No                 | Each is independent work unit            |
| `/linear INT-XXX` on random issue | ❌ No                 | Standalone issue, not part of split      |
| Working through Todo queue        | ❌ No                 | Each issue is separate task              |

## Example: INT-156 Style Plan

Given a plan like:

```markdown
# Phase 1: Create Skill Directory Structure

- Create .claude/skills/linear/
- Create SKILL.md

# Phase 2: Migrate Existing Content

- Move workflows from commands/
- Create templates/

# Phase 3: Implement Auto-Splitting

- Add detection heuristics
- Create tier classification

# Phase 4: Update Documentation

- Add deprecation notices
- Create pattern docs
```

Results in:

| Tier | Issue   | Title                                     |
| ---- | ------- | ----------------------------------------- |
| 0    | INT-157 | [tier-0] Create skill directory structure |
| 1    | INT-158 | [tier-1] Migrate workflow content         |
| 1    | INT-159 | [tier-1] Create templates                 |
| 2    | INT-160 | [tier-2] Implement auto-splitting         |
| 3    | INT-161 | [tier-3] Update documentation             |

Parent INT-156 serves as the ledger tracking overall progress.

---

## Completion (MANDATORY)

**After all steps complete, output verbose completion message and STOP:**

```
✅ SPLIT COMPLETE: INT-XXX split into N children
   👶 Children: INT-YYY, INT-ZZZ, ...
   🏷️ All children have 'code-task' label
   🏷️ Parent INT-XXX has 'code-task' label

⏹️ STOPPING: Splitting complete. This is Phase 1 design work.
   To start execution: re-invoke `/linear INT-XXX`
   → Routes to parent-execution.md (sets 'In Progress' and begins work)
```

**DO NOT automatically continue to execution.** Splitting is a full handoff from `create-issue.md`. User must explicitly re-invoke to start Phase 2.

---

## Workflow Transition

This workflow is invoked from:

- `create-issue.md` Step 6 (when complex task detected)

After completion:

- **STOP** — do not continue to execution
- User re-invokes `/linear INT-parent`
- `work-existing.md` sees `code-task` label + children
- Routes to `parent-execution.md`
