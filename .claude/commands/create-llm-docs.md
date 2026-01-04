# Create LLM Documentation

Generate a comprehensive document about LLM costs, pricing, and usage in the codebase.

**Output:** `docs/current/llm-usage.md`

---

## Usage

```
/create-llm-docs
```

---

## What This Command Does

1. **Fetches current pricing** from official API documentation for all providers
2. **Analyzes codebase** to find all places where LLM models are used
3. **Compares pricing with database** and generates migration if prices changed
4. **Documents pricing calculation logic** in the code
5. **Describes token counting differences** between providers (especially for web search)
6. **Maps model usage** to specific features (research, synthesis, title generation, etc.)
7. **Documents image generation costs** (DALL-E, Imagen) and their usage in image-service

---

## Analysis Steps

### Step 1: Fetch Current Pricing (WebSearch)

Search for official pricing for each provider:

**Searches to perform:**

Use current year in queries (check today's date). Example for 2027:

```
1. "Anthropic Claude API pricing" site:anthropic.com - Get Claude model prices
2. "Google Gemini API pricing" site:ai.google.dev - Get Gemini model prices
3. "OpenAI API pricing" site:openai.com - Get GPT model prices
4. "Perplexity Sonar API pricing" site:perplexity.ai - Get Perplexity model prices
5. "OpenAI DALL-E API pricing" site:openai.com - Get DALL-E image generation prices
6. "Google Imagen API pricing" site:cloud.google.com - Get Google image generation prices
```

**Note:** Use `site:` filter to get official pricing pages, not outdated blog posts.

Extract for each model:

- Input token price (per million)
- Output token price (per million)
- Web search/grounding cost (per request or per call)
- Cache pricing (if applicable)
- Image generation cost (per image, by size/quality)
- Any additional fees

### Step 2: Analyze Code for Model Usage (Explore Agents)

**Agent 1 - Supported Models Registry:**

```
Find the central registry of supported models.
Look for:
- Model names and their providers
- Which models are used for research vs quick modes
- Display names for UI

Search in: packages/llm-contract/src/
```

**Agent 2 - Model Execution Points:**

```
Find ALL places where LLM models are actually executed.
For each execution point, document:
- File path and function name
- Which method is called (research, generate, synthesize, etc.)
- Which model is used
- Purpose (research, title generation, synthesis, validation, image prompt, etc.)

Search in:
- packages/infra-*/src/client.ts
- apps/llm-orchestrator/src/infra/llm/*.ts
- apps/llm-orchestrator/src/domain/research/usecases/*.ts
- apps/user-service/src/infra/llm/*.ts
- apps/image-service/src/infra/*.ts
```

**Agent 3 - Token Counting & Cost Calculation:**

```
Find how tokens are counted and costs calculated.
Look for:
- What token fields are extracted from each provider's response
- How costs are calculated (costCalculator)
- What pricing data is stored (migrations, Firestore)
- What's missing vs what providers actually return

Search in:
- packages/infra-*/src/client.ts (usage extraction)
- apps/llm-orchestrator/src/domain/research/utils/costCalculator.ts
- apps/llm-orchestrator/src/infra/pricing/
- migrations/*.mjs (pricing data)
```

**Agent 4 - Audit & Usage Tracking:**

```
Find how LLM usage is audited and tracked.
Look for:
- Audit context creation and logging
- What fields are captured
- Where audit data is stored
- Usage statistics collection

Search in:
- packages/llm-audit/src/
- apps/llm-orchestrator/src/infra/usage/
```

**Agent 5 - Image Generation:**

```
Find ALL places where images are generated using AI.
For each image generation point, document:
- File path and function name
- Which provider/model is used (DALL-E, Imagen, etc.)
- Image size and quality settings
- How costs are tracked (if at all)
- Purpose (cover image, thumbnail, etc.)

Search in:
- apps/image-service/src/infra/*.ts
- apps/image-service/src/domain/*.ts
- packages/infra-openai/src/ (for DALL-E)

Look for:
- Image generation API calls
- Prompt generation for images (LLM calls to create prompts)
- Image size/quality parameters
- Cost calculation or tracking
```

### Step 3: Compare Pricing with Database

**Read current pricing from database:**

Use Explore agent to find current pricing stored in Firestore:

```
Search for current LLM pricing data in the codebase.
Look for:
- The most recent migrations in migrations/*.mjs that set pricing
- The pricing structure stored in app_settings/llm_pricing
- Extract current inputPricePerMillion and outputPricePerMillion for each model

Return a table with:
| Provider | Model | Current Input Price | Current Output Price |
```

**Compare with fetched pricing from Step 1:**

For each model, compare:

- `fetchedInputPrice` vs `currentInputPrice`
- `fetchedOutputPrice` vs `currentOutputPrice`

**If ANY pricing has changed:**

1. Find the next migration number by checking `migrations/` directory
2. Generate a new migration file `migrations/{NNN}_llm-pricing-update.mjs`:

```javascript
/**
 * Migration {NNN}: LLM Pricing Update
 *
 * Updates pricing based on official sources as of {YYYY-MM-DD}.
 *
 * Changes:
 * - {model}: input {old} → {new}, output {old} → {new}
 * - ...
 */

export const metadata = {
  id: '{NNN}',
  name: 'llm-pricing-update',
  description: 'Update LLM pricing from official sources',
  createdAt: '{YYYY-MM-DD}',
};

export async function up(context) {
  console.log('  Updating LLM pricing...');

  const pricingUpdate = {
    // Only include models that changed:
    'models.{provider}_{model}': {
      provider: '{provider}',
      model: '{model}',
      inputPricePerMillion: { newInputPrice },
      outputPricePerMillion: { newOutputPrice },
    },
    // ... more changed models
    updatedAt: new Date().toISOString(),
  };

  await context.firestore.doc('app_settings/llm_pricing').update(pricingUpdate);

  console.log('  LLM pricing updated for {N} models');
}
```

3. Report the changes in chat:

```
## Pricing Changes Detected

| Provider | Model | Field  | Old     | New     |
|----------|-------|--------|---------|---------|
| ...      | ...   | input  | $X.XX   | $Y.YY   |

Migration created: migrations/{NNN}_llm-pricing-update.mjs
```

**If NO pricing has changed:**

Report in chat:

```
## No Pricing Changes

All model prices match current database values. No migration needed.
```

### Step 4: Compile Documentation

Write the document following the template below.

---

## Documentation Template

Write the following structure to `docs/current/llm-usage.md`:

````markdown
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

Pricing data verified as of: **YYYY-MM-DD** (insert date when running this command)

## Quick Reference: Model Pricing

### Token Pricing (per million tokens)

| Provider   | Model                      | Input | Output | Web Search | Notes                    |
| ---------- | -------------------------- | ----- | ------ | ---------- | ------------------------ |
| Anthropic  | claude-opus-4-5-20251101   | $X.XX | $X.XX  | $0.01/call | Research model           |
| Anthropic  | claude-sonnet-4-5-20250929 | $X.XX | $X.XX  | $0.01/call | Quick model              |
| Google     | gemini-2.5-pro             | $X.XX | $X.XX  | $0.035/req | Research model           |
| Google     | gemini-2.5-flash           | $X.XX | $X.XX  | $0.035/req | Quick model              |
| OpenAI     | o4-mini-deep-research      | $X.XX | $X.XX  | $0.01/call | Research model           |
| OpenAI     | gpt-5.2                    | $X.XX | $X.XX  | $0.01/call | Quick model              |
| Perplexity | sonar                      | $X.XX | $X.XX  | $X.XX/req  | Validation, low context  |
| Perplexity | sonar-pro                  | $X.XX | $X.XX  | $X.XX/req  | Research, medium context |
| Perplexity | sonar-deep-research        | $X.XX | $X.XX  | included   | Deep research, high ctx  |

### Image Generation Pricing

| Provider | Model    | Size      | Quality  | Price/Image | Notes                |
| -------- | -------- | --------- | -------- | ----------- | -------------------- |
| OpenAI   | DALL-E 3 | 1024x1024 | standard | $X.XX       | Cover images         |
| OpenAI   | DALL-E 3 | 1024x1024 | hd       | $X.XX       | High quality         |
| OpenAI   | DALL-E 3 | 1792x1024 | standard | $X.XX       | Wide format          |
| Google   | Imagen 3 | 1024x1024 | -        | $X.XX       | Alternative provider |

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
````

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

## Model Usage in Codebase

### By Feature

| Feature            | Provider    | Model           | Method            | File                      |
| ------------------ | ----------- | --------------- | ----------------- | ------------------------- |
| Research (deep)    | Multiple    | `researchModel` | `research()`      | `processLlmCall.ts`       |
| Research (quick)   | Multiple    | `defaultModel`  | `research()`      | `processLlmCall.ts`       |
| Title generation   | Google      | `defaultModel`  | `generateTitle()` | `processResearch.ts`      |
| Synthesis          | User choice | Any             | `synthesize()`    | `runSynthesis.ts`         |
| API key validation | Each        | `evaluateModel` | `evaluate()`      | `LlmValidatorImpl.ts`     |
| Image prompt       | Google      | gemini-2.5-pro  | `generate()`      | `GptPromptAdapter.ts`     |
| Image generation   | OpenAI      | dall-e-3        | `generateImage()` | `OpenAIImageGenerator.ts` |

### Execution Points

[Table of all files/functions that execute LLM calls with line numbers]

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
| Anthropic  | input_tokens                |     ✅     |       ✅       | -                         |
| Anthropic  | output_tokens               |     ✅     |       ✅       | -                         |
| Anthropic  | cache_creation_input_tokens |     ❌     |       ✅       | Underestimate cache costs |
| Anthropic  | cache_read_input_tokens     |     ❌     |       ✅       | Overestimate costs        |
| Anthropic  | web_search_calls            |     ❌     | Count manually | Missing $0.01/call        |
| Google     | promptTokenCount            |     ✅     |       ✅       | -                         |
| Google     | candidatesTokenCount        |     ✅     |       ✅       | -                         |
| Google     | grounding fee               |     ❌     |      N/A       | Missing flat fee          |
| OpenAI     | input_tokens                |     ✅     |       ✅       | -                         |
| OpenAI     | output_tokens               |     ✅     |       ✅       | -                         |
| OpenAI     | cached_tokens               |     ❌     |       ✅       | Overestimate costs        |
| OpenAI     | reasoning_tokens            |     ❌     |       ✅       | Informational             |
| OpenAI     | web_search_calls            |     ❌     | Count manually | Missing $0.01/call        |
| Perplexity | prompt_tokens               |     ✅     |       ✅       | -                         |
| Perplexity | completion_tokens           |     ✅     |       ✅       | -                         |
| Perplexity | cost.total_cost             |     ❌     |       ✅       | **Could use exact cost!** |
| OpenAI     | image_size                  |     ❌     |       ✅       | Affects pricing           |
| OpenAI     | image_quality               |     ❌     |       ✅       | hd vs standard            |
| OpenAI     | images_generated            |     ❌     |       ✅       | Count of images           |

### Pricing Data Storage

**Location:** Firestore `app_settings/llm_pricing`

**Migrations:**

- `002_initial-llm-pricing.mjs` - Base pricing for Claude, Gemini, GPT
- `003_perplexity-pricing.mjs` - Added Perplexity models

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

### Storage

**Collection:** `llm_api_logs`

**Usage Statistics:**

- Aggregated to `llm_usage_stats` collection
- By provider, model, and time period
- Includes `costUsd` (calculated, not from provider)

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
     + (grounding_enabled ? $0.035 : 0)  // Per request
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
cost = response.usage.cost.total_cost  // Already calculated!
```

**OpenAI DALL-E (Image Generation):**

```
cost = images_count × price_per_image
where price_per_image depends on:
  - size: 1024x1024, 1024x1792, 1792x1024
  - quality: standard, hd
  - model: dall-e-2, dall-e-3
```

**Google Imagen (Image Generation):**

```
cost = images_count × price_per_image
where price_per_image depends on:
  - resolution: 1024x1024, etc.
  - model version: imagen-3, etc.
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

```

---

## After Documentation

Output improvement suggestions to chat (NOT in docs):

```

## LLM Cost Tracking Improvements

### Critical

- [Missing cost factors that significantly affect billing]

### High Priority

- [Opportunities to use provider-provided costs]
- [Missing cache/search tracking]

### Recommendations

1. Extend TokenUsage interface to capture:
   - cache_creation_input_tokens (Anthropic)
   - cache_read_input_tokens (Anthropic)
   - cached_tokens (OpenAI)
   - web_search_calls (count for Anthropic, OpenAI)
   - cost object (Perplexity)

2. Extend LlmPricing schema to include:
   - webSearchCostPerCall
   - groundingCostPerRequest
   - cacheWriteMultiplier
   - cacheReadMultiplier

3. Use Perplexity's native cost.total_cost instead of calculating

4. Track image generation costs:
   - Add image pricing to LlmPricing schema (per-image costs)
   - Track image_prompt calls separately in llm_usage_stats
   - Track image_generation calls in llm_usage_stats
   - Capture image size/quality for accurate costing

5. Update image-service to report usage:
   - Call llm-orchestrator tracking endpoint for prompt generation
   - Call llm-orchestrator tracking endpoint for image generation

```

---

## Implementation Notes

- Always fetch CURRENT pricing via WebSearch (prices change frequently)
- Include pricing verification date in the Pricing Reference section
- Show exact API response structures for each provider
- Highlight discrepancies between what we track vs what's available
- Document the financial impact of missing data
- Keep headers minimal - no "auto-generated" notices
- Overview section should convey the intelligence and value of the LLM integration
```
