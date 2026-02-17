# @intexuraos/llm-contract - Technical Debt

## Code Quality

The package is well-structured with clear separation between model definitions, client interfaces, and pricing types. All types are thoroughly tested and enforced at compile time.

### Current Issues

#### 1. No runtime validation for MODEL_PROVIDER_MAP completeness

The `MODEL_PROVIDER_MAP` relies on TypeScript's `Record<LLMModel, LlmProvider>` type to enforce completeness at compile time, but there is no runtime assertion verifying that the map covers all entries in `ALL_LLM_MODELS`. If the two data structures ever drift apart due to tooling issues, it would only surface as a runtime error.

**Impact:** Low. TypeScript catches this at compile time. Only a risk if someone bypasses type checking.

#### 2. Pricing types duplicated between contract and pricing package

`ModelPricing` is defined in `llm-contract/src/pricing.ts`, while `LlmPricing` in `llm-pricing/src/types.ts` defines a similar but not identical shape (it adds `provider`, `model`, `updatedAt`). This split forces consumers to know which pricing type to use in which context.

**Impact:** Low. The types serve different layers (contract vs storage), but the naming similarity causes confusion.

#### 3. TokenUsage has provider-specific fields in a shared type

`TokenUsage` contains fields specific to individual providers (`cacheCreationTokens` for Anthropic, `reasoningTokens` for OpenAI, `groundingEnabled` for Google). This leaks provider implementation details into the shared contract.

**Impact:** Low. The optional fields do not break consumers that do not use them. However, adding a new provider with unique usage metrics requires modifying the shared contract.

## Future Plans

- Consider splitting `TokenUsage` into a base type plus provider-specific extensions to avoid shared-type bloat
- Evaluate whether `CostCalculator` interface should move to a dedicated cost-calculation package as pricing logic grows
- The `SynthesisInput` type in `types.ts` is minimal and may need richer metadata as synthesis operations evolve
