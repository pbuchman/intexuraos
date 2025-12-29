# Task 1-1: Create infra-gemini Package

## Objective

Create Gemini API adapter package with Google Search grounding for deep research.

## Structure

```
packages/infra-gemini/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── client.ts
    └── types.ts
```

## Interface

```typescript
// types.ts
export interface GeminiConfig {
  apiKey: string;
  model?: string; // default: 'gemini-2.0-flash-exp'
}

export interface ResearchParams {
  prompt: string;
  enableWebSearch: boolean;
}

export interface ResearchResult {
  content: string;
  sources?: string[];
}

// client.ts
export interface GeminiClient {
  research(params: ResearchParams): Promise<Result<ResearchResult, GeminiError>>;
  generateTitle(prompt: string): Promise<Result<string, GeminiError>>;
}

export function createGeminiClient(config: GeminiConfig): GeminiClient;
```

## Implementation Notes

- Use `@google/generative-ai` SDK
- Enable Google Search grounding for research queries
- Model: `gemini-2.0-flash-exp` (with search) or latest available

## Dependencies

- `@google/generative-ai`
- `@intexuraos/common-core`

## Verification

```bash
npm run typecheck
npm run lint
```

## Acceptance Criteria

- [ ] Package created with correct structure
- [ ] GeminiClient interface defined
- [ ] Google Search grounding enabled
- [ ] Exports via index.ts
- [ ] `npm run typecheck` passes
