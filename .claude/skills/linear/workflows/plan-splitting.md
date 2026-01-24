# Plan Splitting Workflow (Auto-Splitting)

**Trigger:** Detected automatically when working with complex multi-step tasks, or user explicitly says "split this into subtasks".

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

**IMPORTANT:** If an issue was already created in `create-issue.md`, REUSE it as the parent.
Do NOT create a new parent issue — this would orphan the original.

```
IF issue already exists (from create-issue.md step 4):
  - Use that issue as the parent
  - UPDATE its description to ledger format
  - UPDATE its state to "In Progress"

ELSE (direct invocation without existing issue):
  - CREATE new parent issue via mcp__linear__create_issue
```

Use [ledger-template.md](../templates/ledger-template.md) format for the description:

```
Title: [feature] <original plan title>  (update if needed)
State: In Progress
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
Description: Subtask template format
```

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

## Execution Protocol

After splitting:

1. **Move parent to In Progress**
2. **Start with Tier 0 tasks** (all can run in parallel)
3. **When Tier 0 complete**, start Tier 1 tasks
4. **Continue tier by tier** until all complete
5. **Move parent to Done** when all children Done

Linear automatically tracks child status — no manual ledger updates needed.

## Continuation Directive

Each child issue (except the final one) includes:

```markdown
---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next unblocked task without waiting for user input.
```

The final task does NOT include this directive, allowing natural completion.

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
