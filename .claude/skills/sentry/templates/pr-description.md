# PR Description Template for Sentry Fixes

Use this template when creating PRs that fix Sentry issues.

## Template

```markdown
## Summary

Fixes Sentry issue: [{{sentry_issue_id}}]({{sentry_url}})

{{brief_description_of_fix}}

## Root Cause

{{root_cause_analysis}}

## Changes

- {{change_1}}
- {{change_2}}
- {{change_3}}

## Investigation Evidence

{{evidence_summary}}

## Cross-References

- **Sentry Issue:** [{{sentry_issue_id}}]({{sentry_url}})
- **Linear Issue:** Fixes [{{linear_issue_id}}]({{linear_url}})

## Test Plan

- [ ] Verified fix locally
- [ ] Checked similar patterns in codebase
- [ ] `pnpm run ci:tracked` passes
- [ ] Tested edge cases: {{edge_cases}}
```

## Field Descriptions

| Field                    | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `sentry_issue_id`        | Sentry issue identifier                          |
| `sentry_url`             | Full Sentry issue URL                            |
| `brief_description`      | 1-2 sentence summary of what the fix does        |
| `root_cause_analysis`    | Detailed explanation of WHY the bug happened     |
| `change_N`               | Specific code changes made                       |
| `evidence_summary`       | Firestore data, logs, or other investigation data|
| `linear_issue_id`        | Linear issue ID (e.g., `INT-123`)                |
| `linear_url`             | Full Linear issue URL                            |
| `edge_cases`             | Edge cases tested                                |

## Root Cause Section Guidelines

The root cause section should explain:

1. **What was happening**: The actual failure mechanism
2. **Why it was happening**: The underlying cause
3. **How data got into this state**: If data corruption is involved

```
✅ Good root cause:
The `userId` field was undefined because the OAuth callback handler
was not waiting for the user record to be created in Firestore before
redirecting. Race condition between Auth0 webhook and redirect handler.

❌ Bad root cause:
The code wasn't handling null values properly.
```

## Investigation Evidence Guidelines

Include relevant evidence from investigation:

- Firestore document snapshots (redact sensitive data)
- Log entries showing the failure
- Seer analysis output
- Timeline of events

```markdown
## Investigation Evidence

Firestore document at `users/abc123`:
```json
{
  "email": "user@example.com",
  "createdAt": "2026-01-15T10:30:00Z",
  "profile": null  // <-- Missing profile object
}
```

Log entry showing the failure point:
```
2026-01-15T10:30:05Z ERROR TodoService: Cannot read 'preferences' of null
```
```

## Cross-Reference Requirements

**Both Sentry and Linear links are MANDATORY.**

The PR will not be approved without:
1. Link to the original Sentry issue
2. `Fixes INT-XXX` for Linear issue (enables auto-closing)

The `Fixes` keyword in front of the Linear issue ID enables GitHub to automatically transition the Linear issue when the PR is merged.
