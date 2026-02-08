# @intexuraos/llm-factory - Technical Debt

## Code Quality

The package is minimal and focused. The factory uses an exhaustive switch with a `never` check to catch missing providers at compile time. Test coverage exercises all supported and unsupported providers.

### Current Issues

#### 1. Only two of five providers routed through the factory

The factory supports Google (Gemini) and Zai (GLM) but not Anthropic, OpenAI, or Perplexity. Those providers are configured through separate code paths in each app. This means the factory does not fully deliver on its promise of being a "unified" creation point.

**Impact:** Medium. Apps that use Claude, GPT, or Perplexity models cannot use the factory pattern and must handle provider-specific setup themselves.
**Suggested fix:** Add `infra-claude`, `infra-gpt`, and `infra-perplexity` as dependencies and route all providers through the factory.

#### 2. LlmGenerateClient is a subset of LLMClient

The factory returns `LlmGenerateClient` (which only has `generate()`), while `@intexuraos/llm-contract` defines `LLMClient` with `research()` and optional `generateImage()`. This means callers cannot use the factory to get a full-featured client with web search capabilities.

**Impact:** Medium. Callers that need `research()` or `generateImage()` must bypass the factory or cast the result.
**Suggested fix:** Align `LlmGenerateClient` with `LLMClient` from `llm-contract`, or make the factory return the full `LLMClient` interface.

## Future Plans

- Expand factory to cover all five providers for true provider-agnostic client creation
- Consider adding a `createResearchClient()` factory function that returns the full `LLMClient` interface
- Evaluate adding connection pooling or client caching for repeated calls with the same configuration
