# Task 016: Firestore Collection Ownership Enforcement

## Goal

Implement strict enforcement mechanisms to ensure NOT A SINGLE Firestore collection is shared between multiple services.

## Success Criteria

- Collection registry exists (`firestore-collections.json`) with all 10 collections
- Validation script (`scripts/verify-firestore-ownership.mjs`) detects violations
- Script integrated into `npm run ci`
- Documentation updated in CLAUDE.md and docs/architecture/
- Zero violations in current codebase (already clean)
- Catches intentional test violations

## Scope

**In Scope:**

- Create collection registry
- Build validation script with clear error messages
- Integrate into CI pipeline
- Update documentation

**Out of Scope:**

- Custom ESLint rules (regex-based script is sufficient)
- IDE integration (future enhancement)
- Firestore security rules generation
