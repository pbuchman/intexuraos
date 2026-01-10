# 3-2: Add attributionStatus to Research Model

**Tier:** 3 (Dependent Deliverable)

## Context Snapshot

Add the `attributionStatus` field to the Research model and Firestore repository.

## Codebase Rules

Read `.claude/CLAUDE.md`:

- Each Firestore collection owned by ONE service
- Check `firestore-collections.json` for ownership

## Dependencies

- **Requires:** 3-1-post-processing.md completed (or in parallel)

## Problem Statement

The `attributionStatus` field needs to be:

1. Added to the Research model type
2. Accepted in the repository update method
3. Stored in Firestore

## Files to Modify

| File                                                                      | Action                 |
| ------------------------------------------------------------------------- | ---------------------- |
| `apps/research-agent/src/domain/research/models/Research.ts`            | **MODIFY**             |
| `apps/research-agent/src/infra/research/FirestoreResearchRepository.ts` | **MODIFY** (if needed) |

## Files to Read First

1. `apps/research-agent/src/domain/research/models/Research.ts` — Research type definition
2. `apps/research-agent/src/infra/research/FirestoreResearchRepository.ts` — update method
3. `apps/research-agent/src/domain/research/ports/index.ts` — ResearchRepository interface

## Exact Changes

### In Research Model (`models/Research.ts`)

Find the Research interface and add:

```typescript
export interface Research {
  // ... existing fields ...

  /**
   * Status of source attribution in synthesis output.
   * - complete: All sections have valid Attribution lines
   * - incomplete: Some sections missing or have invalid Attribution lines
   * - repaired: Attribution was fixed by repair pass
   */
  attributionStatus?: 'complete' | 'incomplete' | 'repaired';
}
```

### In ResearchRepository Port (if typed separately)

If there's a separate UpdateResearchInput type, add:

```typescript
interface UpdateResearchInput {
  // ... existing fields ...
  attributionStatus?: 'complete' | 'incomplete' | 'repaired';
}
```

### In FirestoreResearchRepository

The repository likely uses a generic update pattern. Verify it accepts the new field. If it has explicit field mapping, add:

```typescript
// In update method, if fields are mapped explicitly:
...(data.attributionStatus !== undefined && { attributionStatus: data.attributionStatus }),
```

## Type Definition

```typescript
export type AttributionStatus = 'complete' | 'incomplete' | 'repaired';
```

Consider exporting this as a standalone type for reuse.

## Step Checklist

- [ ] Add attributionStatus field to Research interface
- [ ] Add JSDoc comment explaining values
- [ ] Update port interface if needed
- [ ] Update repository if explicit mapping exists
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Field added to Research model
- Type includes all three values
- Repository accepts the field
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
grep -r "attributionStatus" apps/research-agent/src/
```

## Rollback Plan

Remove the field from Research model and related types.

## Non-Negotiable Quality Bar

- Field MUST be optional (existing records don't have it)
- Type MUST be union of three strings exactly
- JSDoc MUST explain what each value means
- No default value in model (undefined is acceptable)
