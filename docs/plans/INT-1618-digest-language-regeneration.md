# INT-1618 Digest Language Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerated fishing assistant digest summaries must stay in the configured original digest language, Polish for `grupa-wedkarska-skool`, instead of being regenerated in English.

**Architecture:** The mobile-notifications digest subscription becomes the source of truth for digest output language. That language is passed through every digest run path into the shared digest prompt and repair prompt, and the internal fishing digest Markdown formatter uses matching section labels. Existing Firestore digest/state documents are overwritten by normal regeneration/backfill after deployment; no new endpoint or Firestore migration is required.

**Tech Stack:** TypeScript, Fastify, Firestore, `@intexuraos/llm-prompts`, Vitest, `pnpm run ci:tracked`.

---

## Investigation Summary

- Source root cause: `packages/llm-prompts/src/digest/digestPrompt.ts` hard-codes English in the headline, bullets, and content rules.
- Regression guard currently encodes the bug: `packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts` asserts the prompt contains `in english`.
- Production Firestore evidence, read on 2026-05-08 UTC: recent `notification_daily_digests` for `google-oauth2|113131655542389277022_grupa-wedkarska-skool` are English, including `2026-05-07` with `generation: 2`.
- Current `notification_group_states` data is already mixed-language, so the prompt must translate or normalize carried-forward human-readable state into the target language instead of copying prior English state.

## Endpoint Changes

| Category | Endpoint | Change |
| --- | --- | --- |
| Modified | `POST /internal/notifications/digest/run` | Request/response shape unchanged; generated digest/state text uses subscription `outputLanguage`. |
| Modified | `POST /internal/notifications/digest/run-yesterday` | Request/response shape unchanged; cron output uses subscription `outputLanguage`. |
| Modified | `POST /notifications/digests/run` | Request/response shape unchanged; manual regeneration output uses subscription `outputLanguage`. |
| Modified | `POST /internal/notifications/digests/query` | Request/response shape unchanged; generated `summaryMarkdown` section labels use subscription `outputLanguage`. |
| Modified | `POST /internal/notifications/digests/get` | Request/response shape unchanged; generated `summaryMarkdown` section labels use subscription `outputLanguage`. |
| Created | None | No new HTTP surface. |
| Removed | None | No route removal. |
| Unchanged | Fishing assistant proxy routes in `apps/fishing-assistant-service/src/routes/digestsRoutes.ts` | They continue to proxy mobile-notifications digest data. |

## File Structure

- Modify `packages/llm-prompts/src/digest/digestPrompt.ts` to add `outputLanguage` to `DigestPromptInput`, bump the prompt to `4.0.0`, and replace English-only instructions with target-language instructions.
- Modify `packages/llm-prompts/src/digest/digestRepairPrompt.ts` to add `outputLanguage`, bump to `2.0.0`, and make repair preserve/translate to the target language.
- Modify `packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts` and `packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts` for target-language regression coverage.
- Modify `apps/mobile-notifications-service/src/domain/digestSubscriptions.ts` to add `outputLanguage: 'Polish'` to the hard-coded fishing group subscription.
- Modify `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts` to accept and pass `outputLanguage`.
- Modify `apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts` to pass `outputLanguage` into the repair prompt.
- Modify `apps/mobile-notifications-service/src/routes/digestRoutes.ts` so internal, cron, and user-triggered regeneration all pass the subscription language.
- Modify `apps/mobile-notifications-service/src/routes/internalRoutes.ts` so fishing digest evidence Markdown headings are language-aware.
- Modify tests under `apps/mobile-notifications-service/src/__tests__/domain/usecases/`, `apps/mobile-notifications-service/src/__tests__/routes/`, and `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts`.
- Update `docs/services/mobile-notifications-service/technical.md` and `docs/services/mobile-notifications-service/agent.md` to document subscription-driven digest language and the post-deploy regeneration requirement.

---

## Task 1: Shared Digest Prompt Language Contract

**Files:**
- Modify: `packages/llm-prompts/src/digest/digestPrompt.ts`
- Modify: `packages/llm-prompts/src/digest/digestRepairPrompt.ts`
- Modify: `packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts`
- Modify: `packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts`

- [ ] **Step 1: Write failing tests for target-language prompt generation**

In `packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts`, add `outputLanguage: 'Polish'` to `baseInput`:

```typescript
const baseInput = {
  userId: 'google-oauth2|test-user',
  groupKey: 'grupa-wedkarska-skool',
  date: '2026-04-15',
  outputLanguage: 'Polish',
  previousState: null,
  last3Summaries: [],
  todaysMessages: [{ sender: 'Test', text: 'Testowa polska wiadomość', postTimeSec: 1776380400 }],
};
```

Replace the existing English assertion test with:

```typescript
it('instructs the model to write in the configured target language', () => {
  const prompt = digestPrompt.build(baseInput);
  expect(prompt).toContain('Target output language: Polish');
  expect(prompt).toContain('dailySummary.headline');
  expect(prompt).toContain('stateUpdate.openThreads[].lastSignal');
  expect(prompt.toLowerCase()).not.toContain('in english');
});
```

Update the semver assertion:

```typescript
it('exposes semver version 4.x', () => {
  expect(DIGEST_PROMPT_VERSION).toMatch(/^4\.\d+\.\d+$/);
});
```

- [ ] **Step 2: Write failing tests for repair prompt language preservation**

In `packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts`, update every `digestRepairPrompt.build` call to include `outputLanguage: 'Polish'`, then add:

```typescript
it('requires repaired text to use the target language', () => {
  const repair = digestRepairPrompt.build({
    originalPrompt: 'ORIGINAL_PROMPT_BODY',
    invalidResponse: '{"dailySummary": {"headline": "English headline"}}',
    errorMessage: 'missing fields',
    outputLanguage: 'Polish',
  });

  expect(repair).toContain('Target output language: Polish');
  expect(repair).toContain('translate it to the target output language');
});
```

- [ ] **Step 3: Run prompt tests and confirm they fail**

Run:

```bash
pnpm vitest run packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts
```

Expected: fail because `DigestPromptInput` does not have `outputLanguage`, the prompt still contains English-only instructions, and `DigestRepairPromptInput` does not accept `outputLanguage`.

- [ ] **Step 4: Update digest prompt input and instructions**

In `packages/llm-prompts/src/digest/digestPrompt.ts`, add the field and bump the version:

```typescript
export const DIGEST_PROMPT_VERSION = '4.0.0';

export interface DigestPromptInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly outputLanguage: string;
  readonly previousState: unknown;
  readonly last3Summaries: readonly unknown[];
  readonly todaysMessages: readonly {
    readonly sender: string;
    readonly text: string;
    readonly postTimeSec: number;
  }[];
}
```

Inside `build`, derive the language:

```typescript
const targetLanguage = input.outputLanguage.trim();
```

Replace the English-only format/content rules with this target-language block:

```typescript
return `You aggregate one day of messages from a fishing WhatsApp group into AggregationOutput JSON.

Target output language: ${targetLanguage}

Content format:
- headline: ONE short sentence (up to 200 characters) in the target output language that captures the most important topics of the day. Do not use generic templates like "The day was marked by...".
- bullets: 3 to 7 short bullets in the target output language. Each bullet is a concrete fact from today's messages: who, what, decision, or outcome. Do not duplicate thread, moderatorPosts, or openQuestions content; use the highest-signal facts of the day in note-headline style.
- Do not use the narrative field; leave it empty or omit it.

Language rules:
- Write every human-readable text value in the target output language: dailySummary.headline, dailySummary.bullets[], dailySummary.threads[].keyFacts[], dailySummary.moderatorPosts[].summary, dailySummary.openQuestions[], dailySummary.activityOutliers[].note, stateUpdate.identityLedger[].notes, stateUpdate.moderatorEvents[].summary, and stateUpdate.openThreads[].lastSignal.
- Use stable kebab-case topic identifiers for dailySummary.threads[].topic, dailySummary.moderatorPosts[].topic, stateUpdate.moderatorEvents[].topic, and stateUpdate.openThreads[].topic. If continuing an existing open thread, keep the existing topic identifier unchanged.
- If previousState or last3Summaries contain another language, translate or normalize any carried-forward human-readable facts into the target output language instead of copying them.
- The example JSON below demonstrates schema shape and reasoning only. Its wording does not override the target output language.
- Keep enum keys, kebab-case thread identifiers, groupKey values, and YYYY-MM-DD dates in their schema format.
- Preserve participant names and source group names as written in the input.
- DO NOT COPY text verbatim from previousState or last3Summaries. Those values are historical context only; they describe previous days, not today. If nothing happened in a thread today, omit it.
- Return ONE JSON object with { dailySummary, stateUpdate } that matches the Zod schema.
- recentSummaryDates: append today's date and trim to the last 30 days.
- identityLedger: increment counters for senders visible today; add new senders with role='newcomer'; preserve everyone else unchanged.
- moderatorEvents: append only; never remove entries.
- openThreads: carry forward with updated lastSignal/lastSignalDate; remove only when today's messages clearly close the topic.
- Do not invent information; use empty arrays when facts are missing.
- The result MUST be valid JSON: no markdown blocks, comments, or trailing commas.
`;
```

Keep the existing examples and input-data sections after this block.

- [ ] **Step 5: Update repair prompt input and instructions**

In `packages/llm-prompts/src/digest/digestRepairPrompt.ts`, add the field and bump the version:

```typescript
export const DIGEST_REPAIR_PROMPT_VERSION = '2.0.0';

export interface DigestRepairPromptInput {
  originalPrompt: string;
  invalidResponse: string;
  errorMessage: string;
  outputLanguage: string;
}
```

Update `build`:

```typescript
const { originalPrompt, invalidResponse, errorMessage, outputLanguage } = input;
const targetLanguage = outputLanguage.trim();
```

Add this section before `Requirements:`:

```typescript
Target output language: ${targetLanguage}
```

Replace requirements 6 and 7 with:

```typescript
6. Preserve schema-valid facts, identifiers, dates, enum values, participant names, and counts.
7. Any added, repaired, or translated human-readable strings must be in the target output language.
8. If a schema-valid human-readable value is in another language, translate it to the target output language while preserving the fact.
9. Fill missing required fields with sensible empty values: arrays -> [], optional strings -> omit.
```

- [ ] **Step 6: Run prompt tests and commit**

Run:

```bash
pnpm vitest run packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts
```

Expected: pass.

Commit:

```bash
git add packages/llm-prompts/src/digest/digestPrompt.ts packages/llm-prompts/src/digest/digestRepairPrompt.ts packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts
git commit -m "[INT-1618] Make digest prompts target-language aware"
```

## Task 2: Thread Subscription Language Through Digest Runs

**Files:**
- Modify: `apps/mobile-notifications-service/src/domain/digestSubscriptions.ts`
- Modify: `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts`
- Modify: `apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts`
- Modify: `apps/mobile-notifications-service/src/routes/digestRoutes.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`

- [ ] **Step 1: Write failing use-case tests for language threading**

In `apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts`, add `outputLanguage: 'Polish'` to each `aggregateDigest` input. Add this test:

```typescript
it('passes the target output language into initial and repair prompts', async () => {
  const llmClient = new FakeLlmClient([
    { type: 'content', value: 'not json' },
    { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
  ]);

  const result = await aggregateDigest(
    { llmClient, logger: noopLogger },
    {
      userId: 'u',
      groupKey: 'grupa-wedkarska-skool',
      date: '2026-04-15',
      outputLanguage: 'Polish',
      previousState: null,
      last3Summaries: [],
      todaysMessages: [{ sender: 'Mateusz', text: 'Zanęta zaczęła pracować.', postTimeSec: 1776380400 }],
    },
  );

  expect(result.ok).toBe(true);
  expect(llmClient.calls[0]?.prompt).toContain('Target output language: Polish');
  expect(llmClient.calls[1]?.prompt).toContain('Target output language: Polish');
});
```

In `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts`, add a helper:

```typescript
function runInput(overrides: Partial<Parameters<typeof runDigestForGroup>[1]> = {}): Parameters<typeof runDigestForGroup>[1] {
  return {
    userId: 'u',
    groupKey: 'g',
    groupTitlePrefix: 'G',
    outputLanguage: 'Polish',
    date: '2026-04-15',
    holder: 'manual',
    ...overrides,
  };
}
```

Use `runInput(...)` in existing `runDigestForGroup` calls. Add:

```typescript
it('passes outputLanguage into aggregateDigest prompt input', async () => {
  let capturedPrompt = '';
  const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
  const originalGenerate = llm.generate.bind(llm);
  llm.generate = async (prompt, options) => {
    capturedPrompt = prompt;
    return originalGenerate(prompt, options);
  };

  setMockServices({
    digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
    notificationRepository: fakeNotificationRepo([]),
    digestRepository: { save: async () => ({ ok: true, value: { summary: EXAMPLE_SUMMARY, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
    groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
  });

  await runDigestForGroup(
    { llmClient: llm, logger: noopLogger, modelId: 'm' },
    runInput({ outputLanguage: 'Polish' }),
  );

  expect(capturedPrompt).toContain('Target output language: Polish');
});
```

- [ ] **Step 2: Run use-case tests and confirm they fail**

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts
```

Expected: fail because `RunDigestForGroupInput` and the subscription type do not carry language yet.

- [ ] **Step 3: Add language to digest subscriptions**

In `apps/mobile-notifications-service/src/domain/digestSubscriptions.ts`:

```typescript
export type DigestOutputLanguage = 'English' | 'Polish';

export interface DigestSubscription {
  readonly userId: string;
  readonly groupKey: string;
  readonly groupTitlePrefix: string;
  readonly outputLanguage: DigestOutputLanguage;
}

export const DIGEST_SUBSCRIPTIONS: readonly DigestSubscription[] = [
  {
    userId: 'google-oauth2|113131655542389277022',
    groupKey: 'grupa-wedkarska-skool',
    groupTitlePrefix: 'Grupa Wędkarska Skool',
    outputLanguage: 'Polish',
  },
] as const;
```

In `apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts`, update the default subscription:

```typescript
digestSubscriptions: overrides.digestSubscriptions ?? [
  { userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', outputLanguage: 'Polish' },
],
```

- [ ] **Step 4: Thread language through runDigestForGroup and aggregateDigest**

In `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts`:

```typescript
export interface RunDigestForGroupInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly groupTitlePrefix: string;
  readonly outputLanguage: string;
  readonly date: string; // YYYY-MM-DD (CET interpretation)
  readonly holder: DigestLockHolder;
}
```

Pass the field to `aggregateDigest`:

```typescript
const aggregation = await aggregateDigest(
  { llmClient: deps.llmClient, logger: deps.logger },
  {
    userId: input.userId,
    groupKey: input.groupKey,
    date: input.date,
    outputLanguage: input.outputLanguage,
    previousState: previousState.value,
    last3Summaries: lastSummaries.value.map((p) => p.summary),
    todaysMessages: filtered.map((m) => ({
      sender: m.senderLabel ?? DIGEST_SENDER_FALLBACK,
      text: m.text,
      postTimeSec: m.postTimeSec,
    })),
  },
);
```

In `apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts`, pass language to repair:

```typescript
const repairPrompt = digestRepairPrompt.build({
  originalPrompt: initialPrompt,
  invalidResponse: lastResponseContent,
  errorMessage: lastErrorMessage,
  outputLanguage: input.outputLanguage,
});
```

- [ ] **Step 5: Pass subscription language from every digest route**

In `apps/mobile-notifications-service/src/routes/digestRoutes.ts`, update all three `runDigestForGroup` call inputs:

```typescript
{
  userId,
  groupKey,
  groupTitlePrefix: subscription.groupTitlePrefix,
  outputLanguage: subscription.outputLanguage,
  date,
  holder,
}
```

For `/internal/notifications/digest/run-yesterday`, the `sub` variable is the subscription:

```typescript
{
  userId: sub.userId,
  groupKey: sub.groupKey,
  groupTitlePrefix: sub.groupTitlePrefix,
  outputLanguage: sub.outputLanguage,
  date,
  holder: 'cron',
}
```

- [ ] **Step 6: Add route regression test for manual regeneration**

In `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`, add a test under `describe('POST /notifications/digests/run', ...)` that captures the prompt:

```typescript
it('uses the subscription output language when regenerating a digest', async () => {
  let capturedPrompt = '';
  setMockServices({
    digestSubscriptions: [{ userId: 'u', groupKey: 'g', groupTitlePrefix: 'G', outputLanguage: 'Polish' }],
    digestLockRepository: {
      acquire: async () => ({ ok: true, value: { acquired: true } }),
      release: async () => ({ ok: true, value: undefined }),
    },
    notificationRepository: {
      findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }),
      save: async () => ({ ok: true, value: NULL_NOTIFICATION }),
      findById: async () => ({ ok: true, value: null }),
      existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }),
      delete: async () => ({ ok: true, value: undefined }),
    },
    digestRepository: {
      save: async () => ({ ok: true, value: { ...EXAMPLE_PERSISTED, generation: 2 } }),
      findByDate: async () => ({ ok: true, value: null }),
      findRecentByGroup: async () => ({ ok: true, value: [] }),
      findInRange: async () => ({ ok: true, value: { items: [] } }),
    },
    groupStateRepository: {
      getByDate: async () => ({ ok: true, value: null }),
      getLatest: async () => ({ ok: true, value: null }),
      save: async () => ({ ok: true, value: undefined }),
    },
  });

  vi.mock('@intexuraos/llm-factory', async (): Promise<typeof import('@intexuraos/llm-factory')> => {
    const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
    return {
      ...actual,
      createLlmClient: () => ({
        generate: async (prompt: string): Promise<{ ok: true; value: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } } }> => {
          capturedPrompt = prompt;
          return { ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } };
        },
      }),
    } as typeof import('@intexuraos/llm-factory');
  });

  const app = await buildServer();
  const token = await createToken({ sub: 'u' });
  const res = await app.inject({
    method: 'POST',
    url: '/notifications/digests/run',
    headers: { authorization: `Bearer ${token}` },
    payload: { groupKey: 'g', date: '2026-04-15' },
  });

  expect(res.statusCode).toBe(200);
  expect(capturedPrompt).toContain('Target output language: Polish');
  await app.close();
});
```

- [ ] **Step 7: Run mobile-notifications focused tests and commit**

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts
```

Expected: pass.

Commit:

```bash
git add apps/mobile-notifications-service/src/domain/digestSubscriptions.ts apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts apps/mobile-notifications-service/src/routes/digestRoutes.ts apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts
git commit -m "[INT-1618] Thread digest output language through regeneration"
```

## Task 3: Language-Aware Fishing Digest Markdown

**Files:**
- Modify: `apps/mobile-notifications-service/src/routes/internalRoutes.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts`

- [ ] **Step 1: Write failing internal route tests for Polish Markdown labels**

In `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts`, update mock subscriptions to include `outputLanguage: 'Polish'`. Add or update a digest query/get assertion so it checks:

```typescript
expect(body.data.items[0]?.summaryMarkdown).toContain('Data: 2026-04-15');
expect(body.data.items[0]?.summaryMarkdown).toContain('Wiadomości:');
expect(body.data.items[0]?.summaryMarkdown).toContain('## Najważniejsze punkty');
expect(body.data.items[0]?.summaryMarkdown).not.toContain('## Key points');
```

For the single digest get endpoint, assert the same labels against `body.data.summaryMarkdown`.

- [ ] **Step 2: Run internal route tests and confirm they fail**

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts
```

Expected: fail because `buildDigestMarkdown` currently emits English section labels.

- [ ] **Step 3: Add markdown labels by subscription language**

In `apps/mobile-notifications-service/src/routes/internalRoutes.ts`, import the type:

```typescript
import type { DigestOutputLanguage } from '../domain/digestSubscriptions.js';
```

Add labels near the constants:

```typescript
const DIGEST_MARKDOWN_LABELS: Record<DigestOutputLanguage, {
  readonly date: string;
  readonly messages: string;
  readonly keyPoints: string;
  readonly threads: string;
  readonly moderatorPosts: string;
  readonly openQuestions: string;
}> = {
  English: {
    date: 'Date',
    messages: 'Messages',
    keyPoints: 'Key points',
    threads: 'Threads',
    moderatorPosts: 'Moderator posts',
    openQuestions: 'Open questions',
  },
  Polish: {
    date: 'Data',
    messages: 'Wiadomości',
    keyPoints: 'Najważniejsze punkty',
    threads: 'Wątki',
    moderatorPosts: 'Wpisy moderatorów',
    openQuestions: 'Otwarte pytania',
  },
};
```

Update the formatter signatures and labels:

```typescript
function buildDigestMarkdown(summary: DailySummary, outputLanguage: DigestOutputLanguage): string {
  const labels = DIGEST_MARKDOWN_LABELS[outputLanguage];
  const lines: string[] = [
    `# ${summary.headline}`,
    '',
    `${labels.date}: ${summary.date}`,
    `${labels.messages}: ${String(summary.messageCount)}`,
  ];

  if (summary.bullets.length > 0) {
    lines.push('', `## ${labels.keyPoints}`);
    for (const bullet of summary.bullets) lines.push(`- ${bullet}`);
  }

  if (summary.threads.length > 0) {
    lines.push('', `## ${labels.threads}`);
    for (const thread of summary.threads) {
      const facts = thread.keyFacts.length > 0 ? `: ${thread.keyFacts.join('; ')}` : '';
      lines.push(`- ${thread.topic}${facts}`);
    }
  }

  if (summary.moderatorPosts.length > 0) {
    lines.push('', `## ${labels.moderatorPosts}`);
    for (const post of summary.moderatorPosts) {
      lines.push(`- ${post.time} ${post.topic}: ${post.summary}`);
    }
  }

  if (summary.openQuestions.length > 0) {
    lines.push('', `## ${labels.openQuestions}`);
    for (const question of summary.openQuestions) lines.push(`- ${question}`);
  }

  return lines.join('\n');
}

function toDigestEvidenceItem(doc: PersistedDailySummary, outputLanguage: DigestOutputLanguage): DigestEvidenceItem {
  const { summary } = doc;
  return {
    groupKey: summary.groupKey,
    date: summary.date,
    title: summary.headline,
    summaryMarkdown: buildDigestMarkdown(summary, outputLanguage),
    messageCount: summary.messageCount,
  };
}
```

In the query route, keep the subscription object and pass its language:

```typescript
const subscription = findSubscription(getServices().digestSubscriptions, userId, groupKey);
if (subscription === undefined) {
  return await reply.fail('INVALID_REQUEST', `no digest subscription for userId=${userId} groupKey=${groupKey}`);
}
```

Then:

```typescript
const matchedItems = result.value.items
  .map((doc) => toDigestEvidenceItem(doc, subscription.outputLanguage))
  .filter((item) => textMatchesTerms(`${item.title}\n${item.summaryMarkdown}`, terms));
```

In the get route:

```typescript
const subscription = findSubscription(getServices().digestSubscriptions, userId, groupKey);
if (subscription === undefined) {
  return await reply.fail('INVALID_REQUEST', `no digest subscription for userId=${userId} groupKey=${groupKey}`);
}
```

Then:

```typescript
return await reply.ok(toDigestEvidenceItem(result.value, subscription.outputLanguage));
```

- [ ] **Step 4: Run internal route tests and commit**

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts
```

Expected: pass.

Commit:

```bash
git add apps/mobile-notifications-service/src/routes/internalRoutes.ts apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts
git commit -m "[INT-1618] Localize fishing digest markdown labels"
```

## Task 4: Documentation And Data Remediation Handoff

**Files:**
- Modify: `docs/services/mobile-notifications-service/technical.md`
- Modify: `docs/services/mobile-notifications-service/agent.md`

- [ ] **Step 1: Update technical documentation**

In `docs/services/mobile-notifications-service/technical.md`, update the `DigestSubscription` table to include:

```markdown
| `outputLanguage`   | `"English"` or `"Polish"` | Language used for generated digest summaries, group state text, and fishing digest Markdown labels |
```

Update `### LLM Aggregation` to state:

```markdown
`aggregateDigest` sends a prompt to OpenRouter with the day's filtered messages, previous group state, last 3 summaries, and the subscription `outputLanguage`. All human-readable summary and group-state fields must be generated in that target language; for `grupa-wedkarska-skool`, the target is Polish. If previous state or prior summaries contain English from earlier generations, the prompt requires translated/normalized Polish carry-forward text rather than copying English.
```

Add a note under `### Backfill Chaining`:

```markdown
After changing digest prompt language behavior, rerun the affected date range through the existing backfill/regeneration flow so `notification_daily_digests` and `notification_group_states` are overwritten in the target language. Existing generation numbers increment; WhatsApp notifications remain suppressed for regenerations.
```

- [ ] **Step 2: Update agent documentation**

In `docs/services/mobile-notifications-service/agent.md`, update the digest subscription shape:

```typescript
interface DigestSubscription {
  userId: string;
  groupKey: string;
  groupTitlePrefix: string;
  outputLanguage: 'English' | 'Polish';
}
```

Add an operational note near digest regeneration guidance:

```markdown
For fishing digest language fixes, regenerate the affected date range after deploy. The hard-coded `grupa-wedkarska-skool` subscription uses `outputLanguage: 'Polish'`, so regenerated summaries, state carry-forward text, and internal fishing digest Markdown labels should be Polish.
```

- [ ] **Step 3: Commit docs**

Run:

```bash
pnpm vitest run packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts
```

Expected: pass.

Commit:

```bash
git add docs/services/mobile-notifications-service/technical.md docs/services/mobile-notifications-service/agent.md
git commit -m "[INT-1618] Document digest output language behavior"
```

## Task 5: Verification And Current Data Repair

**Files:**
- No source files beyond Tasks 1-4.

- [ ] **Step 1: Run workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- mobile-notifications-service
```

Expected: pass.

- [ ] **Step 2: Run tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: pass.

- [ ] **Step 3: After deployment, regenerate affected Firestore data**

After the implementation PR is merged and deployed, run the existing backfill/regeneration flow for the current affected range. Based on production Firestore evidence gathered on 2026-05-08, at minimum regenerate `2026-05-04` through `2026-05-08` for:

```text
userId: google-oauth2|113131655542389277022
groupKey: grupa-wedkarska-skool
outputLanguage: Polish
```

Use the existing authenticated UI backfill action or the internal digest run chain. Do not send WhatsApp messages for these regenerations; existing code suppresses notifications when `generation > 1`.

- [ ] **Step 4: Verify regenerated Firestore documents**

Read recent `notification_daily_digests` and `notification_group_states` for the same user/group. Confirm:

```text
2026-05-04..2026-05-08 summary.headline and summary.bullets are Polish.
state.openThreads[].lastSignal and state.moderatorEvents[].summary are Polish or unchanged non-human identifiers.
generation incremented for regenerated dates.
modelId remains populated.
```

- [ ] **Step 5: Verify fishing assistant digest view**

Open the fishing assistant digest detail for a regenerated date and confirm:

```text
Headline and bullets are Polish.
Markdown labels are Polish: Data, Wiadomości, Najważniejsze punkty, Wątki, Wpisy moderatorów, Otwarte pytania.
No duplicate WhatsApp digest notification was sent for regenerated dates.
```

## Self-Review Checklist

- [ ] Spec coverage: fixes the hardcoded English prompt, the repair path, all three regeneration entry points, and the fishing assistant digest Markdown output path.
- [ ] No placeholder work: every code step names exact files, commands, and concrete snippets.
- [ ] Type consistency: `DigestSubscription.outputLanguage`, `RunDigestForGroupInput.outputLanguage`, and `DigestPromptInput.outputLanguage` all use the same target-language string.
- [ ] Documentation coverage: mobile-notifications technical and agent docs describe subscription-driven digest language and required post-deploy regeneration.
- [ ] Endpoint compliance: no HTTP request or response shape changes; endpoint semantics are documented in the Endpoint Changes section.
