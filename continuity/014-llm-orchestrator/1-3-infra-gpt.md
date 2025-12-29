# Task 1-3: Create infra-gpt Package

## Objective

Create OpenAI GPT API adapter package.

## Structure

```
packages/infra-gpt/
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
export interface GptConfig {
  apiKey: string;
  model?: string; // default: 'gpt-4o'
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
export interface GptClient {
  research(params: ResearchParams): Promise<Result<ResearchResult, GptError>>;
}

export function createGptClient(config: GptConfig): GptClient;
```

## Implementation Notes

- Use `openai` SDK
- Model: `gpt-4o` or reasoning model if web browsing available
- Note: OpenAI web browsing may have limited API availability

## Dependencies

- `openai`
- `@intexuraos/common-core`

## Verification

```bash
npm run typecheck
npm run lint
```

## Acceptance Criteria

- [ ] Package created with correct structure
- [ ] GptClient interface defined
- [ ] Exports via index.ts
- [ ] `npm run typecheck` passes
