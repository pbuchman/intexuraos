# Code Coverage Improvement Orchestration

## Goal

Achieve ≥90% coverage across **all dimensions** (lines, branches, functions, statements) by removing exclusions and adding tests for currently uncovered code.

## Revoked Exclusions

These patterns were previously excluded but **must now achieve ≥90% coverage**:

- `**/infra/**`
- `**/notion.ts`
- `**/whatsappClient.ts`
- `**/workers/**`
- `**/usecases/extractLinkPreviews.ts`
- `**/statusRoutes.ts`

## Retained Exclusions (Justified)

- Test files (`**/*.test.ts`, `**/*.spec.ts`, `**/testing/**`, `**/__tests__/**`)
- Index/barrel files (`**/index.ts`) — re-exports only
- Type definitions (`**/*.d.ts`)
- Type-only files (`**/domain/**/models/**`, `**/domain/**/ports/**`, `**/domain/**/events/**`)
- Web app (`apps/web/**`) — requires E2E testing
- Firestore singleton (`**/firestore.ts`) — pure getter
- API docs hub (`apps/api-docs-hub/**`) — static aggregator
- Adapters (`**/adapters.ts`) — class wrappers delegating to infra
- Server setup (`**/server.ts`) — Fastify lifecycle
- Service containers (`**/services.ts`) — DI singletons
- HTTP logger (`**/http/logger.ts`) — logging wrapper

## Execution Rules

1. Execute subtasks sequentially — one file at a time
2. After each subtask: re-run coverage, update ledger
3. Mark subtask "Done" when target ≥90%
4. Task complete only when all revoked exclusions meet threshold

## Forbidden Actions

- **Never modify `vitest.config.ts` without explicit user permission**
- **Never modify `.github/copilot-instructions.md` without explicit user permission**

## Verification Command

```bash
npm run test -- --coverage
```
