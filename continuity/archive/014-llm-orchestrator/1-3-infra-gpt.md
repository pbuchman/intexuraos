# Task 1-3: Create infra-gpt Package

**Tier:** 1 (Independent deliverable)

---

## Context Snapshot

- LLM Orchestrator runs research prompts on multiple LLMs including GPT
- Uses OpenAI `openai` SDK
- Model: `gpt-4o` (or latest available)
- GPT does not have built-in web search; relies on knowledge cutoff

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Need a standalone OpenAI GPT adapter that executes research prompts, returning structured results compatible with the orchestrator's synthesis flow.

---

## Scope

**In scope:**

- Create `packages/infra-gpt/` package structure
- Implement `research()` for research prompts
- Handle API errors with Result type
- Add to root tsconfig.json references
- Add to eslint.config.js boundaries

**Non-scope:**

- Streaming responses
- Multi-turn conversations
- Image generation
- Web browsing (GPT doesn't support this natively in API)
- Synthesis (Gemini handles this)

---

## Required Approach

### Step 1: Create package structure

```bash
mkdir -p packages/infra-gpt/src
```

### Step 2: Create package.json

```json
{
  "name": "@intexuraos/infra-gpt",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist .tsbuildinfo"
  },
  "dependencies": {
    "@intexuraos/common-core": "*",
    "openai": "^4.73.0"
  }
}
```

### Step 3: Create tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../common-core" }]
}
```

### Step 4: Create src/types.ts

```typescript
export interface GptConfig {
  apiKey: string;
  model?: string; // default: 'gpt-4o'
}

export interface ResearchResult {
  content: string;
  sources?: string[]; // GPT doesn't provide sources
}

export interface GptError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'CONTEXT_LENGTH';
  message: string;
}
```

### Step 5: Create src/client.ts

```typescript
import OpenAI from 'openai';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { GptConfig, ResearchResult, GptError } from './types.js';

const DEFAULT_MODEL = 'gpt-4o';
const MAX_TOKENS = 8192;

export interface GptClient {
  research(prompt: string): Promise<Result<ResearchResult, GptError>>;
}

export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GptError>> {
      try {
        const response = await client.chat.completions.create({
          model: config.model ?? DEFAULT_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'system',
              content:
                'You are a research analyst. Provide comprehensive, well-organized research on the given topic. Include relevant facts, analysis, and conclusions.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        });

        const content = response.choices[0]?.message?.content ?? '';

        return ok({ content });
      } catch (error) {
        return err(mapGptError(error));
      }
    },
  };
}

function mapGptError(error: unknown): GptError {
  if (error instanceof OpenAI.APIError) {
    const message = error.message;

    if (error.status === 401) {
      return { code: 'INVALID_KEY', message };
    }
    if (error.status === 429) {
      return { code: 'RATE_LIMITED', message };
    }
    if (error.code === 'context_length_exceeded') {
      return { code: 'CONTEXT_LENGTH', message };
    }
    if (message.includes('timeout')) {
      return { code: 'TIMEOUT', message };
    }

    return { code: 'API_ERROR', message };
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return { code: 'API_ERROR', message };
}
```

### Step 6: Create src/index.ts

```typescript
export { createGptClient, type GptClient } from './client.js';
export type { GptConfig, ResearchResult, GptError } from './types.js';
```

### Step 7: Update root tsconfig.json

Add reference:

```json
{ "path": "packages/infra-gpt" }
```

### Step 8: Update eslint.config.js

Add to `boundaries/elements`:

```javascript
{ type: 'infra-gpt', pattern: ['packages/infra-gpt/src/**'], mode: 'folder' }
```

Add boundary rule: `infra-gpt` can only import `common-core`.

---

## Step Checklist

- [ ] Create `packages/infra-gpt/` directory structure
- [ ] Create `package.json` with openai dependency
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/types.ts` with interfaces
- [ ] Create `src/client.ts` with research function
- [ ] Create `src/index.ts` with exports
- [ ] Add to root `tsconfig.json` references
- [ ] Add to `eslint.config.js` boundaries
- [ ] Run `npm install` to update lockfile
- [ ] Run verification commands

---

## Definition of Done

1. Package exists at `packages/infra-gpt/`
2. `GptClient` interface with `research()` method
3. TypeScript compiles without errors
4. ESLint passes with boundaries configured

---

## Verification Commands

```bash
npm run typecheck
npm run lint
npm run build
```

---

## Rollback Plan

If verification fails:

1. Remove `packages/infra-gpt/` directory
2. Revert changes to `tsconfig.json`
3. Revert changes to `eslint.config.js`
4. Run `npm install` to update lockfile
