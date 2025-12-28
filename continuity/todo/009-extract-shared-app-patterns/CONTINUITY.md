# Continuity — Extract Shared App Patterns

## Current Status

**Phase**: Ready to begin execution
**Last Updated**: 2025-12-28

## Completed

- [x] Analysis of duplicated patterns across services
- [x] Package boundary design (http-contracts, http-server)
- [x] Detailed execution plan created

## In Progress

- [ ] Phase 2: Create http-contracts package

## Remaining

- [ ] Phase 2: Create http-contracts package (Tasks 2.1-2.3)
- [ ] Phase 3: Create http-server package (Tasks 3.1-3.3)
- [ ] Phase 4: Update configuration (Tasks 4.1-4.3)
- [ ] Phase 5: Migrate promptvault-service (Tasks 5.1-5.4)
- [ ] Phase 6: Verification (Tasks 6.1-6.5)
- [ ] Phase 7: Cleanup (Tasks 7.1-7.3)

## Key Files

**To Create**:
- `packages/http-contracts/package.json`
- `packages/http-contracts/tsconfig.json`
- `packages/http-contracts/src/index.ts`
- `packages/http-contracts/src/openapi-schemas.ts`
- `packages/http-contracts/src/fastify-schemas.ts`
- `packages/http-server/package.json`
- `packages/http-server/tsconfig.json`
- `packages/http-server/src/index.ts`
- `packages/http-server/src/health.ts`
- `packages/http-server/src/validation-handler.ts`

**To Modify**:
- `tsconfig.json` — Add package references
- `eslint.config.js` — Update boundary rules
- `apps/promptvault-service/src/server.ts` — Use new packages
- `apps/promptvault-service/package.json` — Add dependencies
- `apps/promptvault-service/tsconfig.json` — Add references

## Notes

1. The validation error handler has a TypeScript quirk with `v.params?.['missingProperty']` — must use bracket notation due to strict indexing
2. ESLint boundary rules need to define proper dependency graph:
   - http-contracts: leaf (no deps)
   - common: can import http-contracts
   - http-server: can import common, http-contracts
   - apps: can import all packages
3. Do not change behavior — this is a pure extraction refactoring
