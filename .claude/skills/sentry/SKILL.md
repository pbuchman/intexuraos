---
name: sentry
description: |
  Sentry issue triage and investigation with automatic cross-linking.
  Handles issue investigation, AI analysis via Seer, and integration
  with Linear for tracking fixes.

invocation: both

triggers:
  - '/sentry'
  - 'sentry.*issue'
  - 'sentry.*error'
  - "https?://.*sentry\\.io"
  - 'triage.*sentry'

config:
  organization: 'intexuraos-dev-pbuchman'
  projects:
    - 'intexuraos-development'
    - 'intexuraos-web-development'
---

# Sentry Issue Management

Triage, investigate, and resolve Sentry issues with enforced cross-linking to Linear and GitHub.

**Organization:** `intexuraos-dev-pbuchman`

## Usage

```
/sentry                           # NON-INTERACTIVE: Triage unresolved issues
/sentry <sentry-url>              # Investigate specific issue
/sentry INT-123                   # Find Sentry issues linked to Linear issue
/sentry triage --limit 5          # Batch triage with limit
/sentry analyze <sentry-url>      # AI-powered root cause analysis via Seer
```

## Core Mandates

1. **Fail Fast**: If Sentry, Linear, GitHub CLI, or GCloud are unavailable, STOP immediately
2. **No Guessing**: Surface-level fixes without identifying the _source_ of corruption are FORBIDDEN
3. **Cross-Linking**: Every Sentry issue MUST be linked to a Linear issue and GitHub PR
4. **Documentation in PR**: Reasoning belongs in PR descriptions, not code comments
5. **CI Gate**: `pnpm run ci:tracked` MUST pass before PR creation

## Invocation Detection

The skill automatically detects intent from input:

| Input Pattern                 | Type          | Workflow                                                   |
| ----------------------------- | ------------- | ---------------------------------------------------------- |
| `/sentry` (no args)           | Batch Triage  | [triage-batch.md](workflows/triage-batch.md)               |
| `/sentry <sentry-url>`        | Single Issue  | [triage-issue.md](workflows/triage-issue.md)               |
| `/sentry analyze <url>`       | Seer Analysis | [analyze-with-seer.md](workflows/analyze-with-seer.md)     |
| `/sentry linear <sentry-url>` | Create Linear | [create-linear-issue.md](workflows/create-linear-issue.md) |
| `/sentry triage --limit N`    | Limited Batch | [triage-batch.md](workflows/triage-batch.md)               |

## Tool Verification (Fail Fast)

Before ANY operation, verify all required tools:

| Tool       | Verification Command         | Purpose          |
| ---------- | ---------------------------- | ---------------- |
| Sentry MCP | `mcp__sentry__whoami`        | Issue management |
| Linear MCP | `mcp__linear__list_teams`    | Issue tracking   |
| GitHub CLI | `gh auth status`             | PR creation      |
| GCloud     | Service account verification | Firestore access |

### GCloud Verification

**Service account key location:** `~/personal/gcloud-claude-code-dev.json`

1. Check if credentials file exists
2. If `gcloud auth list` shows no active account, activate service account
3. Verify authentication

**You are NEVER "unauthenticated" if the service account key file exists.**

### Failure Handling

If ANY required tool is unavailable, **ABORT immediately**:

```
ERROR: /sentry cannot proceed - <tool-name> unavailable

Required for: <purpose>
Fix: <fix-command>

Aborting.
```

## Configured Projects

Issues are fetched from these Sentry projects:

1. `intexuraos-development` (backend services)
2. `intexuraos-web-development` (web app)

## Cross-Linking Protocol (Critical)

Every Sentry issue must be traceable across all systems:

| Direction       | Method                                          |
| --------------- | ----------------------------------------------- |
| Sentry → Linear | Comment on Sentry with Linear issue link        |
| Linear → Sentry | `[sentry] <title>` naming + link in description |
| Linear → GitHub | PR title contains `INT-XXX`                     |
| GitHub → Linear | `Fixes INT-XXX` in PR body                      |
| GitHub → Sentry | Sentry link in PR description                   |

## References

- Workflows: [`workflows/`](workflows/)
- Templates: [`templates/`](templates/)
- Reference: [`reference/`](reference/)
