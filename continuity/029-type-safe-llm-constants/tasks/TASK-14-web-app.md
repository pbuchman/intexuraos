# TASK-14: Migrate Web App

## Status: PENDING

## Depends On: TASK-02

## Objective

Replace hardcoded model and provider strings with constants in the web application.

## Investigation Required

First, scan web app for violations:

```bash
grep -rn "gemini-2.5-pro\|gemini-2.5-flash\|gpt-5.2\|claude-opus\|sonar" apps/web/src/ --include="*.ts" --include="*.tsx"
grep -rn "'google'\|'openai'\|'anthropic'\|'perplexity'" apps/web/src/ --include="*.ts" --include="*.tsx"
```

## Typical Files to Check

### 1. Model selection components
- Components that let users select research models
- Any dropdown/select with model options

### 2. Research configuration
- Default model configurations
- Model display names mapping

### 3. Type definitions
- Local type definitions that duplicate LLMModel

## Pattern to Apply

```tsx
import { LlmModels, LlmProviders, type ResearchModel } from '@intexuraos/llm-contract';

// Replace hardcoded strings:
// FROM:
const defaultModels = ['gemini-2.5-pro', 'claude-opus-4-5-20251101'];

// TO:
const defaultModels: ResearchModel[] = [LlmModels.Gemini25Pro, LlmModels.ClaudeOpus45];
```

## Validation

```bash
npm run typecheck -w @intexuraos/web
npx tsx scripts/verify-llm-architecture.ts 2>&1 | grep "apps/web"
```

## Acceptance Criteria

- [ ] No hardcoded model strings in web app
- [ ] No hardcoded provider strings in web app
- [ ] Typecheck passes
- [ ] Verification script shows no web app violations

