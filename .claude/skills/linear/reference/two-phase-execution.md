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
        | Follow requirements |     | Create design document  |
        | Write tests + code  |     | Update issue template   |
        | Run CI              |     +------------+------------+
        | Create PR           |                  |
        | Update Linear state |       +----------+----------+
        +----------+----------+       |                     |
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

### Phase 1: Design & Validation

**Trigger:** Issue does NOT have `code-task` label

**Purpose:** Analyze requirements and prepare for execution

**Outputs:**

1. Updated Linear issue matching Unified Issue Template
2. Design document at `docs/plans/{issue-id}-design.md`
3. Design PR on `design/{issue-id}` branch
4. Label added: `code-task` OR `unclear`

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

**Required:** Agent must add ONE of these labels:

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
