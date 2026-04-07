# Parent Issue Execution Workflow

**Trigger:** Issue has `code-task` label AND has child subissues

---

## Verbose Transition Logging (MANDATORY)

```
🚀 PARENT EXEC: Starting execution for INT-301 (3 children)
🌿 BRANCH: Creating refactor/INT-301 from origin/development
📍 STATE: INT-301 → In Progress
🔗 PR: Created draft PR #123
👶 CHILD: Starting INT-302 "[tier-0] Setup infrastructure"
📍 STATE: INT-302 → In Progress
💻 IMPLEMENT: Working on INT-302...
✅ CI: pnpm run ci:tracked passed
📦 COMMIT: INT-302 Setup infrastructure
📤 PUSH: Pushed to origin/refactor/INT-301
📝 PR: Updated PR #123 description (INT-302 ✅)
📍 STATE: INT-302 → In Review
👶 CHILD: Starting INT-303 "[tier-1] Implement core logic"
...
✅ PARENT EXEC COMPLETE: All 3 children done
🔗 PR: #123 ready for review
📍 STATE: INT-301 → In Review
```

---

## Overview

When `/linear INT-XXX` is called with a parent issue that has child subissues, this workflow executes **ALL children continuously** without stopping between them. This enables completing multi-step features in a single session.

**Key Differences from Single-Issue Workflow:**

| Aspect    | Single Issue (`work-existing.md`) | Parent Execution (this workflow) |
| --------- | --------------------------------- | -------------------------------- |
| Branch    | Per-issue (`fix/INT-302`)         | Parent only (`refactor/INT-301`) |
| Execution | One issue → STOP → wait           | All children continuously        |
| PR        | One per issue                     | Single PR for parent             |
| Resume    | N/A                               | Detect interruption, continue    |

---

## 🚨 CRITICAL: Branch Creation

**A task FAILS if you start working on `development` or `main`.**

Before ANY work:

1. Check current branch: `git branch --show-current`
2. If on `development` or `main` → CREATE BRANCH FIRST (see Step 3)
3. Only then proceed with execution loop

---

## 🚨 CRITICAL: Automatic Completion (NO ASKING)

**The entire parent execution flow is AUTOMATIC. Never ask for permission.**

⛔ **FORBIDDEN PATTERNS:**

```
❌ "Would you like me to commit these changes?"
❌ "Should I continue with the next child?"
❌ "Ready to create the PR?"
```

**CORRECT BEHAVIOR:**
Execute the entire workflow automatically:

1. Create branch → Create PR (draft) → Execute all children → Finalize PR → Update Linear to "In Review"
2. Only pause on CI failure (fix and continue)
3. Report completion AFTER everything is done

---

## Steps

### 1. Validate Entry Conditions

**This workflow executes when issue has BOTH:**

- `code-task` label (ready for execution)
- Child subissues (non-empty children array)

**Validation steps:**

1. Issue was fetched with `mcp__linear__get_issue`
2. Labels include `code-task`
3. Subissues were detected with `mcp__linear__list_issues(parentId: "<issue-uuid>")`
4. Children array is non-empty

**How we arrive here:**

- Via `work-existing.md` router (most common)
- User re-invokes `/linear INT-parent` after plan-splitting completed

> ⚠️ **This is NOT automatic.** After plan-splitting completes, execution STOPS. User must explicitly re-invoke `/linear INT-parent` to start this workflow.

### 2. Analyze Children Structure

```
1. Call mcp__linear__list_issues(parentId: "<parent-uuid>", team: "IntexuraOS")
   Note: Use the full UUID from get_issue response, not the identifier (INT-XXX)
2. For each child, extract:
   - Issue ID
   - Title (contains [tier-X] prefix)
   - Current state
   - Blockers (if any)
3. Sort children by tier number (ascending)
```

**Tier Extraction:**

- Parse `[tier-X]` from title prefix
- `[tier-0]` = Setup/prerequisites (execute first)
- `[tier-1]` = Independent deliverables
- `[tier-2]` = Integration work
- `[tier-3+]` = Verification/finalization

### 3. Create Branch (MANDATORY)

**Single branch for ALL children, named after parent:**

```bash
git fetch origin
git checkout -b <type>/INT-<parent-id> origin/development
```

**Branch Type Extraction:**
Extract type from parent title prefix:

| Parent Title Prefix | Branch Type | Example            |
| ------------------- | ----------- | ------------------ |
| `[feature]`         | `feature/`  | `feature/INT-301`  |
| `[bug]`             | `fix/`      | `fix/INT-301`      |
| `[refactor]`        | `refactor/` | `refactor/INT-301` |
| `[docs]`            | `docs/`     | `docs/INT-301`     |
| Other/None          | `feature/`  | `feature/INT-301`  |

### 4. Update Parent State (MANDATORY)

```
Call mcp__linear__update_issue
- Issue: Parent issue
- State: "In Progress"
```

### 5. Determine Resume Point

Check child states to find where to start/resume:

```
FOR each child in tier order:
  IF state == "In Progress":
    → Resume here (was interrupted mid-execution)
    BREAK

  IF state == "Backlog" AND no unresolved blockers:
    → Start here (next unstarted task)
    BREAK

  IF state in ["In Review", "QA", "Done"]:
    → Skip (already completed)
    CONTINUE

  IF state == "Backlog" AND has unresolved blockers:
    → Skip for now (circle back after blockers resolve)
    CONTINUE
```

**Resume States:**

| Child State | Action                        |
| ----------- | ----------------------------- |
| In Progress | Resume here (was interrupted) |
| Backlog     | Start fresh (if no blockers)  |
| In Review   | Skip (completed)              |
| QA          | Skip (completed)              |
| Done        | Skip (completed)              |

### 6. Create PR Early (Before First Child)

**⚠️ CRITICAL: Create the PR BEFORE starting work on children. This enables progressive updates.**

```bash
# Push branch (even if empty, to establish remote)
git push -u origin <type>/INT-<parent-id>

# Create draft PR with all planned children listed
gh pr create --draft --base development \
  --title "[INT-<parent-id>] <parent-title>" \
  --body "$(cat <<'EOF'
## Summary
<overall feature summary>

## Child Issues
| Issue | Title | Status |
|-------|-------|--------|
| INT-<child-1> | <title> | ⏳ Pending |
| INT-<child-2> | <title> | ⏳ Pending |
| INT-<child-3> | <title> | ⏳ Pending |

## Progress Log
_Updated after each child issue completion_

---

Fixes INT-<parent-id>

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
EOF
)"
```

**Store the PR number** — you'll need it for updates after each child.

---

### 7. Execute Children Loop (CONTINUOUS EXECUTION)

**⚠️ CRITICAL: Execute all children in sequence. Your next tool call after completing each child MUST be starting the next child.**

```
FOR each child starting from resume point:
  IF child completed (In Review/QA/Done):
    SKIP
    CONTINUE to next child

  IF child blocked:
    LOG "Skipping INT-XXX (blocked by INT-YYY)"
    CONTINUE to next child

  // === Execute Child ===

  1. Update child state to "In Progress"
     Call mcp__linear__update_issue(state: "In Progress")

  2. Implement the task described in child issue
     - Read requirements from child description
     - Make code changes
     - Follow all CLAUDE.md rules
     - **REMEMBER: You are on the PARENT branch (feature/INT-<parent>)**

  3. Run CI verification (MUST PASS)
     pnpm run ci:tracked

     IF CI fails:
       Fix ALL errors (ownership mindset)
       Re-run until passes

  4. Commit AND PUSH changes with child ID
     git add -A
     git commit -m "INT-<child-id>: <child-title-summary>"
     git push

  5. Update PR description (MANDATORY)
     - Mark child as ✅ Done in Child Issues table
     - Add entry to Progress Log section
     - Update title if scope changed

     gh pr edit <pr-number> --body "$(cat <<'EOF'
     <updated body with child marked done>
     EOF
     )"

  6. Update child state to "In Review"
     Call mcp__linear__update_issue(state: "In Review")

  7. Update parent ledger (State Tracking section)
     Move child from "Now" to "Done" checklist

  // === YOUR NEXT ACTION: Start the next child ===
  // Do NOT output "Next Step: INT-YYY" — execute it directly
```

### ⚠️ FORBIDDEN: Transition Announcements

**NEVER output messages like:**

- "Next Step: Proceed to INT-YYY"
- "Moving on to the next child issue"
- "Now I'll work on INT-YYY"

**These announcements end your turn without executing.** Instead, your very next tool call after completing step 7 must be either:

- `mcp__linear__update_issue` to start the next child, OR
- Implementation code for the next child

**The correct behavior is SILENT TRANSITION** — finish one child, immediately start the next.

### 8. Handle Blocked Children (Circle Back)

After initial pass, if any children were skipped due to blockers:

```
blocked_children = children where state == "Backlog" AND was_skipped

FOR each blocked_child:
  IF blockers now resolved (blocking issues in In Review/QA/Done):
    Execute child (same as Step 7)
  ELSE:
    Report: "Cannot complete INT-XXX — blocked by INT-YYY (still in progress)"
```

### 9. Finalize PR (After ALL Children Complete)

**Mark PR ready for review when ALL children are in In Review or later:**

```bash
git fetch origin
git merge origin/development  # Resolve conflicts if any
git push

# Mark PR as ready for review (removes draft status)
gh pr ready <pr-number>

# Final PR body update - all children marked done
gh pr edit <pr-number> --body "$(cat <<'EOF'
## Summary
<summary of all changes across children>

## Child Issues Completed
| Issue | Title | Status |
|-------|-------|--------|
| INT-<child-1> | <title> | ✅ Done |
| INT-<child-2> | <title> | ✅ Done |
| INT-<child-3> | <title> | ✅ Done |

## Progress Log
- **INT-<child-1>**: <what was done>
- **INT-<child-2>**: <what was done>
- **INT-<child-3>**: <what was done>

## Test Plan
- [x] All CI checks pass
- [ ] <verification items>

Fixes INT-<parent-id>

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
EOF
)"
```

### 10. Update Parent State to In Review

```
Call mcp__linear__update_issue
- Issue: Parent issue
- State: "In Review"
```

### 11. Cross-Link Summary

Display completion summary:

```
Parent Issue Execution Complete
===============================
Parent: INT-<parent-id> - <title>
Branch: <type>/INT-<parent-id>
PR: #<pr-number>

Children Completed:
- INT-<child-1>: <title> → In Review
- INT-<child-2>: <title> → In Review
- INT-<child-3>: <title> → In Review

All artifacts cross-linked via GitHub integration.
```

---

## State Transitions

| Event                    | Issue  | From               | To          |
| ------------------------ | ------ | ------------------ | ----------- |
| Start parent execution   | Parent | Backlog/Todo (any) | In Progress |
| Begin child work         | Child  | Backlog            | In Progress |
| Complete child work      | Child  | In Progress        | In Review   |
| All children done, PR up | Parent | In Progress        | In Review   |

> **Note:** Parent may start from any pre-execution state (Backlog, Todo). The workflow sets "In Progress" regardless of starting state.

---

## Ledger Updates

After each child completion, update the parent issue's State Tracking section:

**Before child completion:**

```markdown
### Now

- [ ] INT-302: [tier-0] Setup infrastructure

### Next

- [ ] INT-303: [tier-1] Implement core feature
```

**After child completion:**

```markdown
### Done

- [x] INT-302: [tier-0] Setup infrastructure

### Now

- [ ] INT-303: [tier-1] Implement core feature
```

---

## Interruption Recovery

If execution is interrupted mid-workflow:

1. **Re-invoke:** `/linear INT-<parent-id>`
2. **Workflow detects:** Child in "In Progress" state
3. **Resumes from:** That child (Step 5 resume logic)
4. **Continues:** Through remaining children

**The workflow is designed to be idempotent** — re-running with the same parent issue safely resumes from the correct point.

---

## Forbidden Patterns

| Pattern                      | Why It's Wrong                            |
| ---------------------------- | ----------------------------------------- |
| Creating branch per child    | Creates merge hell, loses context         |
| Stopping after each child    | Defeats purpose of continuous execution   |
| Creating PR per child        | Fragments review, loses cohesion          |
| Skipping CI between children | Accumulates failures, harder to debug     |
| Moving parent to Done        | Only user can mark Done (terminal state)  |
| Setting assignee/delegate    | User-only responsibility. Blocked by hook |

---

## Checklist

Before creating PR (all must be true):

- [ ] Single branch created from parent ID
- [ ] ALL children in In Review or later
- [ ] ALL commits have child ID in message
- [ ] `pnpm run ci:tracked` passes
- [ ] Parent ledger updated (all children in Done section)
- [ ] PR title contains parent ID `[INT-<parent-id>]`
- [ ] Parent state updated to "In Review"
