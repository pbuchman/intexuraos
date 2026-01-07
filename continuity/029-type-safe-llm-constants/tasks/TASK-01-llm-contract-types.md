# TASK-01: Update llm-contract with Individual Model and Provider Types

## Status: ✅ COMPLETED

## Objective

Add individual type aliases for each model and provider, then compose category types from them.

## Files to Modify

### 1. `packages/llm-contract/src/supportedModels.ts`

**Current state (lines ~1-50):**

```typescript
export type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity';

export type ImageModel = 'gpt-image-1' | 'gemini-2.5-flash-image';
export type ResearchModel = ...
```

**Target state:**

```typescript
// ============================================
// Individual Provider Types
// ============================================
export type Google = 'google';
export type OpenAI = 'openai';
export type Anthropic = 'anthropic';
export type Perplexity = 'perplexity';

/** Union of all LLM providers */
export type LlmProvider = Google | OpenAI | Anthropic | Perplexity;

// ============================================
// Individual Model Types - Google
// ============================================
export type Gemini25Pro = 'gemini-2.5-pro';
export type Gemini25Flash = 'gemini-2.5-flash';
export type Gemini20Flash = 'gemini-2.0-flash';
export type Gemini25FlashImage = 'gemini-2.5-flash-image';

// ============================================
// Individual Model Types - OpenAI
// ============================================
export type O4MiniDeepResearch = 'o4-mini-deep-research';
export type GPT52 = 'gpt-5.2';
export type GPT4oMini = 'gpt-4o-mini';
export type GPTImage1 = 'gpt-image-1';

// ============================================
// Individual Model Types - Anthropic
// ============================================
export type ClaudeOpus45 = 'claude-opus-4-5-20251101';
export type ClaudeSonnet45 = 'claude-sonnet-4-5-20250929';
export type ClaudeHaiku35 = 'claude-3-5-haiku-20241022';

// ============================================
// Individual Model Types - Perplexity
// ============================================
export type Sonar = 'sonar';
export type SonarPro = 'sonar-pro';
export type SonarDeepResearch = 'sonar-deep-research';

// ============================================
// Category Types (composed from individual types)
// ============================================

/** Models capable of image generation */
export type ImageModel = GPTImage1 | Gemini25FlashImage;

/** Models suitable for deep research tasks */
export type ResearchModel =
  | Gemini25Pro
  | Gemini25Flash
  | ClaudeOpus45
  | ClaudeSonnet45
  | O4MiniDeepResearch
  | GPT52
  | Sonar
  | SonarPro
  | SonarDeepResearch;

/** Fast, cost-effective models for validation */
export type ValidationModel = ClaudeHaiku35 | Gemini20Flash | GPT4oMini | Sonar;

/** Fast models for quick operations */
export type FastModel = Gemini25Flash | Gemini20Flash;

/** General-purpose high-quality models */
export type GenericModel = Gemini25Pro | GPT52;

/** Union of all LLM models */
export type LLMModel =
  | Gemini25Pro
  | Gemini25Flash
  | Gemini20Flash
  | Gemini25FlashImage
  | O4MiniDeepResearch
  | GPT52
  | GPT4oMini
  | GPTImage1
  | ClaudeOpus45
  | ClaudeSonnet45
  | ClaudeHaiku35
  | Sonar
  | SonarPro
  | SonarDeepResearch;
```

## Validation

```bash
npm run typecheck -w @intexuraos/llm-contract
```

## Acceptance Criteria

- [ ] All 14 individual model types defined
- [ ] All 4 individual provider types defined
- [ ] Category types use individual types (no string literals)
- [ ] LLMModel union uses individual types
- [ ] LlmProvider union uses individual types
- [ ] Typecheck passes
