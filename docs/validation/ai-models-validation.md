# AI Models Cross-Validation Report

**Generated:** 2026-02-08
**Scope:** All docs (overview.md, services/index.md, service technical.md files) cross-referenced against code (llm-contract, llm-factory, llm-pricing, service source files)

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
| 7   | `gpt-4o-mini`                | GPT4oMini          | OpenAI     | Validation                                 |
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

| Model ID                 | Used By       | Purpose            | In llm-contract? |
| ------------------------ | ------------- | ------------------ | ---------------- |
| `gpt-4.1`                | image-service | Prompt enhancement | NO               |
| `text-embedding-3-small` | chat-agent    | Vector embeddings  | NO               |

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

- **chat-agent:** Uses `Gemini 2.5 Flash`, `GLM-4.7`, `GLM-4.7-Flash` for chat, plus `text-embedding-3-small` for embeddings. Not listed in `docs/overview.md` or `docs/services/index.md` at all.
- **code-agent:** Does not directly use LLM models (delegates to external workers), but is not listed in the services overview either.

**Significance:** These are newer services (chat-agent created ~7 days ago, code-agent earlier) that have not been added to the overview or services index documentation.

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

---

## 9. Summary of Issues

### Critical Issues

| #   | Issue                                                           | Impact                                                 |
| --- | --------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `gpt-4.1` not in llm-contract                                   | Model exists in production but not in central registry |
| 2   | `text-embedding-3-small` not in llm-contract                    | Embedding model not tracked in central model inventory |
| 3   | chat-agent and code-agent missing from overview.md and index.md | New services not discoverable via main documentation   |
| 4   | overview.md says "17 models" then "16 models"                   | Self-contradicting model count                         |

### Moderate Issues

| #   | Issue                                                                                                       | Impact                                       |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 5   | Anthropic model IDs in docs use short names                                                                 | Developers may use wrong model IDs from docs |
| 6   | index.md omits GLM-4.7-Flash from commands-agent                                                            | Incomplete capability documentation          |
| 7   | index.md says todos-agent uses "Via commands-agent"                                                         | Incorrect -- todos-agent calls LLM directly  |
| 8   | Overview omits Gemini 2.0 Flash, GPT-4o Mini, GPT-4.1 from provider table                                   | Incomplete model listing                     |
| 9   | data-insights-agent and web-agent docs claim specific models when they actually use user's configured model | Misleading specificity                       |

### Minor Issues

| #   | Issue                                                                          | Impact                             |
| --- | ------------------------------------------------------------------------------ | ---------------------------------- |
| 10  | Gemini Flash Image naming varies across docs                                   | Cosmetic inconsistency             |
| 11  | GPT-Image-1 redundant parenthetical in index.md                                | Cosmetic                           |
| 12  | overview.md "5 providers" claim does not count OpenAI embedding API separately | Technically correct but incomplete |

---

## 10. Recommendations

1. **Add `gpt-4.1` and `text-embedding-3-small` to llm-contract** or document why they are excluded from the central model registry.
2. **Update overview.md and index.md** to include chat-agent and code-agent services.
3. **Fix model count** -- decide on a consistent count (16 in llm-contract, or 18 including `gpt-4.1` and `text-embedding-3-small`) and use it everywhere.
4. **Standardize Anthropic model naming in docs** -- use display names for human-readable docs and full model IDs for technical references. Never use the hybrid short form `claude-opus-4.5`.
5. **Fix todos-agent AI attribution** in index.md -- it uses its own LLM calls, not "Via commands-agent".
6. **Add GLM-4.7-Flash** to commands-agent listing in index.md.
7. **Clarify "user's configured model"** for data-insights-agent and web-agent instead of claiming specific models.
