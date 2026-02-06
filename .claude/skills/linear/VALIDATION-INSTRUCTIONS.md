# Linear Skill Validation Instructions

**Purpose:** Review the Linear skill documentation for consistency, completeness, and correctness.

---

## Your Role

You are an external architect reviewing this skill's documentation. Your goal is to find issues that would cause:

1. **Dead paths** — Code/docs that can never be reached
2. **Inconsistencies** — Contradictions between files
3. **Missing handoffs** — Workflows that don't connect properly
4. **Ambiguous routing** — Unclear which workflow handles what

---

## Files to Review

Read these files in order:

| File                                | Purpose                                   |
| ----------------------------------- | ----------------------------------------- |
| `SKILL.md`                          | Entry point, core mandates, routing table |
| `workflows/create-issue.md`         | New issue creation flow                   |
| `workflows/work-existing.md`        | Router for existing issues                |
| `workflows/work-existing-phase1.md` | Design & validation phase                 |
| `workflows/work-existing-phase2.md` | Execution phase (single issues)           |
| `workflows/parent-execution.md`     | Execution for parent+children             |
| `workflows/plan-splitting.md`       | Complex task splitting                    |
| `workflows/random-todo.md`          | Queue-based issue selection               |

---

## Validation Checklist

### 1. Routing Consistency

Trace these paths and verify they work:

| Scenario                                          | Expected Path                                         |
| ------------------------------------------------- | ----------------------------------------------------- |
| `/linear` (no args)                               | SKILL.md → random-todo.md → work-existing.md → ?      |
| `/linear INT-XXX` (no label)                      | SKILL.md → work-existing.md → work-existing-phase1.md |
| `/linear INT-XXX` (has `code-task`, no children)  | work-existing.md → work-existing-phase2.md            |
| `/linear INT-XXX` (has `code-task`, has children) | work-existing.md → parent-execution.md                |
| `/linear <description>` (complex)                 | create-issue.md → plan-splitting.md → STOP            |

**Questions to answer:**

- Does the router (`work-existing.md`) check labels BEFORE children?
- After plan-splitting, does the parent get `code-task` label?
- Does re-invoking `/linear INT-parent` route correctly to `parent-execution.md`?

### 2. Label Logic

| Label       | Meaning             | Set By                  | Checked By              |
| ----------- | ------------------- | ----------------------- | ----------------------- |
| `code-task` | Ready for execution | Phase 1, plan-splitting | work-existing.md router |
| `unclear`   | Needs human review  | Phase 1                 | work-existing.md router |

**Verify:**

- Every workflow that creates issues adds appropriate labels
- Router handles both labels correctly
- No path creates an issue without one of these labels (for execution-ready issues)

### 3. State Transitions

Expected flow: `Backlog → Todo → In Progress → In Review → QA → Done`

**Verify:**

- Issues are created in which state?
- When does Phase 2 set "In Progress"?
- When is "In Review" set?
- Is "Done" ever set by the agent? (Should be NO)

### 4. Handoff Semantics

When one workflow says "proceed to X" or "delegate to X":

| Term          | Meaning                                 |
| ------------- | --------------------------------------- |
| "Delegate to" | Full handoff, caller does nothing after |
| "Route to"    | Full handoff, caller does nothing after |
| "Continue to" | Same execution, next step               |
| "STOP"        | Terminate, user must re-invoke          |

**Verify:**

- `create-issue.md` → `plan-splitting.md` is a full handoff (Step 7 doesn't run)
- `plan-splitting.md` ends with STOP
- Phase 1 ends with STOP
- Phase 2 ends with PR creation (automatic, no STOP)

### 5. Two-Cycle Pattern (Cron Mode)

For automated/cron invocations:

```
Cycle 1: /linear INT-XXX → Phase 1 → adds code-task → STOP
Cycle 2: /linear INT-XXX → Phase 2 → executes → PR → In Review
```

**Verify:**

- Documentation explains this pattern
- No workflow tries to do both phases in one invocation

### 6. Verbose Logging

All workflows should have emoji logging sections.

**Verify each workflow has:**

- `## Verbose Transition Logging (MANDATORY)` section
- Example log output with emojis
- Consistent emoji usage across files

---

## Output Format

Provide feedback in this structure:

```markdown
## Validation Results

### Critical Issues (Must Fix)

1. **[File:Line]** Issue description
   - Expected: X
   - Actual: Y
   - Impact: Z

### Warnings (Should Fix)

1. **[File]** Issue description
   - Recommendation: X

### Suggestions (Nice to Have)

1. **[File]** Improvement idea

### Verified Paths

- [x] Path 1 works correctly
- [x] Path 2 works correctly
- [ ] Path 3 has issue (see Critical #1)

### Overall Assessment

[1-2 paragraph summary of documentation health]
```

---

## What NOT to Review

- Implementation code (there is none, this is documentation)
- Grammar/style (focus on logic and consistency)
- Template files in `templates/` (they're examples, not workflows)
- Reference files in `reference/` (supplementary, not core logic)

---

## Success Criteria

The skill documentation passes validation when:

1. All routing paths are traceable and consistent
2. No dead code/unreachable sections exist
3. Labels are set and checked correctly
4. State transitions follow the documented flow
5. Handoffs between workflows are explicit and complete
6. Two-cycle pattern is clearly documented
7. Verbose logging exists in all workflows
