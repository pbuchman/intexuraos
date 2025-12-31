# 2-1: Documentation

**Tier**: 2 (Integration)
**Dependencies**: 2-0

## Problem

Developers need clear guidance on Firestore ownership rules.

## Scope

Update CLAUDE.md and create architecture documentation.

## Steps

- [ ] Add "Firestore Collections" section to CLAUDE.md
  - Collection registry table
  - Ownership rules (forbidden/allowed)
  - How to add new collections
  - Verification command
- [ ] Create `docs/architecture/firestore-ownership.md`
  - Rationale for single-owner rule
  - Registry specification
  - Validation algorithm
  - Service-to-service patterns
  - Migration guide (for reference)

## Definition of Done

- CLAUDE.md updated with Firestore section
- Architecture doc created with full specification
- Examples show correct and incorrect patterns
- Links between docs

## Verification

```bash
# Check docs exist
ls .claude/CLAUDE.md docs/architecture/firestore-ownership.md

# Verify CLAUDE.md has Firestore section
grep -A 5 "Firestore Collections" .claude/CLAUDE.md
```
