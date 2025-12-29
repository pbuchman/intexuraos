# Task 1-2: Create infra-claude Package

## Objective

Create Claude API adapter package with web search capability.

## Structure

```
packages/infra-claude/
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
export interface ClaudeConfig {
  apiKey: string;
  model?: string;  // default: 'claude-sonnet-4-20250514'
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
export interface ClaudeClient {
  research(params: ResearchParams): Promise<Result<ResearchResult, ClaudeError>>;
}

export function createClaudeClient(config: ClaudeConfig): ClaudeClient;
```

## Implementation Notes

- Use `@anthropic-ai/sdk`
- Enable web search tool for research queries
- Model: `claude-sonnet-4-20250514` or latest with web capabilities

## Dependencies

- `@anthropic-ai/sdk`
- `@intexuraos/common-core`

## Verification

```bash
npm run typecheck
npm run lint
```

## Acceptance Criteria

- [ ] Package created with correct structure
- [ ] ClaudeClient interface defined
- [ ] Web search tool enabled
- [ ] Exports via index.ts
- [ ] `npm run typecheck` passes
