# @intexuraos/llm-factory — Agent Reference

> Machine-readable interface for automated tooling and AI agents.

## Identity

| Attribute | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| Package   | `@intexuraos/llm-factory`                                          |
| Role      | Provider-routing factory for LLM client construction               |
| Goal      | Create the correct provider client from a model name + config      |
| Scope     | Google (Gemini) only — other providers use direct infra packages   |

## Exports

### Functions

| Export                    | Signature                                                  | Purpose                                          |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| `createLlmClient`         | `(config: LlmClientConfig) => LlmGenerateClient`           | Create a generate-only client for Gemini models  |
| `createToolCallingClient` | `(config: ToolCallingClientConfig) => ToolCallingClient`   | Create a tool-calling agent client (Gemini only) |
| `isSupportedProvider`     | `(provider: string) => provider is SupportedProvider`      | Guard: `true` only for `'google'`                |

### Key Types

```typescript
interface LlmClientConfig {
  apiKey: string;
  model: LLMModel;          // Must be a Google model
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;   // Override Firestore audit sink (optional)
  usageSink?: UsageSink;   // Override Firestore usage sink (optional)
}

interface LlmGenerateClient {
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
}

interface GenerateResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

// ToolCallingClientConfig is re-exported from @intexuraos/infra-gemini
```

## Constraints

**Do NOT:**
- Pass a non-Google model (throws `Error("Unsupported LLM provider: {provider}")`)
- Expect `research()` or `generateImage()` on the returned `LlmGenerateClient`
- Use `createToolCallingClient` with non-Gemini models (throws)

**Requires:**
- Valid Google API key in `config.apiKey`
- `ModelPricing` sourced from `llm-pricing` `PricingContext.getPricing(model)`
- A Pino `Logger` instance

## Usage Pattern

```typescript
// Standard generation client
const client = createLlmClient({
  apiKey: process.env.GOOGLE_API_KEY,
  model: LlmModels.Gemini25Flash,
  userId,
  pricing: pricingContext.getPricing(LlmModels.Gemini25Flash),
  logger,
});
const result = await client.generate(prompt);
if (!result.ok) handleError(result.error);
return result.data.content;

// Tool calling agent
const toolClient = createToolCallingClient({ model: LlmModels.Gemini25Flash, ...config });
const loopResult = await toolClient.run({ systemPrompt, messages, tools, maxIterations: 10 });
```

## Error Handling

| Condition                            | Thrown Error Message                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Invalid model string                 | `"Unsupported LLM model: {model}"`                                                 |
| Non-Google model passed              | `"Unsupported LLM provider: {provider}. Only google is supported."`                |
| Non-Gemini tool-calling model passed | `"Tool calling not supported for provider: {provider}. Only google is supported."` |

## Dependencies

| Package                    | Why Needed                              |
| -------------------------- | --------------------------------------- |
| `@intexuraos/infra-gemini` | Gemini client implementation            |
| `@intexuraos/llm-audit`    | `AuditSink` type; Firestore audit sink  |
| `@intexuraos/llm-pricing`  | `UsageSink` type; Firestore usage sink  |
| `@intexuraos/llm-contract` | `LLMModel`, `ModelPricing`, error types |
| `@intexuraos/common-core`  | `Logger`, `Result` types                |
