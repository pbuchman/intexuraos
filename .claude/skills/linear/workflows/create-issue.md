# Create New Issue Workflow

**Trigger:** User calls `/linear <task description>`

## Issue Type Detection

### Automatic Detection

| Pattern                                  | Type          | Prefix       |
| ---------------------------------------- | ------------- | ------------ |
| fix, error, bug, broken, fail, crash     | Bug           | `[bug]`      |
| add, create, implement, support, enhance | Feature       | `[feature]`  |
| refactoring, extract, refactor           | Refactor      | `[refactor]` |
| docs, documentation, readme              | Documentation | `[docs]`     |

### When Ambiguous

**ASK USER** - do not guess. Prompt: "Is this a bug or a feature?"

## Steps

### 1. Tool Verification

Verify Linear, GitHub, GCloud available.

### 2. Issue Type Detection

Detect bug/feature from keywords.

### 3. Ask If Ambiguous

When keywords match both patterns, ask: "Is this a bug or a feature?"

### 4. Create Linear Issue

```
- Call mcp__linear__create_issue
- Format: [bug] <short-description> or [feature] <short-description>
- Team: "pbuchman"
- State: "Backlog"
- Description: MUST start with "Original User Instruction" section
```

### 5. Original User Instruction Section (MANDATORY)

Every issue created from `/linear <task description>` MUST include:

```markdown
## Original User Instruction

> <verbatim user input here>

_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._
```

**Requirements:**
- Preserve exactly - Include typos, grammatical errors, raw phrasing
- No corrections - Do not fix spelling or grammar
- Quote block - Use `>` blockquote for the instruction
- Disclaimer - Include the italicized note
- Position - Place at the TOP of the issue description

### 6. Offer to Start Working

Ask: "Ready to start working on this issue?"

If yes: Transition to [work-existing.md](work-existing.md) flow

### 7. Check for Auto-Splitting

If task appears complex (multiple phases, many checkboxes), ask:
"This appears to be a multi-step task. Split into child issues?"

If yes: Proceed to [plan-splitting.md](plan-splitting.md) **with the issue created in step 4**.
The existing issue becomes the parent (ledger) — do NOT create a new parent issue.

## Issue Naming Conventions

| Type          | Pattern                             | Examples                                              |
| ------------- | ----------------------------------- | ----------------------------------------------------- |
| Bug           | `[bug] <short-error-message>`       | `[bug] Cannot read property 'id' of undefined`        |
| Feature       | `[feature] <action-object-context>` | `[feature] Add OAuth token refresh for calendar`      |
| Sentry        | `[sentry] <error-name>`             | `[sentry] TypeError: null is not an object`           |
| Coverage      | `[coverage][<app>] <description>`   | `[coverage][user-service] Add tests for validation`   |
| Refactoring   | `[refactor] <component-name>`       | `[refactor] Extract shared HTTP client utilities`     |
| Documentation | `[docs] <topic>`                    | `[docs] API authentication flow`                      |

## Title Generation Rules

1. Keep under 80 characters when possible
2. Start with type tag (enforced)
3. Use present tense, imperative mood
4. Be specific about location/context
5. Avoid technical jargon in first 50 chars
