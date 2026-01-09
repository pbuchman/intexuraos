# CONTINUITY.md - Task 029: Type-Safe LLM Model and Provider Constants

## Goal (incl. success criteria)

Eliminate all hardcoded LLM model strings (e.g., `'gemini-2.5-pro'`) and provider strings (e.g., `'google'`) across the entire codebase. Introduce typed constants via `LlmModels` and `LlmProviders` objects in `llm-contract`. Enforce via verification script.

**Success Criteria:**

- All 14 individual model types defined in llm-contract
- All 4 individual provider types defined in llm-contract
- `LlmModels` and `LlmProviders` constants objects exported
- `SupportedModel` and `SYSTEM_DEFAULT_MODELS` removed
- All 1060 verification violations fixed (703 model strings, 357 provider strings)
- `npm run ci` passes
- Verification script shows 0 violations

## Constraints / Assumptions

- No backward compatibility - breaking changes allowed (internal monorepo only)
- `migrations/*.mjs` excluded from verification (historical records)
- `packages/llm-contract/` is single source of truth for string definitions
- NEVER modify `vitest.config.ts` - write tests instead

## Key Decisions

1. **Type structure**: Individual model types first (e.g., `type Gemini25Pro = 'gemini-2.5-pro'`), then compose category types from them
2. **Naming convention**: `LlmModels` and `LlmProviders` (camelCase prefix)
3. **Verification**: RULE-4 and RULE-5 are warnings until migration complete, then become blocking

## Reasoning Narrative

- Task breakdown created with 16 sub-tasks covering llm-contract updates, app migrations, test file updates, and CI enablement
- Verification script extended with RULE-4 (model strings) and RULE-5 (provider strings) as warnings
- Baseline captured: 1060 violations total

## State

### Done:

- Task planning and documentation created
- Verification script extended with RULE-4 and RULE-5 (non-blocking)
- Violations baseline captured (1060 total)
- TASK-01: Individual model/provider types added to llm-contract ✅
- TASK-02: LlmModels and LlmProviders constants added ✅
- TASK-03: SupportedModel and SYSTEM_DEFAULT_MODELS removed ✅
- TASK-04: llm-orchestrator domain layer migrated to ResearchModel ✅
- TASK-05: llm-orchestrator infra/routes migrated ✅
- TASK-06: commands-router migrated ✅
- TASK-07: actions-agent migrated ✅
- TASK-08: image-service migrated (all source files) ✅
- TASK-09: data-insights-service migrated ✅
- TASK-10: user-service migrated ✅
- TASK-11: app-settings-service migrated ✅
- TASK-12: llm-pricing package migrated ✅
- TASK-13: infra-\* packages migrated (gemini, gpt, claude, perplexity) ✅
- TASK-14: web app migrated (types, components, pages) ✅
- TASK-15: Test files ~60% complete (~350/600 violations fixed) ⏳

### Now:

- Remaining ~250 test file violations need migration
- CI verification to identify exact remaining work

### Next:

- Complete remaining test file migrations (TASK-15)
- TASK-16: Enable CI verification
- Final verification: npm run ci passes with 0 violations

## Open Questions

None - all design decisions confirmed by user.

## Working Set

- Files: `packages/llm-contract/src/supportedModels.ts`, `packages/llm-contract/src/index.ts`
- Commands: `npm run typecheck`, `npm run ci`

---

## Execution Log

### 2026-01-07 - Session Start

- Ledger created
- TASK-01 through TASK-07 completed
- SupportedModel deprecation warnings: 0 (was 53)
- Typecheck: PASSED
- Lint: PASSED
- Coverage: Branch coverage 92.95% (below 95% threshold)

### 2026-01-07 - GitHub PR Work (Claude via GitHub Actions)

- Completed TASK-08 through TASK-14 (all source code migrations)
- Completed ~60% of TASK-15 (test file migrations)
  - llm-orchestrator: 11 test files (~200 violations)
  - commands-router: 2 test files (~60 violations)
  - image-service: 2 test files (~40 violations)
  - llm-pricing: 1 test file (~20 violations)
- Committed changes to development branch (commit ae85e76)
- Remaining: ~250 test file violations in actions-agent, app-settings-service, and scattered test files
- Status: All production code migrated, test suite partially migrated
