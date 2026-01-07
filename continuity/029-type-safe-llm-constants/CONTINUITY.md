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

### Now:
- Fixing remaining test failures and coverage issues

### Next:
- TASK-08 through TASK-14: Remaining app migrations (may be complete)
- TASK-15: Test file updates
- TASK-16: Enable CI verification

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

