# Task 3-0: Define Research Domain Models

## Objective

Create Research and LlmResult domain models for llm-orchestrator-service.

## File to Create

`apps/llm-orchestrator-service/src/domain/research/models/Research.ts`

## Models

```typescript
export type LlmProvider = 'google' | 'openai' | 'anthropic';

export type ResearchStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type LlmResultStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface LlmResult {
  provider: LlmProvider;
  model: string;
  status: LlmResultStatus;
  result?: string;
  error?: string;
  sources?: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  status: ResearchStatus;
  llmResults: LlmResult[];
  synthesizedResult?: string;
  synthesisError?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
}

export function createResearch(params: {
  id: string;
  userId: string;
  prompt: string;
  selectedLlms: LlmProvider[];
}): Research {
  return {
    id: params.id,
    userId: params.userId,
    title: '', // Generated later via Gemini
    prompt: params.prompt,
    selectedLlms: params.selectedLlms,
    status: 'pending',
    llmResults: params.selectedLlms.map((provider) => ({
      provider,
      model: getDefaultModel(provider),
      status: 'pending',
    })),
    startedAt: new Date().toISOString(),
  };
}

function getDefaultModel(provider: LlmProvider): string {
  switch (provider) {
    case 'google':
      return 'gemini-2.0-flash-exp';
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
  }
}
```

## Verification

```bash
npm run typecheck
```

## Acceptance Criteria

- [ ] Research model defined
- [ ] LlmResult model defined
- [ ] createResearch factory function
- [ ] Exported from models/index.ts
- [ ] `npm run typecheck` passes
