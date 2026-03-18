# Research Pipeline Quality Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 quality gaps identified in research 23f84d5f that cause language cascade failures, missing quality gates, safety override of user instructions, unusable Gemini citations, and imprecise domain classification.

**Architecture:** Changes span two packages (`llm-prompts`, `infra-gemini`) and one app (`research-agent`). Each task modifies prompt builders, schemas, or adapters. All changes are backwards-compatible — no HTTP endpoint changes, no migration needed, no Firestore schema changes.

**Tech Stack:** TypeScript, Zod schemas, Vitest, Fastify (research-agent)

**Debug report:** https://intexuraos.cloud/share/claude/research-debug-23f84d5f.html

**Endpoint Changes:** None — all changes are internal prompt/schema/adapter modifications.

---

## File Structure

### Modified Files (by task)

| #   | File                                                               | Responsibility                                       | Tasks      |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------- | ---------- |
| 1   | `packages/llm-prompts/src/shared/contextSchemas.ts`                | Domain enum, SafetyInfo schema                       | T1, T3, T5 |
| 2   | `packages/llm-prompts/src/research/contextInference.ts`            | Research context inference prompt                    | T3, T5     |
| 3   | `packages/llm-prompts/src/research/researchPrompt.ts`              | Research prompt builder                              | T1, T5     |
| 4   | `packages/llm-prompts/src/synthesis/contextInference.ts`           | Synthesis context inference prompt                   | T1         |
| 5   | `packages/llm-prompts/src/synthesis/contextSchemas.ts`             | SynthesisContext schema, InferSynthesisContextParams | T1         |
| 6   | `packages/llm-prompts/src/research/synthesisPrompt.ts`             | Synthesis prompt builder                             | T3         |
| 7   | `packages/infra-gemini/src/client.ts`                              | Gemini API client, source extraction                 | T4         |
| 8   | `apps/research-agent/src/domain/research/usecases/runSynthesis.ts` | Synthesis orchestration                              | T1         |
| 9   | `apps/research-agent/src/routes/internalRoutes.ts`                 | LLM call handler                                     | T2         |

### Test Files (modified or created)

| File                                                                              | Tests For   |
| --------------------------------------------------------------------------------- | ----------- |
| `packages/llm-prompts/src/research/__tests__/researchPrompt.test.ts`              | T1, T5      |
| `packages/llm-prompts/src/research/__tests__/contextInference.test.ts`            | T3, T5      |
| `packages/llm-prompts/src/synthesis/__tests__/contextInference.test.ts`           | T1          |
| `packages/llm-prompts/src/shared/__tests__/contextSchemas.test.ts`                | T3, T5      |
| `packages/infra-gemini/src/__tests__/client.test.ts`                              | T4          |
| `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts` | T1          |
| `apps/research-agent/src/__tests__/routes.test.ts`                                | T2          |
| `packages/llm-prompts/src/research/__tests__/synthesisPrompt.test.ts`             | T3          |

---

## Chunk 1: Language Enforcement Cascade (Task 1)

### Task 1: Fix language enforcement cascade in research pipeline

**Problem:** Language instruction appears only at the END of the research prompt. 2/3 LLMs ignored it. Synthesis context re-detects language from reports instead of inheriting from ResearchContext. Result: English-speaking user gets Spanish output.

**Fix strategy (3 parts):**
1. Add language instruction at TOP of research prompt (not just end)
2. Add `languageOverride` to `InferSynthesisContextParams` so synthesis inherits ResearchContext.language
3. Pass `researchContext.language` from `runSynthesis.ts` into synthesis context inference

---

#### Task 1.1: Add language instruction to TOP of research prompt

**Files:**
- Modify: `packages/llm-prompts/src/research/researchPrompt.ts:93-108`
- Test: `packages/llm-prompts/src/research/__tests__/researchPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/llm-prompts/src/research/__tests__/researchPrompt.test.ts`, add:

```typescript
it('should include language instruction before the Research Request section', () => {
  const result = buildResearchPrompt('test query', mockContext);
  const languagePos = result.indexOf('**LANGUAGE: Write your ENTIRE response in EN');
  const requestPos = result.indexOf('## Research Request');
  expect(languagePos).toBeGreaterThan(-1);
  expect(requestPos).toBeGreaterThan(-1);
  expect(languagePos).toBeLessThan(requestPos);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/researchPrompt.test.ts -t "language instruction before"`
Expected: FAIL — the current prompt has language instruction only at the end.

- [ ] **Step 3: Implement — add language instruction at the top of the contextual prompt**

In `packages/llm-prompts/src/research/researchPrompt.ts`, modify `buildContextualResearchPrompt` (line 93). Insert a language preamble after "Conduct comprehensive research" and before "## Pipeline Context":

```typescript
  return `Conduct comprehensive research on the following topic.

**LANGUAGE: Write your ENTIRE response in ${ctx.language.toUpperCase()}. This is non-negotiable.**

## Pipeline Context
```

Keep the existing language instruction at the end (line 155) as reinforcement.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/researchPrompt.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
feat(llm-prompts): add language instruction at top of research prompt

Language instruction was only at the end of the prompt (line 155).
LLMs deprioritized it — 2/3 models ignored it in research 23f84d5f.
Now placed at top AND bottom for reinforcement.

Bump researchPrompt version: 1.1.0 → 2.0.0 (major: behavior change per CLAUDE.md)
```

---

#### Task 1.2: Add languageOverride to InferSynthesisContextParams

**Files:**
- Modify: `packages/llm-prompts/src/synthesis/contextSchemas.ts:102-109`
- Modify: `packages/llm-prompts/src/synthesis/contextInference.ts:11-113`
- Test: `packages/llm-prompts/src/synthesis/__tests__/contextInference.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/llm-prompts/src/synthesis/__tests__/contextInference.test.ts`, add:

```typescript
it('should instruct to use languageOverride when provided', () => {
  const result = buildInferSynthesisContextPrompt({
    originalPrompt: 'test query',
    reports: [{ model: 'test-model', content: 'test content' }],
    languageOverride: 'en',
  });
  expect(result).toContain('LANGUAGE OVERRIDE');
  expect(result).toContain('"en"');
});

it('should not include language override section when not provided', () => {
  const result = buildInferSynthesisContextPrompt({
    originalPrompt: 'test query',
    reports: [{ model: 'test-model', content: 'test content' }],
  });
  expect(result).not.toContain('LANGUAGE OVERRIDE');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-prompts && pnpm vitest run src/synthesis/__tests__/contextInference.test.ts -t "languageOverride"`
Expected: FAIL — `languageOverride` doesn't exist on the interface yet.

- [ ] **Step 3: Implement — add languageOverride to params and prompt**

In `packages/llm-prompts/src/synthesis/contextSchemas.ts`, add to `InferSynthesisContextParams` (line 108):

```typescript
export interface InferSynthesisContextParams {
  originalPrompt: string;
  reports?: LlmReport[];
  additionalSources?: AdditionalSource[];
  asOfDate?: string;
  defaultJurisdiction?: string;
  defaultCurrency?: string;
  languageOverride?: string;
}
```

In `packages/llm-prompts/src/synthesis/contextInference.ts`, modify `buildInferSynthesisContextPrompt` (after line 14):

```typescript
  const languageOverrideSection =
    params.languageOverride !== undefined
      ? `\nLANGUAGE OVERRIDE: The user's original query was in "${params.languageOverride}". Use "${params.languageOverride}" as the language value in your output, regardless of what language the reports are written in.\n`
      : '';
```

Insert `${languageOverrideSection}` before the `ANALYSIS INSTRUCTIONS:` section (line 47). Also update step 1 to clarify:

```
1. Detect the primary language used across reports (BUT if a LANGUAGE OVERRIDE is provided above, use that instead)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-prompts && pnpm vitest run src/synthesis/__tests__/contextInference.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Bump prompt version**

Update line 114 in `contextInference.ts`:
```typescript
// Prompt version: 1.1.0 → 2.0.0
```

- [ ] **Step 6: Commit**

```
feat(llm-prompts): add languageOverride to synthesis context inference

Synthesis context was re-detecting language from LLM reports, causing
cascade failures when reports were in wrong language. Now accepts an
explicit override from ResearchContext.language.

Bump synthesis contextInference version: 1.1.0 → 2.0.0 (major: behavior change per CLAUDE.md)
```

---

#### Task 1.3: Pass researchContext.language into synthesis context inference

**Files:**
- Modify: `apps/research-agent/src/domain/research/usecases/runSynthesis.ts:153-157`
- Test: `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts`, add to the synthesis context inference section. Follow the existing test pattern (`vi.fn().mockResolvedValue(ok(...))` with `deps.mockRepo.findById`):

```typescript
it('should pass researchContext.language as languageOverride to synthesis context inferrer', async () => {
  const research = createTestResearch({
    researchContext: { language: 'en', /* ...spread other required fields */ },
    llmResults: [completedResult('gemini-2.5-pro', 'Spanish content here')],
  });
  deps.mockRepo.findById.mockResolvedValue(ok(research));

  await runSynthesis(deps);

  expect(deps.mockContextInferrer.inferSynthesisContext).toHaveBeenCalledWith(
    expect.objectContaining({ languageOverride: 'en' })
  );
});
```

**IMPORTANT:** Also update any existing test assertion (around line 607) that checks the exact `inferSynthesisContext` call args. Change it to use `expect.objectContaining()` so it tolerates the new `languageOverride` field without breaking.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/research-agent && pnpm vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts -t "languageOverride"`
Expected: FAIL — languageOverride not passed yet.

- [ ] **Step 3: Implement — pass language override in runSynthesis.ts**

In `apps/research-agent/src/domain/research/usecases/runSynthesis.ts`, modify lines 153-157:

```typescript
    const contextResult = await contextInferrer.inferSynthesisContext({
      originalPrompt: research.prompt,
      reports: reports.map((r) => ({ model: r.model, content: r.content })),
      ...(additionalSources !== undefined && { additionalSources }),
      ...(research.researchContext?.language !== undefined && {
        languageOverride: research.researchContext.language,
      }),
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/research-agent && pnpm vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Build and verify**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(research-agent): pass researchContext.language to synthesis inference

Closes the language cascade gap: ResearchContext.language is now forwarded
as languageOverride to synthesis context inference, preventing re-detection
from potentially wrong-language LLM reports.
```

---

## Chunk 2: LLM Result Quality Gate (Task 2)

### Task 2: Add quality gate on LLM results before synthesis

**Problem:** Any "completed" LLM result passes to synthesis regardless of quality. sonar-pro returned 745 tokens of wrong advice (bluefin tuna from shore) with equal standing as gpt-5.2's 3,761 verified tokens.

**Fix strategy:** Add a `qualityFlag` field to LLM results. After LLM call succeeds, check minimum output length. Flag results below threshold as `low_quality`. Pass quality flags to synthesis context so synthesizer knows to deprioritize them.

---

#### Task 2.1: Add qualityFlag field to LLM result model

**Files:**
- Modify: `apps/research-agent/src/domain/research/models/Research.ts`
- Test: Covered by Task 2.2 tests

- [ ] **Step 1: Read the Research model to find LlmResult type**

Read `apps/research-agent/src/domain/research/models/Research.ts` and find the `LlmResult` interface.

- [ ] **Step 2: Add qualityFlag to LlmResult**

Add to the LlmResult interface:

```typescript
qualityFlag?: 'normal' | 'low_quality';
```

This is an optional field — backwards-compatible with existing Firestore documents.

- [ ] **Step 3: Commit**

```
feat(research-agent): add qualityFlag to LlmResult model

Optional field that downstream quality checks can set to 'low_quality'
to signal the synthesis should deprioritize this result.
```

---

#### Task 2.2: Implement minimum length quality check after LLM call

**Files:**
- Modify: `apps/research-agent/src/routes/internalRoutes.ts:904-939`
- Test: `apps/research-agent/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('should flag LLM result as low_quality when output is below minimum length threshold', async () => {
  // Mock LLM returning very short content (under 200 tokens ~ 800 chars)
  fakeLlmProvider.setResponse({ content: 'Short answer.', inputTokens: 500, outputTokens: 20 });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/llm/pubsub/process-llm-call',
    payload: createPubSubPayload({ researchId, model: 'sonar-pro', prompt: 'detailed query' }),
    headers: { 'x-internal-auth': validToken },
  });

  expect(response.statusCode).toBe(200);
  const savedResult = fakeResearchRepo.getLastUpdatedLlmResult();
  expect(savedResult.qualityFlag).toBe('low_quality');
});

it('should not flag LLM result when output length is sufficient', async () => {
  fakeLlmProvider.setResponse({ content: 'A'.repeat(1000), inputTokens: 500, outputTokens: 300 });

  await app.inject({
    method: 'POST',
    url: '/internal/llm/pubsub/process-llm-call',
    payload: createPubSubPayload({ researchId, model: 'gemini-2.5-pro', prompt: 'detailed query' }),
    headers: { 'x-internal-auth': validToken },
  });

  const savedResult = fakeResearchRepo.getLastUpdatedLlmResult();
  expect(savedResult.qualityFlag).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/research-agent && pnpm vitest run src/__tests__/routes.test.ts -t "low_quality"`
Expected: FAIL

- [ ] **Step 3: Implement quality check**

In `apps/research-agent/src/routes/internalRoutes.ts`, after the LLM call succeeds (around line 904), before saving the result:

```typescript
const MIN_QUALITY_CHARS = 800; // ~200 tokens
const qualityFlag =
  llmResult.value.content.length < MIN_QUALITY_CHARS ? 'low_quality' as const : undefined;

const updateData: Parameters<typeof researchRepo.updateLlmResult>[2] = {
  status: 'completed',
  result: llmResult.value.content,
  completedAt: new Date().toISOString(),
  durationMs,
  ...(qualityFlag !== undefined && { qualityFlag }),
};
```

Add a log line:

```typescript
if (qualityFlag === 'low_quality') {
  logger.warn(
    { model: event.model, contentLength: llmResult.value.content.length },
    '[3.3.1] LLM result flagged as low_quality (below minimum length threshold)'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/research-agent && pnpm vitest run src/__tests__/routes.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
feat(research-agent): add minimum length quality gate on LLM results

Results below 800 chars (~200 tokens) are flagged as low_quality.
This prevents thin/empty responses from entering synthesis with equal
weight as detailed, verified responses.
```

---

#### Task 2.3: Pass quality flags to synthesis for deprioritization

**Files:**
- Modify: `apps/research-agent/src/domain/research/usecases/runSynthesis.ts`
- Test: `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('should include quality flags in reports passed to synthesis prompt', async () => {
  const research = createTestResearch({
    llmResults: [
      completedResult('gemini-2.5-pro', 'Good content', { qualityFlag: undefined }),
      completedResult('sonar-pro', 'Short.', { qualityFlag: 'low_quality' }),
    ],
  });
  deps.mockRepo.findById.mockResolvedValue(ok(research));

  await runSynthesis(deps);

  // Verify the synthesis prompt includes a quality warning for the low-quality report
  const synthesizeCall = deps.mockSynthesizer.synthesize.mock.calls[0];
  expect(synthesizeCall).toBeDefined();
  // The prompt should mention low_quality flag so synthesizer knows to deprioritize
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/research-agent && pnpm vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts -t "quality flags"`
Expected: FAIL

- [ ] **Step 3: Implement — annotate low-quality reports before synthesis**

In `apps/research-agent/src/domain/research/usecases/runSynthesis.ts`, when building reports for synthesis (where `successfulResults` is mapped to `{ model, content }`), prepend a quality warning to low-quality reports:

```typescript
const reports = successfulResults.map((r) => ({
  model: r.model,
  content:
    r.qualityFlag === 'low_quality'
      ? `[QUALITY WARNING: This report was flagged as low quality — very short output. Deprioritize this source.]\n\n${r.result ?? ''}`
      : r.result ?? '',
}));
```

This injects a plain-text annotation that the synthesis LLM will read and act on, without changing any interfaces.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/research-agent && pnpm vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
feat(research-agent): annotate low-quality LLM results for synthesis deprioritization

Reports flagged as low_quality get a [QUALITY WARNING] prefix before
being passed to synthesis, so the synthesis LLM knows to deprioritize them.
```

---

## Chunk 3: User Instruction Respect in Safety Disclaimers (Task 3)

### Task 3: Respect user's explicit exclusion instructions in safety disclaimers

**Problem:** User says "don't focus on permits/rules." Context inference generates disclaimers about permits anyway. These get injected into the prompt, overriding the user's explicit instruction.

**Fix strategy:** Add `user_exclusions` field to ResearchContext. Modify context inference prompt to NOT generate disclaimers contradicting user exclusions for non-high-stakes topics. Filter disclaimers in prompt builders.

---

#### Task 3.1: Add user_exclusions to SafetyInfo schema

**Files:**
- Modify: `packages/llm-prompts/src/shared/contextSchemas.ts:62-65`
- Test: `packages/llm-prompts/src/shared/__tests__/contextSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('should accept user_exclusions field in SafetyInfo', () => {
  const result = SafetyInfoSchema.safeParse({
    high_stakes: false,
    required_disclaimers: ['Be safe'],
    user_exclusions: ['permits', 'regulations'],
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.user_exclusions).toEqual(['permits', 'regulations']);
  }
});

it('should default user_exclusions to empty array when not provided', () => {
  const result = SafetyInfoSchema.safeParse({
    high_stakes: false,
    required_disclaimers: [],
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.user_exclusions).toEqual([]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-prompts && pnpm vitest run src/shared/__tests__/contextSchemas.test.ts -t "user_exclusions"`
Expected: FAIL

- [ ] **Step 3: Implement — add user_exclusions to SafetyInfoSchema**

In `packages/llm-prompts/src/shared/contextSchemas.ts` line 62:

```typescript
export const SafetyInfoSchema = z.object({
  high_stakes: z.boolean(),
  required_disclaimers: z.array(z.string()),
  user_exclusions: z.array(z.string()).default([]),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-prompts && pnpm vitest run src/shared/__tests__/contextSchemas.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
feat(llm-prompts): add user_exclusions to SafetyInfo schema

Allows context inference to record topics the user explicitly
excluded (e.g., "do not focus on permits"). Default [].
```

---

#### Task 3.2: Update context inference prompt to respect user exclusions

**Files:**
- Modify: `packages/llm-prompts/src/research/contextInference.ts:21-111`
- Test: `packages/llm-prompts/src/research/__tests__/contextInference.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('should include user_exclusions instruction in the prompt', () => {
  const result = buildInferResearchContextPrompt('test query');
  expect(result).toContain('user_exclusions');
  expect(result).toContain('do not');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/contextInference.test.ts -t "user_exclusions"`
Expected: FAIL

- [ ] **Step 3: Implement — update context inference prompt**

In `packages/llm-prompts/src/research/contextInference.ts`, add to the analysis instructions (after step 13, around line 36):

```
14. Extract user exclusions: If the user explicitly says "do not focus on X", "must not include X", or "X is known/not needed", record X in user_exclusions. When high_stakes is false, do NOT generate required_disclaimers that contradict user_exclusions.
```

Update the JSON output schema (around line 99):

```json
  "safety": {
    "high_stakes": <boolean>,
    "required_disclaimers": ["<disclaimer if needed — OMIT any that contradict user_exclusions when high_stakes is false>"],
    "user_exclusions": ["<topics the user explicitly asked to exclude>"]
  },
```

Bump prompt version: `1.0.0 → 2.0.0` (major: behavior change per CLAUDE.md)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/contextInference.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
feat(llm-prompts): teach context inference to respect user exclusions

When user explicitly says "do not focus on X" and high_stakes=false,
context inference will omit disclaimers about X and record the
exclusion in user_exclusions for downstream filtering.

Bump contextInference version: 1.0.0 → 2.0.0 (major: behavior change)
```

---

#### Task 3.3: Filter disclaimers in research prompt builder

**Files:**
- Modify: `packages/llm-prompts/src/research/researchPrompt.ts:68-74`
- Test: `packages/llm-prompts/src/research/__tests__/researchPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('should exclude disclaimers matching user_exclusions when not high_stakes', () => {
  const ctx = createTestResearchContext({
    safety: {
      high_stakes: false,
      required_disclaimers: [
        'Always verify local fishing regulations.',
        'Wear a life jacket near water.',
      ],
      user_exclusions: ['regulations', 'permits'],
    },
  });
  const result = buildResearchPrompt('test query', ctx);
  expect(result).not.toContain('fishing regulations');
  expect(result).toContain('life jacket');
});

it('should keep all disclaimers when high_stakes even with user_exclusions', () => {
  const ctx = createTestResearchContext({
    safety: {
      high_stakes: true,
      required_disclaimers: ['Always consult a doctor.'],
      user_exclusions: ['doctor'],
    },
  });
  const result = buildResearchPrompt('test query', ctx);
  expect(result).toContain('consult a doctor');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/researchPrompt.test.ts -t "user_exclusions"`
Expected: FAIL

- [ ] **Step 3: Implement — filter disclaimers**

In `packages/llm-prompts/src/research/researchPrompt.ts`, modify the safety section builder (line 68):

```typescript
  const filteredDisclaimers = ctx.safety.high_stakes
    ? ctx.safety.required_disclaimers
    : ctx.safety.required_disclaimers.filter(
        (d) =>
          !ctx.safety.user_exclusions.some((excl) =>
            d.toLowerCase().includes(excl.toLowerCase())
          )
      );

  const safetySection =
    ctx.safety.high_stakes || filteredDisclaimers.length > 0
      ? `
## Safety Considerations

${ctx.safety.high_stakes ? '⚠️ This is a HIGH-STAKES topic. Be extra careful with accuracy.\n' : ''}${filteredDisclaimers.length > 0 ? `Include these disclaimers:\n${filteredDisclaimers.map((d) => `- ${d}`).join('\n')}` : ''}`
      : '';
```

Apply the same filtering logic to `red_flags`:

```typescript
  const filteredRedFlags = ctx.safety.high_stakes
    ? ctx.red_flags
    : ctx.red_flags.filter(
        (f) =>
          !ctx.safety.user_exclusions.some((excl) =>
            f.toLowerCase().includes(excl.toLowerCase())
          )
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/researchPrompt.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Write synthesis prompt filtering test**

In `packages/llm-prompts/src/research/__tests__/synthesisPrompt.test.ts`, add:

```typescript
it('should exclude disclaimers matching user_exclusions in synthesis when not high_stakes', () => {
  const ctx = createTestSynthesisContext({
    safety: {
      high_stakes: false,
      required_disclaimers: ['Verify local regulations.', 'Wear safety gear.'],
      user_exclusions: ['regulations'],
    },
  });
  const result = buildSynthesisPrompt('test', [{ model: 'test', content: 'report' }], ctx);
  expect(result).not.toContain('local regulations');
  expect(result).toContain('safety gear');
});
```

- [ ] **Step 6: Apply same filtering in synthesisPrompt.ts**

In `packages/llm-prompts/src/research/synthesisPrompt.ts`, apply the identical filtering pattern in `buildContextualSynthesisPrompt` (line 176). The synthesis context also has `safety.user_exclusions` from the shared schema.

- [ ] **Step 7: Run synthesis prompt tests**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/synthesisPrompt.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Update synthesis context inference JSON schema for user_exclusions**

In `packages/llm-prompts/src/synthesis/contextInference.ts` lines 107-111, update the safety JSON output to include `user_exclusions`:

```json
  "safety": {
    "high_stakes": <boolean>,
    "required_disclaimers": ["<disclaimer if needed>"],
    "user_exclusions": ["<topics the user explicitly asked to exclude>"]
  },
```

This ensures the synthesis context inferrer produces `user_exclusions` for the synthesis prompt to filter against.

- [ ] **Step 9: Commit**

```
feat(llm-prompts): filter disclaimers against user_exclusions

When high_stakes=false, disclaimers and red_flags matching user's
explicit exclusion topics are filtered out of both research and
synthesis prompts. High-stakes disclaimers always kept.

Bump researchPrompt: 2.0.0 → 3.0.0 (major: behavior change per CLAUDE.md)
```

---

## Chunk 4: Vertex AI URL Resolution (Task 4)

### Task 4: Resolve Vertex AI grounding redirect URLs to actual destinations

**Problem:** `extractSourcesFromResponse` in infra-gemini stores opaque `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs. These are temporary redirects — actual destination URLs are never extracted.

**Fix strategy:** After extracting sources, attempt to resolve each redirect URL by following the Location header. Store resolved URLs. Fail gracefully (keep original if resolution fails).

---

#### Task 4.1: Add URL resolution to extractSourcesFromResponse

**Files:**
- Modify: `packages/infra-gemini/src/client.ts:252-266`
- Test: `packages/infra-gemini/src/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing test**

Use `vi.fn()` to mock global `fetch` (infra-gemini does NOT use `nock` — it uses `vi.mock`/`vi.fn()` pattern):

```typescript
describe('resolveVertexRedirectUrls', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should resolve vertexaisearch redirect URLs to actual destinations', async () => {
    const urls = [
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABCdef123',
      'https://example.com/already-resolved',
    ];
    mockFetch.mockResolvedValueOnce({
      headers: new Headers({ location: 'https://www.pescamediterraneo.com/foro/123' }),
    });

    const resolved = await resolveVertexRedirectUrls(urls);
    expect(resolved).toEqual([
      'https://www.pescamediterraneo.com/foro/123',
      'https://example.com/already-resolved',
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only redirect URL fetched
  });

  it('should keep original URL when redirect resolution fails', async () => {
    const urls = ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/expired'];
    mockFetch.mockResolvedValueOnce({
      headers: new Headers({}), // no location header
    });

    const resolved = await resolveVertexRedirectUrls(urls);
    expect(resolved).toEqual([
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/expired',
    ]);
  });

  it('should skip resolution for non-vertexaisearch URLs', async () => {
    const urls = ['https://example.com/direct-link'];
    const resolved = await resolveVertexRedirectUrls(urls);
    expect(resolved).toEqual(['https://example.com/direct-link']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fall back to original URL when fetch throws', async () => {
    const urls = ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/error'];
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const resolved = await resolveVertexRedirectUrls(urls);
    expect(resolved).toEqual([
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/error',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/infra-gemini && pnpm vitest run src/__tests__/client.test.ts -t "resolveVertexRedirectUrls"`
Expected: FAIL — function doesn't exist yet.

- [ ] **Step 3: Implement resolveVertexRedirectUrls**

In `packages/infra-gemini/src/client.ts`, add after `extractSourcesFromResponse` (line 266):

```typescript
const VERTEX_REDIRECT_PREFIX = 'vertexaisearch.cloud.google.com/grounding-api-redirect/';

interface ResolveOptions {
  timeoutMs?: number;
}

export async function resolveVertexRedirectUrls(
  urls: string[],
  opts?: ResolveOptions
): Promise<string[]> {
  const timeoutMs = opts?.timeoutMs ?? 3000;

  return Promise.all(
    urls.map(async (url) => {
      if (!url.includes(VERTEX_REDIRECT_PREFIX)) return url;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timer);
        const location = response.headers.get('location');
        return location ?? url;
      } catch {
        return url;
      }
    })
  );
}
```

- [ ] **Step 4: Integrate into the Gemini client's research method**

In `packages/infra-gemini/src/client.ts`, find the `research` method where `extractSourcesFromResponse` is called (line 118). The research method is already async. Replace the synchronous source extraction with:

```typescript
// Before (line 118):
const sources = extractSourcesFromResponse(response);

// After:
const rawSources = extractSourcesFromResponse(response);
const sources = await resolveVertexRedirectUrls(rawSources);
```

This resolves redirect URLs before returning them in the result object. The 3-second timeout per URL ensures this doesn't significantly delay research completion.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/infra-gemini && pnpm vitest run src/__tests__/client.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Build and verify**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: PASS (since infra-gemini is a dependency)

- [ ] **Step 7: Commit**

```
feat(infra-gemini): resolve Vertex AI grounding redirect URLs

vertexaisearch.cloud.google.com redirect URLs are now resolved to
their actual destination URLs via HEAD request. Falls back to
original URL on timeout (3s) or failure. Makes Gemini citations
usable for synthesis and end users.
```

---

## Chunk 5: Domain Classification — Add Fishing Domain (Task 5)

### Task 5: Add fishing domain and outdoor_recreation domain

**Problem:** "Fishing in Calafell" classified as "travel." Neither "travel" nor "fitness_sports" fits sport fishing well. Domain guidelines shape the entire research prompt.

**Fix strategy:** Add `outdoor_recreation` and `fishing` domains with specialized guidelines.

---

#### Task 5.1: Add new domains to shared schema

**Files:**
- Modify: `packages/llm-prompts/src/shared/contextSchemas.ts:11-33`
- Test: `packages/llm-prompts/src/shared/__tests__/contextSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('should accept "fishing" as a valid domain', () => {
  const result = DomainSchema.safeParse('fishing');
  expect(result.success).toBe(true);
});

it('should accept "outdoor_recreation" as a valid domain', () => {
  const result = DomainSchema.safeParse('outdoor_recreation');
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-prompts && pnpm vitest run src/shared/__tests__/contextSchemas.test.ts -t "fishing"`
Expected: FAIL

- [ ] **Step 3: Add domains to DOMAINS array**

In `packages/llm-prompts/src/shared/contextSchemas.ts`, add before `'general'` (line 31):

```typescript
  'outdoor_recreation',
  'fishing',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-prompts && pnpm vitest run src/shared/__tests__/contextSchemas.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
feat(llm-prompts): add fishing and outdoor_recreation domains
```

---

#### Task 5.2: Add domain guidelines to research prompt

**Files:**
- Modify: `packages/llm-prompts/src/research/researchPrompt.ts:9-43`
- Test: `packages/llm-prompts/src/research/__tests__/researchPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('should include fishing-specific guidelines for fishing domain', () => {
  const ctx = createTestResearchContext({ domain: 'fishing' });
  const result = buildResearchPrompt('test query', ctx);
  expect(result).toContain('species');
  expect(result).toContain('spinning');
});

it('should include outdoor_recreation guidelines', () => {
  const ctx = createTestResearchContext({ domain: 'outdoor_recreation' });
  const result = buildResearchPrompt('test query', ctx);
  expect(result).toContain('local conditions');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/researchPrompt.test.ts -t "fishing"`
Expected: FAIL — new domains not in domainGuides yet.

- [ ] **Step 3: Add guidelines to domainGuides**

In `packages/llm-prompts/src/research/researchPrompt.ts`, add to `domainGuides` (after `diy_home` entry, line 42):

```typescript
    outdoor_recreation:
      'Include local conditions, seasonal availability, safety precautions, required equipment, and cite community forums and local guides.',
    fishing:
      'Identify target species by season, recommend technique-specific tackle and lures (spinning, surfcasting, fly), cite local fishing communities and forums, include tidal/weather influence, and distinguish between shore and boat fishing.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-prompts && pnpm vitest run src/research/__tests__/researchPrompt.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Update domain options in BOTH context inference prompts**

In `packages/llm-prompts/src/research/contextInference.ts` line 46, add `outdoor_recreation, fishing` to the domain options list.

In `packages/llm-prompts/src/synthesis/contextInference.ts` line 66, add the same.

- [ ] **Step 6: Commit**

```
feat(llm-prompts): add fishing and outdoor_recreation domain guidelines

Fishing domain includes species identification, technique-specific
tackle, community forum citations, and tidal/weather guidance.
Outdoor recreation covers general outdoor activity patterns.

Bump research/contextInference.ts: 2.0.0 → 2.1.0 (minor: new domain options)
Bump synthesis/contextInference.ts: 2.0.0 → 2.1.0 (minor: new domain options)
Bump researchPrompt.ts: 3.0.0 → 3.1.0 (minor: new domain guidelines)
```

---

## Final Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm install && pnpm build`

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 3: Verify no regressions in research-agent**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: PASS

---

## Summary: Implementation Order

| Order   | Task                                   | Chunk   | Packages Modified   |
| ------- | -------------------------------------- | ------- | ------------------- |
| 1       | T1.1 — Language at top of prompt       | 1       | llm-prompts         |
| 2       | T1.2 — languageOverride param          | 1       | llm-prompts         |
| 3       | T1.3 — Pass language to synthesis      | 1       | research-agent      |
| 4       | T2.1 — qualityFlag model field         | 2       | research-agent      |
| 5       | T2.2 — Min length quality check        | 2       | research-agent      |
| 6       | T2.3 — Pass quality flags to synthesis | 2       | research-agent      |
| 7       | T3.1 — user_exclusions schema          | 3       | llm-prompts         |
| 8       | T3.2 — Context inference prompt        | 3       | llm-prompts         |
| 9       | T3.3 — Filter disclaimers              | 3       | llm-prompts         |
| 10      | T4.1 — Resolve redirect URLs           | 4       | infra-gemini        |
| 11      | T5.1 — Add domains to schema           | 5       | llm-prompts         |
| 12      | T5.2 — Add domain guidelines           | 5       | llm-prompts         |
