# 1-1: Test Validation Script

**Tier**: 1 (Core Implementation)
**Dependencies**: 1-0

## Problem

Validation script must correctly catch violations without false positives.

## Scope

Test script with intentional violations to ensure it catches them.

## Steps

- [ ] Test 1: Verify current state passes (baseline)
- [ ] Test 2: Add cross-service violation (user-service accessing whatsapp_messages)
- [ ] Test 3: Add undeclared collection usage
- [ ] Test 4: Verify constructor parameter detection
- [ ] Clean up test files
- [ ] Document test cases in script comments

## Definition of Done

- All test cases executed
- Script catches all violation types
- No false positives on valid code
- Test artifacts cleaned up
- Current codebase passes validation

## Verification

```bash
# Should pass
node scripts/verify-firestore-ownership.mjs

# Should fail (after adding test violation)
echo "const test = db.collection('whatsapp_messages')" >> apps/user-service/src/infra/firestore/test-violation.ts
node scripts/verify-firestore-ownership.mjs
rm apps/user-service/src/infra/firestore/test-violation.ts

# Should pass again
node scripts/verify-firestore-ownership.mjs
```
