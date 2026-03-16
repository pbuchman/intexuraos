# Agent Reference: @intexuraos/infra-gemini

## Identity

| Attribute | Value                                                                      |
| --------- | -------------------------------------------------------------------------- |
| Package   | `@intexuraos/infra-gemini`                                                 |
| Version   | 3.3.0                                                                      |
| Purpose   | Google Gemini API wrapper implementing `LLMClient` and `ToolCallingClient` |
| Provider  | `LlmProviders.Google`                                                      |
| SDK       | `@google/genai` ^1.0.0                                                     |

## Exports

```ts
// Factories
export function createGeminiClient(config: GeminiConfig): GeminiClient;
export function createGeminiToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient;

// Pre-built pricing
export const TOOL_CALLING_PRICING: Record<ToolCallingModel, ModelPricing>;

// Cost calculation
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
export function calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  groundingEnabled: boolean,
  pricing: ModelPricing
): NormalizedUsage;

// Types
export type GeminiClient = LLMClient;
export type {
  GeminiConfig,
  GeminiError,
  ToolCallingClientConfig,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
};
```

## Key Interfaces

```ts
interface GeminiConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: ModelPricing;
  imagePricing?: ModelPricing; // separate pricing for generateImage
  logger: Logger;
  auditSink?: AuditSink;  // defaults to Firestore audit sink
  usageSink?: UsageSink;  // defaults to Firestore usage sink
}

interface ToolCallingClientConfig {
  apiKey: string;
  model: ToolCallingModel; // 'gemini-2.5-flash'
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;
  usageSink?: UsageSink;
}

// GeminiError = LLMError from @intexuraos/llm-contract
type GeminiError = {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'TIMEOUT' | 'CONTENT_FILTERED' | 'API_ERROR';
  message: string;
};
```

## Usage Patterns

### Research with Google Search grounding

```ts
import { createGeminiClient } from '@intexuraos/infra-gemini';

const client = createGeminiClient({
  apiKey: env.INTEXURAOS_GOOGLE_API_KEY,
  model: 'gemini-2.5-flash',
  userId,
  pricing: {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    groundingCostPerRequest: 0.002,
  },
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
  // sources: extracted from groundingMetadata.groundingChunks[].web.uri
  // usage.groundingEnabled: true when Google Search was active
}
```

### Image generation

```ts
const result = await client.generateImage('A sunset over mountains', { size: '1024x1024' });
if (result.ok) {
  // result.data: { imageData: Buffer, model: LlmModels.Gemini25FlashImage, usage: NormalizedUsage }
  // imageData decoded from base64 inlineData
}
```

### Tool calling agent loop

```ts
import { createGeminiToolCallingClient, TOOL_CALLING_PRICING } from '@intexuraos/infra-gemini';

const toolClient = createGeminiToolCallingClient({
  apiKey: env.INTEXURAOS_GOOGLE_API_KEY,
  model: 'gemini-2.5-flash',
  userId,
  pricing: TOOL_CALLING_PRICING['gemini-2.5-flash'],
  logger,
});

const result = await toolClient.run({
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'What is the status of PR #42?' }],
  tools: [{ name: 'get_pr', description: '...', parameters: { ... }, run: async (args) => '...' }],
  maxIterations: 5,
  onExhausted: ({ iterationCount, toolCallsMade }) => {
    // Return a repair message or undefined to stop
    return 'Please provide a final answer now.';
  },
});
if (result.ok) {
  // result.data: { content: string, toolCallsMade: number, iterationCount: number, usage: NormalizedUsage }
}
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'RATE_LIMITED':      // quota exceeded — retry with backoff
    case 'CONTENT_FILTERED':  // safety filter — do not retry
    case 'INVALID_KEY':       // bad API key — do not retry
    case 'TIMEOUT':           // retry
    case 'API_ERROR':         // log and handle
  }
}
```

## Dependencies

| Package                    | Role                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `@intexuraos/common-core`  | Result types, getErrorMessage, Logger                                                         |
| `@intexuraos/llm-contract` | LLMClient, ToolCallingClient, NormalizedUsage, TokenUsage, ModelPricing, LlmModels, ImageSize |
| `@intexuraos/llm-prompts`  | buildResearchPrompt                                                                           |
| `@intexuraos/llm-audit`    | createAuditContext, AuditSink                                                                 |
| `@intexuraos/llm-pricing`  | createUsageLogger, UsageSink                                                                  |

## Constants

| Constant                     | Value                          |
| ---------------------------- | ------------------------------ |
| `IMAGE_MODEL`                | `LlmModels.Gemini25FlashImage` |
| `DEFAULT_IMAGE_SIZE`         | `'1024x1024'`                  |
| `DEFAULT_MAX_ITERATIONS`     | `5`                            |
| Tool calling default model   | `'gemini-2.5-flash'`           |

## Constraints

**Do NOT:**

- Expect `reasoning_tokens` in usage — Gemini does not expose reasoning tokens
- Pass a custom image model via config — `IMAGE_MODEL` is hardcoded to `LlmModels.Gemini25FlashImage`
- Expect `cacheTokens` in usage — Gemini does not report prompt cache token details
- Omit `tools` from `toolClient.run()` — the loop requires at least one tool definition

**Requires:**

- Valid `INTEXURAOS_GOOGLE_API_KEY` environment variable
- `logger` field on config (mandatory, enforced by ESLint)
- `imagePricing` config for accurate `generateImage` cost tracking
