# Single Issue Triage Workflow

**Trigger:** User calls `/sentry <sentry-url>` or `/sentry ISSUE-ID`

## Input

- Sentry URL (e.g., `https://intexuraos-dev-pbuchman.sentry.io/issues/123/`)
- OR Sentry issue ID (e.g., `INTEXURAOS-DEVELOPMENT-42`)

## Steps

### 1. Parse Input

Extract from URL or ID:
- Organization slug
- Issue ID
- Project slug (if available)

### 2. Fetch Issue Details

```
Call: mcp__sentry__get_issue_details
Parameters:
  - issueUrl: <full-sentry-url>
  OR
  - organizationSlug: "intexuraos-dev-pbuchman"
  - issueId: <issue-id>

Extract:
  - title
  - firstSeen
  - lastSeen
  - count (event count)
  - userCount
  - stacktrace
  - release
  - environment
```

### 3. Get Tag Distribution

For impact analysis, fetch tag distributions:

```
Call: mcp__sentry__get_issue_tag_values
Parameters:
  - issueUrl: <url>
  - tagKey: "url"          # Affected URLs
  - tagKey: "browser"      # Browser distribution
  - tagKey: "environment"  # Environment breakdown
```

This reveals:
- Which endpoints are affected
- Browser-specific issues
- Production vs staging scope

### 4. Check for AI Analysis (Seer)

```
Call: mcp__sentry__analyze_issue_with_seer
Parameters:
  - issueUrl: <url>

Returns:
  - Root cause analysis
  - Specific code fixes
  - File locations and line numbers
```

**Note:** Seer analysis may take 2-5 minutes if not cached.

### 5. Search for Existing Linear Issue

```
Call: mcp__linear__list_issues
Parameters:
  - query: "[sentry] <error-title-substring>"
  - team: "pbuchman"
```

If match found:
- Display existing Linear issue
- Ask: "Use existing issue or create new?"

### 6. Create Linear Issue (if needed)

If no existing issue, offer to create:

```
Call: mcp__linear__create_issue
Parameters:
  - title: "[sentry] <short-error-message>"
  - team: "pbuchman"
  - state: "Backlog"
  - description: See templates/linear-issue.md
  - labels: ["bug", "sentry"]
```

### 7. Update Sentry Issue (if Linear created)

```
Call: mcp__sentry__update_issue
Parameters:
  - issueUrl: <url>
  - status: "unresolved"  # Keep open until fixed
```

Add comment linking to Linear issue (manual step - Sentry MCP doesn't support comments yet).

### 8. Display Investigation Summary

Output format:

```
## Sentry Issue: <title>

**Status:** <status>
**First Seen:** <date> | **Last Seen:** <date>
**Events:** <count> | **Users Affected:** <user-count>

### Stack Trace
<excerpt of relevant frames>

### Impact Analysis
- **URLs Affected:** <list top 3>
- **Browsers:** <distribution>
- **Environment:** <prod/staging>

### Seer Analysis
<root cause summary if available>

### Linked Issues
- **Linear:** [INT-XXX](<url>) <status>
- **GitHub PR:** (none yet)

### Next Steps
1. [ ] Create branch: `fix/INT-XXX-<short-desc>`
2. [ ] Investigate root cause
3. [ ] Implement fix
4. [ ] Create PR with cross-references
```

## Handoff

Ask: "Start working on this issue now?"

If yes: Create branch and proceed with investigation.
