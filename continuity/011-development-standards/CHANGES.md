# Changes Log

## Phase 1: COMPLETED

### Standard 2: Hard Cross-App Isolation

**Status:** ✅ IMPLEMENTED

#### Files Modified

- `eslint.config.js` - Replaced hardcoded app list with pattern-based regex

#### Details

Replaced 6 individual app patterns with 3 pattern-based rules:

- `@intexuraos/*-service` - Matches all service apps automatically
- `@intexuraos/web` - Matches the web app
- `@intexuraos/api-docs-hub` - Matches the docs hub

This ensures new services following the naming convention are automatically blocked
without requiring ESLint config changes.

---

### Standard 3 & 4: Notion-Service Domain Introduction (Task 3.5)

**Status:** ✅ IMPLEMENTED

#### Files Created

- `apps/notion-service/src/domain/integration/index.ts`
- `apps/notion-service/src/domain/integration/ports/index.ts`
- `apps/notion-service/src/domain/integration/ports/ConnectionRepository.ts`
- `apps/notion-service/src/domain/integration/usecases/index.ts`
- `apps/notion-service/src/domain/integration/usecases/connectNotion.ts`
- `apps/notion-service/src/domain/integration/usecases/getNotionStatus.ts`
- `apps/notion-service/src/domain/integration/usecases/disconnectNotion.ts`
- `apps/notion-service/src/__tests__/domain/usecases.test.ts`

#### Files Modified

- `apps/notion-service/src/routes/integrationRoutes.ts` - Refactored to use domain use-cases
- `apps/whatsapp-service/src/__tests__/usecases/transcribeAudio.test.ts` - Removed unused eslint-disable

#### Details

Routes are now thin adapters:

- Extract auth user
- Parse request body
- Call use-case
- Map result to HTTP response

Business logic (page validation, error mapping, connection saving) moved to use-cases.

---

### Standard 5: Observability Baseline

**Status:** ✅ ALREADY IMPLEMENTED

#### Analysis

The existing infrastructure meets all requirements. No changes needed.

---

## Phase 2: PENDING

### Standard 1: Common Package Decomposition

**Status:** ⬜ NOT STARTED

See LEDGER.md Tasks 1.1-1.9 for implementation plan.

---

### Standard 3: Route Refactoring (Remaining Services)

#### Task 3.1: auth-service

**Status:** ⬜ NOT STARTED

See LEDGER.md for details.

#### Task 3.2: whatsapp-service

**Status:** ⬜ NOT STARTED

See LEDGER.md for details.

#### Task 3.3: promptvault-service

**Status:** ⬜ NOT STARTED

See LEDGER.md for details.

#### Task 3.4: mobile-notifications-service

**Status:** ⬜ NOT STARTED

See LEDGER.md for details.

---

## Verification

### Phase 1

- [x] `npm run ci` passes
- [x] Pattern-based ESLint rules block cross-app imports
- [x] notion-service domain layer structure created with tests
- [x] Routes refactored to thin adapters (notion-service)
- [x] Structured logging already includes required fields

### Phase 2

- [ ] Standard 1 tasks (1.1-1.9) completed
- [ ] auth-service route refactoring completed (Task 3.1)
- [ ] whatsapp-service route review completed (Task 3.2)
- [ ] promptvault-service route review completed (Task 3.3)
- [ ] mobile-notifications-service route review completed (Task 3.4)
- [ ] All tests pass
- [ ] `npm run ci` passes
