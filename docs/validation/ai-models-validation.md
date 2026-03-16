# AI Models Cross-Validation Report

**Generated:** 2026-02-08
**Updated:** 2026-03-16 (v4 — full refresh against current codebase)
**Scope:** `packages/llm-contract`, `packages/llm-factory`, `apps/` and `workers/` service code, `docs/architecture/ai-architecture.md` cross-referenced for accuracy.

---

## 1. Master Model Inventory (Code as Source of Truth)

Models defined in `packages/llm-contract/src/supportedModels.ts` — the single source of truth:

| #   | Code Model ID                | Type Alias         | Provider   | Categories in Code                     |
| --- | ---------------------------- | ------------------ | ---------- | -------------------------------------- |
| 1   | `gemini-2.5-pro`             | Gemini25Pro        | Google     | Research, Generic                      |
| 2   | `gemini-2.5-flash`           | Gemini25Flash      | Google     | Research, Fast, ToolCalling            |
| 3   | `gemini-2.0-flash`           | Gemini20Flash      | Google     | Validation, Fast                       |
| 4   | `gemini-2.5-flash-image`     | Gemini25FlashImage | Google     | Image                                  |
| 5   | `o4-mini-deep-research`      | O4MiniDeepResearch | OpenAI     | Research                               |
| 6   | `gpt-5.2`                    | GPT52              | OpenAI     | Research, Generic                      |
| 7   | `gpt-4o-mini`                | GPT4oMini          | OpenAI     | Validation, Fast                       |
| 8   | `gpt-image-1`                | GPTImage1          | OpenAI     | Image                                  |
| 9   | `claude-opus-4-5-20251101`   | ClaudeOpus45       | Anthropic  | Research                               |
| 10  | `claude-sonnet-4-5-20250929` | ClaudeSonnet45     | Anthropic  | Research                               |
| 11  | `claude-3-5-haiku-20241022`  | ClaudeHaiku35      | Anthropic  | Validation, Fast                       |
| 12  | `sonar`                      | Sonar              | Perplexity | Research, Validation                   |
| 13  | `sonar-pro`                  | SonarPro           | Perplexity | Research                               |
| 14  | `sonar-deep-research`        | SonarDeepResearch  | Perplexity | Research                               |

**Total in llm-contract: 14 models across 4 providers.**

The file header comment says "All 14 models from migrations 012+".

### Models Used in Code but NOT in llm-contract

| Model ID                 | Used By                                                   | Purpose                           |
| ------------------------ | --------------------------------------------------------- | --------------------------------- |
| `gpt-4.1`                | `apps/image-service/src/infra/llm/GptPromptAdapter.ts:16` | Default prompt-enhancement model  |
| `text-embedding-3-small` | `apps/chat-agent/src/infra/llm/embeddingClient.ts:56`     | OpenAI embeddings for RAG search  |

Both models are used with provider-specific clients (`infra-gpt`, OpenAI SDK directly) and bypass `llm-contract` entirely.

**Effective total unique models in production: 16**

---

## 2. llm-factory Provider Support

`packages/llm-factory/src/llmClientFactory.ts` defines:

```typescript
type SupportedProvider = typeof LlmProviders.Google;
```

**Only Google (Gemini) is supported.** Both `createLlmClient()` and `createToolCallingClient()` throw at runtime if the model's provider is not Google.

Services using non-Google providers create clients directly via provider-specific packages:

| Provider   | Package               | Services Using It Directly                              |
| ---------- | --------------------- | ------------------------------------------------------- |
| Google     | `infra-gemini`        | via llm-factory (all agents) + image-service directly   |
| OpenAI     | `infra-gpt`           | research-agent, image-service (GptPromptAdapter)        |
| Anthropic  | `infra-claude`        | research-agent                                          |
| Perplexity | `infra-perplexity`    | research-agent                                          |

There is no `infra-glm` package with implemented source code in the repository. The path `packages/infra-glm/` contains only a `node_modules/.bin/openai` symlink, not a real package.

---

## 3. research-agent: Actual Model Set (from `apps/research-agent/src/index.ts`)

`REQUIRED_MODELS` at startup (lines 48–61):

```
gemini-2.5-pro, gemini-2.5-flash, claude-opus-4-5-20251101,
claude-sonnet-4-5-20250929, o4-mini-deep-research, gpt-5.2,
sonar, sonar-pro, sonar-deep-research, gemini-2.0-flash
```

**10 models** (9 research + 1 fast for title generation). `SonarDeepResearch` is in the list.
Neither GLM-5 nor any Zai model appears.

---

## 4. Discrepancies: `docs/architecture/ai-architecture.md` vs Code

The architecture doc is at version **2.0.0, dated 2026-01-24**. The codebase has advanced significantly since that date. The following discrepancies were found.

### 4.1 GLM-5 / Zai Provider — Phantom Model

**ai-architecture.md claims:**
- Research Models table (line 111): `GLM-5 | Alibaba Cloud | Code tasks, multilingual`
- Model Selection Strategy table (line 91): `Quick Classification | Gemini 2.5 Flash | GLM-5`
- Provider Integration diagram: `IZ[infra-glm]` and `Z[Zai API]`
- Research Synthesis diagram: `Z[GLM]` as a parallel query target
- Research Adapters section: `GlmAdapter - Zai integration`
- Provider Packages table (line 432): `@intexuraos/infra-glm | Zai | Chat, structured output`
- Packages table (line 650): `@intexuraos/infra-glm | Zai adapter`

**Code reality:**
- `LlmModels` has no GLM model of any kind.
- `LlmProviders` has no `Zai` provider.
- No `infra-glm` package with source code exists (only a stale symlink under `packages/infra-glm/node_modules/`).
- `llm-factory` only supports `LlmProviders.Google`.
- `research-agent` REQUIRED_MODELS has no GLM model.

**Severity: Critical.** The entire Zai/GLM section of the architecture doc describes functionality that does not exist in the current codebase.

### 4.2 Research Models Table — Wrong Count and Missing Model

**ai-architecture.md section header (line 96):** "Research Models (11)"
**Table rows:** 10 rows (including the phantom GLM-5).
**Code (ResearchModel type):** 9 models — `gemini-2.5-pro`, `gemini-2.5-flash`, `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `o4-mini-deep-research`, `gpt-5.2`, `sonar`, `sonar-pro`, `sonar-deep-research`.

- Header says 11 but table has 10 rows — internal inconsistency.
- Code has 9 research models, not 10 or 11.
- `gemini-2.0-flash` is NOT in the `ResearchModel` type (it is `FastModel`/`ValidationModel` only) but appears in the research-agent `REQUIRED_MODELS` for title generation as a fast model, not as a research model.

### 4.3 Fast Models Table — Incomplete

**ai-architecture.md Fast Models table (lines 119–121):** Lists only 2 models:
- Gemini 2.5 Flash
- Gemini 2.0 Flash

**Code (`FastModel` type):** 4 models — `gemini-2.5-flash`, `gemini-2.0-flash`, `claude-3-5-haiku-20241022`, `gpt-4o-mini`.

Claude Haiku 3.5 and GPT-4o Mini are missing from the Fast Models section of the doc.

### 4.4 llm-factory Code Example — Invalid Interface

**ai-architecture.md lines 411–421:**
```typescript
const client = createLlmClient({
  provider: 'anthropic',
  model: 'claude-opus-4-5-20251101',
  apiKey: userApiKey,
});
```

**Code reality (`LlmClientConfig` interface in `packages/llm-factory/src/llmClientFactory.ts`):**
- There is no `provider` field in `LlmClientConfig`. Provider is inferred from the model via `getProviderForModel()`.
- `anthropic` provider is not supported by `llm-factory` — it throws `"Unsupported LLM provider: anthropic. Only google is supported."` at runtime.
- The required fields are: `apiKey`, `model`, `userId`, `pricing`, `logger`.

This code example would not compile and would throw at runtime if attempted.

### 4.5 Research Synthesis Diagram — Includes GLM

The sequence diagram (lines 163–194) and the AI Pipeline Architecture diagram (lines 230–300) both include `Z[GLM]` as an active participant. This is inaccurate — GLM is not used.

The AI Pipeline Architecture diagram also references `GLM1` as a classification participant alongside `GEM1` (Gemini), which contradicts the actual commands-agent code that uses only Gemini-family models.

### 4.6 Commands Agent — GLM Reference

**ai-architecture.md line 311:** "AI Models: Gemini 2.5 Flash"
This is correct for the current codebase but the diagrams on lines 278–280 show `CMD --> GLM1` and `GLM1 --> AA`, implying GLM is also used for classification. No GLM usage is present in the apps code.

### 4.7 Provider Package Table — infra-glm Listed

**ai-architecture.md lines 425–432 (Provider Packages table):** Lists `@intexuraos/infra-glm` as a real package. It does not exist as a functioning package.

### 4.8 Research Agent — "All 10 research models" Claim

**ai-architecture.md line 325:** "AI Models: All 10 research models"
Code has 9 models in the `ResearchModel` type. With the fast model used for title generation (`gemini-2.0-flash`), the startup set is 10 models total — but only 9 are typed as `ResearchModel`. The claim should be "9 research models + 1 fast model".

---

## 5. Model Count Summary

| Source                                          | Model Count Claimed | Actual                                                       |
| ----------------------------------------------- | ------------------- | ------------------------------------------------------------ |
| `llm-contract/src/supportedModels.ts` (comment) | 14                  | 14 ✓                                                         |
| `ai-architecture.md` Research Models header     | 11                  | 9 (ResearchModel type), 10 in research-agent REQUIRED_MODELS |
| `ai-architecture.md` Fast Models table          | 2 rows              | 4 (FastModel type)                                           |
| `ai-architecture.md` Provider packages table    | 5 providers         | 4 active providers (no Zai)                                  |
| Models in production (including off-contract)   | —                   | 16 (14 in contract + gpt-4.1 + text-embedding-3-small)       |

---

## 6. Models in Code Outside llm-contract

### `gpt-4.1` — Image Prompt Enhancement

- **File:** `apps/image-service/src/infra/llm/GptPromptAdapter.ts` line 16
- **Default for:** thumbnail prompt generation via OpenAI text completion
- **Not in:** `LlmModels`, `LLMModel` type, `ALL_LLM_MODELS` array
- **Uses:** `infra-gpt` `createGptClient()` directly, bypassing llm-factory
- **Note:** `ai-architecture.md` does not document `gpt-4.1` at all (not in any model table)

### `text-embedding-3-small` — Vector Embeddings

- **File:** `apps/chat-agent/src/infra/llm/embeddingClient.ts` line 56
- **Purpose:** OpenAI Ada-style embeddings for RAG semantic search in chat-agent
- **Not in:** `LlmModels`, `LLMModel` type
- **Uses:** OpenAI SDK directly (`openai.embeddings.create`)
- **Note:** Embedding models are architecturally different from generation models — no token pricing, different API surface. Their omission from the generation model contract is intentional but undocumented.

---

## 7. Removed Models (Present in Previous Report, Gone from Current Code)

The v3 report (2026-02-19) documented GLM models `glm-4.7` and `glm-4.7-flash` in llm-contract with `Zai` as a fifth provider. These have been entirely removed:

| Removed Item                        | Previous Status           | Current Status |
| ----------------------------------- | ------------------------- | -------------- |
| `glm-4.7` model                     | In LlmModels              | Removed        |
| `glm-4.7-flash` model               | In LlmModels              | Removed        |
| `Zai` provider in LlmProviders      | Present                   | Removed        |
| `infra-glm` package                 | Functional package        | Stub only      |
| `llm-factory` Zai support           | Supported provider        | Removed        |
| `ValidationModel` Glm47Flash entry  | In type                   | Removed        |
| `FastModel` Glm47Flash entry        | In type                   | Removed        |

The `ai-architecture.md` has not been updated to reflect these removals and continues to describe GLM-5/Zai as active components.

---

## 8. Issues Resolved Since Last Report

| Issue from v3 Report                                              | Status          |
| ----------------------------------------------------------------- | --------------- |
| chat-agent and code-agent missing from overview docs              | ✅ Resolved      |
| `o4-mini` in test fixtures (should be `o4-mini-deep-research`)    | Not re-verified |
| `gemini-2.0-flash-exp` in test fixtures (deprecated)              | Not re-verified |

---

## 9. Summary of Open Issues

### Critical

| #   | Issue                                                                                                                | Evidence                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `ai-architecture.md` describes GLM-5/Zai as active — phantom provider                                                | No LlmProviders.Zai, no infra-glm source, no GLM in REQUIRED_MODELS     |
| 2   | `ai-architecture.md` llm-factory code example uses nonexistent `provider` field and unsupported `anthropic` provider | `LlmClientConfig` has no `provider` field; factory throws for anthropic |

### High

| #   | Issue                                                                                  | Evidence                                                                |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 3   | `ai-architecture.md` Fast Models table lists 2 models; `FastModel` type has 4          | Missing Claude Haiku 3.5 and GPT-4o Mini                                |
| 4   | `ai-architecture.md` Research Models header says "(11)"; type has 9, table has 10 rows | `ResearchModel` union in supportedModels.ts                             |
| 5   | `llm-factory` Google-only limitation not documented anywhere                           | `SupportedProvider = typeof LlmProviders.Google` in llmClientFactory.ts |
| 6   | `gpt-4.1` used in production but not in llm-contract                                   | GptPromptAdapter.ts line 16                                             |

### Medium

| #   | Issue                                                                                          | Evidence                                                          |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 7   | `text-embedding-3-small` used in production but not in llm-contract                            | embeddingClient.ts line 56                                        |
| 8   | `ai-architecture.md` sequence and pipeline diagrams include GLM as active participant          | Lines 163–194, 230–300                                            |
| 9   | `ai-architecture.md` Research Agent section claims "All 10 research models" — wrong type count | ResearchModel has 9; REQUIRED_MODELS has 10 (9 research + 1 fast) |

---

## 10. Recommendations

1. **Update `ai-architecture.md`** — remove all GLM-5/Zai content (provider diagram, sequence diagram, pipeline diagram, Research Adapters section, Provider Packages table, Packages table). The doc version should be bumped to 3.0.0.
2. **Fix Fast Models table** in `ai-architecture.md` — add `Claude 3.5 Haiku` and `GPT-4o Mini`.
3. **Fix Research Models header** — change "(11)" to "(9 research models)" and reconcile with the `ResearchModel` type.
4. **Fix llm-factory code example** — remove the `provider` field, use a valid Google model, add `userId`, `pricing`, and `logger` fields.
5. **Document llm-factory scope** — add a note that only `google` provider is supported; Anthropic/OpenAI/Perplexity require direct `infra-*` package usage.
6. **Document `gpt-4.1`** — either add it to llm-contract as an explicit out-of-band model, or add a comment in `GptPromptAdapter.ts` explaining why it is not in the contract.
7. **Document embedding model exclusion** — add a note in the architecture doc or llm-contract explaining that `text-embedding-3-small` is intentionally excluded from the generative model registry.

---

**Last updated:** 2026-03-16 (v4)
