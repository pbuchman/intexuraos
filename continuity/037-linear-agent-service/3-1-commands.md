# Task 3-1: Update Commands-Agent Classification for Linear

## Tier

3 (Integration)

## Context

Actions-agent is configured to handle linear actions. Now update commands-agent to classify messages as 'linear' type.

## Problem Statement

Need to:

1. Add 'linear' to ActionType enum in commands-agent
2. Update classification prompt to detect linear intents
3. Update route schemas

## Scope

### In Scope

- Add linear type to commands-agent models
- Update classification prompt with linear detection rules
- Update route schemas

### Out of Scope

- Web app updates (tier 4)
- Deployment (tier 5)

## Required Approach

1. **Study** `packages/llm-common/src/classification/commandClassifierPrompt.ts`
2. **Add** linear detection rules to prompt
3. **Update** model types in commands-agent
4. **Update tests**

## Step Checklist

- [ ] Update `apps/commands-agent/src/domain/models/action.ts` - Add 'linear' type
- [ ] Update `packages/llm-common/src/classification/commandClassifierPrompt.ts` - Add linear detection
- [ ] Update `apps/commands-agent/src/routes/commandsRoutes.ts` schemas
- [ ] Update `apps/commands-agent/src/infra/actionsAgent/client.ts` type definition
- [ ] Update tests
- [ ] Run workspace verification for both packages

## Definition of Done

- Commands with linear triggers classified as 'linear' type
- All tests pass
- Workspace verification passes

## Verification Commands

```bash
# TypeCheck llm-common
cd packages/llm-common
pnpm run typecheck
cd ../..

# Verify commands-agent
pnpm run verify:workspace:tracked -- commands-agent
```

## Rollback Plan

```bash
git checkout packages/llm-common/src/classification/commandClassifierPrompt.ts
git checkout apps/commands-agent/
```

## Reference Files

- `packages/llm-common/src/classification/commandClassifierPrompt.ts`
- `apps/commands-agent/src/domain/models/action.ts`

## Changes to apps/commands-agent/src/domain/models/action.ts

```typescript
// Update to include 'linear'
export type ActionType = 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear';
```

## Changes to commandClassifierPrompt.ts

Add 'linear' to CommandCategory type:

```typescript
export type CommandCategory =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'linear' // Add this
  | 'unclassified';
```

Update the prompt's CATEGORIES section (insert linear after calendar, before reminder):

```
5. linear: A task or issue to create in Linear (project management)
   - Keywords: "linear", "issue", "ticket", "task in linear", "add to linear"
   - Polish: "do lineara", "nowe zadanie w linear", "dodaj do lineara"
   - Should be a work item, bug report, or feature request
```

Add LINEAR DETECTION section:

```
LINEAR DETECTION (Priority #5):
Classify as "linear" when the message contains:
- Explicit Linear mentions: "linear", "create linear issue", "add to linear"
- Polish equivalents: "do lineara", "nowe zadanie w linear", "dodaj do lineara"
- Task/issue phrasing combined with work context: "new issue", "new ticket", "bug report"

IMPORTANT: Only classify as "linear" when:
- The user explicitly mentions Linear by name, OR
- The context clearly indicates a work/project management task (bug, feature, issue)

Do NOT classify as "linear" when:
- It's a personal todo (use "todo" instead)
- It's a reminder without issue context (use "reminder" instead)

Examples (ENGLISH):
- "create linear issue for dark mode feature" → linear
- "add to linear: fix login bug" → linear
- "new ticket: API rate limiting" → linear
- "bug: mobile menu not working" → linear (work context)
- "buy groceries" → todo (personal task, not linear)

Examples (POLISH):
- "nowe zadanie w linear: napraw walidację" → linear
- "dodaj do lineara bug z logowaniem" → linear
- "zrób zakupy" → todo (not linear)
```

Update priority order in the prompt - linear should be priority #5:

```
CATEGORIES (in priority order - when multiple could apply, use the FIRST matching category):
1. calendar: A time-based event or appointment
2. todo: A task that needs to be done
3. research: A question or topic to research
4. reminder: Something to be reminded about at a specific time
5. linear: A task or issue to create in Linear (project management)
6. note: Information to remember or store
7. link: A URL or reference to save
8. unclassified: Cannot be classified
```

## Changes to route schemas

In `apps/commands-agent/src/routes/commandsRoutes.ts`:

```typescript
enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'linear', 'unclassified'],
```

## Changes to actionsAgent/client.ts

```typescript
type: 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear';
```

## Test updates

Update test files to include 'linear' type in type arrays and add test cases for linear classification.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
