# 1-1 Firestore Repositories

## Tier

1 (Independent)

## Context

Implement Firestore repositories for Commands and Actions with idempotency.

## Problem

Need persistent storage with idempotent command creation.

## Scope

- CommandRepository: save, get, update, list
- ActionRepository: save, get, list
- Idempotency check using document ID = `sourceType:externalId`

## Non-Scope

- Pagination (simple list for MVP)
- Complex queries

## Approach

1. Create port interfaces in `domain/ports/`
2. Create Firestore implementations in `infra/firestore/`
3. Collections: `commands`, `actions`

## Files

- `domain/ports/commandRepository.ts`
- `domain/ports/actionRepository.ts`
- `infra/firestore/commandRepository.ts`
- `infra/firestore/actionRepository.ts`

## Checklist

- [ ] Port interfaces defined
- [ ] Firestore command repository
- [ ] Firestore action repository
- [ ] Idempotency: getById before create
- [ ] Update services.ts with repositories

## Definition of Done

Repositories can save/retrieve commands and actions from Firestore.

## Verification

```bash
npm run typecheck --workspace=@intexuraos/commands-router
```

## Rollback

Delete repository files.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
