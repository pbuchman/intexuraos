# Create LLM Documentation

Generate a comprehensive document about LLM costs, pricing, and usage in the codebase.

**Output:** `docs/current/llm-costs.md`

---

## Usage

```
/create-llm-docs
```

---

## What This Command Does

1. **Fetches current pricing** from official API documentation for all providers
2. **Analyzes codebase** to find all places where LLM models are used
3. **Documents pricing calculation logic** in the code
4. **Describes token counting differences** between providers (especially for web search)
5. **Maps model usage** to specific features (research, synthesis, title generation, etc.)

---

## Analysis Steps

### Step 1: Fetch Current Pricing (WebSearch)

Search for official pricing for each provider:

**Searches to perform:**

```
1. "Anthropic Claude API pricing 2026" - Get Claude model prices
2. "Google Gemini API pricing 2026" - Get Gemini model prices
3. "OpenAI API pricing 2026" - Get GPT model prices
4. "Perplexity Sonar API pricing 2026" - Get Perplexity model prices
```

Extract for each model:

- Input token price (per million)
- Output token price (per million)
- Web search/grounding cost (per request or per call)
- Cache pricing (if applicable)
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
- Purpose (research, title generation, synthesis, validation, etc.)

Search in:
- packages/infra-*/src/client.ts
- apps/llm-orchestrator/src/infra/llm/*.ts
- apps/llm-orchestrator/src/domain/research/usecases/*.ts
- apps/user-service/src/infra/llm/*.ts
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

### Step 3: Compile Documentation

Write the document following the template below.

---

## Documentation Template

Write the following structure to `docs/current/llm-costs.md`:

````markdown
# LLM Costs & Pricing

> **Auto-generated documentation** - Do not edit manually.
> Last updated: YYYY-MM-DD
> Pricing verified from official sources as of this date.

This document provides comprehensive information about LLM costs in IntexuraOS, including official pricing, how costs are calculated in code, and where models are used.

## Quick Reference: Model Pricing

### Token Pricing (per million tokens)

| Provider   | Model                      | Input | Output | Web Search | Notes                     |
| ---------- | -------------------------- | ----- | ------ | ---------- | ------------------------- |
| Anthropic  | claude-opus-4-5-20251101   | $X.XX | $X.XX  | $0.01/call | Research model            |
| Anthropic  | claude-sonnet-4-5-20250929 | $X.XX | $X.XX  | $0.01/call | Quick model               |
| Google     | gemini-2.5-pro             | $X.XX | $X.XX  | $0.035/req | Research model            |
| Google     | gemini-2.5-flash           | $X.XX | $X.XX  | $0.035/req | Quick model               |
| OpenAI     | o4-mini-deep-research      | $X.XX | $X.XX  | $0.01/call | Research model            |
| OpenAI     | gpt-5.2                    | $X.XX | $X.XX  | $0.01/call | Quick model               |
| Perplexity | sonar-pro                  | $X.XX | $X.XX  | $X.XX/req  | Includes cost in response |
| Perplexity | sonar-deep-research        | $X.XX | $X.XX  | included   | Includes cost in response |

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

| Feature            | Provider    | Model           | Method            | File                  |
| ------------------ | ----------- | --------------- | ----------------- | --------------------- |
| Research (deep)    | Multiple    | `researchModel` | `research()`      | `processLlmCall.ts`   |
| Research (quick)   | Multiple    | `defaultModel`  | `research()`      | `processLlmCall.ts`   |
| Title generation   | Google      | `defaultModel`  | `generateTitle()` | `processResearch.ts`  |
| Synthesis          | User choice | Any             | `synthesize()`    | `runSynthesis.ts`     |
| API key validation | Each        | `evaluateModel` | `evaluate()`      | `LlmValidatorImpl.ts` |

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

## Sources

- [Anthropic Pricing](https://www.anthropic.com/pricing)
- [Google Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenAI Pricing](https://openai.com/api/pricing)
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

```

---

## Implementation Notes

- Always fetch CURRENT pricing via WebSearch (prices change)
- Include pricing verification date prominently
- Show exact API response structures for each provider
- Highlight discrepancies between what we track vs what's available
- Document the financial impact of missing data
```
