# Unified Linear Issue Template

**Agent-Agnostic:** Any agent reading this issue should understand what to do.
**Complete Context:** All information needed for execution must be in the issue.

---

```markdown
## Test Requirements (MANDATORY - implement first)

**Backend Tests (\`apps/<service>/src/**tests**/\`):**

| Test Name | Endpoint/Function | Scenario          | Expected          |
| --------- | ----------------- | ----------------- | ----------------- |
| <name>    | <what is tested>  | <input/condition> | <output/behavior> |
| ...       | ...               | ...               | ...               |

**Frontend Tests (if applicable):**

- <test case 1>
- <test case 2>

---

## Original User Instruction

> <verbatim user input - preserve exactly as received>

-_Preserve typos, grammar, raw phrasing. This is the source of truth._

---

## Summary

<1-2 sentence summary of what needs to be done>

---

## Requirements

### Functional Requirements

- <Requirement 1>
- <Requirement 2>
- <Requirement 3>

### Non-Functional Requirements

- <Performance requirement, if applicable>
- <Security requirement, if applicable>
- <Compatibility requirement, if applicable>

---

## Scope

### In Scope

- <Specific deliverable 1>
- <Specific deliverable 2>
- <Specific file(s) to modify>

### Out of Scope (DO NOT)

- <Explicit exclusion 1>
- <Explicit exclusion 2>
- <Related work that should NOT be included>

---

## Files to Change

**New Files:**

- \`path/to/new/utility.ts\` - <what it does>
- \`path/to/new/utility.test.ts\` - <test coverage>

**Modified Files:**

- \`path/to/existing/file.ts\` - <what changes expected>

**Tests to Add/Modify:**

- \`path/to/test/file.test.ts\` - <what tests needed>

---

## Acceptance Criteria

- [ ] All tests in Test Requirements table pass
- [ ] \`pnpm run ci:tracked\` passes (all 4 checks)
- [ ] PR created with issue ID in title: \`[INT-XXX] Description\`
- [ ] Linear state updated to "In Review"
- [ ] <Specific criterion 1>
- [ ] <Specific criterion 2>
- [ ] <Specific criterion 3>

---

## Dependencies

**Blocked By:**

- [INT-XXX](url) - <why this blocks current work>

**Blocks:**

- [INT-XXX](url) - <what this enables>

---

## Technical Context

<Provide any architecture notes, constraints, or background needed for implementation>

**Example:**

- Uses Firestore collection: \`items\`
- Requires API: \`POST /internal/process\`
- Dependent on: \`@intexuraos/common-types\` package

---

## Related

- **Parent Issue:** [INT-XXX](url)
- **SentryBox:** [Issue Title](url) (if applicable)
- **Documentation:** [Doc Link](url)

---

## Execution Notes (Optional)

<Additional context for execution phase - hints, gotchas, implementation preferences>
```

### Required Sections (All Issues)

| Section                   | Required?   | Validation Rule                                    |
| ------------------------- | ----------- | -------------------------------------------------- |
| Test Requirements         | YES         | Table format, at least 1 test row                  |
| Original User Instruction | YES         | Blockquote format present                          |
| Summary                   | YES         | 1-2 sentences, not empty                           |
| Requirements              | YES         | At least 1 bullet                                  |
| Acceptance Criteria       | YES         | At least 3 checkboxes, includes tests/CI/PR/Linear |
| Scope                     | YES         | In Scope list present                              |
| Files to Change           | Conditional | Required for code changes (New Files + Modified)   |
| Dependencies              | Conditional | Required if blocked/blocks exist                   |
| Technical Context         | Optional    | N/A                                                |
| Related                   | Optional    | N/A                                                |

### Conditional Rules

```
IF issue involves code changes:
  THEN "Files to Modify" is REQUIRED
  AND "Technical Context" is RECOMMENDED

IF issue has dependencies:
  THEN "Dependencies" section is REQUIRED

IF issue is part of parent/child hierarchy:
  THEN "Related" section MUST include parent/child links
```
