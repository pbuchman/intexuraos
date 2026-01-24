# @intexuraos/llm-factory

Unified factory for creating LLM clients across different providers.

## Overview

This package provides a single interface for creating LLM clients, abstracting away provider-specific details. Currently supports Google (Gemini) and Zai (GLM) providers.

## Installation

```bash
pnpm add @intexuraos/llm-factory
```

## Usage

### Basic Usage

```typescript
import { createLlmClient } from '@intexuraos/llm-factory';
import { LlmModels } from '@intexuraos/llm-contract';

const client = createLlmClient({
  apiKey: process.env.GOOGLE_API_KEY,
  model: LlmModels.Gemini25Flash,
  userId: 'user-123',
  pricing: {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
  },
  logger,
});

const result = await client.generate('Write a haiku about coding');

if (result.ok) {
  console.log(result.value.content);
  console.log(`Cost: $${result.value.usage.costUsd}`);
}
```

### Supported Providers

| Provider | Models                           | Package                    |
| -------- | -------------------------------- | -------------------------- |
| Google   | Gemini 2.5 Flash, Gemini 2.5 Pro | `@intexuraos/infra-gemini` |
| Zai      | GLM-4.7, GLM-4.7-Flash           | `@intexuraos/infra-glm`    |

### Configuration

```typescript
interface LlmClientConfig {
  /** API key for the LLM provider */
  apiKey: string;

  /** Model identifier (e.g., 'gemini-2.5-flash', 'glm-4.7') */
  model: LLMModel;

  /** User ID for usage tracking */
  userId: string;

  /** Pricing information for cost calculation */
  pricing: ModelPricing;

  /** Logger for structured logging */
  logger: Logger;
}
```

### Response Format

```typescript
interface GenerateResult {
  /** Generated text content */
  content: string;

  /** Usage statistics */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}
```

### Error Handling

The factory returns `Result<GenerateResult, LLMError>`:

```typescript
const result = await client.generate(prompt);

if (!result.ok) {
  switch (result.error.code) {
    case 'RATE_LIMITED':
      // Retry with backoff
      break;
    case 'INVALID_KEY':
      // Prompt user to update API key
      break;
    case 'TIMEOUT':
      // Retry or fail gracefully
      break;
    default:
      logger.error({ error: result.error }, 'LLM call failed');
  }
}
```

### Provider Detection

The factory automatically detects the provider from the model:

```typescript
import { isSupportedProvider } from '@intexuraos/llm-factory';
import { getProviderForModel } from '@intexuraos/llm-contract';

const provider = getProviderForModel('gemini-2.5-flash');
// Returns: 'google'

if (isSupportedProvider(provider)) {
  // Safe to use with factory
}
```

## Adding New Providers

1. Create provider package: `packages/infra-<provider>/`

2. Implement the client interface:

   ```typescript
   interface LlmGenerateClient {
     generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
   }
   ```

3. Update `llm-factory/src/llmClientFactory.ts`:
   - Import the new client creator
   - Add provider to `SupportedProvider` type
   - Add case to the switch statement

4. Update `llm-contract` with new model definitions

## Dependencies

- `@intexuraos/llm-contract` - Types and model definitions
- `@intexuraos/llm-pricing` - Cost calculation
- `@intexuraos/common-core` - Result types, Logger
- `@intexuraos/infra-gemini` - Google client
- `@intexuraos/infra-glm` - Zai client
