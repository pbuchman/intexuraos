# Task 1-1: Create infra-gemini Package

**Tier:** 1 (Independent deliverable)

---

## Context Snapshot

- LLM Orchestrator runs research prompts on multiple LLMs including Gemini
- Gemini is unique: provides Google Search grounding for real-time web info
- Gemini also performs synthesis of results from multiple LLMs
- Uses `@google/generative-ai` SDK

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Need a standalone Gemini API adapter that:

1. Executes research prompts with Google Search grounding enabled
2. Generates short titles from prompts
3. Synthesizes multiple LLM research outputs into a unified report

---

## Scope

**In scope:**

- Create `packages/infra-gemini/` package structure
- Implement `research()` with Google Search grounding
- Implement `generateTitle()` for research title generation
- Implement `synthesize()` for multi-LLM result synthesis
- Handle API errors with Result type
- Add to root tsconfig.json references
- Add to eslint.config.js boundaries

**Non-scope:**

- Streaming responses
- Chat conversations (single-turn only)
- Image generation

---

## Required Approach

### Step 1: Create package structure

```bash
mkdir -p packages/infra-gemini/src
```

### Step 2: Create package.json

```json
{
  "name": "@intexuraos/infra-gemini",
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
    "@google/generative-ai": "^0.21.0"
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
export interface GeminiConfig {
  apiKey: string;
  model?: string; // default: 'gemini-2.0-flash-exp'
}

export interface ResearchResult {
  content: string;
  sources?: string[];
}

export interface SynthesisInput {
  model: string;
  content: string;
}

export interface GeminiError {
  code: 'API_ERROR' | 'TIMEOUT' | 'INVALID_KEY' | 'RATE_LIMITED';
  message: string;
}
```

### Step 5: Create src/client.ts

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { GeminiConfig, ResearchResult, SynthesisInput, GeminiError } from './types.js';

const DEFAULT_MODEL = 'gemini-2.0-flash-exp';

export interface GeminiClient {
  research(prompt: string): Promise<Result<ResearchResult, GeminiError>>;
  generateTitle(prompt: string): Promise<Result<string, GeminiError>>;
  synthesize(
    originalPrompt: string,
    reports: SynthesisInput[]
  ): Promise<Result<string, GeminiError>>;
}

export function createGeminiClient(config: GeminiConfig): GeminiClient {
  const genAI = new GoogleGenerativeAI(config.apiKey);

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      try {
        const model = genAI.getGenerativeModel({
          model: config.model ?? DEFAULT_MODEL,
          // Enable Google Search grounding
          tools: [{ googleSearch: {} }],
        });

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        // Extract sources from grounding metadata if available
        const sources = extractSources(response);

        return ok({ content: text, sources });
      } catch (error) {
        return err(mapGeminiError(error));
      }
    },

    async generateTitle(prompt: string): Promise<Result<string, GeminiError>> {
      try {
        const model = genAI.getGenerativeModel({
          model: config.model ?? DEFAULT_MODEL,
        });

        const result = await model.generateContent(
          `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`
        );

        return ok(result.response.text().trim());
      } catch (error) {
        return err(mapGeminiError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[]
    ): Promise<Result<string, GeminiError>> {
      try {
        const model = genAI.getGenerativeModel({
          model: config.model ?? DEFAULT_MODEL,
        });

        const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports);
        const result = await model.generateContent(synthesisPrompt);

        return ok(result.response.text());
      } catch (error) {
        return err(mapGeminiError(error));
      }
    },
  };
}

function extractSources(response: unknown): string[] | undefined {
  // Extract grounding sources from response metadata
  // Implementation depends on SDK response structure
  return undefined;
}

function mapGeminiError(error: unknown): GeminiError {
  const message = error instanceof Error ? error.message : 'Unknown error';

  if (message.includes('API_KEY')) {
    return { code: 'INVALID_KEY', message };
  }
  if (message.includes('429') || message.includes('quota')) {
    return { code: 'RATE_LIMITED', message };
  }
  if (message.includes('timeout')) {
    return { code: 'TIMEOUT', message };
  }

  return { code: 'API_ERROR', message };
}

function buildSynthesisPrompt(originalPrompt: string, reports: SynthesisInput[]): string {
  const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');

  return `You are a research analyst. Below are research reports from multiple AI models responding to the same prompt. Synthesize them into a comprehensive, well-organized report.

## Original Research Prompt

${originalPrompt}

## Individual Reports

${formattedReports}

## Your Task

Create a unified synthesis that:
1. Combines the best insights from all reports
2. Notes any conflicting information
3. Provides a balanced conclusion
4. Lists key sources from across all reports

Write in clear, professional prose.`;
}
```

### Step 6: Create src/index.ts

```typescript
export { createGeminiClient, type GeminiClient } from './client.js';
export type { GeminiConfig, ResearchResult, SynthesisInput, GeminiError } from './types.js';
```

### Step 7: Update root tsconfig.json

Add reference:

```json
{ "path": "packages/infra-gemini" }
```

### Step 8: Update eslint.config.js

Add to `boundaries/elements`:

```javascript
{ type: 'infra-gemini', pattern: ['packages/infra-gemini/src/**'], mode: 'folder' }
```

Add boundary rule: `infra-gemini` can only import `common-core`.

---

## Step Checklist

- [ ] Create `packages/infra-gemini/` directory structure
- [ ] Create `package.json` with @google/generative-ai dependency
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/types.ts` with interfaces
- [ ] Create `src/client.ts` with research, generateTitle, synthesize
- [ ] Create `src/index.ts` with exports
- [ ] Add to root `tsconfig.json` references
- [ ] Add to `eslint.config.js` boundaries
- [ ] Run `npm install` to update lockfile
- [ ] Run verification commands

---

## Definition of Done

1. Package exists at `packages/infra-gemini/`
2. `GeminiClient` interface with `research()`, `generateTitle()`, `synthesize()`
3. Google Search grounding enabled for research
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

1. Remove `packages/infra-gemini/` directory
2. Revert changes to `tsconfig.json`
3. Revert changes to `eslint.config.js`
4. Run `npm install` to update lockfile
