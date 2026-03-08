# AI Models Cross-Validation Report

**Generated:** 2026-02-08
**Updated:** 2026-02-19 (ENHANCED)
**Scope:** All docs (overview.md, services/index.md, service technical.md files) cross-referenced against code (llm-contract, llm-factory, llm-pricing, service source files, infra-\* provider packages)

---

## 1. Master Model Inventory (Code as Source of Truth)

Models defined in `packages/llm-contract/src/supportedModels.ts` (the single source of truth):

| #   | Code Model ID                | Type Alias         | Provider   | Category in Code                           |
| --- | ---------------------------- | ------------------ | ---------- | ------------------------------------------ |
| 1   | `gemini-2.5-pro`             | Gemini25Pro        | Google     | Research, Generic, Prompt Generation       |
| 2   | `gemini-2.5-flash`           | Gemini25Flash      | Google     | Research, Fast, Classification             |
| 3   | `gemini-2.0-flash`           | Gemini20Flash      | Google     | Validation, Fast                           |
| 4   | `gemini-2.5-flash-image`     | Gemini25FlashImage | Google     | Image Generation                           |
| 5   | `o4-mini-deep-research`      | O4MiniDeepResearch | OpenAI     | Research                                   |
| 6   | `gpt-5.2`                    | GPT52              | OpenAI     | Research, Generic                          |
| 7   | `gpt-4o-mini`                | GPT4oMini          | OpenAI     | Validation, Fast                           |
| 8   | `gpt-image-1`                | GPTImage1          | OpenAI     | Image Generation                           |
| 9   | `claude-opus-4-5-20251101`   | ClaudeOpus45       | Anthropic  | Research                                   |
| 10  | `claude-sonnet-4-5-20250929` | ClaudeSonnet45     | Anthropic  | Research                                   |
| 11  | `claude-3-5-haiku-20241022`  | ClaudeHaiku35      | Anthropic  | Validation                                 |
| 12  | `sonar`                      | Sonar              | Perplexity | Research, Validation                       |
| 13  | `sonar-pro`                  | SonarPro           | Perplexity | Research                                   |
| 14  | `sonar-deep-research`        | SonarDeepResearch  | Perplexity | Research                                   |
| 15  | `glm-4.7`                    | Glm47              | Zai        | Research, Validation, Classification       |
| 16  | `glm-4.7-flash`              | Glm47Flash         | Zai        | Research, Validation, Fast, Classification |

**Total in llm-contract: 16 models**

### Models Used in Code but NOT in llm-contract

| Model ID                 | Used By                                            | Purpose            | In llm-contract? |
| ------------------------ | -------------------------------------------------- | ------------------ | ---------------- |
| `gpt-4.1`                | image-service (ImagePromptModel, GptPromptAdapter) | Prompt enhancement | NO               |
| `text-embedding-3-small` | chat-agent (embeddingClient.ts)                    | Vector embeddings  | NO               |

**Actual total unique models in use across the codebase: 18**

---

## 2. Model Count Inconsistencies in Docs

| Document                                                      | Claim                                      | Actual                              |
| ------------------------------------------------------------- | ------------------------------------------ | ----------------------------------- |
| `docs/overview.md` line 101                                   | "5 AI providers and **17 models**"         | 16 in llm-contract, 18 total in use |
| `docs/overview.md` line 311                                   | "real-time pricing for all **16 models**"  | 16 in llm-contract (but 18 total)   |
| `docs/services/index.md` line 29                              | "5 AI providers with **17 models**"        | 16 in llm-contract, 18 total in use |
| `packages/llm-contract/src/supportedModels.ts` comment line 7 | "All 16 models"                            | 16 defined (correct for this file)  |
| `docs/services/index.md` line 158                             | "Research Models (11)" section header      | 11 listed (correct)                 |
| `docs/services/index.md` line 176                             | "Classification Models (3)" section header | 3 listed (correct)                  |
| `docs/services/index.md` line 188                             | "Image Models (2)" section header          | 2 listed (correct)                  |
| `docs/services/index.md` line 196                             | "Validation Models (6)" section header     | 6 listed (correct)                  |

**Issue:** overview.md says "17 models" at the top but "16 models" later. The index.md also says "17 models". Neither count is correct:

- llm-contract defines **16** models
- The actual codebase uses **18** unique models (adding `gpt-4.1` and `text-embedding-3-small`)
- The sectioned counts in index.md (11 + 3 + 2 + 6 = 22) have overlap (models appear in multiple categories), which is expected and correct

---

## 3. Model Naming Inconsistencies Across Docs

### Anthropic Models: Short Name vs Full Model ID

The documentation inconsistently uses short display names in some places and full model IDs in others:

| Document                                    | Name Used           | Actual Code ID               |
| ------------------------------------------- | ------------------- | ---------------------------- |
| `docs/overview.md`                          | `Claude Opus 4.5`   | `claude-opus-4-5-20251101`   |
| `docs/overview.md`                          | `Claude Sonnet 4.5` | `claude-sonnet-4-5-20250929` |
| `docs/overview.md`                          | `Haiku 3.5`         | `claude-3-5-haiku-20241022`  |
| `docs/services/index.md`                    | `Claude Opus 4.5`   | `claude-opus-4-5-20251101`   |
| `docs/services/index.md`                    | `Claude Sonnet 4.5` | `claude-sonnet-4-5-20250929` |
| `docs/services/index.md`                    | `Claude Haiku 3.5`  | `claude-3-5-haiku-20241022`  |
| `docs/services/research-agent/technical.md` | `claude-opus-4.5`   | `claude-opus-4-5-20251101`   |
| `docs/services/research-agent/technical.md` | `claude-sonnet-4.5` | `claude-sonnet-4-5-20250929` |
| `docs/services/research-agent/tutorial.md`  | `claude-opus-4.5`   | `claude-opus-4-5-20251101`   |
| `docs/services/user-service/technical.md`   | `claude-3.5-haiku`  | `claude-3-5-haiku-20241022`  |

**Issue:** Three different naming conventions are used for the same models:

1. **Human-friendly display name** in overview/index: `Claude Opus 4.5`
2. **Short model ID** in research-agent docs: `claude-opus-4.5` (NOT a valid model ID in code)
3. **Full versioned model ID** in code: `claude-opus-4-5-20251101`

The short model IDs like `claude-opus-4.5` and `claude-sonnet-4.5` used in the research-agent technical.md RESEARCH_MODELS array documentation do not match the actual code type values. This is misleading for developers consulting the docs.

### OpenAI Image Model Naming

| Document                                   | Name Used                   | Actual Code ID |
| ------------------------------------------ | --------------------------- | -------------- |
| `docs/overview.md`                         | `GPT Image 1`               | `gpt-image-1`  |
| `docs/services/index.md`                   | `GPT-Image-1 (GPT Image 1)` | `gpt-image-1`  |
| `docs/services/image-service/technical.md` | `gpt-image-1`               | `gpt-image-1`  |

**Minor issue:** index.md uses `GPT-Image-1 (GPT Image 1)` - redundant parenthetical. The overview uses `GPT Image 1` without the hyphenated form.

### Gemini Flash Image Naming

| Document                                   | Name Used                                |
| ------------------------------------------ | ---------------------------------------- |
| `docs/overview.md`                         | `Flash-Image` (in table)                 |
| `docs/overview.md`                         | `Gemini Flash Image` (in services table) |
| `docs/services/index.md`                   | `Gemini 2.5 Flash Image`                 |
| `docs/services/image-service/technical.md` | `gemini-2.5-flash-image`                 |

**Minor issue:** `Flash-Image` in overview table is ambiguous - could be misread as a separate model. Should be `Gemini 2.5 Flash Image`.

### infra-claude and infra-gpt JSDoc Uses Invalid Short Names

| File                                                | JSDoc String                   | Valid Code ID                |
| --------------------------------------------------- | ------------------------------ | ---------------------------- |
| `packages/infra-claude/src/client.ts:18`            | `claude-sonnet-4-5`            | `claude-sonnet-4-5-20250929` |
| `packages/infra-gpt/src/types.ts:31`                | `gpt-4.1`                      | Not in llm-contract          |
| `packages/infra-gpt/src/client.ts:19,81`            | `gpt-4.1`                      | Not in llm-contract          |
| `packages/llm-pricing/src/pricingClient.ts:216,320` | `gpt-4.1`, `claude-sonnet-4-5` | Both invalid short forms     |

**Issue:** Package JSDoc examples use `claude-sonnet-4-5` (missing version suffix) and `gpt-4.1` (not in contract). Developers following these examples would use invalid model IDs.

---

## 4. Models in Docs but NOT Found in Code

| Model Name in Docs  | Where Documented            | Status                                                             |
| ------------------- | --------------------------- | ------------------------------------------------------------------ |
| `claude-opus-4.5`   | research-agent/technical.md | **Not a valid model ID** -- code uses `claude-opus-4-5-20251101`   |
| `claude-sonnet-4.5` | research-agent/technical.md | **Not a valid model ID** -- code uses `claude-sonnet-4-5-20250929` |
| `claude-3.5-haiku`  | user-service/technical.md   | **Not a valid model ID** -- code uses `claude-3-5-haiku-20241022`  |

These are all shorthand names. The actual runtime code uses the full versioned model IDs via `LlmModels.*` constants.

---

## 5. Models in Code but NOT Documented in Overview/Index

### `gpt-4.1` (OpenAI) -- Prompt Enhancement

- **Used by:** `apps/image-service/src/domain/models/ImagePromptModel.ts`
- **Purpose:** Prompt enhancement for image generation
- **NOT in:** `packages/llm-contract/src/supportedModels.ts` (not in LLMModel union type)
- **NOT in:** `docs/overview.md` AI provider table
- **NOT in:** `docs/services/index.md` AI Models Used section
- **Documented in:** `docs/services/image-service/technical.md` only

**Significance:** This model is used in production for image prompt enhancement but is not registered in the central model contract. It has its own type definition local to image-service (`ImagePromptModel = 'gpt-4.1' | Gemini25Pro`).

### `text-embedding-3-small` (OpenAI) -- Vector Embeddings

- **Used by:** `apps/chat-agent/src/infra/llm/embeddingClient.ts`
- **Purpose:** Generate 1536-dimension embedding vectors for RAG semantic search
- **NOT in:** `packages/llm-contract/src/supportedModels.ts`
- **NOT in:** `docs/overview.md` AI provider table
- **NOT in:** `docs/services/index.md` AI Models Used section
- **Documented in:** `docs/services/chat-agent/technical.md` only

**Significance:** This is an embedding model (not a generation model), so its omission from the generative model list is somewhat understandable. However, it represents a separate OpenAI API usage with its own pricing.

### `chat-agent` and `code-agent` -- Missing from Overview/Index Entirely

**Status: ✅ RESOLVED as of 2026-02-19**

Both chat-agent and code-agent are now documented in `docs/overview.md` (Agent Architecture table) and `docs/services/index.md` (AI Agents section).

- **chat-agent:** `GLM-4.7-Flash` (guest sessions), user-configured model (authenticated), `text-embedding-3-small` (embeddings). Now listed in overview.md line ~273 and index.md.
- **code-agent:** No direct LLM calls; delegates to external Docker workers. Now listed in overview.md and index.md.

---

## 6. Disagreements Between Overview/Index and Individual Service Docs

### commands-agent: Model List Mismatch

| Source                         | Models Listed                                |
| ------------------------------ | -------------------------------------------- |
| `docs/services/index.md` table | `Gemini 2.5 Flash, GLM-4.7`                  |
| `commands-agent/technical.md`  | `Gemini 2.5 Flash / GLM-4.7 / GLM-4.7-Flash` |

**Issue:** index.md omits `GLM-4.7-Flash` from commands-agent's model list.

### data-insights-agent: Specific Model Not Documented

| Source                                   | Models Listed                                                     |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `docs/services/index.md` table           | `Gemini 2.5 Flash`                                                |
| `data-insights-agent/technical.md`       | `LLM Providers` (generic)                                         |
| `data-insights-agent code (services.ts)` | Uses `getLlmClient()` from user-service (user's configured model) |

**Issue:** The data-insights-agent does not hardcode a specific model. It uses the user's configured LLM via `getLlmClient()` from the user-service/internal-clients package. The docs claim `Gemini 2.5 Flash` specifically, but the actual model depends on user configuration. The service uses the `llm-factory` which currently only supports Google (Gemini) and Zai (GLM) providers, so the user's model would be one of those.

### web-agent: Model Documentation

| Source                   | Models Listed          |
| ------------------------ | ---------------------- |
| `docs/services/index.md` | `Gemini 2.5 Flash`     |
| `web-agent/technical.md` | `User's LLM` (generic) |

**Issue:** Similar to data-insights-agent, web-agent uses the user's configured LLM via user-service. It does not hardcode `Gemini 2.5 Flash`. The index.md is misleading.

### todos-agent: Model Documentation

| Source                     | Models Listed                                  |
| -------------------------- | ---------------------------------------------- |
| `docs/services/index.md`   | `Via commands-agent` (NLP extraction)          |
| `todos-agent/technical.md` | `Gemini / GLM` (via user-service getLlmClient) |

**Issue:** index.md says `Via commands-agent` which is incorrect. The todos-agent does its own LLM calls for item extraction using the user's configured model via user-service, not via commands-agent. The commands-agent only classifies the initial command.

### bookmarks-agent: Model Documentation

| Source                         | Models Listed                                                 |
| ------------------------------ | ------------------------------------------------------------- |
| `docs/services/index.md`       | `Via web-agent`                                               |
| `bookmarks-agent/technical.md` | No direct LLM calls; delegates to web-agent for summarization |

**Status:** Correct. bookmarks-agent delegates AI summarization to web-agent.

### overview.md: Research Diagram Uses Short Names

The Mermaid diagram in overview.md (lines 148-161) uses `Claude Opus 4.5` and `Gemini 2.5 Pro` etc. These are display names and are acceptable for a high-level diagram. However, the RESEARCH_MODELS code block in research-agent/technical.md uses `claude-opus-4.5` which is neither the display name nor the actual model ID.

---

## 7. Overview Table vs Code Provider/Model Mapping

### `docs/overview.md` Provider Table (line 103-109)

| Provider   | Overview Lists                              | Code Actually Has                                                               | Match?                                         |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Google     | Gemini 2.5 Pro, Flash, Flash-Image          | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-2.5-flash-image      | PARTIAL -- missing `Gemini 2.0 Flash`          |
| OpenAI     | GPT-5.2, o4-mini-deep-research, GPT Image 1 | gpt-5.2, o4-mini-deep-research, gpt-4o-mini, gpt-image-1, gpt-4.1               | PARTIAL -- missing `GPT-4o Mini` and `GPT-4.1` |
| Anthropic  | Claude Opus 4.5, Sonnet 4.5, Haiku 3.5      | claude-opus-4-5-20251101, claude-sonnet-4-5-20250929, claude-3-5-haiku-20241022 | OK (display names)                             |
| Perplexity | Sonar, Sonar Pro, Sonar Deep Research       | sonar, sonar-pro, sonar-deep-research                                           | OK                                             |
| Zai        | GLM-4.7, GLM-4.7-Flash                      | glm-4.7, glm-4.7-flash                                                          | OK                                             |

**Issues:**

1. Overview omits `Gemini 2.0 Flash` (used for validation in user-service and as a FastModel)
2. Overview omits `GPT-4o Mini` (used for validation in user-service)
3. Overview omits `GPT-4.1` (used for prompt enhancement in image-service)
4. Overview omits `text-embedding-3-small` (used for embeddings in chat-agent)

---

## 8. `llm-factory` Only Supports 2 Providers

The `packages/llm-factory/src/llmClientFactory.ts` only supports:

- **Google** (Gemini) via `@intexuraos/infra-gemini`
- **Zai** (GLM) via `@intexuraos/infra-glm`

Services that use other providers (Anthropic, OpenAI, Perplexity) create their clients directly via provider-specific packages:

- `@intexuraos/infra-claude`
- `@intexuraos/infra-gpt`
- `@intexuraos/infra-perplexity`

This means the `llm-factory` is only used by services that do classification/quick tasks (commands-agent, data-insights-agent, web-agent, todos-agent, chat-agent). The research-agent creates provider-specific clients directly for its multi-model orchestration.

**Documentation gap:** The `llm-factory` README and the overview docs do not make this limitation explicit. Developers reading the factory docs would not know that Anthropic, OpenAI, and Perplexity require separate direct client creation.

---

## 9. ENHANCED: Pricing Coverage Verification

All 16 models in `llm-contract` have pricing defined in `packages/llm-contract/src/__tests__/fixtures/pricing.ts`:

| Provider   | Models with Pricing                                                             | Coverage |
| ---------- | ------------------------------------------------------------------------------- | -------- |
| Google     | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-2.5-flash-image      | COMPLETE |
| OpenAI     | o4-mini-deep-research, gpt-5.2, gpt-4o-mini, gpt-image-1                        | COMPLETE |
| Anthropic  | claude-opus-4-5-20251101, claude-sonnet-4-5-20250929, claude-3-5-haiku-20241022 | COMPLETE |
| Perplexity | sonar, sonar-pro, sonar-deep-research                                           | COMPLETE |
| Zai        | glm-4.7, glm-4.7-flash                                                          | COMPLETE |

All 16 models have pricing defined. The `PricingContext.validateAllModels()` call enforces this at app startup.

### Notable Pricing Characteristics by Model

| Model                                       | Notable Pricing Feature                                               |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `gemini-2.5-flash-image`                    | `imagePricing` only -- `inputPricePerMillion: 0`, no text pricing     |
| `gpt-image-1`                               | `imagePricing` only -- `inputPricePerMillion: 0`, no text pricing     |
| `glm-4.7-flash`                             | Both token prices are `0` (free model)                                |
| `claude-opus-4-5-20251101`                  | Highest pricing: $5/$25 per million + cache multipliers               |
| `sonar`, `sonar-pro`, `sonar-deep-research` | `useProviderCost: true` -- Perplexity returns actual cost in response |

### Model NOT in Pricing Fixtures

| Model                    | In llm-contract? | In pricing fixtures? | Notes                                           |
| ------------------------ | ---------------- | -------------------- | ----------------------------------------------- |
| `gpt-4.1`                | NO               | NO                   | Only local to image-service; no central pricing |
| `text-embedding-3-small` | NO               | NO                   | Embedding model; separate pricing universe      |

---

## 10. ENHANCED: Deprecated Model References in Test Code

The following deprecated model strings appear in test files (NOT in production code):

| Deprecated Model ID    | Files with References                                            | Notes                                            |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `gemini-2.0-flash-exp` | research-agent tests, app-settings-service tests (8 files total) | Renamed to `gemini-2.0-flash` in production      |
| `o4-mini`              | research-agent tests (retryFromFailed, htmlGenerator, routes)    | Wrong -- production uses `o4-mini-deep-research` |

**Critical finding:** `o4-mini` appears in test data for the `retryFromFailed` use case. This is the short form of the actual model ID `o4-mini-deep-research`. Using `o4-mini` as a test fixture model could hide bugs where the system creates or processes results with invalid model IDs that would fail real API calls.

**Also found in archive/continuity files (not production):**

- `continuity/archive/014-llm-orchestrator/` -- uses `gemini-2.0-flash-exp` (historical, archived)
- `continuity/archive/019-commands-router-service/` -- uses `gemini-2.0-flash-exp` (historical, archived)
- `scripts/pubsub-publish-test.mjs` -- uses `gemini-2.0-flash-exp` (test script, not production)

---

## 11. ENHANCED: GLM-4.7 vs GLM-4.7-Flash in ValidationModel

**Issue:** `docs/services/index.md` Validation Models section (line 296-309) lists **6 validation models** including both `GLM-4.7` and `GLM-4.7-Flash`. However, the `ValidationModel` type in `llm-contract/src/supportedModels.ts:91` only includes `Glm47Flash`, not `Glm47`:

```typescript
// Code (actual):
export type ValidationModel = ClaudeHaiku35 | Gemini20Flash | GPT4oMini | Sonar | Glm47Flash;

// Docs (index.md table claims):
// Both GLM-4.7 AND GLM-4.7-Flash are listed
```

The `user-service/src/index.ts` references `ValidationModel` for `REQUIRED_MODELS`. The runtime validation uses `glm-4.7` directly (not the type), but the type definition excludes `Glm47` from `ValidationModel`. The docs overclaim one validation model.

**Verification:** `user-service/technical.md` (LLM Key Validation table) correctly shows `glm-4.7` for Zai validation — this contradicts the code's `ValidationModel` type which only has `glm-4.7-flash`. This creates an ambiguity: which GLM model actually runs validation calls in `LlmValidatorImpl.ts`?

---

## 12. ENHANCED: llm-factory Provider Support Matrix

### What llm-factory Supports vs What Docs Claim

| Provider   | Supported by llm-factory? | Supported by infra-\* directly? | Who uses llm-factory?                                                   |
| ---------- | ------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Google     | YES                       | YES (`infra-gemini`)            | commands-agent, data-insights-agent, web-agent, todos-agent, chat-agent |
| Zai        | YES                       | YES (`infra-glm`)               | commands-agent, data-insights-agent, web-agent, todos-agent, chat-agent |
| Anthropic  | NO                        | YES (`infra-claude`)            | research-agent (direct), claude-worker (external)                       |
| OpenAI     | NO                        | YES (`infra-gpt`)               | research-agent (direct), image-service (direct)                         |
| Perplexity | NO                        | YES (`infra-perplexity`)        | research-agent (direct)                                                 |

**Documentation gap:** The `llm-factory` package README describes itself as "unified factory for creating provider-specific LLM clients" but the `SupportedProvider` type is narrowed to only `Google | Zai`. No documentation explains this deliberate limitation or guides developers to use `infra-claude`, `infra-gpt`, or `infra-perplexity` directly when needed.

---

## 13. ENHANCED: Display Name vs Model ID Consistency Matrix

The system uses three representation levels that must be understood separately:

| Model              | Display Name      | Short Form (NOT valid ID)           | Full Model ID (valid)      |
| ------------------ | ----------------- | ----------------------------------- | -------------------------- |
| ClaudeOpus45       | Claude Opus 4.5   | claude-opus-4.5                     | claude-opus-4-5-20251101   |
| ClaudeSonnet45     | Claude Sonnet 4.5 | claude-sonnet-4.5                   | claude-sonnet-4-5-20250929 |
| ClaudeHaiku35      | Claude 3.5 Haiku  | claude-3.5-haiku / claude-3-5-haiku | claude-3-5-haiku-20241022  |
| Gemini25Pro        | Gemini 2.5 Pro    | gemini-2.5-pro (same as full)       | gemini-2.5-pro             |
| Gemini25Flash      | Gemini 2.5 Flash  | gemini-2.5-flash (same)             | gemini-2.5-flash           |
| GPT52              | GPT-5.2           | gpt-5.2 (same)                      | gpt-5.2                    |
| O4MiniDeepResearch | o4-mini (WRONG)   | o4-mini (NOT valid)                 | o4-mini-deep-research      |

**Key insight:** Google, OpenAI (non-Claude), Perplexity, and Zai model IDs are self-describing (same as display form). Anthropic model IDs include a version date suffix that is easy to omit in documentation. The research-agent technical.md consistently uses the wrong form `claude-opus-4.5` and `claude-sonnet-4.5`.

The `FAST_MODEL_DISPLAY_NAMES` constant in `supportedModels.ts` defines the canonical display names for fast models only. There is no canonical display name registry for all 16 models.

---

## 14. Summary of Issues

### Critical Issues (CRITICAL = wrong model used in prod)

| #   | Issue                                                               | Status                 | Impact                                                 |
| --- | ------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| 1   | `gpt-4.1` not in llm-contract                                       | ❌ Open                 | Model exists in production but not in central registry |
| 2   | `text-embedding-3-small` not in llm-contract                        | ❌ Open                 | Embedding model not tracked in central model inventory |
| 3   | `o4-mini` used in test fixtures (should be `o4-mini-deep-research`) | ❌ Open                 | Test data uses invalid model ID -- could hide bugs     |
| 4   | chat-agent and code-agent missing from overview.md and index.md     | ✅ Resolved 2026-02-19  | Both services now documented                           |

### High Severity Issues (HIGH = model count wrong in docs)

| #   | Issue                                                                                           | Status  | Impact                                           |
| --- | ----------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------ |
| 5   | overview.md says "17 models" then "16 models" -- self-contradicting                             | ❌ Open  | Contradictory model count in same doc            |
| 6   | index.md claims "17 models" -- wrong count                                                      | ❌ Open  | Incorrect count for the 16-model registry        |
| 7   | GLM-4.7 listed as ValidationModel in index.md but `ValidationModel` type only has GLM-4.7-Flash | ❌ Open  | Type vs doc mismatch -- 5 vs 6 validation models |
| 8   | `llm-factory` limitation (Google + Zai only) not documented                                     | ❌ Open  | Developers may try to use factory for Claude/GPT |

### Medium Severity Issues (MEDIUM = naming inconsistency)

| #   | Issue                                                                                                       | Status  | Impact                                       |
| --- | ----------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------- |
| 9   | Anthropic model IDs in docs use short names (claude-opus-4.5, claude-sonnet-4.5)                            | ❌ Open  | Developers may use wrong model IDs from docs |
| 10  | index.md omits GLM-4.7-Flash from commands-agent                                                            | ❌ Open  | Incomplete capability documentation          |
| 11  | index.md says todos-agent uses "Via commands-agent"                                                         | ❌ Open  | Incorrect -- todos-agent calls LLM directly  |
| 12  | Overview omits Gemini 2.0 Flash, GPT-4o Mini, GPT-4.1 from provider table                                   | ❌ Open  | Incomplete model listing                     |
| 13  | data-insights-agent and web-agent docs claim specific models when they actually use user's configured model | ❌ Open  | Misleading specificity                       |
| 14  | infra-claude JSDoc uses `claude-sonnet-4-5` (no version suffix); infra-gpt JSDoc uses `gpt-4.1`             | ❌ Open  | Misleading code examples in package docs     |
| 15  | `gemini-2.0-flash-exp` used in test fixtures (deprecated; should be `gemini-2.0-flash`)                     | ❌ Open  | Deprecated model in test data                |

### Low Severity Issues (LOW = cosmetic)

| #   | Issue                                                                          | Status  | Impact                                       |
| --- | ------------------------------------------------------------------------------ | ------- | -------------------------------------------- |
| 16  | Gemini Flash Image naming varies across docs                                   | ❌ Open  | Cosmetic inconsistency                       |
| 17  | GPT-Image-1 redundant parenthetical in index.md                                | ❌ Open  | Cosmetic                                     |
| 18  | overview.md "5 providers" claim does not count OpenAI embedding API separately | ❌ Open  | Technically correct but incomplete           |
| 19  | No canonical display name registry for all 16 models (only FastModel covered)  | ❌ Open  | Minor -- FAST_MODEL_DISPLAY_NAMES incomplete |

---

## 15. Recommendations

1. **Add `gpt-4.1` and `text-embedding-3-small` to llm-contract** or document why they are excluded from the central model registry.
2. ~~**Update overview.md and index.md** to include chat-agent and code-agent services.~~ ✅ Resolved 2026-02-19.
3. **Fix model count** -- decide on a consistent count (16 in llm-contract, or 18 including `gpt-4.1` and `text-embedding-3-small`) and use it everywhere.
4. **Standardize Anthropic model naming in docs** -- use display names for human-readable docs and full model IDs for technical references. Never use the hybrid short form `claude-opus-4.5`.
5. **Fix todos-agent AI attribution** in index.md -- it uses its own LLM calls, not "Via commands-agent".
6. **Add GLM-4.7-Flash** to commands-agent listing in index.md.
7. **Clarify "user's configured model"** for data-insights-agent and web-agent instead of claiming specific models.
8. **Add Gemini 2.0 Flash and GPT-4o Mini** to the AI Stack table in overview.md (currently only shows 3 per row for Google and OpenAI).
9. **Resolve GLM-4.7 vs GLM-4.7-Flash** for validation: update `ValidationModel` type to include `Glm47` if user-service validates with it, or update docs to show only `Glm47Flash`.
10. **Fix test fixtures**: replace `o4-mini` with `o4-mini-deep-research` and `gemini-2.0-flash-exp` with `gemini-2.0-flash` in research-agent and app-settings-service tests.
11. **Document llm-factory scope** -- add a note to the factory README and to llm-factory docs explaining it only handles Google and Zai providers, and that Anthropic/OpenAI/Perplexity require direct infra-\* package usage.
12. **Fix JSDoc examples** in `infra-claude/src/client.ts`, `infra-gpt/src/client.ts`, and `llm-pricing/src/pricingClient.ts` to use valid full model IDs.
13. **Add canonical display name table** for all 16 models (extending `FAST_MODEL_DISPLAY_NAMES` to all models).
