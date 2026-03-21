# INT-616: OpenRouter Integration & Multi-Model Selection - Design Document

## 1. Overview

**Goal:** Add OpenRouter as a new LLM provider to the research studio, enabling users to access 200+ models from a single API key with multi-model selection support.

**Key Insight:** OpenRouter provides an OpenAI-compatible API (`https://openrouter.ai/api/v1`) that proxies requests to multiple LLM providers. Unlike existing IntexuraOS providers (Google, Anthropic, OpenAI, Perplexity) which each support 2-3 static models, OpenRouter dynamically exposes 200+ models from dozens of providers.

**Approach:** Integrate OpenRouter as a 5th provider in the existing architecture, with a dynamic model catalog fetched from the OpenRouter API at runtime.

---

## 2. OpenRouter API Summary

### Authentication

```
Base URL: https://openrouter.ai/api/v1
Header:   Authorization: Bearer <OPENROUTER_API_KEY>
```

### Key Endpoints

| Endpoint                                       | Method | Description                         |
| ---------------------------------------------- | ------ | ----------------------------------- |
| `/api/v1/chat/completions`                     | POST   | Chat completion (OpenAI-compatible) |
| `/api/v1/models`                               | GET    | List all models with pricing        |
| `/api/v1/models/{author}/{slug}/endpoints`     | GET    | Provider endpoints for a model      |
| `/api/v1/key`                                  | GET    | API key info & credit balance       |

### Model Identification

Models use `{author}/{slug}` format (e.g., `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `meta-llama/llama-3.1-70b-instruct`).

### Chat Completion Request

```typescript
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://intexuraos.cloud',
    'X-Title': 'IntexuraOS Research Studio',
  },
  body: JSON.stringify({
    model: 'anthropic/claude-sonnet-4',
    messages: [{ role: 'user', content: prompt }],
  }),
});
```

### Models API Response (per model)

```json
{
  "id": "anthropic/claude-sonnet-4",
  "name": "Anthropic: Claude Sonnet 4",
  "context_length": 200000,
  "pricing": {
    "prompt": "0.000003",
    "completion": "0.000015",
    "request": "0",
    "image": "0.0048"
  },
  "architecture": {
    "input_modalities": ["text", "image"],
    "output_modalities": ["text"]
  },
  "supported_parameters": ["temperature", "top_p", "max_tokens", "tools", "stream"]
}
```

### Multi-Model & Fallback

```json
{
  "models": ["anthropic/claude-sonnet-4", "openai/gpt-4o"],
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

OpenRouter tries models in order; the response `model` field indicates which model served the request.

### Provider Routing

```json
{
  "model": "anthropic/claude-sonnet-4",
  "provider": {
    "order": ["anthropic", "aws-bedrock"],
    "data_collection": "deny",
    "sort": "price"
  }
}
```

---

## 3. Current Architecture Analysis

### Provider Type System

```
packages/llm-contract/src/supportedModels.ts
```

All models and providers are **statically typed** as TypeScript literal types:

```typescript
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';
type LLMModel = 'gemini-2.5-pro' | 'claude-opus-4-5-20251101' | ... ; // 15 models
```

**Key constraint:** Adding a new static model requires changes to the type union, `ALL_LLM_MODELS` array, `MODEL_PROVIDER_MAP`, pricing migrations, and the UI.

### API Key Storage

```
packages/internal-clients/src/user-service/types.ts
```

```typescript
interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
}
```

**Key constraint:** One API key per provider. OpenRouter follows this pattern perfectly - one key unlocks all models.

### Adapter Factory Pattern

```
apps/research-agent/src/infra/llm/LlmAdapterFactory.ts
```

```typescript
function createResearchProvider(model, apiKey, userId, pricing, logger): LlmResearchProvider {
  const provider = getProviderForModel(model);
  switch (provider) {
    case 'google':     return new GeminiAdapter(...);
    case 'anthropic':  return new ClaudeAdapter(...);
    case 'openai':     return new GptAdapter(...);
    case 'perplexity': return new PerplexityAdapter(...);
  }
}
```

### Pricing System

```
apps/app-settings-service/ -> Firestore: settings/llm_pricing/providers/{provider}
packages/llm-pricing/ -> PricingContext for runtime lookups
```

Pricing is stored per provider in Firestore, loaded at startup into a `PricingContext` map.

### UI Model Selection

```
apps/web/src/components/ModelSelector.tsx
```

Static `PROVIDER_MODELS` array with hardcoded models per provider. One model per provider selected at a time.

---

## 4. Design Challenges & Solutions

### Challenge 1: Dynamic vs Static Model Catalog

**Problem:** Current system uses static TypeScript types for all models. OpenRouter has 200+ models that change over time.

**Solution: Hybrid Type System**

Introduce `OpenRouterModel` as a branded string type, keeping the static type system for existing providers while allowing dynamic models for OpenRouter:

```typescript
// In packages/llm-contract/src/supportedModels.ts

export type OpenRouter = 'openrouter';

// Branded string for runtime-validated OpenRouter models
export type OpenRouterModelId = string & { readonly __brand: 'OpenRouterModelId' };

// Extend the provider union
export type LlmProvider = Google | OpenAI | Anthropic | Perplexity | OpenRouter;

// ResearchModel now includes OpenRouter models
export type ResearchModel =
  | Gemini25Pro | Gemini25Flash | ...existing...
  | OpenRouterModelId;
```

The `OpenRouterModelId` models are validated at runtime against the OpenRouter API catalog, not at compile time.

### Challenge 2: Multi-Model Selection for One Provider

**Problem:** Current UI allows one model per provider. OpenRouter needs multiple model selection from the same provider.

**Solution: OpenRouter-Specific Model Picker**

Add a dedicated `OpenRouterModelSelector` component that:
1. Fetches available models from OpenRouter API (via backend proxy)
2. Allows searching/filtering by name, category, modality
3. Supports selecting **multiple** models (not just one)
4. Shows pricing per model inline

```typescript
// New component for OpenRouter
interface OpenRouterModelSelectorProps {
  availableModels: OpenRouterModelInfo[];
  selectedModels: OpenRouterModelId[];
  onChange: (models: OpenRouterModelId[]) => void;
  loading?: boolean;
}
```

### Challenge 3: Pricing Integration

**Problem:** Existing pricing is fetched from app-settings-service at startup with static models. OpenRouter pricing comes from the OpenRouter API and changes dynamically.

**Solution: Dual Pricing Source**

For OpenRouter, pricing comes directly from the `/api/v1/models` endpoint response. Store a curated subset in Firestore (for models users have used), but always prefer live pricing from the API:

```typescript
// OpenRouter-specific pricing adapter
interface OpenRouterPricing {
  promptPricePerToken: number;    // From API: pricing.prompt
  completionPricePerToken: number; // From API: pricing.completion
  requestPrice: number;            // From API: pricing.request
  imagePricePerUnit: number;       // From API: pricing.image
}

// Convert to existing ModelPricing format
function toModelPricing(orPricing: OpenRouterPricing): ModelPricing {
  return {
    inputPricePerMillion: orPricing.promptPricePerToken * 1_000_000,
    outputPricePerMillion: orPricing.completionPricePerToken * 1_000_000,
    useProviderCost: true, // OpenRouter includes cost in response
  };
}
```

### Challenge 4: API Key Validation

**Problem:** Existing providers validate API keys at startup by making a test request. OpenRouter's key validation is simpler.

**Solution:** Use the `/api/v1/key` endpoint to validate the OpenRouter API key:

```typescript
async function validateOpenRouterKey(apiKey: string): Promise<boolean> {
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  return response.ok;
}
```

---

## 5. Integration Architecture

### 5.1 New Package: `packages/infra-openrouter`

```
packages/infra-openrouter/
  src/
    client.ts           - OpenRouter LLM client (OpenAI SDK wrapper)
    modelCatalog.ts     - Fetch and cache model catalog from API
    costCalculator.ts   - Convert OpenRouter pricing to normalized usage
    types.ts            - OpenRouter-specific types
    index.ts            - Public exports
```

**Client Implementation (using OpenAI SDK):**

```typescript
import OpenAI from 'openai';
import type { Result } from '@intexuraos/common-core';
import type { ResearchResult, LLMError } from '@intexuraos/llm-contract';

export class OpenRouterClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenRouterConfig) {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://intexuraos.cloud',
        'X-Title': 'IntexuraOS Research Studio',
      },
    });
    this.model = config.model;
  }

  async research(prompt: string): Promise<Result<ResearchResult, LLMError>> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });

    return ok({
      content: completion.choices[0]?.message?.content ?? '',
      sources: [], // OpenRouter doesn't provide web search natively
      usage: this.normalizeUsage(completion.usage),
    });
  }
}
```

**Model Catalog Service:**

```typescript
export interface OpenRouterModelInfo {
  id: string;                  // e.g., "anthropic/claude-sonnet-4"
  name: string;                // e.g., "Anthropic: Claude Sonnet 4"
  contextLength: number;
  pricing: {
    promptPerToken: number;
    completionPerToken: number;
  };
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
}

export async function fetchModelCatalog(
  apiKey: string
): Promise<Result<OpenRouterModelInfo[], LLMError>> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    return err({ code: 'API_ERROR', message: `HTTP ${response.status}` });
  }

  const data = await response.json();
  return ok(data.data.map(normalizeModelInfo));
}
```

### 5.2 Research Agent Adapter

```
apps/research-agent/src/infra/llm/OpenRouterAdapter.ts
```

Implements `LlmResearchProvider` and `LlmSynthesisProvider` using the OpenRouter client:

```typescript
export class OpenRouterAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: OpenRouterClient;

  constructor(
    apiKey: string,
    model: string,  // OpenRouter model ID, e.g., "anthropic/claude-sonnet-4"
    userId: string,
    pricing: ModelPricing,
    logger: Logger
  ) {
    this.client = new OpenRouterClient({ apiKey, model, userId, pricing, logger });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    return this.client.research(prompt);
  }

  async synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    additionalSources?: { content: string; label?: string }[],
    synthesisContext?: SynthesisContext
  ): Promise<Result<LlmSynthesisResult, LlmError>> {
    return this.client.synthesize(originalPrompt, reports, additionalSources, synthesisContext);
  }
}
```

### 5.3 Factory Extension

```typescript
// LlmAdapterFactory.ts - add OpenRouter case
export function createResearchProvider(
  model: ResearchModel,
  apiKey: string,
  userId: string,
  pricing: ModelPricing,
  logger: Logger
): LlmResearchProvider {
  const provider = getProviderForModel(model);

  switch (provider) {
    case 'google':     return new GeminiAdapter(...);
    case 'anthropic':  return new ClaudeAdapter(...);
    case 'openai':     return new GptAdapter(...);
    case 'perplexity': return new PerplexityAdapter(...);
    case 'openrouter': return new OpenRouterAdapter(apiKey, model, userId, pricing, logger);
  }
}
```

### 5.4 API Key Integration

Add `openrouter` to `DecryptedApiKeys`:

```typescript
interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
  openrouter?: string;  // NEW
}
```

### 5.5 Backend Model Catalog Endpoint

New endpoint on research-agent to proxy the OpenRouter model catalog:

```
GET /research/openrouter/models
```

This prevents exposing the user's OpenRouter API key to the browser and allows server-side caching:

```typescript
// Response format
interface OpenRouterModelsResponse {
  models: {
    id: string;
    name: string;
    contextLength: number;
    promptPrice: number;
    completionPrice: number;
    inputModalities: string[];
    category?: string;
  }[];
  cachedAt: string;
}
```

### 5.6 Pricing Approach

For OpenRouter, pricing is **dynamic** (comes from their API). Two strategies:

**Option A - Live Pricing (Recommended for POC):**
- Fetch pricing from OpenRouter models API at research creation time
- Convert to `ModelPricing` format on-the-fly
- Set `useProviderCost: true` so the actual cost from the response is used

**Option B - Cached Pricing:**
- Periodically sync popular model prices to Firestore
- Fall back to live API if cache miss
- More complex but better for cost tracking accuracy

**Recommendation:** Start with Option A for the POC. The `useProviderCost` flag already exists in the pricing system, which is a perfect fit.

### 5.7 UI Changes

#### ModelSelector Enhancement

Add OpenRouter as a new section with a dynamic model picker:

```typescript
// New section in ModelSelector.tsx
{isOpenRouterConfigured && (
  <OpenRouterSection
    availableModels={openRouterModels}   // Fetched from backend
    selectedModels={openRouterSelections} // Multiple selection
    onChange={handleOpenRouterChange}
    loading={loadingModels}
  />
)}
```

#### OpenRouterModelSelector Component

```typescript
// New component: apps/web/src/components/OpenRouterModelSelector.tsx
function OpenRouterModelSelector({
  availableModels,
  selectedModels,
  onChange,
  maxModels = 5,
}: OpenRouterModelSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const filteredModels = availableModels
    .filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(m => categoryFilter === null || m.category === categoryFilter);

  return (
    <div>
      <SearchInput value={searchQuery} onChange={setSearchQuery} />
      <CategoryFilter categories={categories} selected={categoryFilter} onChange={setCategoryFilter} />
      <ModelGrid
        models={filteredModels}
        selected={selectedModels}
        onToggle={(modelId) => {/* toggle selection */}}
        maxModels={maxModels}
      />
      <SelectedModelsSummary models={selectedModels} />
    </div>
  );
}
```

---

## 6. Data Flow

### Research Creation with OpenRouter Models

```
User selects OpenRouter models in UI
  -> POST /research { selectedModels: ["or:anthropic/claude-sonnet-4", "or:meta-llama/llama-3.1-70b"] }
    -> research-agent validates API key exists for 'openrouter' provider
    -> For each OpenRouter model:
      -> Fetch live pricing from catalog
      -> Create OpenRouterAdapter with model ID
      -> Call adapter.research(prompt)
    -> Collect results
    -> Run synthesis (using any provider with synthesis support)
    -> Save & return
```

### Model Catalog Fetch

```
User opens research page
  -> Frontend: GET /research/openrouter/models
    -> research-agent: Check in-memory cache (5-min TTL)
      -> Cache miss: Fetch from OpenRouter API with user's API key
      -> Transform & cache
    -> Return model list with pricing
  -> Frontend: Render OpenRouterModelSelector with models
```

---

## 7. Files to Modify

### New Files

| File                                                              | Purpose                                 |
| ----------------------------------------------------------------- | --------------------------------------- |
| `packages/infra-openrouter/src/client.ts`                         | OpenRouter LLM client                   |
| `packages/infra-openrouter/src/modelCatalog.ts`                   | Model catalog fetch & cache             |
| `packages/infra-openrouter/src/costCalculator.ts`                 | Pricing normalization                   |
| `packages/infra-openrouter/src/types.ts`                          | OpenRouter-specific types               |
| `packages/infra-openrouter/src/index.ts`                          | Package exports                         |
| `packages/infra-openrouter/package.json`                          | Package config                          |
| `apps/research-agent/src/infra/llm/OpenRouterAdapter.ts`          | Research adapter for OpenRouter         |
| `apps/web/src/components/OpenRouterModelSelector.tsx`             | Dynamic model picker UI                 |

### Modified Files

| File                                                              | Change                                            |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| `packages/llm-contract/src/supportedModels.ts`                    | Add `OpenRouter` provider type                    |
| `packages/internal-clients/src/user-service/types.ts`             | Add `openrouter?` to `DecryptedApiKeys`           |
| `apps/research-agent/src/infra/llm/LlmAdapterFactory.ts`          | Add `case 'openrouter'` to factory switch         |
| `apps/research-agent/src/services.ts`                             | Wire OpenRouter model catalog service             |
| `apps/research-agent/src/routes/researchRoutes.ts`                | Add `/research/openrouter/models` endpoint        |
| `apps/web/src/components/ModelSelector.tsx`                       | Add OpenRouter section                            |
| `apps/web/src/pages/ResearchAgentPage.tsx`                        | Handle OpenRouter model state                     |
| `apps/web/src/services/researchAgentApi.types.ts`                 | Add OpenRouter API types                          |
| `packages/llm-pricing/src/pricingClient.ts`                       | Add `openrouter` to `AllPricingResponse`          |
| `apps/app-settings-service/src/routes/internalRoutes.ts`          | Add OpenRouter pricing fetch                      |
| `apps/user-service/` (API keys storage)                           | Add `openrouter` provider to API key schema       |
| `migrations/NNN_openrouter-provider.mjs`                          | Add OpenRouter provider to type system            |

---

## 8. Key Design Decisions

### Decision 1: OpenRouter Model ID Format

**Chosen:** Prefix OpenRouter model IDs with `or:` to distinguish from static models:
- `or:anthropic/claude-sonnet-4` (via OpenRouter)
- `claude-sonnet-4-5-20250929` (direct Anthropic)

**Rationale:** Prevents collision with existing model IDs. The `getProviderForModel()` function can check for `or:` prefix to route to OpenRouter.

**Alternative considered:** Use raw OpenRouter IDs. Rejected because `openai/gpt-4o` could collide with our static GPT provider mapping.

### Decision 2: No Web Search for OpenRouter Models

**Chosen:** OpenRouter models in the research pipeline will use generation-only mode (no web search tools), unless the model natively supports them.

**Rationale:** Web search capabilities vary by model on OpenRouter. Some models support function calling (which could enable search), but this requires per-model feature detection.

**Future:** Can add search support for models that declare `tools` in their `supported_parameters`.

### Decision 3: Synthesis Support

**Chosen:** OpenRouter models CAN be used for synthesis (they support structured output via chat completions).

**Rationale:** Any model that can follow instructions can synthesize. The synthesis prompt is the same regardless of provider.

### Decision 4: Maximum Models per Research

**Chosen:** Cap OpenRouter model selection at 5 models per research.

**Rationale:** Each model costs money and takes time. 5 is enough for meaningful comparison without excessive cost/latency.

---

## 9. Implementation Phases

### Phase 1: Core Infrastructure (POC)

1. Create `packages/infra-openrouter` package
2. Implement OpenRouter client with chat completion support
3. Add `openrouter` to `LlmProvider` type union
4. Add `OpenRouterAdapter` to research-agent
5. Extend `LlmAdapterFactory` with `case 'openrouter'`
6. Add `openrouter` to `DecryptedApiKeys`
7. Wire up API key storage in user-service

### Phase 2: Model Catalog & Pricing

1. Implement model catalog fetch with caching
2. Add `/research/openrouter/models` endpoint
3. Implement dynamic pricing conversion
4. Add pricing fallback for usage tracking

### Phase 3: UI Integration

1. Add `OpenRouterModelSelector` component
2. Integrate into `ModelSelector.tsx` layout
3. Update `ResearchAgentPage.tsx` for multi-model OpenRouter state
4. Add API key configuration for OpenRouter in settings page

### Phase 4: Polish & Edge Cases

1. Error handling for OpenRouter API failures
2. Rate limit handling (429 responses)
3. Model availability changes during research
4. Cost tracking and usage display for OpenRouter models
5. Integration tests

---

## 10. Open Questions

1. **Model curation:** Should we show ALL 200+ OpenRouter models, or curate a subset for the research use case? The models API supports category filtering which could help.

2. **Cost limits:** Should we add a per-research cost estimate/limit for OpenRouter models, since users might accidentally select expensive models?

3. **Overlap with existing providers:** If a user has both a direct Anthropic key and an OpenRouter key, should we warn about duplicate access to Claude models?

4. **Environment variable:** The OpenRouter API key will need `INTEXURAOS_OPENROUTER_API_KEY` for platform-level access, or should it be user-managed only?

---

## 11. Test Requirements

| Test Case                                | Type        | Description                                                              |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| OpenRouter client - successful research  | Unit        | Mock OpenAI SDK, verify chat completion call with correct model ID       |
| OpenRouter client - API error handling   | Unit        | Mock 4xx/5xx responses, verify correct LLMError codes                    |
| OpenRouter client - rate limiting        | Unit        | Mock 429 response, verify RATE_LIMITED error                             |
| Model catalog - fetch and normalize      | Unit        | Mock API response, verify model info normalization                       |
| Model catalog - caching                  | Unit        | Verify cache hit within TTL, cache miss after TTL                        |
| Pricing conversion                       | Unit        | Verify OpenRouter pricing → ModelPricing conversion accuracy             |
| Adapter factory - openrouter routing     | Unit        | Verify `case 'openrouter'` creates OpenRouterAdapter                     |
| Research flow - OpenRouter models        | Integration | Full request through research-agent with mocked OpenRouter API           |
| UI - model selector renders OpenRouter   | Component   | Verify OpenRouter section shows when API key configured                  |
| UI - multi-model selection               | Component   | Verify multiple OpenRouter models can be selected/deselected             |
| API key validation                       | Integration | Verify `/api/v1/key` endpoint is called for OpenRouter key validation    |
| Cost tracking                            | Unit        | Verify `useProviderCost: true` uses OpenRouter-reported cost             |
