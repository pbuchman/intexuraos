# Two-Phase Execution Model

The orchestrator uses a two-phase model to process Linear issues based on label state.

## Decision Tree

```
                        +---------------------------+
                        |   Issue arrives at        |
                        |   Orchestrator            |
                        +-------------+-------------+
                                      |
                                      v
                        +---------------------------+
                        |   Check labels on issue   |
                        +-------------+-------------+
                                      |
                        +-------------+-------------+
                        |                           |
               Has 'code-task'?            No 'code-task'?
                        |                           |
                        v                           v
            +-------------------+       +-------------------+
            |    PHASE 2        |       |    PHASE 1        |
            | Strict Execution  |       | Design & Validate |
            +-------------------+       +-------------------+
                    |                           |
                    v                           v
        +---------------------+     +-------------------------+
        | Execute /linear     |     | Analyze issue           |
        | Follow requirements |     | Update issue IN-PLACE   |
        | Write tests + code  |     | Create subissues if     |
        | Run CI              |     | complex (with labels)   |
        | Create PR           |     +------------+------------+
        | Update Linear state |                  |
        +----------+----------+       +----------+----------+
                   |           Ready for code?      Needs clarification?
                   |                  |                     |
                   |                  v                     v
                   |     +--------------------+   +-------------------+
                   |     | Add 'code-task'    |   | Add 'unclear'     |
                   |     | label              |   | label             |
                   |     +--------------------+   +-------------------+
                   |                  |                     |
                   |                  v                     v
                   |     +--------------------+   +-------------------+
                   |     | Phase 1 Complete   |   | Phase 1 Complete  |
                   |     | → Requeue as       |   | → Wait for human  |
                   |     |   Phase 2          |   |   review          |
                   |     +--------------------+   +-------------------+
                   |
                   v
        +-------------------------+
        | Completion Validator    |
        | Hook Checks:            |
        | - PR created?           |
        | - CI passed?            |
        | - Linear updated?       |
        +------------+------------+
                     |
           +---------+---------+
           |                   |
        All present?      Missing artifacts?
           |                   |
           v                   v
    +--------------+    +------------------+
    | STOP allowed |    | BLOCK: Agent     |
    | Task complete|    | must complete    |
    +--------------+    | missing items    |
                        +------------------+
```

## Phase Descriptions

### Phase 1: Design & Validation (In-Place Model)

**Trigger:** Issue does NOT have `code-task` label

**Purpose:** Analyze requirements and prepare for execution **in-place** on the Linear issue itself

**In-Place Design Outputs:**

1. **Updated Linear issue** - Enrich with Unified Issue Template sections:
   - `## Test Requirements` (with table format)
   - `## Summary`
   - `## Requirements` (Functional / Non-Functional)
   - `## Scope` (In Scope / Out of Scope)
   - `## Files to Modify`
   - `## GLM Delegation Plan` (if GLM MCP tools available)
   - `## Acceptance Criteria`

2. **GLM Delegation Plan (CONDITIONAL)** - If GLM MCP tools are available:
   - GLM-Generated table (files, tools, task descriptions)
   - Direct Implementation table (files, reasons)
   - Criteria checklist showing analysis was done
   - **Purpose:** Allocate work to GLM before Phase 2 to reduce costs

3. **Create subissues (if needed)** - Split complex issues into specific, labeled children:
   - Each child has detailed scope and test requirements
   - All children have `code-task` label (ready for Phase 2)

4. **Label added** - ONE of:
   - `code-task` - Issue is ready for execution
   - `unclear` - Issue needs human clarification

**Optional Design Document (Complex Cases Only):**

For complex architectural decisions that need preserved reasoning:

1. Create design document at `docs/plans/{issue-id}-design.md`
2. Create PR on `design/{issue-id}` branch (required to preserve the work)
3. PR description references the Linear issue

**Exit Conditions:**

- `code-task` label → Issue re-enters queue as Phase 2
- `unclear` label → Issue awaits human review

### Phase 2: Strict Execution

**Trigger:** Issue HAS `code-task` label

**Purpose:** Autonomous code execution

**Outputs:**

1. Implementation code
2. Tests (from Test Requirements)
3. PR with passing CI
4. Linear state updated to "In Review"

**Exit Conditions:**

- Completion validator verifies all artifacts present
- Agent must state: PR, CI passed, Linear updated

## Label-Based Transitions

| Label State                  | Phase | Next Action           |
| ---------------------------- | ----- | --------------------- |
| No `code-task`, no `unclear` | 1     | Design & validate     |
| `unclear` added              | -     | Human review required |
| `code-task` added            | 2     | Execute autonomously  |
| `code-task` present          | 2     | Execute autonomously  |

## Completion Validation (INT-522)

The `completion-validator.sh` hook enforces output requirements:

### Phase 1 Validation

**Required outputs (at least one):**

1. **In-place design** - Linear issue enriched with template sections, OR
2. **Subissues created** - Child issues with `code-task` labels, OR
3. **Design PR** - For complex cases needing preserved reasoning

**AND** agent must add ONE of these labels to the parent issue:

- `code-task` - Issue is ready for Phase 2 execution
- `unclear` - Issue needs human clarification

**Hook blocks if:** No label mentioned in recent responses

### Phase 2 Validation

**Required artifacts (all must be mentioned):**

- PR created (URL or `#XXX` format)
- CI passed (`CI passed` or `ci:tracked passed`)
- Linear updated (`In Review` state)

**Hook blocks if:** Any artifact missing from recent responses

## Markers

The orchestrator injects markers into worker prompts for hook detection:

```
[WORKER-MODE]     - Identifies automated worker session
[PHASE:1]         - Design & Validation mode
[PHASE:2]         - Strict Execution mode
```

Interactive sessions (no `[WORKER-MODE]` marker) bypass validation.

## Related Documentation

- [State Machine](state-machine.md) - Linear state transitions
- [Unified Issue Template](../templates/unified-issue.md) - Issue format
- [Completion Validator Hook](../../../../hooks/README.md) - Hook details
