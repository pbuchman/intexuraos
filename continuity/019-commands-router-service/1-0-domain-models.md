# 1-0 Domain Models

## Tier

1 (Independent)

## Context

Define Command and Action domain models with TypeScript types.

## Problem

Need typed models for commands (incoming) and actions (classified).

## Scope

- Command model with status, classification, timestamps
- Action model with type, confidence, status
- Type guards and factory functions

## Non-Scope

- Repository implementation
- Database schema

## Approach

1. Create `domain/models/command.ts`
2. Create `domain/models/action.ts`
3. Export from index files

## Data Models

### Command

```typescript
type CommandSourceType = 'whatsapp_text' | 'whatsapp_voice';
type CommandStatus = 'received' | 'classified' | 'failed';
type CommandType = 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'unclassified';

interface CommandClassification {
  type: CommandType;
  confidence: number;
  classifiedAt: string;
}

interface Command {
  id: string;
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  timestamp: string;
  status: CommandStatus;
  classification?: CommandClassification;
  actionId?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Action

```typescript
type ActionType = 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder';
type ActionStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface Action {
  id: string;
  userId: string;
  commandId: string;
  type: ActionType;
  confidence: number;
  title: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

## Checklist

- [ ] Command model with all fields
- [ ] Action model with confidence field
- [ ] Type exports
- [ ] Factory functions (createCommand, createAction)

## Definition of Done

Models compile, types exported, ready for repository implementation.

## Verification

```bash
npm run typecheck --workspace=@intexuraos/commands-router
```

## Rollback

Delete model files.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
