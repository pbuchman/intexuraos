# Execution Memory Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five issues found in the INT-1267 execution memory audit: evaluation schema validation, DI wiring gap, vector scoring, remediation agent eligibility, and agent memory usage tracking.

**Architecture:** All fixes are in `apps/code-agent` except Task 5 (orchestrator system prompt). Each task is independently testable and deployable. TDD throughout.

**Tech Stack:** TypeScript, Vitest, Zod, `@google-cloud/firestore@7.11.6`, pnpm monorepo

---

### Task 1: Add EVALUATION_SCHEMA_BLOCK and Schema Repair to Evaluation Prompt

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts:423-440`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`

- [ ] **Step 1: Write failing test — evaluation repair retries on invalid JSON**

In `apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`, add a test inside the existing `describe('processExecutionMemoryBacklog')` block:

```typescript
it('retries evaluation when first LLM response fails schema validation', async () => {
  const invalidResponse = '{"perMemory":[]}'; // missing required "summary"
  const validResponse = JSON.stringify({
    summary: 'Memory was applied successfully.',
    perMemory: [
      { memoryId: 'mem-existing', outcome: 'positive', reason: 'Guided the approach.', confidence: 0.9 },
    ],
  });

  evaluatorClient.generate
    .mockResolvedValueOnce(ok({ content: invalidResponse }))
    .mockResolvedValueOnce(ok({ content: validResponse }));

  executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
  executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord({ evaluationSummary: 'Memory was applied successfully.' })));

  executionMemoryRepo.findById.mockResolvedValueOnce(ok(createMemory()));
  executionMemoryRepo.update.mockResolvedValueOnce(ok(undefined));

  const summary = await processExecutionMemoryBacklogTestables.evaluateApplication(
    createTask(),
    [{ text: 'log line' }],
    {
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      evaluatorClient,
      distillerClient,
      embeddingClient,
      limit: 5,
    },
  );

  expect(summary).toBe('Memory was applied successfully.');
  expect(evaluatorClient.generate).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.anything() }),
    'Evaluator response failed Zod parse, retrying with refinement prompt',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts -t "retries evaluation"`
Expected: FAIL — `EvaluationSchema.parse()` throws without retry

- [ ] **Step 3: Add EVALUATION_SCHEMA_BLOCK constant**

In `processExecutionMemoryBacklog.ts`, after the `DISTILLATION_SCHEMA_BLOCK` definition (after line 523), add:

```typescript
const EVALUATION_SCHEMA_BLOCK = [
  'Return JSON only. Use this exact schema:',
  '{',
  '  "summary": "string (non-empty, overall assessment of how matched memories helped this task)",',
  '  "perMemory": [',
  '    {',
  '      "memoryId": "string (exact ID from matched memories above)",',
  '      "outcome": "positive" | "neutral" | "negative" | "unknown",',
  '      "reason": "string (why this outcome)",',
  '      "confidence": 0.0 to 1.0',
  '    }',
  '  ]',
  '}',
  '',
  'Example (memories helped):',
  '{"summary":"The previous verification memory directly helped the fix.","perMemory":[{"memoryId":"mem-existing","outcome":"positive","reason":"The route coverage lesson was applied.","confidence":0.84}]}',
  '',
  'Example (no matched memories to evaluate):',
  '{"summary":"No matched memories were provided for this task.","perMemory":[]}',
].join('\n');
```

- [ ] **Step 4: Update evaluation prompt to include schema block**

Replace the evaluation prompt construction at lines 423-433:

```typescript
  const evaluationPrompt = [
    `Version: ${EVALUATION_VERSION}`,
    `Task summary: ${task.result?.summary ?? ''}`,
    `Terminal status: ${task.status}`,
    `Worker self report used: ${evalCtx.selfReportUsed}`,
    `Worker self report rejected: ${evalCtx.selfReportRejected}`,
    `Worker self report summary: ${evalCtx.selfReportSummary}`,
    `Matched memories: ${JSON.stringify(application.matchedMemories)}`,
    `Recent logs:\n${logs.slice(0, MAX_EVALUATION_LOG_LINES).map((line) => line.text).join('\n')}`,
    EVALUATION_SCHEMA_BLOCK,
  ].join('\n\n');
```

- [ ] **Step 5: Add repair retry to evaluation parse**

Replace the bare `EvaluationSchema.parse()` call at line 440 with try/catch + retry:

```typescript
  let parsed: z.infer<typeof EvaluationSchema>;
  try {
    parsed = EvaluationSchema.parse(parseJsonObject(evaluationResult.value.content));
  } catch (firstError) {
    deps.logger.warn({ err: firstError }, 'Evaluator response failed Zod parse, retrying with refinement prompt');

    const refinementPrompt = [
      evaluationPrompt,
      '',
      'Your previous response was invalid JSON or did not match the required schema.',
      `Error: ${getErrorMessage(firstError, 'Unknown parse error')}`,
      'Fix the JSON schema violation and return valid JSON matching the exact schema above.',
    ].join('\n');

    const retryResult = await deps.evaluatorClient.generate(refinementPrompt);
    if (!retryResult.ok) {
      throw new Error(retryResult.error.message);
    }

    parsed = EvaluationSchema.parse(parseJsonObject(retryResult.value.content));
  }
```

- [ ] **Step 6: Export EVALUATION_SCHEMA_BLOCK via __testables**

Add `EVALUATION_SCHEMA_BLOCK` to the `__testables` export at the bottom of the file (near line 831):

```typescript
export const __testables = {
  evaluateApplication,
  distillTask,
  updateExistingMemory,
  shouldSuppressMemory,
  computeQualityScore,
  parseCsv,
  parseJsonObject,
  normalizeFingerprintText,
  buildFingerprint,
  isInfraOnlyFailure,
  shouldSkipDistillation,
  buildDistillationPrompt,
  EVALUATION_SCHEMA_BLOCK,
};
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts -t "retries evaluation"`
Expected: PASS

- [ ] **Step 8: Write test — evaluation repair fails on both attempts**

```typescript
it('throws when evaluation repair also fails schema validation', async () => {
  const invalidResponse = '{"perMemory":[]}'; // missing "summary" both times

  evaluatorClient.generate
    .mockResolvedValueOnce(ok({ content: invalidResponse }))
    .mockResolvedValueOnce(ok({ content: invalidResponse }));

  executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));

  await expect(
    processExecutionMemoryBacklogTestables.evaluateApplication(
      createTask(),
      [{ text: 'log line' }],
      {
        logger,
        codeTaskRepo: codeTaskRepo as never,
        logLineRepo: logLineRepo as never,
        turnMetricsRepo: turnMetricsRepo as never,
        linearAgentClient: linearAgentClient as never,
        executionMemoryRepo: executionMemoryRepo as never,
        executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
        evaluatorClient,
        distillerClient,
        embeddingClient,
        limit: 5,
      },
    ),
  ).rejects.toThrow();

  expect(evaluatorClient.generate).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts -t "throws when evaluation repair"`
Expected: PASS

- [ ] **Step 10: Write test — EVALUATION_SCHEMA_BLOCK is present in prompt**

```typescript
it('includes EVALUATION_SCHEMA_BLOCK in evaluation prompt', async () => {
  executionMemoryApplicationRepo.findById.mockResolvedValueOnce(ok(createApplicationRecord()));
  evaluatorClient.generate.mockResolvedValueOnce(ok({
    content: JSON.stringify({
      summary: 'Test summary.',
      perMemory: [{ memoryId: 'mem-existing', outcome: 'positive', reason: 'Applied.', confidence: 0.9 }],
    }),
  }));
  executionMemoryApplicationRepo.update.mockResolvedValue(ok(createApplicationRecord()));
  executionMemoryRepo.findById.mockResolvedValueOnce(ok(createMemory()));
  executionMemoryRepo.update.mockResolvedValueOnce(ok(undefined));

  await processExecutionMemoryBacklogTestables.evaluateApplication(
    createTask(),
    [{ text: 'log line' }],
    {
      logger,
      codeTaskRepo: codeTaskRepo as never,
      logLineRepo: logLineRepo as never,
      turnMetricsRepo: turnMetricsRepo as never,
      linearAgentClient: linearAgentClient as never,
      executionMemoryRepo: executionMemoryRepo as never,
      executionMemoryApplicationRepo: executionMemoryApplicationRepo as never,
      evaluatorClient,
      distillerClient,
      embeddingClient,
      limit: 5,
    },
  );

  const prompt = evaluatorClient.generate.mock.calls[0]?.[0] as string;
  expect(prompt).toContain('"summary"');
  expect(prompt).toContain('"perMemory"');
  expect(prompt).toContain('Return JSON only. Use this exact schema:');
});
```

- [ ] **Step 11: Run all processExecutionMemoryBacklog tests**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts`
Expected: ALL PASS

- [ ] **Step 12: Commit**

```bash
git add apps/code-agent/src/domain/usecases/processExecutionMemoryBacklog.ts apps/code-agent/src/__tests__/domain/useCases/processExecutionMemoryBacklog.test.ts
git commit -m "fix(code-agent): add EVALUATION_SCHEMA_BLOCK and repair retry to evaluation prompt

The evaluation prompt was missing a schema definition, causing Zod
validation failures when the LLM omitted the required 'summary' field.
Adds an explicit schema block (matching the DISTILLATION_SCHEMA_BLOCK
pattern) and a try/catch retry loop that sends validation errors back
to the LLM for repair before failing."
```

---

### Task 2: Fix drainTaskQueue DI Wiring in webhookRoutes

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:856-870`

- [ ] **Step 1: Add executionMemory bag to triggerDrainForPR**

In `webhookRoutes.ts`, the `triggerDrainForPR` function at line 861 calls `drainTaskQueue` without passing `executionMemory`. The `codeRoutes.ts` drain at line 4232 does pass it. Make them consistent.

Replace lines 861-870:

```typescript
          await drainTaskQueue({
            logger,
            codeTaskRepo: services.codeTaskRepo,
            taskDispatcher: services.taskDispatcher,
            linearAgentClient: services.linearAgentClient,
            whatsappNotifier: services.whatsappNotifier,
            workerSettingsRepo: services.workerSettingsRepo,
            taskEnqueueService: services.taskEnqueueService,
            orchestratorSecret: loadConfig().orchestratorSecret,
            executionMemory: {
              /* v8 ignore start -- ts-type: conditional spread for exactOptionalPropertyTypes @preserve */
              ...(services.executionMemoryQueryClient !== undefined && {
                queryClient: services.executionMemoryQueryClient,
              }),
              ...(services.executionMemoryEmbeddingClient !== undefined && {
                embeddingClient: services.executionMemoryEmbeddingClient,
              }),
              ...(services.executionMemoryRepo !== undefined && {
                executionMemoryRepo: services.executionMemoryRepo,
              }),
              ...(services.executionMemoryApplicationRepo !== undefined && {
                executionMemoryApplicationRepo: services.executionMemoryApplicationRepo,
              }),
              /* v8 ignore stop @preserve */
            },
          });
```

- [ ] **Step 2: Run webhook route tests**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/routes/webhookRoutes.test.ts`
Expected: PASS (existing tests should continue to pass since executionMemory resources are optional in drainTaskQueue)

- [ ] **Step 3: Run full test suite**

Run: `cd apps/code-agent && pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts
git commit -m "fix(code-agent): pass executionMemory resources in webhookRoutes triggerDrainForPR

The post-completion drain triggered by webhookRoutes was not passing
execution memory resources to drainTaskQueue, causing tasks dispatched
through this path to hit 'application_repo_unavailable'. Now matches
the resource wiring in codeRoutes."
```

---

### Task 3: Fix Vector Scoring — Add distanceResultField

**Files:**
- Modify: `apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts:155-176`
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreExecutionMemoryRepository.test.ts`

- [ ] **Step 1: Write failing test — vectorScore uses real distance**

Find the existing `findNearest` test in `firestoreExecutionMemoryRepository.test.ts` and add a new test:

```typescript
it('computes vectorScore from distanceResultField instead of defaulting to 1.0', async () => {
  const fakeDoc = {
    id: 'mem-1',
    data: () => ({
      repository: 'owner/repo',
      sourceTaskId: 'task-1',
      sourceAgentType: 'execution',
      memoryType: 'pitfall_pattern',
      title: 'Test memory',
      appliesWhen: 'When testing',
      action: 'Do this',
      avoid: 'Avoid that',
      verification: 'Check this',
      evidenceSummary: 'Evidence',
      retrievalText: 'retrieval text',
      keywords: [],
      labelHints: [],
      componentHints: [],
      embedding: [0.1, 0.2],
      embeddingModel: 'text-embedding-3-small',
      fingerprint: 'fp-1',
      distillationVersion: 'v1',
      qualityScore: 0.8,
      distillationConfidence: 0.9,
      applicationCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      status: 'active',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      vectorDistance: 0.35,
    }),
  };

  const fakeSnapshot = {
    empty: false,
    docs: [fakeDoc],
  };

  mockFindNearest.mockReturnValue({ get: vi.fn().mockResolvedValue(fakeSnapshot) });

  const result = await repo.findNearest({
    repository: 'owner/repo',
    embedding: [0.1, 0.2],
    limit: 5,
    status: 'active',
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value[0]?.vectorScore).toBeCloseTo(0.65, 2);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/repositories/firestoreExecutionMemoryRepository.test.ts -t "computes vectorScore from distanceResultField"`
Expected: FAIL — current code reads `.distance` (undefined), falls back to 0, returns 1.0

- [ ] **Step 3: Add distanceResultField to findNearest options**

In `firestoreExecutionMemoryRepository.ts`, modify the `findNearest()` call at lines 155-162:

```typescript
      const vectorQuery = filteredCollection.findNearest(
        'embedding',
        FieldValue.vector(input.embedding),
        {
          limit: input.limit,
          distanceMeasure: 'COSINE',
          distanceResultField: 'vectorDistance',
        }
      );
```

- [ ] **Step 4: Read distance from document data instead of snapshot property**

Replace lines 169-176:

```typescript
      const matches = snapshot.docs.map((doc) => {
        const memory = toExecutionMemory(doc as { id: string; data(): Record<string, unknown> });
        const data = doc.data() as Record<string, unknown>;
        const distance = typeof data['vectorDistance'] === 'number' ? data['vectorDistance'] : 1;
        return {
          ...memory,
          vectorScore: 1 - distance,
        };
      });
```

Note: The fallback changed from `?? 0` (perfect score) to default `1` (worst score). Unknown distance should not mean perfect match.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/repositories/firestoreExecutionMemoryRepository.test.ts -t "computes vectorScore from distanceResultField"`
Expected: PASS

- [ ] **Step 6: Run all repository tests**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/repositories/firestoreExecutionMemoryRepository.test.ts`
Expected: ALL PASS (update existing tests if they assert on distance behavior)

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/infra/repositories/firestoreExecutionMemoryRepository.ts apps/code-agent/src/__tests__/infra/repositories/firestoreExecutionMemoryRepository.test.ts
git commit -m "fix(code-agent): use distanceResultField for vector scoring in findNearest

The Firestore findNearest() call was missing the distanceResultField
option, causing all vectorScore values to be 1.0 (the ?? 0 fallback
when .distance is undefined). Now reads distance from a named field
in the document data. Changed the unknown-distance fallback from 0
(perfect) to 1 (worst) to prevent silent false positives."
```

---

### Task 4: Include Remediation Agents in Memory Eligibility

**Files:**
- Modify: `apps/code-agent/src/domain/utils/memoryEligibility.ts:1`
- Modify: `apps/code-agent/src/__tests__/domain/utils/memoryEligibility.test.ts:21-23`

- [ ] **Step 1: Update test — expect remediation to be eligible**

In `memoryEligibility.test.ts`, change the existing test at line 21:

```typescript
  it('returns true for remediation', () => {
    expect(isMemoryEligibleAgent('remediation')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/utils/memoryEligibility.test.ts -t "returns true for remediation"`
Expected: FAIL — `isMemoryEligibleAgent('remediation')` currently returns `false`

- [ ] **Step 3: Add remediation to eligible agents**

In `memoryEligibility.ts` line 1:

```typescript
const MEMORY_ELIGIBLE_AGENTS = new Set(['execution', 'planning', 'review', 'remediation']);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/utils/memoryEligibility.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/utils/memoryEligibility.ts apps/code-agent/src/__tests__/domain/utils/memoryEligibility.test.ts
git commit -m "feat(code-agent): include remediation agents in execution memory eligibility

Remediation agents now receive matched execution memories during
dispatch. This allows them to benefit from pitfall and verification
patterns learned from prior tasks in the same issue lifecycle."
```

---

### Task 5: Add Memory Usage Reporting Instructions to System Prompt

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:80-116`
- Modify: `workers/orchestrator/src/__tests__/services/system-prompt.test.ts`

- [ ] **Step 1: Write failing test — memory section includes usage instructions**

In `system-prompt.test.ts`, add within the existing planning prompt describe block:

```typescript
it('includes memory usage reporting instructions when memories are matched', () => {
  const prompt = planningPrompt.build({
    taskId: 'task-plan-456',
    linearIssueLabels: [],
    executionMemoryContext: {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@1.0.0',
      querySummary: 'Test query',
      matchedMemories: [
        {
          memoryId: 'mem-1',
          title: 'Test pattern',
          memoryType: 'pitfall_pattern',
          score: 0.75,
          appliesWhen: 'When testing',
          action: 'Do this',
          avoid: 'Avoid that',
          verification: 'Check this',
        },
      ],
    },
  });

  expect(prompt).toContain('execution_memory_ids_used');
  expect(prompt).toContain('execution_memory_ids_rejected');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/services/system-prompt.test.ts -t "includes memory usage reporting"`
Expected: FAIL — current prompt does not mention these fields

- [ ] **Step 3: Add usage reporting instructions to buildExecutionMemorySection**

In `system-prompt.ts`, update `buildExecutionMemorySection()`. After the rendered memories (line 115, before the closing backtick), append:

```typescript
  return `

### Execution Memory
Retrieved application: ${executionMemoryContext.applicationId}
Retrieval version: ${executionMemoryContext.retrievalVersion}
Query summary: ${executionMemoryContext.querySummary}

- Memories are advisory, not authoritative.
- Trust the current repository state and current Linear issue/comments over memory.
- Ignore any memory that does not match the task or codebase in front of you.
- Do not copy stale branch names, issue IDs, or URLs from memories.

${renderedMemories}

#### Memory Usage Reporting
After completing your work, include in your final summary which memories you applied and which you did not:
- **execution_memory_ids_used**: comma-separated memory IDs you applied (e.g. "mem-abc,mem-def")
- **execution_memory_ids_rejected**: comma-separated memory IDs you found irrelevant or inapplicable
- **execution_memory_usage_summary**: one sentence describing how memories influenced your work, or "No memories applied" if none were relevant`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/services/system-prompt.test.ts -t "includes memory usage reporting"`
Expected: PASS

- [ ] **Step 5: Run all system prompt tests**

Run: `cd workers/orchestrator && pnpm vitest run src/__tests__/services/system-prompt.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Bump prompt version**

The `buildExecutionMemorySection` is shared across all prompt builders. Since this adds new behavioral instructions (agents should now report memory usage), the prompt versions in `system-prompt.ts` need a minor version bump. Find each `PromptBuilder` that calls `buildExecutionMemorySection` (planning, review, execution) and bump the minor version (e.g. `'5.0.0'` -> `'5.1.0'`).

- [ ] **Step 7: Run all orchestrator tests**

Run: `cd workers/orchestrator && pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/__tests__/services/system-prompt.test.ts
git commit -m "feat(orchestrator): add memory usage reporting instructions to system prompt

Agents now receive explicit instructions to report which execution
memories they applied vs rejected. The completion verifier already
extracts these fields — the gap was that agents didn't know to emit
them. Prompt versions bumped to reflect new behavioral instructions."
```

---

### Task 6: Cross-workspace CI Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: Verify code-agent workspace**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 3: Verify orchestrator workspace**

Run: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci:tracked`
Expected: ALL PASS

- [ ] **Step 5: Final commit if any CI fixes needed**

Only if CI required adjustments. Otherwise skip.
