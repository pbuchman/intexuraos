# Create New Issue Workflow

**Trigger:** User calls `/linear <task description>`

---

## Verbose Transition Logging (MANDATORY)

```
📋 CREATE: Parsing task description...
🔍 DETECT: Keywords ["add", "implement"] → type: feature
📋 CREATED: INT-XXX "[feature] <title>"
📍 STATE: Backlog
📋 SPLIT: Detected 3 phases, asking user about splitting...
🔀 ROUTING: User confirmed split → delegating to plan-splitting.md (full handoff)
```

Or if simple:

```
📋 CREATE: Parsing task description...
🔍 DETECT: Keywords ["fix", "bug"] → type: bug
📋 CREATED: INT-XXX "[bug] <title>"
📍 STATE: Backlog
📋 SPLIT: No splitting needed (simple task)
⏹️ STOPPING: Issue created. No execution keywords detected.
```

---

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
- Team: "IntexuraOS" (ALWAYS use this exact name)
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

### 6. Check for Auto-Splitting

> **Why splitting comes before execution intent:** Even if user says "implement now", complex tasks should be split first. A multi-step feature with execution keywords still needs proper breakdown. Splitting ensures quality; execution intent just controls timing.

If task appears complex (multiple phases, many checkboxes), ask:
"This appears to be a multi-step task. Split into child issues?"

**If yes:** This is a **FULL HANDOFF** to [plan-splitting.md](plan-splitting.md):

- Pass the issue created in Step 4
- The existing issue becomes the parent (ledger)
- **Step 7 does NOT run** — splitting is Phase 1 design work
- After splitting completes → STOP (user re-invokes for execution)

**If no (or not complex):** Continue to Step 7.

**Output (verbose logging):**

```
📋 CREATED: INT-XXX "[type] <title>"
📍 STATE: Backlog
📋 SPLIT: Detected 3 phases, asking user about splitting...
🔀 ROUTING: User confirmed split → delegating to plan-splitting.md (full handoff)
```

Or if not complex:

```
📋 CREATED: INT-XXX "[type] <title>"
📍 STATE: Backlog
📋 SPLIT: No splitting needed (simple task) → continuing to Step 7
```

### 7. Execution Intent Detection (Only if NOT split)

**Check if user's description contains explicit execution keywords:**

| Keywords Found                                        | Action                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "implement", "execute", "work on", "build", "fix now" | Ask: "Start working immediately?" → If yes, transition to [work-existing.md](work-existing.md) |
| No execution keywords                                 | **STOP.** Issue created. Do not offer to work on it.                                           |

**Output (verbose logging):**

```
🔀 ROUTING: Creation complete. No execution keywords detected. Stopping.
```

Or if execution keywords present:

```
🔀 ROUTING: Execution keywords detected ("implement"). Asking user to confirm.
```

## Issue Naming Conventions

| Type          | Pattern                             | Examples                                            |
| ------------- | ----------------------------------- | --------------------------------------------------- |
| Bug           | `[bug] <short-error-message>`       | `[bug] Cannot read property 'id' of undefined`      |
| Feature       | `[feature] <action-object-context>` | `[feature] Add OAuth token refresh for calendar`    |
| Sentry        | `[sentry] <error-name>`             | `[sentry] TypeError: null is not an object`         |
| Coverage      | `[coverage][<app>] <description>`   | `[coverage][user-service] Add tests for validation` |
| Refactoring   | `[refactor] <component-name>`       | `[refactor] Extract shared HTTP client utilities`   |
| Documentation | `[docs] <topic>`                    | `[docs] API authentication flow`                    |

## Title Generation Rules

1. Keep under 80 characters when possible
2. Start with type tag (enforced)
3. Use present tense, imperative mood
4. Be specific about location/context
5. Avoid technical jargon in first 50 chars

## Forbidden Actions

| Action                    | Why Forbidden                             |
| ------------------------- | ----------------------------------------- |
| Setting assignee/delegate | User-only responsibility. Blocked by hook |
