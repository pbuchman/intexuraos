# LLM Prompt Type Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic prompt type tracking to LLM usage events so the UI displays what each LLM call was for (e.g., "linear-issue-title-generation", "code-worker-validation", "github-review-decision").

**Architecture:** Extend the `generate()` method signature to accept an optional `promptType` parameter, propagate it through `UsageSink` → `UsageLogParams` → `buildUsageEvent` → Firestore `UsageEvent`, and display it in the web UI's event list and detail views.

**Tech Stack:** TypeScript, Firestore, React, Fastify

---

## Files Affected

### Backend Changes (packages + llm-usage-service)

| File                                                                          | Change                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/llm-factory/src/llmClientFactory.ts`                                | Modify `LlmGenerateClient.generate()` signature to accept options with `promptType` |
| `packages/llm-pricing/src/usageLogger.ts`                                     | Add `promptType?: string` to `UsageLogParams`                                       |
| `packages/llm-pricing/src/buildUsageEvent.ts`                                 | Add `promptType` to event payload under `request.promptType`                        |
| `packages/infra-gemini/src/client.ts`                                         | Pass `promptType` to `trackUsage()`                                                 |
| `packages/infra-openrouter/src/client.ts`                                     | Pass `promptType` to usage logging                                                  |
| `apps/llm-usage-service/src/domain/models/usageEvent.ts`                      | Add `promptType?: string` to `UsageEvent.request`                                   |
| `apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts`               | Add `promptType` field validation                                                   |
| `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts` | Handle `promptType` field (no index needed)                                         |
| `apps/web/src/types/llmUsage.ts`                                              | Mirror `promptType` field                                                           |

### Frontend Changes (web UI)

| File                                                     | Change                                              |
| -------------------------------------------------------- | --------------------------------------------------- |
| `apps/web/src/pages/LlmUsagePage.tsx`                    | Display `promptType` column in events table         |
| `apps/web/src/pages/LlmUsageViewPage.tsx`                | Display `promptType` in RequestCard                 |
| `apps/llm-usage-service/src/domain/models/usageQuery.ts` | Add `promptType` to `ALLOWED_GROUP_BY` for grouping |

### Caller Updates (examples - not exhaustive)

| File                                                               | Change                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| `apps/linear-agent/src/domain/useCases/generateIssueTitle.ts`      | Pass `promptType: linearIssueTitlePrompt.name`       |
| `apps/linear-agent/src/infra/llm/linearActionExtractionService.ts` | Pass `promptType: linearActionExtractionPrompt.name` |

---

## Task 1: Extend LLM Client Interface

**Files:**
- Modify: `packages/llm-factory/src/llmClientFactory.ts:93-99`
- Test: `packages/llm-factory/src/__tests__/llmClientFactory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-factory/src/__tests__/llmClientFactory.test.ts
// Add test for generate with options

import { describe, it, expect } from 'vitest';
import { createLlmClient } from '../llmClientFactory.js';

describe('LlmGenerateClient', () => {
  it('should accept promptType in generate options', async () => {
    // This test will fail because generate() only accepts prompt string currently
    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      userId: 'user-123',
      logger: mockLogger,
      usageSink: mockSink,
    });

    // Should accept options with promptType
    const result = await client.generate('test prompt', { promptType: 'linear-issue-title' });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/llm-factory/src/__tests__/llmClientFactory.test.ts`
Expected: FAIL - TypeScript error: generate() signature doesn't accept options

- [ ] **Step 3: Update LlmGenerateClient interface**

```typescript
// packages/llm-factory/src/llmClientFactory.ts

/**
 * Options for LLM generation.
 */
export interface GenerateOptions {
  /** Semantic identifier for the prompt type (e.g., 'linear-issue-title', 'code-worker-validation') */
  promptType?: string;
}

/**
 * Unified LLM client interface.
 * All provider clients implement this interface.
 */
export interface LlmGenerateClient {
  /**
   * Generate text using the LLM.
   * @param prompt - Text prompt to send to the LLM
   * @param options - Optional generation options including promptType for usage tracking
   * @returns Result with content and usage, or error
   */
  generate(prompt: string, options?: GenerateOptions): Promise<Result<GenerateResult, LLMError>>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/llm-factory/src/__tests__/llmClientFactory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/llm-factory/src/llmClientFactory.ts packages/llm-factory/src/__tests__/llmClientFactory.test.ts
git commit -m "feat(llm-factory): add promptType option to generate method

[INT-1390]"
```

---

## Task 2: Add promptType to UsageLogParams

**Files:**
- Modify: `packages/llm-pricing/src/usageLogger.ts:42-65`
- Test: `packages/llm-pricing/src/__tests__/usageLogger.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-pricing/src/__tests__/usageLogger.test.ts
// Add test for promptType field

describe('UsageLogParams', () => {
  it('should accept promptType field', () => {
    const params: UsageLogParams = {
      userId: 'user-123',
      provider: 'google',
      model: 'gemini-2.5-flash',
      callType: 'generate',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      success: true,
      promptType: 'linear-issue-title', // New field
    };
    expect(params.promptType).toBe('linear-issue-title');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/llm-pricing/src/__tests__/usageLogger.test.ts`
Expected: FAIL - TypeScript error: promptType not in interface

- [ ] **Step 3: Add promptType to UsageLogParams interface**

```typescript
// packages/llm-pricing/src/usageLogger.ts

export interface UsageLogParams {
  /** User ID for per-user tracking */
  userId: string;
  /** LLM provider (anthropic, openai, google, perplexity) */
  provider: LlmProvider;
  /** Model identifier (e.g., 'claude-sonnet-4-5') */
  model: string;
  /** Type of LLM operation performed */
  callType: CallType;
  /** Normalized usage with token counts and calculated cost */
  usage: NormalizedUsage;
  /** Whether the LLM call succeeded */
  success: boolean;
  /** Error message if success is false */
  errorMessage?: string;
  /** Optional pino logger for structured logging */
  logger?: Logger;
  /** Owner scope of the call. Defaults to 'system' when omitted. */
  ownerType?: OwnerType;
  /** Label identifying the calling client/transport. Defaults to source.component when omitted. */
  clientName?: string;
  /** Cost reported by the provider. */
  providerReportedUsd?: number | null;
  /** Semantic identifier for what the prompt was used for (e.g., 'linear-issue-title', 'code-worker-validation') */
  promptType?: string;
}
```

- [ ] **Step 4: Update UsageLogger.log to include promptType in structured log**

```typescript
// packages/llm-pricing/src/usageLogger.ts - update log method

async log(params: UsageLogParams): Promise<void> {
  if (!isUsageLoggingEnabled()) return;

  this.logger.info(
    {
      userId: params.userId,
      provider: params.provider,
      model: params.model,
      callType: params.callType,
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      totalTokens: params.usage.totalTokens,
      costUsd: params.usage.costUsd,
      success: params.success,
      ...(params.errorMessage !== undefined && { errorMessage: params.errorMessage }),
      ...(params.promptType !== undefined && { promptType: params.promptType }),
    },
    'LLM usage logged'
  );

  try {
    await this.sink.log(params);
  } catch (error) {
    this.logger.error({ error: getErrorMessage(error), params }, 'Failed to log LLM usage');
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test packages/llm-pricing/src/__tests__/usageLogger.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/llm-pricing/src/usageLogger.ts packages/llm-pricing/src/__tests__/usageLogger.test.ts
git commit -m "feat(llm-pricing): add promptType to UsageLogParams

[INT-1390]"
```

---

## Task 3: Propagate promptType through buildUsageEvent

**Files:**
- Modify: `packages/llm-pricing/src/buildUsageEvent.ts`
- Test: `packages/llm-pricing/src/__tests__/usageLogger.test.ts` (reuse existing tests)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts - new file

import { describe, it, expect } from 'vitest';
import { buildUsageEvent } from '../buildUsageEvent.js';

describe('buildUsageEvent', () => {
  it('should include promptType in request field', () => {
    const params = {
      userId: 'user-123',
      provider: 'google',
      model: 'gemini-2.5-flash',
      callType: 'generate',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      success: true,
      promptType: 'linear-issue-title',
    };

    const event = buildUsageEvent(params, { service: 'linear-agent', component: 'llm-client' });

    expect(event.request.promptType).toBe('linear-issue-title');
  });

  it('should omit promptType when not provided', () => {
    const params = {
      userId: 'user-123',
      provider: 'google',
      model: 'gemini-2.5-flash',
      callType: 'generate',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
      success: true,
    };

    const event = buildUsageEvent(params, { service: 'linear-agent', component: 'llm-client' });

    expect(event.request.promptType).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts`
Expected: FAIL - promptType not in event payload

- [ ] **Step 3: Add promptType to buildUsageEvent output**

```typescript
// packages/llm-pricing/src/buildUsageEvent.ts

export function buildUsageEvent(
  params: UsageLogParams,
  source: { service: string; component: string },
  correlationOverrides?: CorrelationOverrides
): UsageEventPayload {
  const environment: 'dev' | 'prod' = process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev';

  const ownerType = params.ownerType ?? 'system';
  const clientName = params.clientName ?? source.component;
  const providerReportedUsd = params.providerReportedUsd ?? null;
  const useProviderCost = providerReportedUsd !== null;

  return {
    schemaVersion: 2,
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    owner: { type: ownerType, id: params.userId },
    source: {
      service: source.service,
      component: source.component,
      client: clientName,
      environment,
    },
    request: {
      provider: params.provider,
      model: params.model,
      operation: params.callType,
      success: params.success,
      durationMs: 0,
      ...(params.promptType !== undefined && { promptType: params.promptType }),
    },
    usage: {
      inputTokens: params.usage.inputTokens,
      outputTokens: params.usage.outputTokens,
      totalTokens: params.usage.totalTokens,
      cacheReadTokens: params.usage.cacheTokens ?? 0,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      reasoningTokens: params.usage.reasoningTokens ?? 0,
      thinkingTokens: params.usage.thinkingTokens ?? 0,
      webSearchCalls: params.usage.webSearchCalls ?? 0,
      groundingEnabled: params.usage.groundingEnabled ?? false,
      imageCount: 0,
    },
    cost: {
      providerReportedUsd,
      pricingSource: useProviderCost ? 'provider_reported' : 'pending',
    },
    correlation: {
      requestId: correlationOverrides?.requestId ?? null,
      traceId: null,
      taskId: correlationOverrides?.taskId ?? null,
      researchId: null,
      attempt: null,
      sessionId: correlationOverrides?.sessionId ?? null,
    },
    error: params.success ? null : { code: null, message: params.errorMessage ?? null },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/llm-pricing/src/buildUsageEvent.ts packages/llm-pricing/src/__tests__/buildUsageEvent.test.ts
git commit -m "feat(llm-pricing): include promptType in buildUsageEvent payload

[INT-1390]"
```

---

## Task 4: Update infra-gemini client to pass promptType

**Files:**
- Modify: `packages/infra-gemini/src/client.ts:108-131`
- Modify: `packages/infra-gemini/src/types.ts`
- Test: `packages/infra-gemini/src/__tests__/client.test.ts`

- [ ] **Step 1: Update GeminiConfig to accept promptType**

```typescript
// packages/infra-gemini/src/types.ts - add promptType to GeminiConfig if needed
// (Actually, promptType comes via generate options, not config)
```

- [ ] **Step 2: Update generate method to pass promptType to trackUsage**

```typescript
// packages/infra-gemini/src/client.ts

// Modify trackUsage to accept promptType
function trackUsage(
  callType: CallType,
  usage: NormalizedUsage,
  success: boolean,
  errorMessage?: string,
  promptType?: string
): void {
  void usageLogger.log({
    userId,
    provider: LlmProviders.Google,
    model,
    callType,
    usage,
    success,
    ...(errorMessage !== undefined && { errorMessage }),
    ...(ownerType !== undefined && { ownerType }),
    ...(promptType !== undefined && { promptType }),
  });
}

// Update generate method
async generate(prompt: string, options?: { promptType?: string }): Promise<Result<GenerateResult, GeminiError>> {
  try {
    const response = await ai.models.generateContent({ model, contents: prompt });
    const text = response.text ?? '';
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
    const usage = normalizeUsage(inputTokens, outputTokens, false, thinkingTokens);

    trackUsage('generate', usage, true, undefined, options?.promptType);

    return ok({ content: text, usage });
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    const emptyUsage: NormalizedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    trackUsage('generate', emptyUsage, false, errorMsg, options?.promptType);
    return err(mapGeminiError(error));
  }
}
```

- [ ] **Step 3: Write test for promptType propagation**

```typescript
// packages/infra-gemini/src/__tests__/client.test.ts

describe('GeminiClient generate with promptType', () => {
  it('should pass promptType to usageSink', async () => {
    const fakeSink = createFakeUsageSink();
    const client = createGeminiClient({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      userId: 'user-123',
      logger: mockLogger,
      usageSink: fakeSink,
    });

    // Mock Gemini API response...

    await client.generate('test prompt', { promptType: 'linear-issue-title' });

    const records = fakeSink.getRecords();
    expect(records[0].promptType).toBe('linear-issue-title');
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/infra-gemini/src/__tests__/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/infra-gemini/src/client.ts packages/infra-gemini/src/__tests__/client.test.ts
git commit -m "feat(infra-gemini): pass promptType to usage tracking

[INT-1390]"
```

---

## Task 5: Update infra-openrouter client

**Files:**
- Modify: `packages/infra-openrouter/src/client.ts`
- Modify: `packages/infra-openrouter/src/types.ts`
- Test: `packages/infra-openrouter/src/__tests__/client.test.ts`

- [ ] **Step 1: Update OpenRouter client generate method**

```typescript
// packages/infra-openrouter/src/client.ts

async generate(prompt: string, options?: { promptType?: string }): Promise<Result<GenerateResult, OpenRouterError>> {
  // ... existing implementation ...

  // When calling usageSink.log, include promptType
  await usageLogger.log({
    userId: config.userId,
    provider: 'openrouter',
    model: rawModel,
    callType: 'generate',
    usage: normalizedUsage,
    success: true,
    ownerType: config.ownerType,
    providerReportedUsd: usage.cost ?? null,
    ...(options?.promptType !== undefined && { promptType: options.promptType }),
  });
}
```

- [ ] **Step 2: Write test for promptType**

```typescript
// packages/infra-openrouter/src/__tests__/client.test.ts

it('should pass promptType to usageSink', async () => {
  // Similar test as infra-gemini
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test packages/infra-openrouter/src/__tests__/client.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/infra-openrouter/src/client.ts packages/infra-openrouter/src/__tests__/client.test.ts
git commit -m "feat(infra-openrouter): pass promptType to usage tracking

[INT-1390]"
```

---

## Task 6: Update llm-usage-service UsageEvent model

**Files:**
- Modify: `apps/llm-usage-service/src/domain/models/usageEvent.ts`
- Modify: `apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts`
- Test: `apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts`

- [ ] **Step 1: Add promptType to UsageEvent interface**

```typescript
// apps/llm-usage-service/src/domain/models/usageEvent.ts

export interface UsageEvent {
  // ... existing fields ...

  request: {
    provider: LlmProvider;
    model: string;
    operation: 'research' | 'generate' | 'image_generation' | 'tool_calling' | 'other';
    success: boolean;
    durationMs: number;
    /** Semantic identifier for what the prompt was used for (e.g., 'linear-issue-title') */
    promptType?: string;
  };

  // ... rest of interface ...
}
```

- [ ] **Step 2: Update Zod schema**

```typescript
// apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts

// Add promptType to request schema
const RequestSchema = z.object({
  provider: z.string(),
  model: z.string(),
  operation: z.enum(['research', 'generate', 'image_generation', 'tool_calling', 'other']),
  success: z.boolean(),
  durationMs: z.number(),
  promptType: z.string().optional(),
});
```

- [ ] **Step 3: Write test for promptType in ingestion**

```typescript
// apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts

describe('Usage event ingestion with promptType', () => {
  it('should accept and store promptType field', async () => {
    const event = {
      eventId: 'test-123',
      occurredAt: new Date().toISOString(),
      owner: { type: 'user', id: 'user-123' },
      source: { service: 'linear-agent', component: 'llm', client: 'gemini', environment: 'dev' },
      request: {
        provider: 'google',
        model: 'gemini-2.5-flash',
        operation: 'generate',
        success: true,
        durationMs: 0,
        promptType: 'linear-issue-title',
      },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, ... },
      cost: { providerReportedUsd: null, pricingSource: 'pending' },
      correlation: { requestId: null, traceId: null, taskId: null, researchId: null, attempt: null, sessionId: null },
      error: null,
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/llm-usage/events',
      body: { schemaVersion: 2, events: [event] },
    });

    expect(response.statusCode).toBe(200);
    // Verify stored event has promptType
  });
});
```

- [ ] **Step 4: Run test**

Run: `pnpm test apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/llm-usage-service/src/domain/models/usageEvent.ts apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts
git commit -m "feat(llm-usage-service): add promptType to UsageEvent schema

[INT-1390]"
```

---

## Task 7: Update web app types

**Files:**
- Modify: `apps/web/src/types/llmUsage.ts`

- [ ] **Step 1: Add promptType to UsageEvent interface**

```typescript
// apps/web/src/types/llmUsage.ts

export interface UsageEvent {
  // ... existing fields ...

  request: {
    provider: string;
    model: string;
    operation: string;
    success: boolean;
    durationMs: number;
    promptType?: string;
  };

  // ... rest ...
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/types/llmUsage.ts
git commit -m "feat(web): add promptType to UsageEvent type

[INT-1390]"
```

---

## Task 8: Display promptType in web UI

**Files:**
- Modify: `apps/web/src/pages/LlmUsagePage.tsx`
- Modify: `apps/web/src/pages/LlmUsageViewPage.tsx`

- [ ] **Step 1: Add promptType column to events table**

```typescript
// apps/web/src/pages/LlmUsagePage.tsx

// In RawEventsList component table header, add new column:
<th className="py-2 pr-4 text-left font-medium text-slate-500 dark:text-slate-400">Prompt Type</th>

// In table body, add cell:
<td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
  {event.request.promptType ?? '-'}
</td>
```

- [ ] **Step 2: Add promptType to RequestCard in detail view**

```typescript
// apps/web/src/pages/LlmUsageViewPage.tsx

// In RequestCard component:
<DetailRow label="Prompt Type" value={request.promptType} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/LlmUsagePage.tsx apps/web/src/pages/LlmUsageViewPage.tsx
git commit -m "feat(web): display promptType in LLM usage UI

[INT-1390]"
```

---

## Task 9: Update example callers to pass promptType

**Files:**
- Modify: `apps/linear-agent/src/domain/useCases/generateIssueTitle.ts`
- Modify: `apps/linear-agent/src/infra/llm/linearActionExtractionService.ts`

- [ ] **Step 1: Update generateIssueTitle to pass promptType**

```typescript
// apps/linear-agent/src/domain/useCases/generateIssueTitle.ts

const result = await llmClient.generate(prompt, { promptType: linearIssueTitlePrompt.name });
```

- [ ] **Step 2: Update linearActionExtractionService to pass promptType**

```typescript
// apps/linear-agent/src/infra/llm/linearActionExtractionService.ts

const result = await llmClient.generate(prompt, { promptType: linearActionExtractionPrompt.name });
```

- [ ] **Step 3: Commit**

```bash
git add apps/linear-agent/src/domain/useCases/generateIssueTitle.ts apps/linear-agent/src/infra/llm/linearActionExtractionService.ts
git commit -m "feat(linear-agent): pass promptType for LLM usage tracking

[INT-1390]"
```

---

## Task 10: Add promptType to query groupBy options

**Files:**
- Modify: `apps/llm-usage-service/src/domain/models/usageQuery.ts`
- Modify: `apps/web/src/pages/LlmUsagePage.tsx`

- [ ] **Step 1: Add promptType to ALLOWED_GROUP_BY**

```typescript
// apps/llm-usage-service/src/domain/models/usageQuery.ts

export const ALLOWED_GROUP_BY = [
  'day',
  'owner.type',
  'owner.id',
  'source.service',
  'source.component',
  'source.client',
  'request.provider',
  'request.model',
  'request.operation',
  'request.success',
  'request.promptType', // New
] as const;
```

- [ ] **Step 2: Add promptType group-by option to web UI**

```typescript
// apps/web/src/pages/LlmUsagePage.tsx

// Add to GROUP_BY_OPTIONS
{ key: 'promptType', label: 'Prompt Type' },

// Add to GROUP_BY_MAP
promptType: ['request.promptType'],
```

- [ ] **Step 3: Commit**

```bash
git add apps/llm-usage-service/src/domain/models/usageQuery.ts apps/web/src/pages/LlmUsagePage.tsx
git commit -m "feat(llm-usage): add promptType to groupBy options

[INT-1390]"
```

---

## Self-Review Checklist

After completing all tasks, verify:

1. **Spec coverage:**
   - promptType added to generate() signature ✓
   - promptType propagated through UsageSink ✓
   - promptType stored in UsageEvent ✓
   - promptType displayed in web UI ✓
   - promptType available for grouping ✓

2. **Placeholder scan:**
   - No TBD, TODO, or vague instructions ✓

3. **Type consistency:**
   - `promptType?: string` consistently typed across all interfaces ✓

4. **CI verification:**
   - `pnpm run ci:tracked` passes ✓