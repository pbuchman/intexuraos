# Linear State Machine

Automatic state transitions enforced by the Linear skill.

## State Flow Diagram

```
                    +-------------------------+
                    |        Backlog          |  (Initial state for new issues)
                    +-----------+-------------+
                                |
                    /linear INT-123 called
                                |
                                v
                    +-------------------------+
                    |      In Progress        |  (Branch created, active work)
                    +-----------+-------------+
                                |
                    gh pr create called
                                |
                                v
                    +-------------------------+
                    |       In Review         |  (PR link added, awaiting review)
                    +-----------+-------------+
                                |
                +---------------+---------------+
                |                               |
        PR approved (→ Q&A QA)         PR changes requested
                |                               |
                v                               v
    +-------------------+             +-------------------+
    |       Q&A QA      |             |      In Progress  |  (Back to work)
    +-------------------+             +-------------------+
                |
        User explicitly
        requests Done
                |
                v
    +-------------------+
    |        Done       |  (Only on explicit user instruction)
    +-------------------+
```

## State Transition Triggers

| Trigger                                    | From         | To          | Action                              |
| ------------------------------------------ | ------------ | ----------- | ----------------------------------- |
| `/linear INT-123` called                   | Backlog/Todo | In Progress | Create branch with issue ID in name |
| `gh pr create` called (title has issue ID) | In Progress  | In Review   | GitHub integration auto-attaches PR |
| PR approved                                | In Review    | Q&A QA      | Move to Q&A QA state for testing    |
| PR has review changes                      | In Review    | In Progress | Update Linear state                 |
| User explicitly requests "move to Done"    | Any          | Done        | Close Linear issue                  |

## Important Notes

### Default Post-Approval State

When a PR is approved, the default transition is to **Q&A QA** (not Done). This allows for:
- Manual testing verification
- QA review
- Final sign-off

Only move to **Done** when user explicitly requests it.

### GitHub Integration Requirement

GitHub integration only works when **BOTH**:
1. Branch name contains Linear issue ID (e.g., `fix/INT-123`)
2. PR title contains Linear issue ID (e.g., `[INT-123] Fix auth`)

Without both conditions, the PR won't appear in Linear's attachments array.

## State Descriptions

| State       | Description                                      |
| ----------- | ------------------------------------------------ |
| Backlog     | New issues, not yet prioritized                  |
| Todo        | Prioritized, ready to work on                    |
| In Progress | Actively being worked on, branch created         |
| In Review   | PR created, awaiting code review                 |
| Q&A QA      | PR approved, awaiting testing/verification       |
| Done        | Complete, issue closed                           |

## Automated Transitions

The skill automatically handles these transitions:

1. **Start Work**: When `/linear INT-123` is called
   - Set state to "In Progress"
   - Must happen BEFORE any investigation

2. **Create PR**: When `gh pr create` succeeds
   - Set state to "In Review"
   - Verify PR appears in attachments

3. **Review Changes**: When PR receives change requests
   - Set state back to "In Progress"

## Manual Transitions

These require explicit user instruction:

1. **Done**: Only when user explicitly says "move to Done" or "mark as complete"
2. **Backlog → Todo**: Requires prioritization decision
