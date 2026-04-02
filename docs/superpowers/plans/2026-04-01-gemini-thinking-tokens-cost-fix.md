# Gemini Thinking Tokens Cost Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Gemini cost calculations to include thinking tokens (`thoughtsTokenCount`) and correct wrong hardcoded pricing in `TOOL_CALLING_PRICING`.

**Architecture:** Gemini 2.5 Flash is a thinking model that returns `thoughtsTokenCount` in `usageMetadata` alongside `candidatesTokenCount`. Our `infra-gemini` reads only `candidatesTokenCount`, undercounting billable output by ~2x. The fix adds `thinkingTokens` as an optional field through the `TokenUsage` → `calculateTextCost` → `normalizeUsage` → `NormalizedUsage` chain, all within `infra-gemini` + `llm-contract`. No downstream app changes needed.

**Tech Stack:** TypeScript, Vitest, `@google/genai` SDK, `@intexuraos/llm-contract`, `@intexuraos/infra-gemini`

---

### Task 1: Add `thinkingTokens` to `llm-contract` types

This task adds the optional `thinkingTokens` field to both `TokenUsage` (raw provider input) and `NormalizedUsage` (normalized output). This is a non-breaking additive change — all existing consumers continue to work unchanged.

**Files:**
- Modify: `packages/llm-contract/src/types.ts:34-53` (TokenUsage)
- Modify: `packages/llm-contract/src/types.ts:61-78` (NormalizedUsage)

- [ ] **Step 1: Write the failing type test**

Create a type-level test that verifies `thinkingTokens` exists on both interfaces.

File: `packages/llm-contract/src/__tests__/thinkingTokens.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { TokenUsage, NormalizedUsage } from '../types.js';

describe('thinkingTokens type support', () => {
  it('TokenUsage accepts thinkingTokens', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      thinkingTokens: 200,
    };
    expect(usage.thinkingTokens).toBe(200);
  });

  it('TokenUsage does not require thinkingTokens', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
    };
    expect(usage.thinkingTokens).toBeUndefined();
  });

  it('NormalizedUsage accepts thinkingTokens', () => {
    const usage: NormalizedUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
      thinkingTokens: 200,
    };
    expect(usage.thinkingTokens).toBe(200);
  });

  it('NormalizedUsage does not require thinkingTokens', () => {
    const usage: NormalizedUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
    };
    expect(usage.thinkingTokens).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/llm-contract/src/__tests__/thinkingTokens.test.ts`

Expected: TypeScript compilation error — `thinkingTokens` does not exist on `TokenUsage` / `NormalizedUsage`.

- [ ] **Step 3: Add `thinkingTokens` to both interfaces**

In `packages/llm-contract/src/types.ts`, add to `TokenUsage` (after the `groundingEnabled` field, before the `providerCost` field):

```ts
  /** Google: tokens used for internal reasoning (Gemini 2.5 thinking models) */
  thinkingTokens?: number;
```

Add to `NormalizedUsage` (after the `groundingEnabled` field):

```ts
  /** Tokens used for internal reasoning (Gemini 2.5 thinking models, billed at output rate) */
  thinkingTokens?: number;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/llm-contract/src/__tests__/thinkingTokens.test.ts`

Expected: All 4 tests PASS.

- [ ] **Step 5: Run full llm-contract tests**

Run: `pnpm vitest run --project llm-contract`

Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-contract/src/types.ts packages/llm-contract/src/__tests__/thinkingTokens.test.ts
git commit -m "feat(llm-contract): add thinkingTokens field to TokenUsage and NormalizedUsage"
```

---

### Task 2: Include thinking tokens in `infra-gemini` cost calculation

This task updates `calculateTextCost` and `normalizeUsage` in the Gemini cost calculator to include thinking tokens at the output rate. The `normalizeUsage` signature gets a new `thinkingTokens` parameter.

**Files:**
- Modify: `packages/infra-gemini/src/costCalculator.ts:8-43`
- Modify: `packages/infra-gemini/src/__tests__/costCalculator.test.ts`

- [ ] **Step 1: Write failing tests for thinking token cost**

Add these tests to `packages/infra-gemini/src/__tests__/costCalculator.test.ts`:

In the `calculateTextCost` describe block, add:

```ts
    it('includes thinking tokens at output rate', () => {
      const usage = { inputTokens: 1000, outputTokens: 500, thinkingTokens: 300 };
      // input: 1000 * 0.1 = 100, output: 500 * 0.4 = 200, thinking: 300 * 0.4 = 120
      // total scaled = 420, / 1_000_000 = 0.00042
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.00042, 6);
    });

    it('treats undefined thinkingTokens as zero', () => {
      const usage = { inputTokens: 1000, outputTokens: 500 };
      expect(calculateTextCost(usage, basePricing)).toBeCloseTo(0.0003, 6);
    });
```

In the `normalizeUsage` describe block, add:

```ts
    it('includes thinkingTokens in cost and exposes on result', () => {
      const result = normalizeUsage(1000, 500, false, basePricing, 300);
      expect(result).toEqual({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: expect.closeTo(0.00042, 6),
        thinkingTokens: 300,
      });
    });

    it('omits thinkingTokens from result when zero', () => {
      const result = normalizeUsage(1000, 500, false, basePricing, 0);
      expect(result.thinkingTokens).toBeUndefined();
      expect(result.costUsd).toBeCloseTo(0.0003, 6);
    });

    it('omits thinkingTokens from result when undefined', () => {
      const result = normalizeUsage(1000, 500, false, basePricing);
      expect(result.thinkingTokens).toBeUndefined();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/infra-gemini/src/__tests__/costCalculator.test.ts`

Expected: New tests FAIL — `normalizeUsage` doesn't accept 5th argument, `calculateTextCost` ignores `thinkingTokens`.

- [ ] **Step 3: Update `calculateTextCost` to include thinking tokens**

In `packages/infra-gemini/src/costCalculator.ts`, update `calculateTextCost`:

```ts
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number {
  const inputPrice = pricing.inputPricePerMillion;
  const outputPrice = pricing.outputPricePerMillion;
  const groundingPrice = pricing.groundingCostPerRequest ?? 0;

  const inputCost = usage.inputTokens * inputPrice;
  const outputCost = usage.outputTokens * outputPrice;
  const thinkingCost = (usage.thinkingTokens ?? 0) * outputPrice;

  // Safe Math: Calculate Grounding Scaled
  const groundingCostScaled = (usage.groundingEnabled === true ? groundingPrice : 0) * 1_000_000;

  const totalScaledCost = inputCost + outputCost + thinkingCost + groundingCostScaled;

  return Math.round(totalScaledCost) / 1_000_000;
}
```

- [ ] **Step 4: Update `normalizeUsage` to accept and expose thinking tokens**

In `packages/infra-gemini/src/costCalculator.ts`, update `normalizeUsage`:

```ts
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  groundingEnabled: boolean,
  pricing: ModelPricing,
  thinkingTokens?: number
): NormalizedUsage {
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    groundingEnabled,
    thinkingTokens,
  };
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateTextCost(usage, pricing),
    ...(groundingEnabled && { groundingEnabled: true }),
    ...(thinkingTokens !== undefined && thinkingTokens > 0 && { thinkingTokens }),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/infra-gemini/src/__tests__/costCalculator.test.ts`

Expected: All tests PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add packages/infra-gemini/src/costCalculator.ts packages/infra-gemini/src/__tests__/costCalculator.test.ts
git commit -m "feat(infra-gemini): include thinking tokens in cost calculation"
```

---

### Task 3: Read `thoughtsTokenCount` from Gemini responses in `client.ts`

This task updates the three call sites in `client.ts` (`research`, `generate`) to read `thoughtsTokenCount` from the Gemini API response and pass it through to `normalizeUsage`.

**Files:**
- Modify: `packages/infra-gemini/src/client.ts:131-133` (research method)
- Modify: `packages/infra-gemini/src/client.ts:170-173` (generate method)
- Modify: `packages/infra-gemini/src/__tests__/client.test.ts`

- [ ] **Step 1: Write failing tests for thinking tokens in research and generate**

Add these tests to `packages/infra-gemini/src/__tests__/client.test.ts`:

In the `research` describe block, add:

```ts
    it('includes thinking tokens in usage when returned by Gemini', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Research content',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 200,
        },
        candidates: [{ groundingMetadata: {} }],
      });

      const pricing = createTestPricing();
      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.research('Tell me about AI');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBe(200);
        // Cost with thinking + grounding:
        // input: 100 * 0.15 / 1M = 0.000015
        // output: 50 * 0.6 / 1M = 0.00003
        // thinking: 200 * 0.6 / 1M = 0.00012
        // grounding: 0.035
        // total: 0.035165
        expect(result.value.usage.costUsd).toBeCloseTo(0.035165, 6);
      }
    });
```

In the `generate` describe block, add:

```ts
    it('includes thinking tokens in usage when returned by Gemini', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 500,
        },
      });

      const pricing = createTestPricing();
      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBe(500);
        // Cost without grounding:
        // input: 50 * 0.15 / 1M = 0.0000075
        // output: 100 * 0.6 / 1M = 0.00006
        // thinking: 500 * 0.6 / 1M = 0.0003
        // total: 0.0003675
        expect(result.value.usage.costUsd).toBeCloseTo(0.0003675, 6);
      }
    });

    it('omits thinkingTokens when Gemini returns zero', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 0,
        },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBeUndefined();
      }
    });

    it('omits thinkingTokens when Gemini does not return thoughtsTokenCount', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Generated text.',
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 100,
        },
      });

      const client = createGeminiClient({
        apiKey: 'test-key',
        model: TEST_MODEL,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      const result = await client.generate('Write something');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage.thinkingTokens).toBeUndefined();
      }
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/infra-gemini/src/__tests__/client.test.ts`

Expected: New tests FAIL — `thinkingTokens` is undefined, cost doesn't include thinking.

- [ ] **Step 3: Update `research` method to read `thoughtsTokenCount`**

In `packages/infra-gemini/src/client.ts`, in the `research` method (around line 131-133), change:

```ts
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const usage = normalizeUsage(inputTokens, outputTokens, groundingEnabled, pricing);
```

To:

```ts
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
        const usage = normalizeUsage(inputTokens, outputTokens, groundingEnabled, pricing, thinkingTokens);
```

- [ ] **Step 4: Update `generate` method to read `thoughtsTokenCount`**

In `packages/infra-gemini/src/client.ts`, in the `generate` method (around line 170-173), change:

```ts
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const usage = normalizeUsage(inputTokens, outputTokens, false, pricing);
```

To:

```ts
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
        const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
        const usage = normalizeUsage(inputTokens, outputTokens, false, pricing, thinkingTokens);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/infra-gemini/src/__tests__/client.test.ts`

Expected: All tests PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add packages/infra-gemini/src/client.ts packages/infra-gemini/src/__tests__/client.test.ts
git commit -m "feat(infra-gemini): read thoughtsTokenCount from Gemini response in client"
```

---

### Task 4: Read `thoughtsTokenCount` in `toolCallingClient.ts` and fix `TOOL_CALLING_PRICING`

This task updates the tool calling client to include thinking tokens and fixes the wrong hardcoded pricing values.

**Files:**
- Modify: `packages/infra-gemini/src/toolCallingClient.ts:39-45` (pricing fix)
- Modify: `packages/infra-gemini/src/toolCallingClient.ts:169-171` (thinking tokens)
- Modify: `packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`

- [ ] **Step 1: Write failing tests**

Add these tests to `packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`.

Find the test `exports TOOL_CALLING_PRICING with gemini-2.5-flash` (line 483) and update the expected values:

```ts
  it('exports TOOL_CALLING_PRICING with gemini-2.5-flash', () => {
    expect(TOOL_CALLING_PRICING[LlmModels.Gemini25Flash]).toEqual({
      inputPricePerMillion: 0.3,
      outputPricePerMillion: 2.5,
      groundingCostPerRequest: 0,
    });
  });
```

Add a new test for thinking tokens in the tool calling loop. Find an appropriate describe block (e.g., the main `createGeminiToolCallingClient` describe) and add:

```ts
    it('includes thinking tokens in aggregated usage', async () => {
      // First call: tool call with thinking tokens
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'London' },
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 50,
        },
      });
      // Second call: final text response with thinking tokens
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [{ text: 'The weather in London is sunny.' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 200,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 80,
        },
      });

      const pricing: ModelPricing = {
        inputPricePerMillion: 0.3,
        outputPricePerMillion: 2.5,
        groundingCostPerRequest: 0,
      };
      const client = createGeminiToolCallingClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'test-user',
        pricing,
        logger: mockLogger,
      });

      const result = await client.run({
        systemPrompt: 'You are a weather assistant.',
        messages: [{ role: 'user', content: 'Weather in London?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
            run: async () => JSON.stringify({ temp: 20, condition: 'sunny' }),
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Aggregated: input 100+200=300, output 20+30=50, thinking 50+80=130
        expect(result.value.usage.inputTokens).toBe(300);
        expect(result.value.usage.outputTokens).toBe(50);
        expect(result.value.usage.thinkingTokens).toBe(130);
        // Cost: (300*0.3 + 50*2.5 + 130*2.5) / 1_000_000 = (90 + 125 + 325) / 1_000_000 = 0.00054
        expect(result.value.usage.costUsd).toBeCloseTo(0.00054, 6);
      }
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`

Expected: Pricing test FAIL (values don't match), thinking tokens test FAIL.

- [ ] **Step 3: Fix `TOOL_CALLING_PRICING` values**

In `packages/infra-gemini/src/toolCallingClient.ts`, change lines 39-45:

```ts
export const TOOL_CALLING_PRICING: Record<ToolCallingModel, ModelPricing> = {
  [LlmModels.Gemini25Flash]: {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
    groundingCostPerRequest: 0,
  },
};
```

- [ ] **Step 4: Read `thoughtsTokenCount` and update usage aggregation**

In `packages/infra-gemini/src/toolCallingClient.ts`, change the usage reading block (around line 169-171):

```ts
            const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
            const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
            const iterationUsage = normalizeUsage(inputTokens, outputTokens, false, pricing);
```

To:

```ts
            const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
            const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
            const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
            const iterationUsage = normalizeUsage(inputTokens, outputTokens, false, pricing, thinkingTokens);
```

Then update the `addUsage` function (around line 361-368) to aggregate `thinkingTokens`:

```ts
function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  const thinkingTokens = (a.thinkingTokens ?? 0) + (b.thinkingTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
    ...(thinkingTokens > 0 && { thinkingTokens }),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/infra-gemini/src/__tests__/toolCallingClient.test.ts`

Expected: All tests PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add packages/infra-gemini/src/toolCallingClient.ts packages/infra-gemini/src/__tests__/toolCallingClient.test.ts
git commit -m "fix(infra-gemini): include thinking tokens in tool calling and fix TOOL_CALLING_PRICING"
```

---

### Task 5: Build packages, run full CI, verify

This task rebuilds the affected packages and runs the full CI suite to confirm nothing is broken.

**Files:**
- No new files

- [ ] **Step 1: Build affected packages**

Run: `pnpm build`

Expected: All packages build successfully. The `llm-contract` type change propagates through `infra-gemini` and all downstream consumers without errors.

- [ ] **Step 2: Run workspace verification for infra-gemini**

Run: `pnpm run verify:workspace:tracked -- infra-gemini`

Expected: All tests pass, 100% coverage, no lint errors.

- [ ] **Step 3: Run full CI**

Run: `pnpm run ci:tracked`

Expected: All tests across all workspaces pass. No type errors anywhere.

- [ ] **Step 4: Commit any CI-driven fixes**

If CI reveals any issues (e.g., a test that asserts exact `outputTokens` values and now gets thinking tokens included), fix them and commit.

- [ ] **Step 5: Verify with a real Gemini API call (manual sanity check)**

Run this curl command and verify `thoughtsTokenCount` is present:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$INTEXURAOS_GEMINI_APP_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents": [{"parts":[{"text":"Say hello"}]}]}' | jq '.usageMetadata'
```

Expected: Response includes `thoughtsTokenCount` field alongside `candidatesTokenCount` and `promptTokenCount`.
