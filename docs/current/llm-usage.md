# LLM Usage

## Overview

IntexuraOS leverages multiple Large Language Model providers to deliver intelligent research, synthesis, and content generation capabilities. The system orchestrates parallel calls across providers to maximize quality and reliability, automatically synthesizing results into comprehensive, well-structured outputs.

**Key capabilities powered by LLMs:**

- **Research** — Deep web-grounded research using multiple AI providers simultaneously (Claude, Gemini, GPT, Perplexity)
- **Synthesis** — Intelligent combination of multiple research results into cohesive, comprehensive reports
- **Title Generation** — Automatic creation of meaningful titles based on research content
- **Context Inference** — Understanding user intent, language, and domain to tailor responses
- **Image Generation** — AI-powered cover image creation from research summaries
- **API Key Validation** — Lightweight model calls to verify user-provided API credentials

The system is designed for resilience: if one provider fails or is rate-limited, research continues with available providers. Gemini serves as the default and fallback provider.

## Pricing Reference

Pricing data verified as of: **2026-01-04**

## Quick Reference: Model Pricing

### Token Pricing (per million tokens)

| Provider   | Model                      | Input  | Output  | Web Search  | Notes                    |
| ---------- | -------------------------- | ------ | ------- | ----------- | ------------------------ |
| Anthropic  | claude-opus-4-5-20251101   | $5.00  | $25.00  | $0.01/call  | Research model           |
| Anthropic  | claude-sonnet-4-5-20250929 | $3.00  | $15.00  | $0.01/call  | Quick model              |
| Google     | gemini-2.5-pro             | $2.00  | $12.00  | $0.035/req  | Research model           |
| Google     | gemini-2.5-flash           | $0.50  | $3.00   | $0.035/req  | Quick model, context     |
| OpenAI     | o4-mini-deep-research      | $1.10  | $4.40   | included    | Research model           |
| OpenAI     | gpt-5.2                    | $1.75  | $14.00  | $0.01/call  | Quick model              |
| Perplexity | sonar                      | $1.00  | $1.00   | $0.005/req  | Validation, low context  |
| Perplexity | sonar-pro                  | $3.00  | $15.00  | $0.005/req  | Research, medium context |
| Perplexity | sonar-deep-research        | $2.00  | $8.00   | included    | Deep research, high ctx  |

### Image Generation Pricing

| Provider | Model    | Size      | Quality  | Price/Image | Notes                |
| -------- | -------- | --------- | -------- | ----------- | -------------------- |
| OpenAI   | DALL-E 3 | 1024x1024 | standard | $0.040      | Cover images         |
| OpenAI   | DALL-E 3 | 1024x1024 | hd       | $0.080      | High quality         |
| OpenAI   | DALL-E 3 | 1792x1024 | standard | $0.080      | Wide format          |
| OpenAI   | DALL-E 3 | 1792x1024 | hd       | $0.120      | Wide HD              |
| Google   | Imagen 3 | 1024x1024 | -        | $0.050      | Alternative provider |

### Additional Pricing Factors

| Provider  | Factor               | Price        | Description       |
| --------- | -------------------- | ------------ | ----------------- |
| Anthropic | Cache write          | 1.25x input  | 5-minute cache    |
| Anthropic | Cache read           | 0.1x input   | 90% discount      |
| OpenAI    | Cached tokens        | 0.25x input  | 75% discount      |
| Google    | Grounding (Gemini 3) | $0.014/query | Starting Jan 2026 |

## Web Search Token Counting

**Critical difference between providers:**

### Anthropic Claude

- Web search results are returned as `tool_result` blocks
- **All search content is counted as input tokens**
- Example: Simple query can generate 80,000+ input tokens
- Additional $0.01 per web search call

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

### Google Gemini

- Search grounding happens "behind the scenes"
- `promptTokenCount` only reflects the original prompt
- **Search content is NOT included in token count**
- Flat fee per request (not per token)

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

### OpenAI GPT

- Web search results become part of context
- **Search content IS counted as input tokens**
- Users report 50-120x token inflation
- Additional $0.01 per web search call

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

### Perplexity Sonar

- **Returns ready-made cost in API response**
- No manual calculation needed
- Request fee varies by search context size

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

## Supported Models Registry

**Location:** `packages/llm-contract/src/supportedModels.ts`

| Model ID                   | Provider   | Display Name               | Use Case |
| -------------------------- | ---------- | -------------------------- | -------- |
| gemini-2.5-pro             | google     | Gemini Pro (research)      | Research |
| gemini-2.5-flash           | google     | Gemini Flash (quick)       | Quick    |
| claude-opus-4-5-20251101   | anthropic  | Claude Opus (research)     | Research |
| claude-sonnet-4-5-20250929 | anthropic  | Claude Sonnet (quick)      | Quick    |
| o4-mini-deep-research      | openai     | O4 Mini (research)         | Research |
| gpt-5.2                    | openai     | GPT-5.2 (quick)            | Quick    |
| sonar                      | perplexity | Perplexity Sonar           | Basic    |
| sonar-pro                  | perplexity | Perplexity Sonar Pro       | Research |
| sonar-deep-research        | perplexity | Perplexity Deep Research   | Deep     |

**System Default Models:** gemini-2.5-pro, claude-opus-4-5-20251101, gpt-5.2, sonar-pro

## Model Usage in Codebase

### By Feature

| Feature            | Provider    | Model           | Method            | File                      |
| ------------------ | ----------- | --------------- | ----------------- | ------------------------- |
| Research (deep)    | Multiple    | `researchModel` | `research()`      | `processLlmCall.ts`       |
| Research (quick)   | Multiple    | `defaultModel`  | `research()`      | `processLlmCall.ts`       |
| Title generation   | Google      | gemini-2.5-flash | `generateTitle()` | `processResearch.ts`      |
| Synthesis          | User choice | Any             | `synthesize()`    | `runSynthesis.ts`         |
| Context inference  | Google      | gemini-2.5-flash | `generate()`      | `ContextInferenceAdapter` |
| API key validation | Each        | Provider basic  | `evaluate()`      | `LlmValidatorImpl.ts`     |
| Image prompt       | Google      | gemini-2.5-pro  | `generate()`      | `GptPromptAdapter.ts`     |
| Image generation   | OpenAI      | dall-e-3        | `generateImage()` | `OpenAIImageGenerator.ts` |

### Execution Points

| Service          | File                                    | Function              | Purpose                |
| ---------------- | --------------------------------------- | --------------------- | ---------------------- |
| llm-orchestrator | `infra/llm/GptAdapter.ts`               | `research()`          | GPT research calls     |
| llm-orchestrator | `infra/llm/GptAdapter.ts`               | `synthesize()`        | GPT synthesis          |
| llm-orchestrator | `infra/llm/GptAdapter.ts`               | `generateTitle()`     | Title generation       |
| llm-orchestrator | `infra/llm/ClaudeAdapter.ts`            | `research()`          | Claude research calls  |
| llm-orchestrator | `infra/llm/ClaudeAdapter.ts`            | `synthesize()`        | Claude synthesis       |
| llm-orchestrator | `infra/llm/ClaudeAdapter.ts`            | `generateTitle()`     | Title generation       |
| llm-orchestrator | `infra/llm/GeminiAdapter.ts`            | `research()`          | Gemini research calls  |
| llm-orchestrator | `infra/llm/GeminiAdapter.ts`            | `synthesize()`        | Gemini synthesis       |
| llm-orchestrator | `infra/llm/GeminiAdapter.ts`            | `generateTitle()`     | Title generation       |
| llm-orchestrator | `infra/llm/GeminiAdapter.ts`            | `generateContextLabel()` | Context labels      |
| llm-orchestrator | `infra/llm/PerplexityAdapter.ts`        | `research()`          | Perplexity research    |
| llm-orchestrator | `infra/llm/ContextInferenceAdapter.ts`  | `inferResearchContext()` | Context inference   |
| llm-orchestrator | `infra/llm/ContextInferenceAdapter.ts`  | `inferSynthesisContext()` | Synthesis context  |
| user-service     | `infra/llm/LlmValidatorImpl.ts`         | `validateKey()`       | API key validation     |
| image-service    | `infra/GptPromptAdapter.ts`             | `generatePrompt()`    | Image prompt creation  |
| image-service    | `infra/OpenAIImageGenerator.ts`         | `generateImage()`     | DALL-E image gen       |

## Cost Calculation in Code

### Current Implementation

**Location:** `apps/llm-orchestrator/src/domain/research/utils/costCalculator.ts`

```typescript
// Current formula (simplified)
cost =
  (inputTokens / 1_000_000) * pricing.inputPricePerMillion +
  (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
```

### What We Extract vs What's Available

| Provider   | Field                       | We Extract |   Available    | Impact                    |
| ---------- | --------------------------- | :--------: | :------------: | ------------------------- |
| Anthropic  | input_tokens                |     Yes    |       Yes      | -                         |
| Anthropic  | output_tokens               |     Yes    |       Yes      | -                         |
| Anthropic  | cache_creation_input_tokens |     No     |       Yes      | Underestimate cache costs |
| Anthropic  | cache_read_input_tokens     |     No     |       Yes      | Overestimate costs        |
| Anthropic  | web_search_calls            |     No     | Count manually | Missing $0.01/call        |
| Google     | promptTokenCount            |     Yes    |       Yes      | -                         |
| Google     | candidatesTokenCount        |     Yes    |       Yes      | -                         |
| Google     | grounding fee               |     No     |      N/A       | Missing flat fee          |
| OpenAI     | input_tokens                |     Yes    |       Yes      | -                         |
| OpenAI     | output_tokens               |     Yes    |       Yes      | -                         |
| OpenAI     | cached_tokens               |     No     |       Yes      | Overestimate costs        |
| OpenAI     | reasoning_tokens            |     No     |       Yes      | Informational             |
| OpenAI     | web_search_calls            |     No     | Count manually | Missing $0.01/call        |
| Perplexity | prompt_tokens               |     Yes    |       Yes      | -                         |
| Perplexity | completion_tokens           |     Yes    |       Yes      | -                         |
| Perplexity | cost.total_cost             |     No     |       Yes      | **Could use exact cost!** |
| OpenAI     | image_size                  |     No     |       Yes      | Affects pricing           |
| OpenAI     | image_quality               |     No     |       Yes      | hd vs standard            |
| OpenAI     | images_generated            |     No     |       Yes      | Count of images           |

### Pricing Data Storage

**Location:** Firestore `app_settings/llm_pricing`

**Migrations:**

- `002_initial-llm-pricing.mjs` - Base pricing for Claude, Gemini, GPT
- `003_perplexity-pricing.mjs` - Added Perplexity models
- `004_openai-pricing-jan-2025.mjs` - OpenAI pricing update
- `005_llm-pricing-update-jan-2026.mjs` - Latest pricing update (2026-01-04)

**Current Schema:**

```typescript
interface LlmPricing {
  provider: LlmProvider;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  updatedAt: string;
}
```

**Missing from schema:**

- Web search cost per call
- Cache pricing multipliers
- Flat request fees (Gemini grounding, Perplexity)
- Image generation pricing

## Audit System

**Package:** `packages/llm-audit`

### What's Captured

| Field        | Description                                   | Used For         |
| ------------ | --------------------------------------------- | ---------------- |
| provider     | `google`, `openai`, `anthropic`, `perplexity` | Grouping         |
| model        | Model identifier                              | Pricing lookup   |
| method       | `research`, `generate`, `evaluate`            | Usage analysis   |
| inputTokens  | Tokens in prompt                              | Cost calculation |
| outputTokens | Tokens in response                            | Cost calculation |
| durationMs   | Call duration                                 | Performance      |
| status       | `success` or `error`                          | Reliability      |

### What's NOT Captured

- Web search call count
- Cache token breakdown
- Actual cost from provider (for Perplexity)
- Request fees
- Image generation calls

### Storage

**Collection:** `llm_api_logs` — Detailed per-call logging

**Usage Statistics:** `llm_usage_stats` — Aggregated by provider, model, and time period

## True Cost Formulas

### Accurate Calculation per Provider

**Anthropic Claude:**

```
cost = (input_tokens - cache_read_tokens) * input_price
     + cache_read_tokens * input_price * 0.1
     + cache_creation_tokens * input_price * 1.25
     + output_tokens * output_price
     + web_search_calls * $0.01
```

**Google Gemini:**

```
cost = prompt_tokens * input_price
     + candidate_tokens * output_price
     + (grounding_enabled ? $0.035 : 0)  // Per request
```

**OpenAI:**

```
cost = (input_tokens - cached_tokens) * input_price
     + cached_tokens * input_price * 0.25
     + output_tokens * output_price
     + web_search_calls * $0.01
```

**Perplexity:**

```
cost = response.usage.cost.total_cost  // Already calculated!
```

**OpenAI DALL-E (Image Generation):**

```
cost = images_count * price_per_image
where price_per_image depends on:
  - size: 1024x1024, 1024x1792, 1792x1024
  - quality: standard, hd
```

## Image Generation in Codebase

### Current Implementation

**Location:** `apps/image-service/src/`

**Flow:**

1. User requests cover image for research
2. `GptPromptAdapter` uses Gemini to generate image prompt from research content
3. `OpenAIImageGenerator` generates image using DALL-E 3
4. Image stored in Cloud Storage

**Cost Components:**

1. LLM call to generate prompt (Gemini tokens)
2. Image generation call (DALL-E per-image pricing)

**What's NOT Tracked:**

- Image generation costs
- Prompt generation token costs (separate from research)
- Image size/quality metadata

## Sources

- [Anthropic Pricing](https://www.anthropic.com/pricing)
- [Google Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenAI Pricing](https://openai.com/api/pricing)
- [OpenAI DALL-E Pricing](https://openai.com/api/pricing#image-models)
- [Google Imagen Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Perplexity Pricing](https://docs.perplexity.ai/getting-started/pricing)
