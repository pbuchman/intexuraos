# Parent Issue Ledger Template

Template for parent issues that serve as ledgers during plan splitting.

## Template

````markdown
## Goal

<Overall objective of this multi-step task>

### Success Criteria

- [ ] <High-level success criterion 1>
- [ ] <High-level success criterion 2>
- [ ] <High-level success criterion 3>

## Key Decisions

| Timestamp  | Decision           | Rationale             |
| ---------- | ------------------ | --------------------- |
| YYYY-MM-DD | <decision made>    | <why this was chosen> |
| YYYY-MM-DD | <another decision> | <reasoning>           |

## State Tracking

### Done

- [x] <Completed task 1>
- [x] <Completed task 2>

### Now

- [ ] <Currently in progress>

### Next

- [ ] <Upcoming task 1>
- [ ] <Upcoming task 2>

## Scope

This epic covers:

- <component/service 1>: <what's being done>
- <component/service 2>: <what's being done>
- <component/service 3>: <what's being done>

_Child issues are linked automatically via Linear's parent-child hierarchy._

## Constraints / Assumptions

- <Constraint or assumption 1>
- <Constraint or assumption 2>

## Open Questions

- [ ] <Unresolved question 1>
- [ ] <Unresolved question 2>

## Working Set

**Files:**

- `path/to/file1.ts`
- `path/to/file2.ts`

**Commands:**

```bash
<frequently used commands>
```
````

## Progress Notes

### YYYY-MM-DD

<Progress update, findings, blockers encountered>

### YYYY-MM-DD

<Another update>
```

## Mandatory Sections

| Section          | Required | Purpose                              |
| ---------------- | -------- | ------------------------------------ |
| Goal             | Yes      | What we're trying to achieve         |
| Success Criteria | Yes      | How we know we're done               |
| Key Decisions    | Yes      | Audit trail of choices made          |
| State Tracking   | Yes      | Done/Now/Next status                 |
| Scope            | Yes      | What components/services are covered |
| Constraints      | Optional | Boundaries and assumptions           |
| Open Questions   | Optional | Unresolved items                     |
| Working Set      | Optional | Active files and commands            |
| Progress Notes   | Optional | Timestamped updates                  |

## Ledger Principles

1. **Every action, decision, or reasoning step MUST be logged** — no silent thinking
2. **Major decisions**: Full reasoning with alternatives considered
3. **Standard steps**: One-line summary with outcome
4. **Minor actions**: Batch into single log entry
5. **Always read the ledger before resuming a session**
6. **Update after every subtask or change in plan**
