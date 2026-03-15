# @intexuraos/infra-glm

> **This package was deleted in v3.3.0.** GLM model support is now provided through the DashScope-backed code-task subsystem. See the migration note below.

## Status

**Retired** — deleted in commit `93aeac4a3` (2026-03-12) as part of the ZAI provider removal.

## What It Was

`infra-glm` was the infrastructure wrapper for Zhipu AI GLM models, implementing the `LLMClient` interface from `@intexuraos/llm-contract`. It supported GLM-4.7 and GLM-4.7-Flash models via the ZAI provider.

## Migration (v3.3.0)

The ZAI provider and GLM-4.7/GLM-4.7-Flash models were removed in v3.3.0:

- **GLM-5** is retained as a DashScope-backed code-task worker via the `'glm'` backward-compatible alias — no `infra-glm` package is needed for this path.
- **ZAI provider** (`LlmProviders.Zai`) was removed from `@intexuraos/llm-contract`. The remaining providers are: Google, OpenAI, Anthropic, Perplexity.
- **Firestore migration 059** cleans up persisted ZAI/GLM-4.7 data.

If you have code importing from `@intexuraos/infra-glm`, remove those imports. GLM-5 functionality is accessed through the code-task subsystem directly, not via a shared infrastructure package.

## Related Changes

- `@intexuraos/llm-contract` — removed `LlmProviders.Zai`, removed `GLM-4.7` and `GLM-4.7-Flash` from `LlmModels`
- `llm-factory` — removed ZAI/GLM client creation path
- Firestore migration `059` — cleans up historical ZAI/GLM-4.7 pricing records
