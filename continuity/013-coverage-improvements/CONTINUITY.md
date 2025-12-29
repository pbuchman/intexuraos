# Continuity Ledger — Coverage Improvements

## Goal

Improve branch coverage to ≥90% for 5 files (issues #240-#244).

**Success Criteria:**

- Branch coverage ≥90% for all target files
- `npm run ci` passes
- GitHub issues closed

## Constraints / Assumptions

- Tests must use in-memory fakes (no external dependencies)
- Follow existing test patterns in codebase
- Protected: `vitest.config.ts` coverage thresholds require permission

## Key Decisions

_(To be updated as work progresses)_

## Reasoning Narrative

### 2024-12-29 — Session Start

Initialized continuity workflow for coverage improvement tasks.
5 issues identified from GitHub (#240-#244, excluding #239 weekly report).

**Baseline Coverage (branches):**
| File | Current | Target | Gap |
|------|---------|--------|-----|
| notion.ts | 34.48% | 90% | 55.52% |
| health.ts | 85.71% | 90% | 4.29% |
| notionConnection.ts | 85.71% | 90% | 4.29% |
| refreshAccessToken.ts | 87.5% | 90% | 2.5% |
| integrationRoutes.ts | 87.5% | 90% | 2.5% |

**Priority order (by effort/impact):**

1. Quick wins first: #243, #244 (smallest gaps)
2. Medium: #241, #242
3. Large: #240 (requires significant test additions)

## State

**Done:**

- Session initialization
- Baseline coverage analysis

**Now:**

- 1-3: refreshAccessToken.ts (#243) — smallest gap

**Next:**

- 1-4: integrationRoutes.ts (#244)
- 1-1: health.ts (#241)
- 1-2: notionConnection.ts (#242)
- 1-0: notion.ts (#240) — largest effort

## Open Questions

None currently.

## Working Set

**Files:**

- `apps/user-service/src/domain/identity/usecases/refreshAccessToken.ts`
- `apps/notion-service/src/routes/integrationRoutes.ts`
- `packages/http-server/src/health.ts`
- `packages/common/src/notionConnection.ts`
- `packages/common/src/notion.ts`

**Commands:**

```bash
npm run test:coverage 2>&1 | grep -E "filename"
npm run ci
```
