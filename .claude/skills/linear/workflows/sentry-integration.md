# Sentry Integration Workflow

**Trigger:** User calls `/linear https://<sentry-url>`

> **Note:** For comprehensive Sentry triage, AI analysis, and batch processing, use the dedicated `/sentry` skill. This workflow focuses specifically on creating Linear issues from Sentry errors.

## Delegation to Sentry Skill

For advanced operations, delegate to the Sentry skill:

| Operation                  | Use                                     |
| -------------------------- | --------------------------------------- |
| Single issue investigation | `/sentry <sentry-url>`                  |
| AI root cause analysis     | `/sentry analyze <sentry-url>`          |
| Batch triage               | `/sentry` or `/sentry triage --limit N` |
| Create Linear issue only   | This workflow (below)                   |

**Full Sentry documentation:** `.claude/skills/sentry/`

---

## Steps (Create Linear Issue)

### 1. Parse Sentry URL

- Extract organization slug
- Extract issue ID

### 2. Verify Tools

Required tools:

- Linear MCP
- GitHub CLI
- Sentry MCP (`mcp__sentry__whoami`)
- GCloud (for investigation)

### 3. Fetch Sentry Details

```
- Call mcp__sentry__get_issue_details with issueUrl
- Extract: title, stacktrace, frequency, affected users
```

### 4. Search for Existing Linear Issue

```
- Call mcp__linear__list_issues with Sentry title query
- If match found: Ask to use existing or create new
```

### 5. Create Linear Issue

```
- Call mcp__linear__create_issue
- Format: [sentry] <short-error-message>
- Team: "pbuchman"
- State: "Backlog"
- Description includes:
  - Sentry issue link
  - Error context summary
  - Stacktrace excerpt
```

### 6. Add Comment to Sentry Issue (Optional)

If possible, add comment linking to Linear issue.

### 7. Handoff to Work Flow

Ask: "Start working on this issue now?"

If yes: Proceed with [work-existing.md](work-existing.md)

## Sentry Issue Description Template

```markdown
## Sentry Error

**Sentry Issue:** [ISSUE-ID](SENTRY_URL)

### Error Summary

<short description of the error>

### Stacktrace
```

<relevant stacktrace excerpt>
```

### Context

- **Frequency:** X events in Y period
- **Affected Users:** Z users
- **Environment:** production/staging

## Investigation Notes

<space for investigation findings>
```

## Naming Convention

Always use `[sentry]` prefix regardless of error type:

| Example                                          |
| ------------------------------------------------ |
| `[sentry] TypeError: null is not an object`      |
| `[sentry] ReferenceError: x is not defined`      |
| `[sentry] Network request failed in AuthService` |
