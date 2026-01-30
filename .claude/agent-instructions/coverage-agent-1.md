# Coverage Agent 1 - Strict Instructions

## Mission

Cover **97 uncovered branches** across 2 workspaces: `apps/research-agent` (76) and `packages/llm-prompts` (21).

## Your Scope (DO NOT TOUCH ANYTHING ELSE)

### apps/research-agent (76 branches)

```
src/domain/research/formatLlmError.ts:140
src/domain/research/usecases/extractModelPreferences.ts:87,132,168
src/domain/research/usecases/processResearch.ts:72,95,105,142
src/domain/research/usecases/retryFromFailed.ts:98
src/domain/research/usecases/runSynthesis.ts:160,167,229,325,326,327,338,340,423
src/infra/llm/ContextInferenceAdapter.ts:272,340,358
src/infra/notion/exportResearchToNotionUseCase.ts:160
src/infra/notion/markdownToNotionBlocks.ts:147,155,169,179,201,259,264,270,330,428,429,430,431,438
src/infra/research/FirestoreResearchRepository.ts:92,123
src/routes/internalRoutes.ts:204,210,366,401,437,447,455,476,477,583,607,738,925,970
src/routes/researchRoutes.ts:178,315,322,323,326,371,438,642,914,915,935,951,954,1071,1082,1197,1311,1400,1430,1440,1505
src/routes/helpers/completionHandlers.ts:115,116
src/domain/research/utils/htmlGenerator.ts:417
```

### packages/llm-prompts (21 branches)

```
src/calendar/calendarActionExtractionPrompt.ts:41
src/calendar/contextSchemas.ts:19,22,25
src/dataInsights/parseInsightResponse.ts:28,40,78,82,94,121,139,154,166
src/research/attribution.ts:140,147,166,171,196,226
src/research/modelExtractionPrompt.ts:137
src/shared/contextSchemas.ts:89
```

---

## Decision Framework

For EACH uncovered branch line, decide:

### Option A: Write a Test

Use when the branch CAN be triggered via test setup (fake repositories, mock services, etc.)

### Option B: Add v8 Ignore Comment

Use when the branch CANNOT be tested due to:

- TypeScript type narrowing (`ts-type`)
- Fake/mock cannot produce required state (`test-infra`)
- Auth middleware tested elsewhere (`auth-guard`)
- Schema validation makes fallback unreachable (`schema`)
- Regex capture group guaranteed (`regex`)

**Format:** `/* v8 ignore <CATEGORY> -- <brief reason> */`

Valid categories: `ts-type`, `regex`, `module-init`, `async-timing`, `test-infra`, `upstream`, `module-mock`, `schema`, `source-map`, `auth-guard`

---

## Testing Commands

```bash
# Verify ONLY your workspaces
pnpm -w run verify:workspace:tracked research-agent
pnpm -w run verify:workspace:tracked llm-prompts

# Run specific test file
cd apps/research-agent && pnpm vitest run src/__tests__/<file>.test.ts

# Check coverage for specific file
cd apps/research-agent && pnpm vitest run src/__tests__/<file>.test.ts --coverage

# Check remaining uncovered branches in your scope
node scripts/verify-v8-ignore.mjs --all 2>&1 | grep -E "apps/research-agent|packages/llm-prompts"
```

---

## Exit Criteria (ALL MUST PASS)

1. **Zero uncovered branches in your scope:**

   ```bash
   node scripts/verify-v8-ignore.mjs --all 2>&1 | grep -E "apps/research-agent|packages/llm-prompts"
   # Must return empty
   ```

2. **Workspace verification passes:**

   ```bash
   pnpm -w run verify:workspace:tracked research-agent
   pnpm -w run verify:workspace:tracked llm-prompts
   # Both must show "All checks passed"
   ```

3. **v8 ignore validation passes:**
   ```bash
   pnpm -w run verify:v8-ignore
   # Must show "✓ N v8 ignore comments validated" with no errors
   ```

---

## Deliverables

1. All 97 branches either tested or properly exempted
2. All new tests pass
3. No changes to files outside your scope
4. Git commit with message: `INT-426 Cover research-agent and llm-prompts branches`

---

## STRICT RULES

1. **DO NOT modify any files outside your scope**
2. **DO NOT modify vitest.config.ts or coverage thresholds**
3. **DO NOT use v8 ignore without valid category**
4. **DO NOT commit until exit criteria pass**
5. **DO NOT run full CI** - only verify your workspaces
6. **DO NOT touch**: apps/_, workers/_, other packages/\*

---

## Work Order (Suggested)

1. Start with `packages/llm-prompts` (smaller, 21 branches)
2. Move to `apps/research-agent/src/domain/` (use case tests)
3. Then `apps/research-agent/src/infra/` (adapter tests)
4. Finally `apps/research-agent/src/routes/` (integration tests)

---

## Branch Information

You are working in: `feature/int-426-coverage-agent-1`
Base branch: `feature/int-426`
