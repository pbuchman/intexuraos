# Linear Issue Management

Manage Linear issues, branches, and PRs with enforced workflow and cross-linking.

## Usage

```
/linear                           # NON-INTERACTIVE: Pick random Backlog issue, work on it WITHOUT asking
/linear <task description>        # Create new issue
/linear LIN-123                   # Work on existing issue
/linear <sentry-url>              # Create issue from Sentry error
```

**CRITICAL:** When `/linear` is called WITHOUT arguments, it operates in **NON-INTERACTIVE MODE**:

- NEVER ask the user for confirmation or what to do
- Automatically pick a random task from Backlog/Todo
- If no tasks available, state "No items in Backlog or Todo state." and exit
- If task cannot be completed (auth failure, missing info), create a PR explaining the blocker and proceed

---

## Non-Interactive Mode Contract (CRITICAL)

**When invoked as:** `claude --dangerously-skip-permissions linear` (or any `/linear` with no arguments)

| Rule             | Description                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| **NO PROMPTS**   | Never ask "what should I do?", "which task?", or "ready to start?"                                |
| **AUTO-PROCEED** | Always proceed with the selected Backlog/Todo item automatically                                  |
| **NO TASKS**     | If Backlog/Todo is empty, print message and exit gracefully                                       |
| **BLOCKER PR**   | If task cannot be completed (auth, missing info), create PR with explanation and consider it done |

**The command is designed for automated/cron usage. It MUST NOT block on user input.**

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

| Input Pattern                   | Type                             | Action                                                       |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `/linear` (no args)             | Random Backlog (NON-INTERACTIVE) | Pick from Backlog/Todo and start working WITHOUT asking user |
| `/linear <task description>`    | Create New                       | Detect bug/feature, create issue, start working              |
| `/linear LIN-<number>`          | Work Existing                    | Start working on specific issue                              |
| `/linear https://sentry.io/...` | Sentry Integration               | Create Linear issue from Sentry error                        |

---

## Issue Type Detection

### Automatic Detection

| Pattern                                  | Type          | Prefix       |
| ---------------------------------------- | ------------- | ------------ |
| fix, error, bug, broken, fail, crash     | Bug           | `[bug]`      |
| add, create, implement, support, enhance | Feature       | `[feature]`  |
| refactoring, extract, refactor           | Refactor      | `[refactor]` |
| docs, documentation, readme              | Documentation | `[docs]`     |

### When Ambiguous

**ASK USER** - do not guess. Prompt: "Is this a bug or a feature?"

### Cron Mode (Non-Interactive)

**MANDATORY:** When `/linear` is called WITHOUT arguments (e.g., `claude --dangerously-skip-permissions linear`):

1. **NEVER ask the user what to do** - proceed automatically with random Backlog task
2. **NEVER ask for confirmation** - no "Ready to start?" or "Continue?" prompts
3. If no Backlog/Todo items exist: state "No items in Backlog or Todo state." and exit
4. If task cannot be completed (auth failure, missing info, blockers):
   - Create a PR with explanation of the blocker
   - The PR with reasoning is considered sufficient deliverable
   - Proceed to next steps (branch push, PR creation, state update)
5. Log all actions to stdout for observability

### Sentry Issues

Always use `[sentry]` prefix regardless of content.

---

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools are available.

### Required Tools

| Tool       | Verification Command             | Purpose          |
| ---------- | -------------------------------- | ---------------- |
| Linear MCP | `mcp__linear-server__list_teams` | Issue management |
| GitHub CLI | `gh auth status`                 | PR creation      |
| GCloud     | See GCloud Verification below    | Firestore access |

### GCloud Verification (MANDATORY)

**RULE:** NEVER claim "gcloud is not authenticated" without first verifying service account credentials.

**Service account key location:** `~/personal/gcloud-claude-code-dev.json`

**Verification steps (in order):**

1. Check if credentials file exists:

   ```bash
   ls -la ~/personal/gcloud-claude-code-dev.json
   ```

2. If `gcloud auth list` shows no active account, activate service account:

   ```bash
   gcloud auth activate-service-account --key-file=~/personal/gcloud-claude-code-dev.json
   ```

3. Verify authentication:
   ```bash
   gcloud auth list
   ```

**You are NEVER "unauthenticated" if the service account key file exists.** Activate it and proceed.

### Optional Tools

| Tool       | Verification          | When Needed          |
| ---------- | --------------------- | -------------------- |
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

```
ERROR: /linear cannot proceed - GCloud not authenticated

Required for: Firestore access
Fix: Run 'gcloud auth activate-service-account --key-file=~/personal/gcloud-claude-code-dev.json'

Aborting.
```

---

## GitHub Integration Requirements (CRITICAL)

Linear's GitHub integration **automatically attaches PRs to issues** when specific naming conventions are followed.

### Required Conditions

For a PR to appear as an attachment in Linear's UI:

1. **Branch name must contain the Linear issue ID** (e.g., `fix/LIN-123`, `feature/PBU-44-add-tests`)
2. **PR title must contain the Linear issue ID** (e.g., `[LIN-123] Fix auth`, `PBU-44: Add tests`)

### What Happens When Conditions Are Met

- PR automatically appears in Linear issue's `attachments` array
- Issue state transitions automatically: `In Progress` → `In Review` → `Done`
- Bidirectional link established (click PR from Linear, see issue from GitHub)

### What Happens When Conditions Are NOT Met

- PR does NOT attach to Linear issue
- Only manual comment with PR URL (not visible as attachment)
- No automatic state transitions

### Example: PBU-42 vs PBU-44

- **PBU-42**: Branch `coverage/PBU-42-...`, PR title `[PBU-42] ...` → PR in `attachments` array ✅
- **PBU-44**: Branch `fix/coverage-web-agent-...` (no issue ID), PR title without issue ID → Only comment link ❌

**Always verify after PR creation:** Check Linear issue has PR under "Pull requests" section. If missing, the naming convention wasn't followed.

---

## Workflow: Random Backlog (Cron Mode)

### Trigger

User calls `/linear` with no arguments.

### NON-INTERACTIVE CONTRACT (MANDATORY)

**This mode operates WITHOUT user interaction. The following rules are absolute:**

1. **NEVER ask "what should I do?"** - proceed with selected task automatically
2. **NEVER ask for confirmation** - no "Ready to start?" or "Continue?" prompts
3. **NEVER ask "which branch?"** - use logic: `origin/development` if exists, else `origin/main`
4. **If task cannot be completed** (auth failure, missing info, unclear requirements):
   - Create a PR explaining the blocker
   - The PR serves as the deliverable documenting what needs to be resolved
   - Include all investigation findings in the PR body
   - Update Linear state to "In Review" and move on

### Selection Algorithm

1. List issues where `state` is `"Backlog"` OR `"Todo"`
2. Filter to `team: "pbuchman"`
3. Sort by `priority` (High → Low) then `createdAt` (newest first)
4. Pick first result
5. **If no items found:** Print "No items in Backlog or Todo state." and exit

### Execution

```
1. Verify tools (Linear, GitHub, GCloud) - fail fast if unavailable
2. Fetch selected issue details
3. Update Linear state to "In Progress"
4. Create branch from origin/development (or origin/main)
5. Implement the task (investigate, code, test)
6. Run CI gate: pnpm run ci:tracked
7. Create PR with cross-links (or PR explaining blocker if task uncompletable)
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

**NON-INTERACTIVE:** Exit gracefully with message: "No items in Backlog or Todo state."

- Do NOT ask to create a new issue
- Do NOT ask what to do instead
- Simply print the message and exit

---

## Original User Instruction (MANDATORY)

**RULE:** Every Linear issue created from `/linear <task description>` MUST include the original user instruction verbatim.

### Format

```markdown
## Original User Instruction

> <verbatim user input here>

_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._
```

### Requirements

1. **Preserve exactly** - Include typos, grammatical errors, raw phrasing
2. **No corrections** - Do not fix spelling or grammar
3. **Quote block** - Use `>` blockquote for the instruction
4. **Disclaimer** - Include the italicized note about verbatim transcription
5. **Position** - Place at the TOP of the issue description

### Why This Matters

- Preserves the original context and intent
- Allows reviewers to understand the raw user need
- Prevents loss of nuance through summarization
- Creates audit trail of actual requests

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
   - Description: **MUST start with "Original User Instruction" section** (see above), then include task context

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

7. **Create PR** (CRITICAL: Title MUST include issue ID)

   ```bash
   git push -u origin fix/LIN-123
   gh pr create --base development \
                --title "[LIN-123] Issue title" \
                --body "<PR template>"
   ```

   **MANDATORY:** PR title MUST contain the Linear issue ID (e.g., `[LIN-123]`, `LIN-123:`, etc.)
   - This enables GitHub integration to automatically attach PR to Linear issue
   - PR appears in `attachments` array (visible in UI), not just as comment
   - Branch name must also contain the issue ID (already enforced)

8. **Update Linear**
   - Set state to "In Review"
   - GitHub integration automatically attaches PR (verify in `attachments` array)
   - Only add comment if attachment is missing (fallback)

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

| Trigger                                    | From         | To          | Action                              |
| ------------------------------------------ | ------------ | ----------- | ----------------------------------- |
| `/linear LIN-123` called                   | Backlog/Todo | In Progress | Create branch with issue ID in name |
| `gh pr create` called (title has issue ID) | In Progress  | In Review   | GitHub integration auto-attaches PR |
| PR approved                                | In Review    | Done        | Close Linear issue                  |
| PR has review changes                      | In Review    | In Progress | Update Linear state                 |

**Note:** GitHub integration only works when BOTH branch name AND PR title contain the Linear issue ID (e.g., `LIN-123`, `PBU-44`).

---

## Cross-Linking Protocol

All issues must be linked between systems.

### GitHub Integration (Automatic Attachment)

**CRITICAL:** For PRs to appear as attachments in Linear UI (visible in `attachments` array):

1. **Branch name MUST contain Linear issue ID** - e.g., `fix/LIN-123`, `feature/PBU-44-...`
2. **PR title MUST contain Linear issue ID** - e.g., `[LIN-123] Fix auth`, `PBU-44: Add tests`

When both conditions are met:

- GitHub integration **automatically attaches PR** to Linear issue
- PR appears in `attachments` array (visible in Linear UI under "Pull requests" section)
- Issue state automatically updates: `In Progress` → `In Review` → `Done`
- **No manual comment needed** - attachment is the canonical link

**Verification:** After creating PR, check Linear issue has PR in `attachments` array. If missing, the title or branch name didn't contain the issue ID.

| Direction       | Method                                                             |
| --------------- | ------------------------------------------------------------------ |
| Linear → GitHub | PR title contains `LIN-XXX` (enables auto-attachment)              |
| GitHub → Linear | GitHub integration attaches PR (when title + branch have issue ID) |
| Linear → GitHub | `Fixes LIN-XXX` in PR body (for issue closing behavior)            |
| Sentry → Linear | `[sentry] <title>` naming + link in description                    |
| Linear → Sentry | Comment on Sentry issue                                            |

**Why Comments Don't Work:** Adding PR URL as comment only adds text - it doesn't create the attachment relationship. The GitHub integration requires the issue ID in both branch name AND PR title to establish the bidirectional link.

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

**In INTERACTIVE mode (user provided arguments):**

1. Report the failure clearly
2. Show which step failed (typecheck/lint/tests)
3. Show `.claude/ci-failures/` content if available
4. Ask: "CI failed. Fix and retry, or explicitly override to proceed anyway?"

**In NON-INTERACTIVE mode (`/linear` called without arguments):**

1. Report the failure clearly
2. Show which step failed (typecheck/lint/tests)
3. Create PR with CI failure details in the body
4. Proceed with PR creation - the PR documenting the CI failure is the deliverable
5. Do NOT retry, do NOT wait for user input

### Override Only When

User explicitly says one of (INTERACTIVE mode only):

- "override ci"
- "skip ci check"
- "proceed anyway"
- "ci is known to fail, continue"

### PR Creation Checklist

- [ ] `pnpm run ci:tracked` passes OR user explicitly overridden
- [ ] Branch created from correct base
- [ ] Branch name contains Linear issue ID (e.g., `fix/LIN-123`, `feature/PBU-44-add-tests`)
- [ ] PR title contains Linear issue ID (e.g., `[LIN-123] Fix auth`, `PBU-44: Add tests`)
- [ ] All commits made
- [ ] PR description complete with all sections
- [ ] PR appears in Linear issue's `attachments` array (verify after creation)

---

## Branch Naming Conventions

| Issue Type    | Branch Pattern     | Example                   |
| ------------- | ------------------ | ------------------------- |
| Bug           | `fix/LIN-XXX`      | `fix/LIN-42`              |
| Feature       | `feature/LIN-XXX`  | `feature/LIN-42`          |
| Sentry        | `fix/sentry-XXX`   | `fix/sentry-INTEXURAOS-4` |
| Refactor      | `refactor/LIN-XXX` | `refactor/LIN-42`         |
| Documentation | `docs/LIN-XXX`     | `docs/LIN-42`             |

---

## Issue Naming Conventions

| Type          | Pattern                             | Examples                                                      |
| ------------- | ----------------------------------- | ------------------------------------------------------------- |
| Bug           | `[bug] <short-error-message>`       | `[bug] Cannot read property 'id' of undefined in TodoService` |
| Feature       | `[feature] <action-object-context>` | `[feature] Add OAuth token refresh for calendar service`      |
| Sentry        | `[sentry] <error-name>`             | `[sentry] TypeError: null is not an object in AuthService`    |
| Coverage      | `[coverage][<app>] <description>`   | `[coverage][user-service] Add tests for token validation`     |
| Refactoring   | `[refactor] <component-name>`       | `[refactor] Extract shared HTTP client utilities`             |
| Documentation | `[docs] <topic>`                    | `[docs] API authentication flow`                              |

### Title Generation Rules

1. Keep under 80 characters when possible
2. Start with type tag (enforced)
3. Use present tense, imperative mood
4. Be specific about location/context
5. Avoid technical jargon in first 50 chars

### Issue Description Template

```markdown
## Original User Instruction

> <verbatim user input - preserve typos and raw phrasing>

_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._

## Summary

<1-2 sentence summary of the task>

## Requirements

<Bulleted list of specific requirements>

## Acceptance Criteria

- [ ] <Criterion 1>
- [ ] <Criterion 2>
```

---

## Edge Cases and Error Handling

| Edge Case              | Detection                                     | Handling                                    |
| ---------------------- | --------------------------------------------- | ------------------------------------------- |
| Issue already exists   | Search Linear for matching title/desc         | Link to existing, don't duplicate           |
| Ambiguous bug/feature  | Keywords match both patterns                  | Ask user to clarify                         |
| No development branch  | `git ls-remote` returns empty for development | Fall back to `main`                         |
| Unauthenticated gh     | `gh auth status` fails                        | Instruct user to run `gh auth login`        |
| Linear MCP unavailable | MCP tool call throws error                    | Suggest manual Linear creation              |
| Sentry URL malformed   | URL doesn't match Sentry pattern              | Ask for correct URL or issue ID             |
| Issue in wrong state   | Current state != expected for operation       | Confirm with user before proceeding         |
| Branch already exists  | `git branch` shows matching branch            | Ask to checkout existing or create new name |

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
