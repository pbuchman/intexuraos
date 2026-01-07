# TASK-02: Add LlmModels and LlmProviders Constants Objects

## Status: ✅ COMPLETED

## Depends On: TASK-01

## Objective

Add `LlmModels` and `LlmProviders` constant objects that provide typed access to model/provider string values.

## Files to Modify

### 1. `packages/llm-contract/src/supportedModels.ts`

**Add after the type definitions (after LLMModel type):**

```typescript
// ============================================
// Provider Constants Object
// ============================================

/**
 * Typed constants for LLM providers.
 * Use these instead of string literals: LlmProviders.Google instead of 'google'
 */
export const LlmProviders = {
  Google: 'google' as Google,
  OpenAI: 'openai' as OpenAI,
  Anthropic: 'anthropic' as Anthropic,
  Perplexity: 'perplexity' as Perplexity,
} as const;

// ============================================
// Model Constants Object
// ============================================

/**
 * Typed constants for LLM models.
 * Use these instead of string literals: LlmModels.Gemini25Pro instead of 'gemini-2.5-pro'
 */
export const LlmModels = {
  // Google
  Gemini25Pro: 'gemini-2.5-pro' as Gemini25Pro,
  Gemini25Flash: 'gemini-2.5-flash' as Gemini25Flash,
  Gemini20Flash: 'gemini-2.0-flash' as Gemini20Flash,
  Gemini25FlashImage: 'gemini-2.5-flash-image' as Gemini25FlashImage,
  // OpenAI
  O4MiniDeepResearch: 'o4-mini-deep-research' as O4MiniDeepResearch,
  GPT52: 'gpt-5.2' as GPT52,
  GPT4oMini: 'gpt-4o-mini' as GPT4oMini,
  GPTImage1: 'gpt-image-1' as GPTImage1,
  // Anthropic
  ClaudeOpus45: 'claude-opus-4-5-20251101' as ClaudeOpus45,
  ClaudeSonnet45: 'claude-sonnet-4-5-20250929' as ClaudeSonnet45,
  ClaudeHaiku35: 'claude-3-5-haiku-20241022' as ClaudeHaiku35,
  // Perplexity
  Sonar: 'sonar' as Sonar,
  SonarPro: 'sonar-pro' as SonarPro,
  SonarDeepResearch: 'sonar-deep-research' as SonarDeepResearch,
} as const;
```

**Update `MODEL_PROVIDER_MAP` to use constants:**

```typescript
export const MODEL_PROVIDER_MAP: Record<LLMModel, LlmProvider> = {
  [LlmModels.Gemini25Pro]: LlmProviders.Google,
  [LlmModels.Gemini25Flash]: LlmProviders.Google,
  [LlmModels.Gemini20Flash]: LlmProviders.Google,
  [LlmModels.Gemini25FlashImage]: LlmProviders.Google,
  [LlmModels.O4MiniDeepResearch]: LlmProviders.OpenAI,
  [LlmModels.GPT52]: LlmProviders.OpenAI,
  [LlmModels.GPT4oMini]: LlmProviders.OpenAI,
  [LlmModels.GPTImage1]: LlmProviders.OpenAI,
  [LlmModels.ClaudeOpus45]: LlmProviders.Anthropic,
  [LlmModels.ClaudeSonnet45]: LlmProviders.Anthropic,
  [LlmModels.ClaudeHaiku35]: LlmProviders.Anthropic,
  [LlmModels.Sonar]: LlmProviders.Perplexity,
  [LlmModels.SonarPro]: LlmProviders.Perplexity,
  [LlmModels.SonarDeepResearch]: LlmProviders.Perplexity,
};
```

**Update `ALL_LLM_MODELS` to use constants:**

```typescript
export const ALL_LLM_MODELS: LLMModel[] = [
  LlmModels.Gemini25Pro,
  LlmModels.Gemini25Flash,
  LlmModels.Gemini20Flash,
  LlmModels.Gemini25FlashImage,
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT52,
  LlmModels.GPT4oMini,
  LlmModels.GPTImage1,
  LlmModels.ClaudeOpus45,
  LlmModels.ClaudeSonnet45,
  LlmModels.ClaudeHaiku35,
  LlmModels.Sonar,
  LlmModels.SonarPro,
  LlmModels.SonarDeepResearch,
];
```

### 2. `packages/llm-contract/src/index.ts`

**Add exports:**

```typescript
export {
  // ...existing exports...
  LlmModels,
  LlmProviders,
} from './supportedModels.js';

export type {
  // ...existing type exports...
  // Individual model types
  Gemini25Pro,
  Gemini25Flash,
  Gemini20Flash,
  Gemini25FlashImage,
  O4MiniDeepResearch,
  GPT52,
  GPT4oMini,
  GPTImage1,
  ClaudeOpus45,
  ClaudeSonnet45,
  ClaudeHaiku35,
  Sonar,
  SonarPro,
  SonarDeepResearch,
  // Individual provider types
  Google,
  OpenAI,
  Anthropic,
  Perplexity,
} from './supportedModels.js';
```

## Validation

```bash
npm run typecheck -w @intexuraos/llm-contract
```

## Acceptance Criteria

- [ ] `LlmModels` object exported with all 14 model constants
- [ ] `LlmProviders` object exported with all 4 provider constants
- [ ] `MODEL_PROVIDER_MAP` uses constants (no string literals)
- [ ] `ALL_LLM_MODELS` uses constants (no string literals)
- [ ] All individual types exported from index.ts
- [ ] Typecheck passes

