# Linear-Based Continuity Pattern

This document describes the Linear-based approach to managing complex, multi-step tasks that replaces the file-based `continuity/` workflow.

## Overview

Instead of creating `continuity/NNN-task-name/` directories with markdown files, we now use Linear's native parent-child issue relationship to track complex tasks.

### What Changed

| Aspect       | Old (File-Based)        | New (Linear-Based)                  |
| ------------ | ----------------------- | ----------------------------------- |
| Ledger       | `CONTINUITY.md` file    | Parent Linear issue description     |
| Subtasks     | `X-Y-title.md` files    | Child Linear issues with `parentId` |
| State        | Manual markdown updates | Linear state machine                |
| Visibility   | Local filesystem only   | Full team visibility in Linear UI   |
| History      | Git history             | Linear activity feed                |
| Dependencies | Manual tracking         | `blockedBy` relationships           |

### Why Linear

- **Team visibility**: Everyone can see progress in Linear UI
- **Full history**: State transitions, comments preserved automatically
- **No manual cleanup**: No archive directories needed
- **Better collaboration**: Comments, assignments, mentions
- **Project integration**: Connects to broader project management

## Architecture

```
Parent Issue (Ledger)
├── Goal & Success Criteria
├── Key Decisions Table
├── State Tracking (Done/Now/Next)
├── Child Issues Table
└── Progress Notes
    │
    ├── Child Issue (Tier 0)
    │   └── Setup/prerequisite work
    ├── Child Issue (Tier 1)
    │   └── Independent deliverables
    ├── Child Issue (Tier 2)
    │   └── Integration work
    └── Child Issue (Tier 3+)
        └── Verification/finalization
```

## Workflow

### 1. Create Parent Issue (Ledger)

When starting a complex multi-step task:

```bash
/linear <task description>
```

If the task is complex (multiple phases, many checkboxes), the skill detects this and offers to split into subtasks.

### 2. Plan Splitting

The skill automatically:

1. Parses the plan into phases/tasks
2. Classifies tasks into tiers
3. Creates parent issue with ledger format
4. Creates child issues with `parentId`
5. Sets `blockedBy` dependencies

### 3. Tier Classification

| Tier | Name         | Purpose                                   |
| ---- | ------------ | ----------------------------------------- |
| 0    | Setup        | Prerequisites, scaffolding, config        |
| 1    | Independent  | Can run in parallel, no interdependencies |
| 2    | Integration  | Connects components, depends on Tier 1    |
| 3+   | Verification | Testing, coverage, finalization           |

### 4. Execution

1. **Move parent to In Progress**
2. **Complete Tier 0** tasks (all can run in parallel)
3. **Complete Tier 1** tasks (unblocked after Tier 0)
4. **Continue tier by tier** through the dependency chain
5. **Update parent ledger** after each child completes
6. **Move parent to Done** when all children complete

### 5. Continuation Directive

Each child issue (except final) includes:

```markdown
---

## Continuation

**DO NOT STOP.** After completing this task and committing,
immediately proceed to the next unblocked task without waiting for user input.
```

This ensures uninterrupted execution through the task series.

## Parent Issue (Ledger) Format

```markdown
## Goal

<Overall objective>

### Success Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Key Decisions

| Timestamp  | Decision   | Rationale |
| ---------- | ---------- | --------- |
| YYYY-MM-DD | <decision> | <why>     |

## State Tracking

### Done

- [x] Completed task

### Now

- [ ] Current task

### Next

- [ ] Upcoming task

## Child Issues

| Tier | Issue   | Title             | Status      |
| ---- | ------- | ----------------- | ----------- |
| 0    | INT-XXX | Setup             | Done        |
| 1    | INT-XXX | Implement feature | In Progress |
| 2    | INT-XXX | Wire up routes    | Backlog     |

## Progress Notes

### YYYY-MM-DD

<Progress update>
```

## Child Issue Format

```markdown
## Context

Part of: [Parent Title](url)
Tier: X | Sequence: Y

## Scope

<What this task covers>

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Dependencies

**Blocked By:** INT-XXX
**Blocks:** INT-XXX

---

## Continuation

**DO NOT STOP.** After completing this task and committing,
immediately proceed to the next unblocked task without waiting for user input.
```

## Example: Feature Implementation

Given a plan like "Create Linear skill with auto-splitting":

### Parent Issue (Ledger)

```
Title: [feature] Create Linear skill with auto-splitting
State: In Progress
```

### Child Issues

| Tier | Issue   | Title                                     | Dependencies |
| ---- | ------- | ----------------------------------------- | ------------ |
| 0    | INT-157 | [tier-0] Create skill directory structure | None         |
| 1    | INT-158 | [tier-1] Migrate workflow content         | INT-157      |
| 1    | INT-159 | [tier-1] Create templates                 | INT-157      |
| 2    | INT-160 | [tier-2] Implement auto-splitting         | INT-158, 159 |
| 3    | INT-161 | [tier-3] Update documentation             | INT-160      |

## Migration from File-Based

All previous `continuity/` tasks remain archived in `continuity/archive/` for historical reference.

**Do not create new `continuity/NNN-task-name/` directories.** Use Linear issues instead.

## Invoking the Skill

```bash
/linear                    # Pick random Todo (cron mode)
/linear <description>      # Create new issue (may auto-split)
/linear INT-123            # Work on existing issue
```

## References

- Skill: `.claude/skills/linear/SKILL.md`
- Workflows: `.claude/skills/linear/workflows/`
- Templates: `.claude/skills/linear/templates/`
