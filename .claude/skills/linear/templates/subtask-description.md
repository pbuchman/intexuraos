# Subtask Description Template

Template for child issues created during plan splitting.

## Template

```markdown
## Context

Part of: [Parent Title](PARENT_ISSUE_URL)
Tier: X | Sequence: Y

## Scope

<Extracted from parent plan - what this specific task covers>

## Requirements

- <Specific requirement 1>
- <Specific requirement 2>

## Acceptance Criteria

- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] <Criterion 3>

## Dependencies

**Blocked By:**
- [INT-XXX](url) - <dependency description>

**Blocks:**
- [INT-XXX](url) - <what this enables>

## Verification Commands

```bash
<commands to verify this task is complete>
```

## Notes

<Implementation hints, gotchas, or context from parent plan>

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next unblocked task without waiting for user input.
```

## Mandatory Sections

| Section              | Required | Purpose                                    |
| -------------------- | -------- | ------------------------------------------ |
| Context              | Yes      | Links to parent, shows tier/sequence       |
| Scope                | Yes      | What this specific task covers             |
| Requirements         | Yes      | Specific deliverables                      |
| Acceptance Criteria  | Yes      | How to verify completion                   |
| Dependencies         | Yes      | What blocks this / what this blocks        |
| Verification         | Yes      | Commands to run                            |
| Continuation         | Varies   | Include for all except final task          |

## Tier Context Line

Always include tier and sequence in context section:

```markdown
Tier: 0 | Sequence: 1
```

This helps quickly identify:
- **Tier 0**: Setup/prerequisite work
- **Tier 1**: Independent deliverables
- **Tier 2**: Integration work
- **Tier 3+**: Verification/finalization

## Continuation Directive

**Include for all subtasks EXCEPT the final one.**

The continuation directive ensures uninterrupted execution through the entire task series. The final task omits this to allow natural completion and user review.

```markdown
---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next unblocked task without waiting for user input.
```
