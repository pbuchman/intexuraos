---
name: linear
description: |
  Linear issue management with automatic workflow orchestration.
  Handles issue creation, state transitions, and automatic splitting
  of large plans into tiered child issues.

invocation: both

triggers:
  - "/linear"
  - "INT-\\d+"
  - "create.*issue"
  - "track.*task"
  - "linear.*issue"

config:
  team: "IntexuraOS"
  project_key: "INT"
  base_branch: "development"
---

# Linear Issue Management

Manage Linear issues, branches, and PRs with enforced workflow and cross-linking.

**Team:** `IntexuraOS` — ALWAYS use this exact team name for all Linear API calls. Never guess.

**Project Key:** `INT-` (e.g., `INT-123`, `INT-144`). All issue references use generic `LIN-XXX` placeholders, but for this project always use `INT-XXX`.

## Usage

```
/linear                           # NON-INTERACTIVE: Pick random Todo issue
/linear <task description>        # Create new issue
/linear INT-123                   # Work on existing issue
/linear <sentry-url>              # Create issue from Sentry error
```

## Core Mandates

1. **Fail Fast**: If Linear, GitHub CLI, or GCloud are unavailable, STOP immediately
2. **No Guessing**: When issue type is ambiguous, ASK the user
3. **Cross-Linking**: Every issue MUST link between systems (Linear <-> GitHub <-> Sentry)
4. **CI Gate**: `pnpm run ci:tracked` MUST pass before PR creation unless explicitly overridden
5. **State Management**: Automatically transition issues through the state machine

## Invocation Detection

The skill automatically detects intent from input:

| Input Pattern                   | Type               | Workflow                              |
| ------------------------------- | ------------------ | ------------------------------------- |
| `/linear` (no args)             | Random Todo        | [random-todo.md](workflows/random-todo.md)        |
| `/linear <task description>`    | Create New         | [create-issue.md](workflows/create-issue.md)      |
| `/linear INT-<number>`          | Work Existing      | [work-existing.md](workflows/work-existing.md)    |
| `/linear https://sentry.io/...` | Sentry Integration | [sentry-integration.md](workflows/sentry-integration.md) |

## Auto-Splitting Detection

For complex multi-step tasks, auto-splitting is triggered when:

1. Issue description has numbered phases (Phase 1, Phase 2...)
2. Issue description has >5 checkbox items
3. Issue description >2000 characters with clear sections
4. User explicitly says "split this into subtasks"

When detected, see: [plan-splitting.md](workflows/plan-splitting.md)

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools:

| Tool       | Verification Command             | Purpose          |
| ---------- | -------------------------------- | ---------------- |
| Linear MCP | `mcp__linear__list_teams`        | Issue management |
| GitHub CLI | `gh auth status`                 | PR creation      |
| GCloud     | Service account verification     | Firestore access |

### GCloud Verification

**Service account key location:** `~/personal/gcloud-claude-code-dev.json`

1. Check if credentials file exists
2. If `gcloud auth list` shows no active account, activate service account
3. Verify authentication

**You are NEVER "unauthenticated" if the service account key file exists.**

### Failure Handling

If ANY required tool is unavailable, **ABORT immediately**:

```
ERROR: /linear cannot proceed - <tool-name> unavailable

Required for: <purpose>
Fix: <fix-command>

Aborting.
```

## GitHub Integration (Critical)

For PRs to appear as attachments in Linear UI:

1. **Branch name MUST contain Linear issue ID** - e.g., `fix/INT-123`
2. **PR title MUST contain Linear issue ID** - e.g., `[INT-123] Fix auth`

When both conditions are met, GitHub integration automatically attaches PR to Linear issue.

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
