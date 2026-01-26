# Issue Description Template

Standard template for Linear issues created via `/linear <task description>`.

## Template

```markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests (`apps/<service>/src/__tests__/`):**

| Test        | Endpoint/Function | Scenario          | Expected          |
| ----------- | ----------------- | ----------------- | ----------------- |
| <test name> | <what is tested>  | <input/condition> | <output/behavior> |
| ...         | ...               | ...               | ...               |

**Frontend Tests (if applicable - optional per CLAUDE.md):**

- <test case 1>
- <test case 2>

---

## Original User Instruction

> <verbatim user input here>

_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._

---

## Summary

<1-2 sentence summary of the task>

## Requirements

- <Requirement 1>
- <Requirement 2>
- <Requirement 3>

## Acceptance Criteria

- [ ] All tests in Test Requirements table pass
- [ ] <Criterion 1>
- [ ] <Criterion 2>
- [ ] <Criterion 3>

## Technical Context

<Optional: relevant files, architecture notes, dependencies>

## Related

- <Links to related issues, PRs, or documentation>
```

## Mandatory Sections

| Section                   | Required | Purpose                                     |
| ------------------------- | -------- | ------------------------------------------- |
| Test Requirements         | Yes      | **QUALITY GATE** - exact tests to implement |
| Original User Instruction | Yes      | Preserves verbatim user request             |
| Summary                   | Yes      | Quick overview                              |
| Requirements              | Yes      | What needs to be done                       |
| Acceptance Criteria       | Yes      | How to verify completion (includes tests)   |
| Technical Context         | Optional | Background info for implementation          |
| Related                   | Optional | Cross-references                            |

## Test Requirements Rules

**CRITICAL:** The Test Requirements section is a QUALITY GATE. Issues without it are incomplete.

1. **Position**: MUST be the FIRST section (before Original User Instruction)
2. **Format**: Use table format for backend tests (Test | Endpoint | Scenario | Expected)
3. **Specificity**: List EXACT test cases, not vague "add tests for X"
4. **Coverage**: Include happy path, error cases, edge cases, auth scenarios
5. **Frontend**: Optional per CLAUDE.md, but list if applicable

### Example Test Requirements

```markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests (`apps/linear-agent/src/__tests__/`):**

| Test                | Endpoint            | Scenario                 | Expected         |
| ------------------- | ------------------- | ------------------------ | ---------------- |
| DELETE success      | `DELETE /items/:id` | Valid ID, user owns item | 204 No Content   |
| DELETE not found    | `DELETE /items/:id` | Non-existent ID          | 404 Not Found    |
| DELETE unauthorized | `DELETE /items/:id` | User doesn't own item    | 404 Not Found    |
| DELETE no auth      | `DELETE /items/:id` | Missing auth token       | 401 Unauthorized |
```

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
