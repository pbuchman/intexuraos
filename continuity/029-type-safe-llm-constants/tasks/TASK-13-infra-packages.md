# TASK-13: Migrate Infrastructure Packages

## Status: PENDING

## Depends On: TASK-02

## Objective

Replace hardcoded provider strings with `LlmProviders` constants in infra-* packages.

## Files to Modify

### 1. `packages/infra-gemini/src/geminiClient.ts`

**Update provider reference:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
// FROM: provider: 'google'
// TO: provider: LlmProviders.Google
```

### 2. `packages/infra-gpt/src/gptClient.ts`

**Update provider reference:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
// FROM: provider: 'openai'
// TO: provider: LlmProviders.OpenAI
```

### 3. `packages/infra-claude/src/claudeClient.ts`

**Update provider reference:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
// FROM: provider: 'anthropic'
// TO: provider: LlmProviders.Anthropic
```

### 4. `packages/infra-perplexity/src/perplexityClient.ts`

**Update provider reference:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace:
// FROM: provider: 'perplexity'
// TO: provider: LlmProviders.Perplexity
```

## Validation

```bash
npm run typecheck -w @intexuraos/infra-gemini
npm run typecheck -w @intexuraos/infra-gpt
npm run typecheck -w @intexuraos/infra-claude
npm run typecheck -w @intexuraos/infra-perplexity
```

## Acceptance Criteria

- [ ] No hardcoded provider strings in any infra-* package
- [ ] All packages typecheck

