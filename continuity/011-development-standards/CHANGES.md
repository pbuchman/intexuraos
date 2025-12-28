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

## Phase 2: IN PROGRESS

### Standard 1: Common Package Decomposition

**Status:** ✅ IMPLEMENTED (Tasks 1.1-1.8)

#### New Packages Created

1. **`packages/common-core`** - Pure utilities with zero infrastructure dependencies
   - `result.ts` - Result types
   - `errors.ts` - Error codes and IntexuraOSError
   - `redaction.ts` - Security utilities

2. **`packages/common-http`** - Fastify helpers, auth
   - `http/response.ts` - API response helpers
   - `http/requestId.ts` - Request ID handling
   - `http/fastifyPlugin.ts` - Fastify plugin
   - `http/validation.ts` - Validation error handling
   - `http/logger.ts` - Logging utilities
   - `auth/jwt.ts` - JWT verification
   - `auth/fastifyAuthPlugin.ts` - Auth plugin

3. **`packages/infra-firestore`** - Firestore client
   - `firestore.ts` - Firestore singleton
   - `testing/` - Fake Firestore utilities

4. **`packages/infra-notion`** - Notion client
   - `notion.ts` - Notion client utilities
   - `notionConnection.ts` - Notion connection repository

#### Files Modified

- `packages/common/src/index.ts` - Converted to facade re-exporting from decomposed packages
- `packages/common/package.json` - Updated dependencies
- `packages/common/tsconfig.json` - Added references
- `tsconfig.json` - Added new package references
- `eslint.config.js` - Added boundary rules for new packages
- `vitest.config.ts` - Excluded decomposed packages from coverage (covered via facade)

#### Backward Compatibility

The `packages/common` package now acts as a facade, re-exporting everything from
the decomposed packages. Existing code continues to work without import changes.

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

- [x] Standard 1 tasks (1.1-1.8) completed
- [x] All tests pass (1122 tests)
- [x] `npm run ci` passes
- [ ] auth-service route refactoring completed (Task 3.1)
- [ ] whatsapp-service route review completed (Task 3.2)
- [ ] promptvault-service route review completed (Task 3.3)
- [ ] mobile-notifications-service route review completed (Task 3.4)
