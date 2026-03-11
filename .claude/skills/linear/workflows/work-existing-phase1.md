# Work on Existing Issue - Phase 1 (Design & Validation)

**Trigger:** Issue does NOT have `code-task` label

---

## Purpose

Analyze, clarify, and prepare the Linear issue for execution. Work **IN-PLACE** on the issue itself - do not execute code.

---

## Verbose Transition Logging (MANDATORY)

```
🔧 PHASE 1: Starting Design & Validation for INT-123
📝 ENRICH: Updating issue description with template sections...
📝 ENRICH: Added Test Requirements section
📝 ENRICH: Added Requirements section
📝 ENRICH: Added Files to Modify section
🏷️ LABEL: Adding 'code-task' label (issue ready for execution)
✅ PHASE 1 COMPLETE: Issue enriched. Label 'code-task' added. User must re-invoke for Phase 2.
```

Or if unclear:

```
🔧 PHASE 1: Starting Design & Validation for INT-456
❓ UNCLEAR: Requirements ambiguous - need clarification on scope
🏷️ LABEL: Adding 'unclear' label (awaiting human review)
⏸️ PHASE 1 COMPLETE: Issue marked unclear. Awaiting human review.
```

---

## Steps

### 1. Verify Tools

Verify Linear MCP, GitHub CLI, GCloud available. Fail fast if unavailable.

### 2. Fetch Issue Details

```
- Call mcp__linear__get_issue with issue ID
- Extract: title, description, state, labels
- Confirm 'code-task' label is NOT present (Phase 1 trigger)
```

**Short-circuit if `unclear` label present:**

| Label Found                       | Action                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `unclear`                         | STOP with message: `⏸️ Issue INT-XXX already marked 'unclear'. Awaiting human review.` |
| Neither `unclear` nor `code-task` | Continue to Step 3                                                                     |

### 3. Analyze Issue

Read the issue description and understand:

- What is being requested?
- What files need to be modified?
- What are the test requirements?
- Is this issue self-contained or needs splitting?

### 4. Enrich Issue IN-PLACE (Mandatory)

Update the Linear issue description with Unified Issue Template sections:

```markdown
## Test Requirements (MANDATORY - implement first)

| Test | Endpoint/Function | Scenario        | Expected        |
| ---- | ----------------- | --------------- | --------------- |
| Name | What is tested    | Input/condition | Output/behavior |

## Summary

[1-2 sentence summary of the task]

## Requirements

### Functional

- [ ] Requirement 1
- [ ] Requirement 2

### Non-Functional

- [ ] Performance: ...
- [ ] Security: ...

## Scope

### In Scope

- Item 1
- Item 2

### Out of Scope

- Item 1

## Files to Modify

- `path/to/file1.ts` - Description of changes
- `path/to/file2.ts` - Description of changes

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

Use `mcp__linear__update_issue` to update the description.

### 5. Create Subissues (If Complex)

**When to use this step vs plan-splitting.md:**

| Complexity | Children                         | Use                                    |
| ---------- | -------------------------------- | -------------------------------------- |
| Simple     | 2-3 independent tasks            | This step (Phase 1)                    |
| Complex    | 4+ tasks with tiers/dependencies | [plan-splitting.md](plan-splitting.md) |

**Simple splitting:** No tier prefixes, no dependency chains, just parallel subtasks.

---

**FIRST: Check for existing children:**

```
Call mcp__linear__list_issues(parentId: "<issue-uuid>", team: "IntexuraOS")
```

| Result         | Action                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Children exist | Skip creation. Add `code-task` to parent. Log: `📋 EXISTING: Found N children, skipping creation` |
| No children    | Create children as below                                                                          |

**If no existing children, create specific child issues:**

```
- Each child has detailed scope
- Each child has own Test Requirements section
- Each child has 'code-task' label (ready for Phase 2)
- State: Backlog
```

Use `mcp__linear__create_issue` with `parentId` set to parent's UUID.

### 6. Add Label (CRITICAL)

**One of these MUST be added:**

| Condition                     | Label       | Next Step             |
| ----------------------------- | ----------- | --------------------- |
| Issue is clear and actionable | `code-task` | Issue enters Phase 2  |
| Issue needs clarification     | `unclear`   | Human review required |

Use `mcp__linear__update_issue` to add labels array.

### 7. Optional: Design Document (Complex Cases Only)

For complex architectural decisions that need preserved reasoning:

1. Create file: `docs/plans/{issue-id}-design.md`
2. Update the Linear issue description to include: `Plan document: docs/plans/{issue-id}-design.md`
3. Create branch: `design/{issue-id}`
4. Commit and push
5. Create PR referencing Linear issue
6. This preserves the design work in version control

**When to create design doc:**

- Multiple architectural approaches considered
- Non-obvious trade-offs made
- Future maintainers need context

### 8. Completion (MANDATORY OUTPUT)

**Print verbose completion message:**

If `code-task` added:

```
✅ PHASE 1 COMPLETE: INT-XXX enriched with template sections.
🏷️ LABEL: 'code-task' added (issue ready for execution)
⏹️ STOPPING: User must re-invoke `/linear INT-XXX` to start Phase 2.
```

If `unclear` added:

```
⏸️ PHASE 1 COMPLETE: INT-XXX marked for human review.
🏷️ LABEL: 'unclear' added (requirements need clarification)
⏹️ STOPPING: Awaiting human review before proceeding.
```

**STOP after this output.** Do NOT automatically continue to Phase 2.

---

## Completion Validation

The completion-validator hook checks:

- [ ] ONE of `code-task` or `unclear` label mentioned in response
- [ ] Issue description was updated (enriched)

---

## Forbidden Actions

| Action                      | Why Forbidden                    |
| --------------------------- | -------------------------------- |
| Writing implementation code | Phase 1 is design only           |
| Creating feature branches   | No code changes in Phase 1       |
| Running CI                  | No code to test                  |
| Creating implementation PRs | Only design PRs if complex       |
| Skipping Test Requirements  | MANDATORY for all implementation |
