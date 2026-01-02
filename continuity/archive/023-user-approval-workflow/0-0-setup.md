# Tier 0: Setup & Type Definitions

## Status: ✅ COMPLETED

## Objective

Add `awaiting_approval` status to type definitions in both commands-router and web frontend.

## Tasks

- [x] Add `awaiting_approval` to ActionStatus enum in commands-router
- [x] Add `awaiting_approval` to ActionStatus type in web frontend
- [x] Create Action model in actions-agent
- [x] Create ActionRepository port in actions-agent
- [x] Create Firestore ActionRepository implementation in actions-agent

## Files Modified

1. `apps/commands-router/src/domain/models/action.ts` - Added status
2. `apps/web/src/types/index.ts` - Added status

## Files Created

1. `apps/actions-agent/src/domain/models/action.ts` - Action type definition
2. `apps/actions-agent/src/domain/ports/actionRepository.ts` - Repository port
3. `apps/actions-agent/src/infra/firestore/actionRepository.ts` - Firestore implementation

## Verification

- TypeScript compiles without errors
- No breaking changes to existing code

## Notes

- Action type duplicated in both apps (cannot import across apps)
- Firestore repository uses same patterns as commands-router version
- Collection name remains `actions`

## Continuation

**DO NOT STOP.** After completing this task and updating the ledger, immediately proceed to task 2-1-coverage-verification.md without waiting for user input.
