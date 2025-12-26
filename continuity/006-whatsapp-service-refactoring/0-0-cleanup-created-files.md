# 0-0: Cleanup Prematurely Created Files

## Tier
0 (Setup/Cleanup)

## Context
Files were created before proper planning phase. Must be removed to start clean.

## Problem Statement
Two port files were created prematurely:
- `apps/whatsapp-service/src/domain/inbox/ports/thumbnailGenerator.ts`
- `apps/whatsapp-service/src/domain/inbox/ports/whatsappClient.ts`

## Scope
- Remove prematurely created files
- Verify no references exist

## Non-Scope
- Creating replacement files (handled in Tier 1)

## Required Approach
1. Delete both files
2. Run `npm run typecheck` to ensure no broken imports

## Step Checklist
- [ ] Delete `thumbnailGenerator.ts`
- [ ] Delete `whatsappClient.ts`
- [ ] Run typecheck
- [ ] Verify clean state

## Definition of Done
- Files removed
- `npm run typecheck` passes

## Verification Commands
```bash
rm apps/whatsapp-service/src/domain/inbox/ports/thumbnailGenerator.ts
rm apps/whatsapp-service/src/domain/inbox/ports/whatsappClient.ts
npm run typecheck
```

## Rollback Plan
N/A - files should not exist

