# Linear Issue Management

Manage Linear issues, branches, and PRs with enforced workflow and cross-linking.

## Usage

```
/linear                           # Pick random issue from Backlog/Todo (cron mode)
/linear <task description>        # Create new issue
/linear LIN-123                   # Work on existing issue
/linear <sentry-url>              # Create issue from Sentry error
```

## Examples

```bash
/linear Fix authentication token not refreshing
/linear LIN-42
/linear https://intexuraos-dev-pbuchman.sentry.io/issues/123/
/linear
```

---

## Invocation Type Detection

The command automatically detects intent from input:

| Input Pattern | Type | Action |
|---------------|------|--------|
| `/linear` (no args) | Random Backlog | Pick from Backlog/Todo and start working |
| `/linear <task description>` | Create New | Detect bug/feature, create issue, start working |
| `/linear LIN-<number>` | Work Existing | Start working on specific issue |
| `/linear https://sentry.io/...` | Sentry Integration | Create Linear issue from Sentry error |

---

## Issue Type Detection

### Automatic Detection

| Pattern | Type | Prefix |
|---------|------|--------|
| fix, error, bug, broken, fail, crash | Bug | `[bug]` |
| add, create, implement, support, enhance | Feature | `[feature]` |
| refactoring, extract, refactor | Refactor | `[refactor]` |
| docs, documentation, readme | Documentation | `[docs]` |

### When Ambiguous

**ASK USER** - do not guess. Prompt: "Is this a bug or a feature?"

### Cron Mode (Non-Interactive)

When `/linear` is called without user interaction (e.g., from cron):
- Default to `[task]` prefix when ambiguous
- Make best-effort decisions
- Log all actions to stdout

### Sentry Issues

Always use `[sentry]` prefix regardless of content.

---

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools are available.

### Required Tools

| Tool | Verification Command | Purpose |
|------|---------------------|---------|
| Linear MCP | `mcp__linear-server__list_teams` | Issue management |
| GitHub CLI | `gh auth status` | PR creation |
| GCloud | `gcloud auth list` | Firestore access |

### Optional Tools

| Tool | Verification | When Needed |
|------|--------------|-------------|
| Sentry MCP | `mcp__sentry__whoami` | Sentry workflow only |

### Failure Handling

If ANY required tool is unavailable, **ABORT immediately** with:

```
ERROR: /linear cannot proceed - <tool-name> unavailable

Required for: <purpose>
Fix: <fix-command>

Aborting.
```

**Examples:**

```
ERROR: /linear cannot proceed - GitHub CLI is not authenticated

Required for: Creating pull requests
Fix: Run 'gh auth login'

Aborting.
```

```
ERROR: /linear cannot proceed - Linear MCP unavailable

Required for: Issue creation and state management
Fix: Check MCP server configuration

Aborting.
```

---

## Workflow: Random Backlog (Cron Mode)

### Trigger

User calls `/linear` with no arguments.

### Selection Algorithm

1. List issues where `state` is `"Backlog"` OR `"Todo"`
2. Filter to `team: "pbuchman"`
3. Sort by `priority` (High → Low) then `createdAt` (newest first)
4. Pick first result

### Execution

```
1. Verify tools (Linear, GitHub, GCloud)
2. Fetch selected issue details
3. Update Linear state to "In Progress"
4. Create branch from origin/development (or origin/main)
5. Guide through implementation
6. Run CI gate: pnpm run ci:tracked
7. Create PR with cross-links
8. Update Linear state to "In Review"
```

### Branch Selection Logic

```bash
# Try development first, fallback to main
git fetch origin
if git ls-remote --heads origin development | grep -q development; then
  BASE_BRANCH="origin/development"
else
  BASE_BRANCH="origin/main"
fi

git checkout -b fix/LIN-123 "$BASE_BRANCH"
```

### When No Backlog Items

Exit gracefully with message: "No items in Backlog or Todo state."

---

## Workflow: Create New Issue

### Trigger

User calls `/linear <task description>`

### Steps

1. **Tool Verification** - Verify Linear, GitHub, GCloud available

2. **Issue Type Detection** - Detect bug/feature from keywords

3. **Ask If Ambiguous** - "Is this a bug or a feature?"

4. **Create Linear Issue**
   - Format: `[bug] <short-description>` or `[feature] <short-description>`
   - Team: `pbuchman`
   - State: `Backlog`
   - Description: Include task context

5. **Offer to Start Working**
   - Ask: "Ready to start working on this issue?"
   - If yes: Transition to "Work on Existing Issue" flow

6. **Link to Continuity** (if complex task)
   - Ask: "This appears to be a multi-step task. Create continuity workspace?"

---

## Workflow: Work on Existing Issue

### Trigger

User calls `/linear LIN-123`

### Steps

1. **Tool Verification** - Verify Linear, GitHub, GCloud available

2. **Fetch Issue Details**
   - Get issue from Linear
   - Parse title, description, state, assignee

3. **Update State** - Set to "In Progress"

4. **Create Branch**
   ```bash
   git fetch origin
   BASE_BRANCH="origin/development"  # or origin/main if development doesn't exist
   git checkout -b fix/LIN-123 "$BASE_BRANCH"
   ```

5. **Guide Implementation**
   - Execute the task described in issue
   - Make commits with clear messages

6. **CI Gate** (MANDATORY)
   - Run `pnpm run ci:tracked`
   - If fails: Report and ask to fix or explicitly override

7. **Create PR**
   ```bash
   git push -u origin fix/LIN-123
   gh pr create --base development \
                --title "[LIN-123] Issue title" \
                --body "<PR template>"
   ```

8. **Update Linear**
   - Set state to "In Review"
   - Add PR link as comment

9. **Cross-Link Summary**
   - Show table of created artifacts

---

## Workflow: Sentry Integration

### Trigger

User calls `/linear https://<sentry-url>`

### Steps

1. **Parse Sentry URL**
   - Extract organization slug
   - Extract issue ID

2. **Verify Tools**
   - Linear MCP
   - GitHub CLI
   - Sentry MCP
   - GCloud (for investigation)

3. **Fetch Sentry Details**
   - Use Sentry MCP tool
   - Extract: title, stacktrace, frequency, affected users

4. **Search for Existing Linear Issue**
   - Search Linear by Sentry issue title
   - If found: Link to existing and ask to proceed

5. **Create Linear Issue**
   - Format: `[sentry] <short-error-message>`
   - Description includes:
     - Sentry issue link
     - Error context summary
     - Stacktrace excerpt

6. **Handoff to Work Flow**
   - Ask: "Start working on this issue now?"
   - If yes: Proceed with "Work on Existing Issue"

---

## State Machine (Automatic Transitions)

```
                    +-------------------------+
                    |        Backlog          |  (Initial state for new issues)
                    +-----------+-------------+
                                |
                    /linear LIN-123 called
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
        PR approved                     PR changes requested
                |                               |
                v                               v
    +-------------------+             +-------------------+
    |        Done       |             |      In Progress  |  (Back to work)
    +-------------------+             +-------------------+
```

### State Transition Triggers

| Trigger | From | To | Action |
|---------|------|-----|--------|
| `/linear LIN-123` called | Backlog/Todo | In Progress | Create branch |
| `gh pr create` called | In Progress | In Review | Add PR link to Linear |
| PR approved | In Review | Done | Close Linear issue |
| PR has review changes | In Review | In Progress | Update Linear state |

---

## Cross-Linking Protocol

All issues must be linked between systems.

| Direction | Method |
|-----------|--------|
| Linear → GitHub | `Fixes LIN-XXX` in PR body |
| GitHub → Linear | PR URL in issue comments |
| Sentry → Linear | `[sentry] <title>` naming + link in description |
| Linear → Sentry | Comment on Sentry issue |

### PR Body Template

```markdown
## Context

Addresses: [LIN-XXX](LINEAR_ISSUE_URL)

## What Changed

<Brief description of changes made>

## Reasoning

<Detailed explanation of approach, alternatives considered>

### Investigation Findings

<Data from investigation, Firestore queries, evidence collected>

### Key Decisions

- Decision 1: <reason>
- Decision 2: <reason>

## Testing

- [ ] Manual testing completed
- [ ] `pnpm run ci:tracked` passes

## Cross-References

- **Linear Issue**: [LIN-XXX](LINEAR_URL)
- **Sentry Issue** (if applicable): [Issue Title](SENTRY_URL)

---

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

---

## Pre-PR CI Gate (MANDATORY)

### Rule: `pnpm run ci:tracked` MUST Pass

Before creating ANY PR, run:

```bash
pnpm run ci:tracked
```

**This is NON-NEGOTIABLE unless user explicitly overrides.**

### CI Failure Handling

If `ci:tracked` fails:

1. Report the failure clearly
2. Show which step failed (typecheck/lint/tests)
3. Show `.claude/ci-failures/` content if available
4. Ask: "CI failed. Fix and retry, or explicitly override to proceed anyway?"

### Override Only When

User explicitly says one of:
- "override ci"
- "skip ci check"
- "proceed anyway"
- "ci is known to fail, continue"

### PR Creation Checklist

- [ ] `pnpm run ci:tracked` passes OR user explicitly overridden
- [ ] Branch created from correct base
- [ ] All commits made
- [ ] PR description complete with all sections

---

## Branch Naming Conventions

| Issue Type | Branch Pattern | Example |
|------------|---------------|---------|
| Bug | `fix/LIN-XXX` | `fix/LIN-42` |
| Feature | `feature/LIN-XXX` | `feature/LIN-42` |
| Sentry | `fix/sentry-XXX` | `fix/sentry-INTEXURAOS-4` |
| Refactor | `refactor/LIN-XXX` | `refactor/LIN-42` |
| Documentation | `docs/LIN-XXX` | `docs/LIN-42` |

---

## Issue Naming Conventions

| Type | Pattern | Examples |
|------|---------|----------|
| Bug | `[bug] <short-error-message>` | `[bug] Cannot read property 'id' of undefined in TodoService` |
| Feature | `[feature] <action-object-context>` | `[feature] Add OAuth token refresh for calendar service` |
| Sentry | `[sentry] <error-name>` | `[sentry] TypeError: null is not an object in AuthService` |
| Coverage | `[coverage][<app>] <description>` | `[coverage][user-service] Add tests for token validation` |
| Refactoring | `[refactor] <component-name>` | `[refactor] Extract shared HTTP client utilities` |
| Documentation | `[docs] <topic>` | `[docs] API authentication flow` |

### Title Generation Rules

1. Keep under 80 characters when possible
2. Start with type tag (enforced)
3. Use present tense, imperative mood
4. Be specific about location/context
5. Avoid technical jargon in first 50 chars

---

## Edge Cases and Error Handling

| Edge Case | Detection | Handling |
|-----------|-----------|----------|
| Issue already exists | Search Linear for matching title/desc | Link to existing, don't duplicate |
| Ambiguous bug/feature | Keywords match both patterns | Ask user to clarify |
| No development branch | `git ls-remote` returns empty for development | Fall back to `main` |
| Unauthenticated gh | `gh auth status` fails | Instruct user to run `gh auth login` |
| Linear MCP unavailable | MCP tool call throws error | Suggest manual Linear creation |
| Sentry URL malformed | URL doesn't match Sentry pattern | Ask for correct URL or issue ID |
| Issue in wrong state | Current state != expected for operation | Confirm with user before proceeding |
| Branch already exists | `git branch` shows matching branch | Ask to checkout existing or create new name |

---

## Continuity Integration (Optional)

For complex multi-step tasks, offer to create a continuity workspace:

```
This appears to be a multi-step task. Create continuity workspace?

If yes:
1. Create continuity/<task-name>/ directory
2. Generate README with task breakdown
3. Add to .gitignore
4. Link in Linear issue description
```

---

## Requirements

- Tools: Linear MCP, GitHub CLI, GCloud
- Git: Must have `origin` remote configured
- Branch: Uses `development` if exists, else `main`
- Team: `pbuchman` (hardcoded)
- CI: `pnpm run ci:tracked` must pass before PR (unless overridden)
