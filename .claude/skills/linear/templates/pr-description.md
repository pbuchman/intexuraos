# PR Description Template

Use this exact structure for all PRs created via the Linear workflow.

## Template

```markdown
## Context

Addresses: [INT-XXX](LINEAR_ISSUE_URL)

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

- **Linear Issue**: [INT-XXX](LINEAR_URL)
- **Sentry Issue** (if applicable): [Issue Title](SENTRY_URL)

---

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Required Sections

| Section              | Required | Purpose                                   |
| -------------------- | -------- | ----------------------------------------- |
| Context              | Yes      | Links to Linear issue                     |
| What Changed         | Yes      | Brief summary of changes                  |
| Reasoning            | Yes      | Explains the "why" behind decisions       |
| Investigation        | If any   | Data collected during investigation       |
| Key Decisions        | If any   | Important choices made                    |
| Testing              | Yes      | Verification checklist                    |
| Cross-References     | Yes      | Links to all related systems              |
| Co-Authored-By       | Yes      | Attribution for AI assistance             |

## Heredoc Usage

When creating PR via `gh pr create`, use HEREDOC for body:

```bash
gh pr create --title "[INT-123] Issue title" --body "$(cat <<'EOF'
## Context

Addresses: [INT-123](https://linear.app/...)

## What Changed

<changes>

...

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```
