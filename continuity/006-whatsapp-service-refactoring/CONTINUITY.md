# Continuity Ledger — 006-whatsapp-service-refactoring

## Goal
Deep refactoring of whatsapp-service routes to enforce architecture pattern:
- Routes should ONLY handle input validation, config, and routing
- Business logic must be extracted to domain usecases
- Maintain 90% coverage thresholds (lines, branches, functions, statements)

**Success Criteria:**
1. webhookRoutes.ts reduced to <200 lines (from 1317)
2. Business logic extracted to domain/inbox/usecases/
3. All code easily testable via dependency injection
4. CI passes with 90% coverage thresholds
5. No code duplication

---

## Constraints / Assumptions
- Must maintain existing API contracts (no breaking changes)
- Must keep all existing functionality
- Coverage thresholds: lines=90%, branches=90%, functions=90%, statements=90%
- Follow existing domain structure: domain/inbox/{usecases, models, ports}

---

## Key Decisions

### 2024-12-26: Architecture analysis
**What:** Analyzed webhookRoutes.ts (1317 lines) structure
**Why:** Need to understand extraction boundaries
**Alternatives considered:** 
- Single large usecase (rejected: too monolithic)
- Keep logic in routes (rejected: violates architecture)
**Chosen:** Extract 4 focused usecases + 2 ports

### Extraction Plan:
| Current Function | Target Usecase | Lines |
|-----------------|----------------|-------|
| processWebhookAsync | ProcessIncomingMessageUseCase | ~200 |
| processImageMessage | ProcessImageMessageUseCase | ~200 |
| processAudioMessage | ProcessAudioMessageUseCase | ~150 |
| transcribeAudioAsync | TranscribeAudioUseCase | ~250 |

New ports needed:
- WhatsAppCloudApiPort (media fetching, message sending)
- ThumbnailGeneratorPort (image thumbnail generation)

---

## Reasoning Narrative

**Initial violation:** Started implementing before completing planning phase.
Created two port files prematurely. These must be cleaned up in Tier 0.

**Task decomposition rationale:**
- Tier 0: Cleanup premature work
- Tier 1: Independent usecases (can be done in parallel conceptually)
- Tier 2: Route refactoring depends on usecases + tests
- Tier 3: Verification and archival

---

## State

### Done:
- [x] Analysis of whatsapp-service code structure
- [x] Identified extraction targets
- [x] Created continuity folder
- [x] Created INSTRUCTIONS.md
- [x] Created all issue files (0-0 through 3-1)

### Now:
- [ ] **AWAITING USER CONFIRMATION** to proceed with execution

### Next (pending confirmation):
- [ ] 0-0: Cleanup prematurely created files
- [ ] 1-0: Create ports and models
- [ ] 1-1: Create ProcessImageMessageUseCase
- [ ] 1-2: Create ProcessAudioMessageUseCase
- [ ] 1-3: Create TranscribeAudioUseCase
- [ ] 1-4: Create ProcessIncomingMessageUseCase
- [ ] 2-0: Refactor webhookRoutes.ts
- [ ] 2-1: Add usecase tests
- [ ] 3-0: Coverage verification
- [ ] 3-1: Final cleanup and archival

---

## Open Questions
None currently.

---

## Working Set

**Issue files created:**
- 0-0-cleanup-created-files.md
- 1-0-create-ports-and-models.md
- 1-1-create-process-image-usecase.md
- 1-2-create-process-audio-usecase.md
- 1-3-create-transcribe-audio-usecase.md
- 1-4-create-process-webhook-usecase.md
- 2-0-refactor-webhook-routes.md
- 2-1-add-usecase-tests.md
- 3-0-coverage-verification.md
- 3-1-final-cleanup.md

**Files to modify:**
- apps/whatsapp-service/src/routes/v1/webhookRoutes.ts (1317 lines → target <200)
- apps/whatsapp-service/src/domain/inbox/usecases/ (new files)
- apps/whatsapp-service/src/domain/inbox/ports/ (new ports)
- apps/whatsapp-service/src/services.ts
- apps/whatsapp-service/src/__tests__/ (new test files)

**Commands:**
```bash
npm run ci                    # Full verification
npm run test:coverage         # Coverage check
```
