# Work on Existing Issue Workflow

**Trigger:** User calls `/linear INT-123`

---

## Purpose

This file is a **ROUTER ONLY**. It determines which phase workflow to execute based on issue labels.

---

## Verbose Transition Logging (MANDATORY)

**All routing decisions MUST be printed for debugging:**

```
🔍 FETCH: Getting issue INT-123 details...
🏷️ LABELS: ["bug", "code-task"]
🔀 ROUTING: INT-123 → Phase 2 (has code-task label)
```

Or:

```
🔍 FETCH: Getting issue INT-456 details...
🏷️ LABELS: ["feature"]
🔀 ROUTING: INT-456 → Phase 1 (no code-task label, requires design)
```

---

## Steps

### 1. Tool Verification

Verify Linear MCP, GitHub CLI, GCloud available. Fail fast if unavailable.

### 2. Fetch Issue Details

```
- Call mcp__linear__get_issue with issue ID
- Extract: title, description, state, labels array
- Print: 🔍 FETCH: Getting issue INT-XXX details...
```

### 3. Phase Detection (MANDATORY - CHECK FIRST)

**Check labels array for `code-task` BEFORE checking for children:**

```
Print: 🏷️ LABELS: [<labels>]
```

| Labels Include | Action                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| No `code-task` | `🔀 ROUTING: INT-XXX → Phase 1 (no code-task label)` → [work-existing-phase1.md](work-existing-phase1.md) |
| `code-task`    | Continue to Step 4 (check for children)                                                                   |

**Rationale:** Parent issues must have `code-task` label before execution. Phase 1 enriches parent first.

### 4. Check for Child Issues (Only if has code-task)

```
Call mcp__linear__list_issues(parentId: "<issue-uuid>", team: "IntexuraOS")
```

**Routing Decision:**

| Result                    | Action                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Children array non-empty  | `🔀 ROUTING: Parent with children → parent-execution.md` → [parent-execution.md](parent-execution.md)             |
| Children array empty/null | `🔀 ROUTING: INT-XXX → Phase 2 (has code-task, no children)` → [work-existing-phase2.md](work-existing-phase2.md) |

### 5. Delegate to Workflow

**DO NOT execute any further steps in this file.** Follow the phase-specific workflow completely.

---

## Phase Transition (Phase 1 → Phase 2)

When Phase 1 completes:

1. Phase 1 adds `code-task` or `unclear` label
2. Phase 1 **STOPS**
3. User must re-invoke `/linear INT-XXX` to start Phase 2

**There is no automatic continuation.** User controls the transition.

---

## Reference

See [two-phase-execution.md](../reference/two-phase-execution.md) for full decision tree.
