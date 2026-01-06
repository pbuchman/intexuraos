# CONTINUITY LEDGER — 028-llm-client-v2-migration

## Goal

Migrate all LLM client usages from V1 to V2, delete V1 code entirely. No backward compatibility.

**Success criteria:**
- All `createXxxClient` → `createXxxClientV2` (then renamed back to `createXxxClient`)
- All `client.ts` (V1) files deleted
- `clientV2.ts` renamed to `client.ts`
- Exports simplified (no V2 suffix)
- All tests pass, `npm run ci` green

## Constraints / Assumptions

- Pricing injected at startup, no runtime refresh
- Test fixtures use migration 012 pricing values (minus DALL-E 3)
- V2 clients already exist in all 4 infra packages

## Key Decisions

1. **Pricing strategy:** Option A — startup injection, no refresh
2. **Backward compat:** None. Hard removal of V1.
3. **Test fixtures:** Shared in llm-contract, mirroring migration 012/013 values

## Reasoning Narrative

Migration 012 established the new pricing structure in Firestore (`settings/llm_pricing/{provider}`).
V2 clients exist but aren't used anywhere.
Services currently use V1 clients with hardcoded pricing.
Goal: cut over completely to V2, remove all V1 code.

## State

- Done: (none)
- Now: Planning complete, awaiting execution
- Next: 0-0 — Create shared test pricing fixture

## Open Questions

(none)

## Working Set

### Packages to modify (Tier 1):
- packages/infra-gemini/src/client.ts (DELETE)
- packages/infra-gemini/src/clientV2.ts → client.ts
- packages/infra-gemini/src/types.ts (remove GeminiConfig)
- packages/infra-gemini/src/index.ts (simplify exports)
- packages/infra-gpt/src/client.ts (DELETE)
- packages/infra-gpt/src/clientV2.ts → client.ts
- packages/infra-gpt/src/types.ts (remove GptConfig)
- packages/infra-gpt/src/index.ts (simplify exports)
- packages/infra-claude/src/client.ts (DELETE)
- packages/infra-claude/src/clientV2.ts → client.ts
- packages/infra-claude/src/types.ts (remove ClaudeConfig)
- packages/infra-claude/src/index.ts (simplify exports)
- packages/infra-perplexity/src/client.ts (DELETE)
- packages/infra-perplexity/src/clientV2.ts → client.ts
- packages/infra-perplexity/src/types.ts (remove PerplexityConfig)
- packages/infra-perplexity/src/index.ts (simplify exports)

### Services to migrate (Tier 2):
- apps/llm-orchestrator/src/infra/llm/GptAdapter.ts
- apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts
- apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts
- apps/llm-orchestrator/src/infra/llm/PerplexityAdapter.ts
- apps/llm-orchestrator/src/infra/llm/ContextInferenceAdapter.ts
- apps/image-service/src/infra/image/OpenAIImageGenerator.ts
- apps/image-service/src/infra/image/GoogleImageGenerator.ts
- apps/image-service/src/infra/llm/GptPromptAdapter.ts
- apps/user-service/src/infra/llm/LlmValidatorImpl.ts
- apps/data-insights-service/src/infra/gemini/titleGenerationService.ts

### Tests to update:
- apps/llm-orchestrator/src/__tests__/infra/llm/GptAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/ClaudeAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/GeminiAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/PerplexityAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/ContextInferenceAdapter.test.ts
- apps/image-service/src/__tests__/infra/OpenAIImageGenerator.test.ts
- apps/image-service/src/__tests__/infra/GoogleImageGenerator.test.ts
- apps/user-service/src/__tests__/infra/llmValidator.test.ts

