# Task 4-1: Wire LLM Client Adapters

**Tier:** 4 (Depends on 4-0 and infra packages from Tier 1)

---

## Context Snapshot

- Infra packages exist: infra-gemini, infra-claude, infra-gpt (Tier 1)
- Domain ports defined: LlmResearchProvider, LlmSynthesisProvider (Tier 3)
- Need adapters to connect infra packages to domain ports

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create adapter classes that implement domain ports using the infra packages. The adapters handle configuration and map between port interfaces and package interfaces.

---

## Scope

**In scope:**

- Create LLM adapter for each provider
- Create GeminiSynthesisAdapter for synthesis
- Get API keys from user-service via internal API call

**Non-scope:**

- Infra package implementation (done in Tier 1)
- Actual API calls (delegated to infra packages)

---

## Required Approach

### Step 1: Create llm adapters directory

```bash
mkdir -p apps/llm-orchestrator-service/src/infra/llm
```

### Step 2: Create infra/llm/GeminiAdapter.ts

```typescript
import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import { err, type Result } from '@intexuraos/common-core';
import type {
  LlmResearchProvider,
  LlmSynthesisProvider,
  LlmResearchResult,
  LlmError,
} from '../../domain/research/index.js';

export class GeminiAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GeminiClient;

  constructor(apiKey: string) {
    this.client = createGeminiClient({ apiKey });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (result.ok === false) {
      return err({
        code: result.error.code,
        message: result.error.message,
      });
    }

    return result;
  }

  async synthesize(
    originalPrompt: string,
    reports: Array<{ model: string; content: string }>
  ): Promise<Result<string, LlmError>> {
    const result = await this.client.synthesize(originalPrompt, reports);

    if (result.ok === false) {
      return err({
        code: result.error.code,
        message: result.error.message,
      });
    }

    return result;
  }

  async generateTitle(prompt: string): Promise<Result<string, LlmError>> {
    const result = await this.client.generateTitle(prompt);

    if (result.ok === false) {
      return err({
        code: result.error.code,
        message: result.error.message,
      });
    }

    return result;
  }
}
```

### Step 3: Create infra/llm/ClaudeAdapter.ts

```typescript
import { createClaudeClient, type ClaudeClient } from '@intexuraos/infra-claude';
import { err, type Result } from '@intexuraos/common-core';
import type {
  LlmResearchProvider,
  LlmResearchResult,
  LlmError,
} from '../../domain/research/index.js';

export class ClaudeAdapter implements LlmResearchProvider {
  private readonly client: ClaudeClient;

  constructor(apiKey: string) {
    this.client = createClaudeClient({ apiKey });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (result.ok === false) {
      return err({
        code: result.error.code,
        message: result.error.message,
      });
    }

    return result;
  }
}
```

### Step 4: Create infra/llm/GptAdapter.ts

```typescript
import { createGptClient, type GptClient } from '@intexuraos/infra-gpt';
import { err, type Result } from '@intexuraos/common-core';
import type {
  LlmResearchProvider,
  LlmResearchResult,
  LlmError,
} from '../../domain/research/index.js';

export class GptAdapter implements LlmResearchProvider {
  private readonly client: GptClient;

  constructor(apiKey: string) {
    this.client = createGptClient({ apiKey });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (result.ok === false) {
      return err({
        code: result.error.code,
        message: result.error.message,
      });
    }

    return result;
  }
}
```

### Step 5: Create infra/llm/LlmAdapterFactory.ts

```typescript
import type {
  LlmProvider,
  LlmResearchProvider,
  LlmSynthesisProvider,
} from '../../domain/research/index.js';
import { GeminiAdapter } from './GeminiAdapter.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GptAdapter } from './GptAdapter.js';

export interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
}

export function createLlmProviders(
  keys: DecryptedApiKeys
): Record<LlmProvider, LlmResearchProvider> {
  const providers: Partial<Record<LlmProvider, LlmResearchProvider>> = {};

  if (keys.google) {
    providers.google = new GeminiAdapter(keys.google);
  }
  if (keys.anthropic) {
    providers.anthropic = new ClaudeAdapter(keys.anthropic);
  }
  if (keys.openai) {
    providers.openai = new GptAdapter(keys.openai);
  }

  return providers as Record<LlmProvider, LlmResearchProvider>;
}

export function createSynthesizer(googleApiKey: string): LlmSynthesisProvider {
  return new GeminiAdapter(googleApiKey);
}
```

### Step 6: Create infra/llm/index.ts

```typescript
export { GeminiAdapter } from './GeminiAdapter.js';
export { ClaudeAdapter } from './ClaudeAdapter.js';
export { GptAdapter } from './GptAdapter.js';
export {
  createLlmProviders,
  createSynthesizer,
  type DecryptedApiKeys,
} from './LlmAdapterFactory.js';
```

### Step 7: Update infra/index.ts

```typescript
export * from './research/index.js';
export * from './llm/index.js';
```

---

## Step Checklist

- [ ] Create infra/llm directory
- [ ] Implement `GeminiAdapter`
- [ ] Implement `ClaudeAdapter`
- [ ] Implement `GptAdapter`
- [ ] Create `LlmAdapterFactory` with factory functions
- [ ] Create index files
- [ ] Update infra/index.ts
- [ ] Run verification commands

---

## Definition of Done

1. Each adapter implements the appropriate port interface
2. Factory functions create providers from API keys
3. Adapters delegate to infra packages
4. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove infra/llm directory
2. Revert changes to infra/index.ts
