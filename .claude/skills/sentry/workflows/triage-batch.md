# Batch Triage Workflow

**Trigger:** User calls `/sentry` (no args) or `/sentry triage --limit N`

This workflow processes multiple unresolved Sentry issues sequentially, ensuring proper cross-linking and documentation.

## Core Mandates

1. **Fail Fast**: If Sentry, Linear, GitHub, or GCloud authentication/tools are unavailable, STOP immediately
2. **No Guessing**: Surface-level fixes without identifying the _source_ of data corruption are FORBIDDEN
3. **Cross-Linking**: Every Sentry issue MUST be linked to a Linear issue and a GitHub PR
4. **Documentation in PR**: Reasoning belongs in PR comments, not in code comments

## Execution Workflow

### Phase 1: Tool Verification (Fail Fast)

Before processing any issues, verify access to all required tools:

1. **Sentry**: Can you fetch issues?
   ```
   Call: mcp__sentry__whoami
   ```

2. **Linear**: Can you search/create issues?
   ```
   Call: mcp__linear__list_teams
   ```

3. **GitHub**: Can you create PRs?
   ```
   Run: gh auth status
   ```

4. **GCloud**: Is service account authenticated for Firestore access?
   ```
   Check: ~/personal/gcloud-claude-code-dev.json exists
   Run: gcloud auth activate-service-account --key-file=...
   ```

**If ANY of these fail, abort the run immediately with a clear error message.**

### Phase 2: Issue Acquisition

Fetch unresolved issues from configured Sentry projects:

```
Call: mcp__sentry__list_issues
Parameters:
  - organizationSlug: "intexuraos-dev-pbuchman"
  - query: "is:unresolved"
  - sort: "freq"  # Most frequent first
  - limit: <limit-param or 10>
```

Projects to query:
1. `intexuraox-development`
2. `intexuraos-web-development`

### Phase 3: Sequential Processing (The Loop)

Process issues **ONE BY ONE** to avoid duplication and ensure focus.

For each Sentry issue:

#### 3.1: Linear Synchronization

1. **Search Linear**: Look for existing issue matching the Sentry error
   ```
   Call: mcp__linear__list_issues
   Parameters:
     - query: "[sentry] <error-title-substring>"
     - team: "pbuchman"
   ```

2. **Create (if missing)**:
   - **Naming Convention (NON-NEGOTIABLE)**: `[sentry] <short-error-message>`
     - _Example:_ `[sentry] Cannot read property 'id' of undefined in TodoService`
   - **Description**: Use template from `templates/linear-issue.md`

3. **Link**: Record the cross-reference (Sentry → Linear)

**Cross-linking protocol (enforced):**

| Direction        | Method                                   |
| ---------------- | ---------------------------------------- |
| Sentry → Linear  | Comment on Sentry with Linear link       |
| Linear → Sentry  | Link in description                      |
| Linear → GitHub  | When PR created                          |
| GitHub → Linear  | `Fixes INT-XXX` in PR body               |

#### 3.2: Deep Investigation

1. **Branching**: Create a new branch from freshly fetched `development`:
   ```bash
   git fetch origin
   git checkout -b fix/INT-XXX-sentry-<short-id> origin/development
   ```

2. **Root Cause Analysis**:
   - **Analyze Stack Trace**: Don't just look at the line; look at the data flow
   - **Check Data**: Use `gcloud firestore` to inspect actual document state
     - _Failure Condition:_ If you need DB info and cannot get it via `gcloud`, STOP processing this issue and report it
   - **Avoid Misleading Errors**: "Error X" might be a controlled failure for "Condition Y". Document this distinction
   - **Use Seer**: Call `mcp__sentry__analyze_issue_with_seer` for AI-powered analysis

3. **FORBIDDEN**: Do not apply "band-aid" fixes (e.g., `if (!x) return`) without proving _why_ `x` is missing and fixing the upstream cause

#### 3.3: Implementation & PR Creation

1. **Fix**: Apply the code change
2. **Verify**: Run `pnpm run ci:tracked` locally
3. **Push & PR**:
   - Create a GitHub Pull Request
   - **PR Body** (use `templates/pr-description.md`):
     - Link to Sentry Issue
     - Link to Linear Issue (`Fixes INT-XXX`)
     - **Reasoning**: Detailed explanation of investigation findings
     - **Data Evidence**: Output from Firestore checks (redacted if sensitive)
4. **Update Linear**: Transition issue to "In Review"

### Phase 4: Final Report

After processing (or if stopped due to limit), output a summary table:

```markdown
## Sentry Triage Summary

| Sentry Issue          | Linear Issue       | GitHub PR          | Status              |
| :-------------------- | :----------------- | :----------------- | :------------------ |
| [Title](sentry-url)   | [INT-XXX](url)     | [#123](pr-url)     | ✅ Triaged          |
| [Title](sentry-url)   | [INT-YYY](url)     | —                  | 🚧 Blocked (DB)     |
| [Title](sentry-url)   | —                  | —                  | ⏭️ Skipped (known)  |
```

**Status Legend:**
- ✅ Triaged - PR created and linked
- 🚧 Blocked - Investigation incomplete, reason documented
- ⏭️ Skipped - Known/expected warning (see expected-sentry-warnings)
- ❌ Failed - Could not process, error documented

## Failure Conditions

You have **FAILED** if:

1. You apply a fix without a corresponding Linear issue
2. You create a PR without linking Sentry and Linear
3. You fix a "missing value" error by just making it optional, without investigating the data source
4. You proceed despite tool authentication failures
5. You create code comments explaining _why_ the bug happened (put this in the PR!)
