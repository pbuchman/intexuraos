# 1-0: Create Validation Script

**Tier**: 1 (Core Implementation)
**Dependencies**: 0-0

## Problem

Need automated tool to detect Firestore collection ownership violations.

## Scope

Create `scripts/verify-firestore-ownership.mjs` that scans all services and validates against registry.

## Approach

1. Load registry from `firestore-collections.json`
2. Scan all apps in `apps/*/src/infra/firestore/*.ts`
3. Extract collection names using regex patterns:
   - `const COLLECTION_NAME = '...'`
   - `.collection('...')`
   - `constructor(collectionName = '...')`
4. Validate each collection reference against registry
5. Report violations with file, line, collection, owner

## Steps

- [ ] Create `scripts/verify-firestore-ownership.mjs`
- [ ] Implement registry loading
- [ ] Implement file scanning (skip tests)
- [ ] Implement regex extraction for 3 patterns
- [ ] Implement ownership validation
- [ ] Implement clear error reporting
- [ ] Handle edge cases (no violations = success)

## Definition of Done

- Script exists and is executable
- Scans all services
- Detects violations (test manually)
- Reports clear errors with file/line info
- Exits with code 0 on success, 1 on violation

## Verification

```bash
node scripts/verify-firestore-ownership.mjs
# Should pass with current codebase (no violations)
```
