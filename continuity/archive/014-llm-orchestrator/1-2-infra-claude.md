# Task 1-2: Create infra-claude Package

**Tier:** 1 (Independent deliverable)

---

## Context Snapshot

- LLM Orchestrator runs research prompts on multiple LLMs including Claude
- Claude provides web search capability via tool use
- Uses `@anthropic-ai/sdk` official SDK
- Model: `claude-sonnet-4-20250514` (or latest available)

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Need a standalone Claude API adapter that executes research prompts with web search tool enabled, returning structured results compatible with the orchestrator's synthesis flow.

---

## Scope

**In scope:**

- Create `packages/infra-claude/` package structure
- Implement `research()` with web search tool
- Handle API errors with Result type
- Add to root tsconfig.json references
- Add to eslint.config.js boundaries

**Non-scope:**

- Streaming responses
- Multi-turn conversations
- Image analysis
- Synthesis (Gemini handles this)

---

## Required Approach

### Step 1: Create package structure

```bash
mkdir -p packages/infra-claude/src
```

### Step 2: Create package.json

```json
{
  "name": "@intexuraos/infra-claude",
  "version": "0.0.4",
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
    "@anthropic-ai/sdk": "^0.32.0"
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
export interface ClaudeConfig {
  apiKey: string;
  model?: string; // default: 'claude-sonnet-4-20250514'
}

export interface ResearchResult {
  content: string;
  sources?: string[];
}

export interface ClaudeError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED' | 'OVERLOADED';
  message: string;
}
```

### Step 5: Create src/client.ts

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { ClaudeConfig, ResearchResult, ClaudeError } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;

export interface ClaudeClient {
  research(prompt: string): Promise<Result<ResearchResult, ClaudeError>>;
}

export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    async research(prompt: string): Promise<Result<ResearchResult, ClaudeError>> {
      try {
        const response = await client.messages.create({
          model: config.model ?? DEFAULT_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
          tools: [
            {
              type: 'web_search',
              name: 'web_search',
            },
          ],
        });

        // Extract text content from response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );

        const content = textBlocks.map((b) => b.text).join('\n\n');

        // Extract sources from tool use results if available
        const sources = extractSources(response);

        return ok({ content, sources });
      } catch (error) {
        return err(mapClaudeError(error));
      }
    },
  };
}

function extractSources(response: Anthropic.Message): string[] | undefined {
  // Extract search result URLs from tool use blocks if present
  const toolUseBlocks = response.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (toolUseBlocks.length === 0) {
    return undefined;
  }

  // Parse sources from tool results
  // Implementation depends on web_search tool response structure
  return undefined;
}

function mapClaudeError(error: unknown): ClaudeError {
  if (error instanceof Anthropic.APIError) {
    const message = error.message;

    if (error.status === 401) {
      return { code: 'INVALID_KEY', message };
    }
    if (error.status === 429) {
      return { code: 'RATE_LIMITED', message };
    }
    if (error.status === 529) {
      return { code: 'OVERLOADED', message };
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
export { createClaudeClient, type ClaudeClient } from './client.js';
export type { ClaudeConfig, ResearchResult, ClaudeError } from './types.js';
```

### Step 7: Update root tsconfig.json

Add reference:

```json
{ "path": "packages/infra-claude" }
```

### Step 8: Update eslint.config.js

Add to `boundaries/elements`:

```javascript
{ type: 'infra-claude', pattern: ['packages/infra-claude/src/**'], mode: 'folder' }
```

Add boundary rule: `infra-claude` can only import `common-core`.

---

## Step Checklist

- [ ] Create `packages/infra-claude/` directory structure
- [ ] Create `package.json` with @anthropic-ai/sdk dependency
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

1. Package exists at `packages/infra-claude/`
2. `ClaudeClient` interface with `research()` method
3. Web search tool enabled for research queries
4. TypeScript compiles without errors
5. ESLint passes with boundaries configured

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

1. Remove `packages/infra-claude/` directory
2. Revert changes to `tsconfig.json`
3. Revert changes to `eslint.config.js`
4. Run `npm install` to update lockfile
