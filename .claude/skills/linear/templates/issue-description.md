# Issue Description Template

Standard template for Linear issues created via `/linear <task description>`.

## Template

```markdown
## Original User Instruction

> <verbatim user input here>

_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._

## Summary

<1-2 sentence summary of the task>

## Requirements

- <Requirement 1>
- <Requirement 2>
- <Requirement 3>

## Acceptance Criteria

- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] <Criterion 3>

## Technical Context

<Optional: relevant files, architecture notes, dependencies>

## Related

- <Links to related issues, PRs, or documentation>
```

## Mandatory Sections

| Section                   | Required | Purpose                            |
| ------------------------- | -------- | ---------------------------------- |
| Original User Instruction | Yes      | Preserves verbatim user request    |
| Summary                   | Yes      | Quick overview                     |
| Requirements              | Yes      | What needs to be done              |
| Acceptance Criteria       | Yes      | How to verify completion           |
| Technical Context         | Optional | Background info for implementation |
| Related                   | Optional | Cross-references                   |

## Original User Instruction Rules

**CRITICAL:** This section must:

1. **Preserve exactly** - Include typos, grammatical errors, raw phrasing
2. **No corrections** - Do not fix spelling or grammar
3. **Quote block** - Use `>` blockquote for the instruction
4. **Disclaimer** - Include the italicized note
5. **Position** - ALWAYS at the TOP of the issue description

## Why This Matters

- Preserves the original context and intent
- Allows reviewers to understand the raw user need
- Prevents loss of nuance through summarization
- Creates audit trail of actual requests
