# LLM Costs & Pricing

> **Auto-generated documentation** - Do not edit manually.
> Last updated: 2026-01-04
> Pricing verified from official sources as of this date.

This document provides comprehensive information about LLM costs in IntexuraOS, including official pricing, how costs are calculated in code, and where models are used.

## Quick Reference: Model Pricing

### Token Pricing (per million tokens)

| Provider       | Model                      | Input | Output | Web Search       | Purpose             |
| -------------- | -------------------------- | ----- | ------ | ---------------- | ------------------- |
| **Anthropic**  | claude-opus-4-5-20251101   | $5.00 | $25.00 | $0.01/call       | Research            |
|                | claude-sonnet-4-5-20250929 | $3.00 | $15.00 | $0.01/call       | Quick               |
|                | claude-haiku-4-5-20251001  | $1.00 | $5.00  | $0.01/call       | Validation          |
| **Google**     | gemini-2.5-pro             | $1.25 | $10.00 | $0.035/req       | Research            |
|                | gemini-2.5-flash           | $0.30 | $2.50  | $0.035/req       | Quick/Title/Context |
|                | gemini-2.5-flash-lite      | $0.10 | $0.40  | N/A              | Evaluate            |
| **OpenAI**     | o4-mini-deep-research      | $1.10 | $4.40  | $0.01/call       | Research            |
|                | gpt-5.2                    | $2.50 | $10.00 | $0.01/call       | Quick               |
|                | gpt-5-nano                 | $0.15 | $0.60  | N/A              | Evaluate            |
| **Perplexity** | sonar-pro                  | $3.00 | $15.00 | $0.006-0.012/req | Research            |
|                | sonar-deep-research        | $2.00 | $8.00  | included         | Deep Research       |

### Additional Pricing Factors

| Provider   | Factor               | Price       | Description            |
| ---------- | -------------------- | ----------- | ---------------------- |
| Anthropic  | Cache write (5min)   | 1.25x input | Cache creation tokens  |
| Anthropic  | Cache read           | 0.1x input  | 90% discount on cached |
| OpenAI     | Cached tokens        | 0.25x input | 75% discount           |
| Google     | Long context (>200k) | 2x rates    | Both input and output  |
| Perplexity | Request fee (low)    | $0.005/req  | Low search context     |
| Perplexity | Request fee (medium) | $0.008/req  | Medium search context  |
| Perplexity | Request fee (high)   | $0.012/req  | High search context    |

**Sources:**

- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Google Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenAI Pricing](https://openai.com/api/pricing/)
- [Perplexity Pricing](https://docs.perplexity.ai/getting-started/pricing)

---

## Web Search Token Counting

### Critical Difference Between Providers

For the **same weather research query**, providers reported vastly different token counts:

| Provider | Input Tokens | Explanation                            |
| -------- | ------------ | -------------------------------------- |
| Gemini   | 480          | Only counts your prompt                |
| OpenAI   | 37,739       | Includes scraped web content           |
| Claude   | 89,080       | Includes ALL search results in context |

This **185x difference** is not a bug—it reflects fundamentally different architectures.

### Anthropic Claude

Web search results are returned as `tool_result` blocks and **all search content is counted as input tokens**.

**API Response Fields:**

```json
{
  "usage": {
    "input_tokens": 89080,
    "output_tokens": 2741,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

**What we extract:** `input_tokens`, `output_tokens`
**What we miss:** `cache_creation_input_tokens`, `cache_read_input_tokens`, web search call count

### Google Gemini

Search grounding happens "behind the scenes". `promptTokenCount` **only reflects the original prompt**, not search results.

**API Response Fields:**

```json
{
  "usageMetadata": {
    "promptTokenCount": 480,
    "candidatesTokenCount": 2823,
    "thoughtsTokenCount": 0,
    "toolUsePromptTokenCount": 0
  }
}
```

**What we extract:** `promptTokenCount`, `candidatesTokenCount`
**What we miss:** Grounding flat fee ($0.035/request)

### OpenAI GPT

Web search results become part of context. Users report **50-120x token inflation** compared to prompts without search.

**API Response Fields:**

```json
{
  "usage": {
    "input_tokens": 37739,
    "output_tokens": 3729,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens_details": { "reasoning_tokens": 20416 }
  }
}
```

**What we extract:** `input_tokens`, `output_tokens`
**What we miss:** `cached_tokens`, `reasoning_tokens`, web search call count

### Perplexity Sonar

**Returns ready-made cost in API response** — no manual calculation needed!

**API Response Fields:**

```json
{
  "usage": {
    "prompt_tokens": 480,
    "completion_tokens": 2823,
    "search_context_size": "medium",
    "cost": {
      "input_tokens_cost": 0.00144,
      "output_tokens_cost": 0.04234,
      "request_cost": 0.008,
      "total_cost": 0.05178
    }
  }
}
```

**What we extract:** `prompt_tokens`, `completion_tokens`
**What we miss:** `cost.total_cost` (the exact cost!), `search_context_size`

---

## Model Usage in Codebase

### Supported Models Registry

**Location:** `packages/llm-contract/src/supportedModels.ts`

| Model                      | Provider   | Display Name             | Mode     |
| -------------------------- | ---------- | ------------------------ | -------- |
| gemini-2.5-pro             | google     | Gemini Pro (research)    | Research |
| gemini-2.5-flash           | google     | Gemini Flash (quick)     | Quick    |
| claude-opus-4-5-20251101   | anthropic  | Claude Opus (research)   | Research |
| claude-sonnet-4-5-20250929 | anthropic  | Claude Sonnet (quick)    | Quick    |
| o4-mini-deep-research      | openai     | O4 Mini (research)       | Research |
| gpt-5.2                    | openai     | GPT-5.2 (quick)          | Quick    |
| sonar-pro                  | perplexity | Perplexity Sonar Pro     | General  |
| sonar-deep-research        | perplexity | Perplexity Deep Research | Research |

**System Default Models:** `gemini-2.5-pro`, `claude-opus-4-5-20251101`, `o4-mini-deep-research`

### Execution Points by Purpose

| Purpose               | Count | Providers Used      | Primary Files                       |
| --------------------- | ----- | ------------------- | ----------------------------------- |
| Research (web search) | 6     | All 4               | `infra-*/client.ts`, adapters       |
| Synthesis             | 5     | Claude, Gemini, GPT | `*Adapter.ts`                       |
| Title Generation      | 6     | All 4               | `*Adapter.ts`, `processResearch.ts` |
| Context Inference     | 4     | Gemini              | `ContextInferenceAdapter.ts`        |
| API Key Validation    | 8     | All 4               | `LlmValidatorImpl.ts`               |
| User Test Requests    | 4     | All 4               | `LlmValidatorImpl.ts`               |
| Classification        | 1     | Gemini              | `classifier.ts`                     |
| Context Labeling      | 1     | Gemini              | `GeminiAdapter.ts`                  |
| Image Generation      | 1     | OpenAI (DALL-E)     | `OpenAIImageGenerator.ts`           |

**Total LLM Execution Points: 37**

### Key Execution Files

| File                                                                          | Methods                             | Provider   |
| ----------------------------------------------------------------------------- | ----------------------------------- | ---------- |
| `packages/infra-claude/src/client.ts:112-155`                                 | research, generate                  | Anthropic  |
| `packages/infra-gemini/src/client.ts:110-148`                                 | research, generate                  | Google     |
| `packages/infra-gpt/src/client.ts:112-155`                                    | research, generate                  | OpenAI     |
| `packages/infra-perplexity/src/client.ts:145-214`                             | research, generate                  | Perplexity |
| `apps/llm-orchestrator/src/domain/research/usecases/processResearch.ts:64,83` | generateTitle, inferResearchContext | Dynamic    |
| `apps/llm-orchestrator/src/domain/research/usecases/runSynthesis.ts:115,131`  | inferSynthesisContext, synthesize   | Dynamic    |
| `apps/user-service/src/infra/llm/LlmValidatorImpl.ts:38-136`                  | validateKey, testRequest            | All        |
| `apps/commands-router/src/infra/gemini/classifier.ts:109`                     | classify                            | Gemini     |

---

## Cost Calculation in Code

### Current Implementation

**Location:** `apps/llm-orchestrator/src/domain/research/utils/costCalculator.ts`

```typescript
function calculateCost(inputTokens: number, outputTokens: number, pricing: LlmPricing): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
```

**Formula:**

```
cost = (inputTokens / 1M × inputPrice) + (outputTokens / 1M × outputPrice)
```

Result rounded to 6 decimal places.

### Pricing Data Storage

**Location:** Firestore `app_settings/llm_pricing`

**Schema:**

```typescript
interface LlmPricing {
  provider: LlmProvider;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  updatedAt: string;
}
```

**Key format:** `${provider}_${model}` (e.g., `"anthropic_claude-opus-4-5-20251101"`)

### Migration Files

| Migration                     | Models                         | Source   |
| ----------------------------- | ------------------------------ | -------- |
| `002_initial-llm-pricing.mjs` | Gemini, Claude, GPT (9 models) | Jan 2026 |
| `003_perplexity-pricing.mjs`  | Perplexity Sonar (2 models)    | Jan 2026 |

---

## What We Extract vs What's Available

| Provider       | Field                       | Extracted |   Available    | Impact                              |
| -------------- | --------------------------- | :-------: | :------------: | ----------------------------------- |
| **Anthropic**  | input_tokens                |    ✅     |       ✅       | —                                   |
|                | output_tokens               |    ✅     |       ✅       | —                                   |
|                | cache_creation_input_tokens |    ❌     |       ✅       | Underestimate cache write costs     |
|                | cache_read_input_tokens     |    ❌     |       ✅       | **Overestimate costs by up to 90%** |
|                | web_search_calls            |    ❌     | Count manually | Missing $0.01/call                  |
| **Google**     | promptTokenCount            |    ✅     |       ✅       | —                                   |
|                | candidatesTokenCount        |    ✅     |       ✅       | —                                   |
|                | grounding fee               |    ❌     |      N/A       | Missing $0.035/request              |
| **OpenAI**     | input_tokens                |    ✅     |       ✅       | —                                   |
|                | output_tokens               |    ✅     |       ✅       | —                                   |
|                | cached_tokens               |    ❌     |       ✅       | **Overestimate costs by up to 75%** |
|                | reasoning_tokens            |    ❌     |       ✅       | Informational only                  |
|                | web_search_calls            |    ❌     | Count manually | Missing $0.01/call                  |
| **Perplexity** | prompt_tokens               |    ✅     |       ✅       | —                                   |
|                | completion_tokens           |    ✅     |       ✅       | —                                   |
|                | cost.total_cost             |    ❌     |       ✅       | **Could use exact cost instead!**   |
|                | search_context_size         |    ❌     |       ✅       | Missing request fee info            |

---

## Audit System

### Package Location

`packages/llm-audit/src/`

### Fields Captured

| Field        | Description                           | Always?    |
| ------------ | ------------------------------------- | ---------- |
| id           | UUID                                  | ✅         |
| provider     | google, openai, anthropic, perplexity | ✅         |
| model        | Model identifier                      | ✅         |
| method       | research, synthesis, title, etc.      | ✅         |
| prompt       | Full prompt text                      | ✅         |
| promptLength | Character count                       | ✅         |
| status       | success or error                      | ✅         |
| startedAt    | ISO timestamp                         | ✅         |
| completedAt  | ISO timestamp                         | ✅         |
| durationMs   | Call duration                         | ✅         |
| response     | Response text                         | On success |
| inputTokens  | From provider response                | On success |
| outputTokens | From provider response                | On success |
| costUsd      | Calculated                            | On success |
| error        | Error message                         | On error   |
| userId       | Context                               | Optional   |
| researchId   | Context                               | Optional   |

### Storage

- **Detailed logs:** `llm_api_logs` collection
- **Aggregated stats:** `llm_usage_stats` collection with periods: `total`, `YYYY-MM`, `YYYY-MM-DD`

### Call Types Tracked

```typescript
type LlmCallType =
  | 'research' // Primary research with web search
  | 'synthesis' // Combining multiple results
  | 'title' // Generating titles
  | 'context_inference' // Inferring context
  | 'context_label' // Labeling context
  | 'image_prompt' // Generating image prompts
  | 'image_generation' // Creating images
  | 'validation' // API key validation
  | 'other';
```

---

## True Cost Formulas

### Accurate Calculation per Provider

**Anthropic Claude:**

```
cost = (input_tokens - cache_read_tokens) × input_price
     + cache_read_tokens × input_price × 0.1
     + cache_creation_tokens × input_price × 1.25
     + output_tokens × output_price
     + web_search_calls × $0.01
```

**Google Gemini:**

```
cost = prompt_tokens × input_price
     + candidate_tokens × output_price
     + (grounding_enabled ? $0.035 : 0)
```

**OpenAI:**

```
cost = (input_tokens - cached_tokens) × input_price
     + cached_tokens × input_price × 0.25
     + output_tokens × output_price
     + web_search_calls × $0.01
```

**Perplexity:**

```
cost = response.usage.cost.total_cost  // Already calculated by API!
```

---

## Recommendations

### Short-term Improvements

1. **Use Perplexity's native `cost.total_cost`** instead of calculating manually
2. **Count web search calls** for Claude and OpenAI (parse response for tool calls)
3. **Extract cache tokens** from Claude and OpenAI responses

### Schema Extensions Needed

**TokenUsage interface:**

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  // New fields:
  cacheCreationTokens?: number; // Anthropic
  cacheReadTokens?: number; // Anthropic
  cachedTokens?: number; // OpenAI
  reasoningTokens?: number; // OpenAI
  webSearchCalls?: number; // Anthropic, OpenAI
  totalCost?: number; // Perplexity (use directly!)
}
```

**LlmPricing interface:**

```typescript
interface LlmPricing {
  provider: LlmProvider;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  // New fields:
  webSearchCostPerCall?: number; // $0.01 for Claude/OpenAI
  groundingCostPerRequest?: number; // $0.035 for Gemini
  cacheWriteMultiplier?: number; // 1.25 for Claude
  cacheReadMultiplier?: number; // 0.1 for Claude
  cachedTokenMultiplier?: number; // 0.25 for OpenAI
}
```

---

## Key Files Reference

| File                                                                     | Purpose                          |
| ------------------------------------------------------------------------ | -------------------------------- |
| `packages/llm-contract/src/supportedModels.ts`                           | Model registry                   |
| `packages/llm-contract/src/types.ts`                                     | TokenUsage, LLMClient interfaces |
| `packages/infra-claude/src/client.ts`                                    | Claude API calls                 |
| `packages/infra-gemini/src/client.ts`                                    | Gemini API calls                 |
| `packages/infra-gpt/src/client.ts`                                       | GPT API calls                    |
| `packages/infra-perplexity/src/client.ts`                                | Perplexity API calls             |
| `packages/llm-audit/src/audit.ts`                                        | Audit context creation           |
| `apps/llm-orchestrator/src/domain/research/utils/costCalculator.ts`      | Cost calculation                 |
| `apps/llm-orchestrator/src/infra/pricing/FirestorePricingRepository.ts`  | Pricing storage                  |
| `apps/llm-orchestrator/src/infra/usage/FirestoreUsageStatsRepository.ts` | Usage statistics                 |
| `migrations/002_initial-llm-pricing.mjs`                                 | Initial pricing data             |
| `migrations/003_perplexity-pricing.mjs`                                  | Perplexity pricing               |
