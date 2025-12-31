# 1-2: Clean Up infra-notion Package

**Tier**: 1 (Independent Deliverable)
**Dependencies**: 0-0-verify-current-state

## Context

Remove Firestore repository functions from shared `@intexuraos/infra-notion` package, keeping only Notion API client wrapper.

## Problem

Package currently contains both:

1. Notion API client (should stay - shared utility)
2. Firestore repository for connections (should be removed - now in notion-service)

## Scope

**In Scope:**

- Remove all `notionConnection` exports from `index.ts`
- Delete `notionConnection.ts` file
- Delete `__tests__/notionConnection.test.ts`
- Remove `@intexuraos/infra-firestore` dependency from `package.json`

**Out of Scope:**

- Changes to Notion API client (`notion.ts`) - this stays
- Changes to services (handled in 1-0 and 1-1)

## Approach

1. Update `index.ts` to export only Notion API client functions
2. Delete repository file and tests
3. Clean up dependencies

## Steps

- [ ] Update `packages/infra-notion/src/index.ts`
  - Remove all exports related to `notionConnection`
  - Keep only exports from `notion.ts`
- [ ] Delete `packages/infra-notion/src/notionConnection.ts`
- [ ] Delete `packages/infra-notion/src/__tests__/notionConnection.test.ts`
- [ ] Update `packages/infra-notion/package.json`
  - Remove `@intexuraos/infra-firestore` from dependencies
- [ ] Run `npm run ci` for package

## Definition of Done

- `index.ts` exports only Notion API client functions
- `notionConnection.ts` deleted
- No references to Firestore in package
- Package tests pass

## Verification

```bash
# No notionConnection exports
! grep "notionConnection" packages/infra-notion/src/index.ts

# File should be gone
! test -f packages/infra-notion/src/notionConnection.ts

# No Firestore dependency
! grep "infra-firestore" packages/infra-notion/package.json

# Tests pass
npm run test --workspace=@intexuraos/infra-notion
```

## Rollback

```bash
git checkout packages/infra-notion/
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
