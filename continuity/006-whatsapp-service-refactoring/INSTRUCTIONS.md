# Process Manual — 006-whatsapp-service-refactoring

## Overview

Deep refactoring of whatsapp-service to enforce architecture pattern:
- Routes handle input validation and routing ONLY
- Business logic extracted to domain usecases
- Maintain 90% coverage thresholds

## Folder Structure

```
continuity/006-whatsapp-service-refactoring/
├── CONTINUITY.md          # Progress ledger
├── INSTRUCTIONS.md        # This file
├── 0-0-cleanup-created-files.md
├── 1-0-create-ports-and-models.md
├── 1-1-create-process-image-usecase.md
├── 1-2-create-process-audio-usecase.md
├── 1-3-create-transcribe-audio-usecase.md
├── 1-4-create-process-webhook-usecase.md
├── 2-0-refactor-webhook-routes.md
├── 2-1-add-usecase-tests.md
├── 3-0-coverage-verification.md
└── 3-1-final-cleanup.md
```

## Issue Numbering

Format: `[tier]-[sequence]-[title].md`

- **Tier 0**: Setup/cleanup tasks
- **Tier 1**: Independent deliverables (usecases, ports)
- **Tier 2**: Dependent deliverables (routes refactor, tests)
- **Tier 3**: Verification and cleanup

## Execution Process

1. Execute tasks in tier order (0 → 1 → 2 → 3)
2. Within a tier, execute in sequence order
3. After each task: update CONTINUITY.md (Done/Now/Next)
4. Run `npm run ci` after each significant change
5. If CI fails: fix before proceeding

## Resume Procedure

1. Read CONTINUITY.md to find current state
2. Continue from "Now" task
3. Update ledger after each step

## Definition of Done

- [ ] All usecases extracted from webhookRoutes.ts
- [ ] webhookRoutes.ts < 200 lines
- [ ] All new code has tests
- [ ] `npm run ci` passes with 90% coverage thresholds
- [ ] No breaking API changes

