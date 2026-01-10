# TASK-03: Remove Deprecated SupportedModel and SYSTEM_DEFAULT_MODELS

## Status: ✅ COMPLETED

## Depends On: TASK-02

## Objective

Remove deprecated exports `SupportedModel` and `SYSTEM_DEFAULT_MODELS` from llm-contract. This will cause compilation errors in consumers that still use them - those errors guide the migration in subsequent tasks.

## Files to Modify

### 1. `packages/llm-contract/src/supportedModels.ts`

**DELETE these lines (approximately lines 148-167):**

```typescript
// DELETE:
/**
 * @deprecated Use ResearchModel instead
 */
export type SupportedModel = ResearchModel;

// DELETE:
/**
 * @deprecated Use specific model category types instead
 */
export const SYSTEM_DEFAULT_MODELS: ResearchModel[] = [
  'gemini-2.5-pro',
  'claude-opus-4-5-20251101',
  'o4-mini-deep-research',
  'gpt-5.2',
  'sonar-pro',
];
```

### 2. `packages/llm-contract/src/index.ts`

**REMOVE from exports:**

```typescript
// DELETE these lines:
export {
  // ...
  SYSTEM_DEFAULT_MODELS, // DELETE
} from './supportedModels.js';

export type {
  // ...
  SupportedModel, // DELETE
} from './supportedModels.js';
```

## Expected Compilation Errors

After this change, running `npm run typecheck` will show errors in:

1. `apps/research-agent/src/domain/research/models/Research.ts` - imports SupportedModel
2. `apps/research-agent/src/domain/research/models/index.ts` - re-exports SupportedModel
3. `apps/research-agent/src/routes/researchRoutes.ts` - imports SupportedModel
4. `apps/research-agent/src/routes/internalRoutes.ts` - imports SupportedModel
5. `apps/commands-router/src/domain/events/actionCreatedEvent.ts` - imports SupportedModel
6. `apps/commands-router/src/domain/ports/classifier.ts` - imports SupportedModel
7. `apps/commands-router/src/infra/gemini/classifier.ts` - imports SupportedModel
8. `apps/actions-agent/src/domain/models/actionEvent.ts` - imports SupportedModel
9. `apps/actions-agent/src/domain/ports/researchServiceClient.ts` - imports SupportedModel

These errors are intentional and will be fixed in TASK-04 through TASK-06.

## Validation

```bash
# This WILL fail - that's expected
npm run typecheck -w @intexuraos/llm-contract

# Record the errors for tracking
npm run typecheck 2>&1 | grep "SupportedModel" | wc -l
```

## Acceptance Criteria

- [ ] `SupportedModel` type removed from supportedModels.ts
- [ ] `SYSTEM_DEFAULT_MODELS` constant removed from supportedModels.ts
- [ ] Both removed from index.ts exports
- [ ] Package typecheck passes (llm-contract itself)
- [ ] Full typecheck fails with expected SupportedModel errors
