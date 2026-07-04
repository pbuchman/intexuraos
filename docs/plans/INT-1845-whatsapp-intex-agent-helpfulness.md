# Intex Agent WhatsApp Direct Request Helpfulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Intex WhatsApp Assistant from replacing direct answer and code-task requests with the generic Polish clarification `Co mam z tym zrobić?`.

**Architecture:** Keep the current two-stage design: the intent classifier selects conversation versus a bounded tool set, and the runner produces the user reply or confirmation preview. The fix tightens prompt contracts for direct conversation and tool execution, changes the runner to require tool calls when the classifier selected tools, and preserves useful conversation replies when the model uses the wrong protocol label without executing a tool.

**Tech Stack:** TypeScript, Vitest, `@intexuraos/llm-prompts`, `@intexuraos/llm-contract` tool-calling clients, `apps/intex-agent` session handling.

## Global Constraints

- Follow `.claude/CLAUDE.md`; it is the single source of truth for this repo.
- Planning issue: `INT-1845`.
- Test-first: write failing tests before production changes.
- Do not change WhatsApp, code-agent, calendar-agent, note, bookmark, research, or prompt-preference endpoint contracts.
- Do not remove confirmation gating for mutating tools.
- Do not expose private message bodies in tests, logs, plan comments, or PR text.
- Prompt edits must bump semver versions: behavior-changing prompt edits use a major version bump.
- Final commit gate for implementation work: `pnpm run ci:tracked`.

---

## Investigation Findings

Read-only production evidence was gathered from Firestore collection `intex_agent_sessions` and `intex_agent_session_events` with message bodies redacted to lengths and SHA-256 prefixes.

Latest affected session:

- Session: `intex_session_a354749a-4291-4ddc-baeb-c330e65b6d1c`
- Status: `waiting_for_user`
- Started: `2026-07-04T10:56:44.756Z`
- Last user message: `2026-07-04T11:00:15.000Z`

Relevant timeline:

| Time (UTC) | Event | Evidence |
|------------|-------|----------|
| `2026-07-04T10:57:51.825Z` | `user_message` | 207-char direct request, SHA prefix `02e2d92752a2` |
| `2026-07-04T10:57:58.561Z` | `agent_fallback` | `reason: tool_result_mismatch`, `sourceOutcome: completed` |
| `2026-07-04T10:57:58.611Z` | `clarification_requested` | generic Polish clarification, `blockerReason: not_enough_context`, `fallbackReason: tool_result_mismatch` |
| `2026-07-04T10:59:35.345Z` | `user_message` | 253-char direct code-task request, SHA prefix `46cdfc7760f1`, code-task wording detected |
| `2026-07-04T10:59:43.500Z` | `agent_fallback` | `reason: tool_result_mismatch`, `sourceOutcome: completed` |
| `2026-07-04T10:59:43.585Z` | `clarification_requested` | generic Polish clarification, `blockerReason: not_enough_context`, `fallbackReason: tool_result_mismatch` |
| `2026-07-04T10:59:56.322Z` | `user_message` | 31-char follow-up |
| `2026-07-04T11:00:05.027Z` | `confirmation_requested` | `toolName: create_code_task`, `toolArgs: prompt/taskMode/workerType`, `taskMode: execution`, `workerType: codex-xhigh` |
| `2026-07-04T11:00:19.303Z` | `tool_call_completed` | `toolName: create_code_task` |

Root cause:

- The persisted `tool_result_mismatch` fallback is emitted when the runner parses a `completed` model response but cannot find exactly one matching tracked tool execution.
- For the direct code-task request, the classifier had enough signal to reach the runner, but the runner called the tool-calling client with `toolChoice: 'auto'`. That allowed the model to return a final `completed` JSON response without invoking `create_code_task`, so the safety guard produced the generic clarification instead of a confirmation preview.
- For direct answer/conversation requests, no tool should run. If the model uses `completed` as a protocol label for a conversational answer, the current parser treats the label mismatch as a tool failure and discards the useful reply.

Current code anchors:

- `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` hardcodes `toolChoice: 'auto'`.
- `apps/intex-agent/src/domain/agent/intexAgentRunner.ts` maps `completed` without matching `toolExecution` to `tool_result_mismatch`.
- `apps/intex-agent/src/domain/messages/handleIncomingMessage.ts` turns that fallback into the generic localized clarification.
- `packages/llm-prompts/src/intex-agent/systemPrompt.ts` already says direct questions are answerable and code tasks are supported, but it does not strongly separate conversational `no_action` from tool-backed `completed`.

## Endpoint Changes

Modified:

- None.

Created:

- None.

Removed:

- None.

Unchanged:

- Public and internal WhatsApp routes.
- Code task creation API contracts.
- Intex Agent session and prompt-preference API contracts.
- Downstream note, calendar, research, bookmark, and external-save clients.

## File Structure

- Modify `packages/llm-prompts/src/intex-agent/systemPrompt.ts`: strengthen direct-answer and required-tool instructions; bump `INTEX_AGENT_SYSTEM_PROMPT.version` and `buildIntexAgentSystemPrompt.version`.
- Modify `packages/llm-prompts/src/intex-agent/runnerOutputRepairPrompt.ts`: make repair guidance preserve direct answers as `no_action` and forbid `completed` unless a tool actually succeeded; bump prompt version.
- Modify `packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts`: add prompt contract assertions and version expectations.
- Modify `packages/llm-prompts/src/intex-agent/__tests__/runnerOutputRepairPrompt.test.ts`: add repair prompt contract assertions and version expectations.
- Modify `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`: set `toolChoice: 'required'` for classifier-selected tool turns; pass intent/tool exposure context into output normalization; salvage conversation label mistakes safely.
- Modify `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`: add direct-answer and direct-code-task regressions, plus updated `toolChoice` assertions.
- Modify `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`: add session-level regressions proving the generic Polish fallback is not emitted for the two fixed cases.

---

### Task 1: Prompt Contracts For Helpful Direct Requests

**Files:**
- Modify: `packages/llm-prompts/src/intex-agent/systemPrompt.ts`
- Modify: `packages/llm-prompts/src/intex-agent/runnerOutputRepairPrompt.ts`
- Test: `packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts`
- Test: `packages/llm-prompts/src/intex-agent/__tests__/runnerOutputRepairPrompt.test.ts`

**Interfaces:**
- Consumes: `buildIntexAgentSystemPrompt.build({ currentDateTime, userPreferences })`
- Consumes: `intexAgentRunnerOutputRepairPrompt.build({ systemPrompt, messages, invalidResponse, errorMessage })`
- Produces: prompt text that distinguishes conversation answers from tool-backed completion, and repair text that does not convert direct answers into generic clarification

- [ ] **Step 1: Add failing system prompt assertions**

Add this test in `packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts`:

```typescript
  it('keeps direct answers and explicit tool requests out of generic protocol fallback', () => {
    const prompt = buildIntexAgentSystemPrompt.build({
      currentDateTime: CURRENT_DATE_TIME,
      userPreferences: null,
    });

    expect(prompt).toContain(
      'If the user asks you to answer, explain, summarize, compare, reason, or reply directly, answer in the reply field with outcome no_action unless a matching read tool is required.'
    );
    expect(prompt).toContain(
      'Use completed only after a tool call actually succeeded in this turn.'
    );
    expect(prompt).toContain(
      'When a tool is exposed because the classifier selected a supported tool intent, call that tool or ask a concrete missing-field clarification; do not return completed without calling the tool.'
    );
    expect(prompt).toContain(
      'For explicit code-task requests with a described task, call create_code_task and let the confirmation preview ask the user to approve it.'
    );
  });
```

- [ ] **Step 2: Add failing repair prompt assertions**

Add this test in `packages/llm-prompts/src/intex-agent/__tests__/runnerOutputRepairPrompt.test.ts`:

```typescript
  it('repairs protocol labels toward useful conversation or concrete clarification', () => {
    const prompt = intexAgentRunnerOutputRepairPrompt.build({
      systemPrompt: 'SYSTEM_PROMPT',
      messages: [{ role: 'user', content: 'Please answer the earlier question directly.' }],
      invalidResponse: '{"outcome":"completed","reply":"Here is the answer.","toolName":"create_note"}',
      errorMessage: 'completed output has no matching tool execution',
    });

    expect(prompt).toContain('Use no_action for direct conversational answers.');
    expect(prompt).toContain('Use completed only when a tool actually succeeded.');
    expect(prompt).toContain(
      'For explicit supported tool requests, return needs_clarification only for concrete missing fields; do not ask a generic question when the requested action is clear.'
    );
  });
```

- [ ] **Step 3: Run prompt tests and confirm failure**

Run:

```bash
pnpm exec vitest run packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts packages/llm-prompts/src/intex-agent/__tests__/runnerOutputRepairPrompt.test.ts
```

Expected before implementation: the new `toContain` assertions fail.

- [ ] **Step 4: Update prompt text and versions**

In `packages/llm-prompts/src/intex-agent/systemPrompt.ts`:

- Change `INTEX_AGENT_SYSTEM_PROMPT.version` from `13.0.0` to `14.0.0`.
- Change `buildIntexAgentSystemPrompt.version` from `6.0.0` to `7.0.0`.
- Add the exact direct-answer, completed-only-after-tool-success, exposed-tool, and code-task instructions asserted by the test.

In `packages/llm-prompts/src/intex-agent/runnerOutputRepairPrompt.ts`:

- Change `intexAgentRunnerOutputRepairPrompt.version` from `2.0.0` to `3.0.0`.
- Add the exact repair guidance asserted by the test after the schema block.

- [ ] **Step 5: Update version assertions**

Update existing version expectations:

```typescript
expect(INTEX_AGENT_SYSTEM_PROMPT.version).toBe('14.0.0');
expect(buildIntexAgentSystemPrompt.version).toBe('7.0.0');
expect(intexAgentRunnerOutputRepairPrompt.version).toBe('3.0.0');
```

- [ ] **Step 6: Run prompt tests and confirm pass**

Run:

```bash
pnpm exec vitest run packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts packages/llm-prompts/src/intex-agent/__tests__/runnerOutputRepairPrompt.test.ts
```

Expected after implementation: all targeted prompt tests pass.

---

### Task 2: Require Tools For Explicit Tool Intents

**Files:**
- Modify: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- Test: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`

**Interfaces:**
- Consumes: `IntexAgentIntentClassification`
- Consumes: `ToolCallingClient.run({ toolChoice })`
- Produces: `toolChoice: 'required'` whenever the classifier selected one or more exposed tools

- [ ] **Step 1: Add failing runner assertion for code-task tool choice**

Add this test near existing code-task runner tests in `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`:

```typescript
  it('requires a tool call for explicit code-task intents before producing a reply', async () => {
    const client = new ToolExecutingFakeToolCallingClient({
      toolName: 'create_code_task',
      args: {
        prompt: 'Investigate why direct WhatsApp requests fall back to generic clarification.',
        taskMode: 'planning',
        workerType: 'codex-xhigh',
      },
    }, [
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'Prepared the code task.',
          toolName: 'create_code_task',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({
      client,
      intentClassifier: toolIntentClassifier(['create_code_task']),
      toolExecutor: fakeToolExecutor(),
    });

    const result = await runner.run({
      session: session(),
      events: [],
      message:
        'Create a code task to investigate why direct WhatsApp requests fall back to generic clarification.',
      currentDateTime: CURRENT_DATE_TIME,
    });

    expect(result).toMatchObject({
      outcome: 'needs_confirmation',
      toolName: 'create_code_task',
    });
    expect(client.calls[0]?.toolChoice).toBe('required');
  });
```

Expected before implementation: the final assertion sees `auto`.

- [ ] **Step 2: Update production runner tool choice**

In `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`, replace the hardcoded tool choice:

```typescript
        toolChoice: 'auto',
```

with:

```typescript
        toolChoice: tools.length > 0 ? 'required' : 'auto',
```

Keep `maxIterations: 5` unchanged.

- [ ] **Step 3: Update existing tests that intentionally assert `auto`**

Search:

```bash
rg -n "toolChoice\\)\\.toBe\\('auto'\\)" apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts
```

For tests where the classifier exposes a tool, update the expectation to `required`. For pure conversation/no-tool tests, keep or add `auto` expectations only if the runner actually calls the tool-calling client with an empty tool list.

- [ ] **Step 4: Run focused runner tests**

Run:

```bash
pnpm --filter @intexuraos/intex-agent exec vitest run src/__tests__/domain/intexAgentRunner.test.ts
```

Expected after implementation: runner tests pass.

---

### Task 3: Preserve Direct Conversation Replies On Protocol Label Mistakes

**Files:**
- Modify: `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`
- Test: `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`

**Interfaces:**
- Consumes: classifier result from `intentClassifier.classify(...)`
- Consumes: parsed `IntexAgentRunnerOutput`
- Produces: `no_action` result for conversation intent when the model incorrectly labels a direct reply as `completed` without a tool execution

- [ ] **Step 1: Add failing direct-answer regression**

Add this test near the runner fallback tests in `apps/intex-agent/src/__tests__/domain/intexAgentRunner.test.ts`:

```typescript
  it('preserves a direct answer when the model labels a conversation reply as completed', async () => {
    const client = new FakeToolCallingClient([
      ok(
        toolResult({
          outcome: 'completed',
          reply: 'The answer is already in the first turn: use the narrower fallback.',
          toolName: 'create_note',
        })
      ),
    ]);
    const runner = createIntexAgentRunner({
      client,
      intentClassifier: conversationIntentClassifier(),
      toolExecutor: fakeToolExecutor(),
    });

    await expect(
      runner.run({
        session: session(),
        events: [],
        message: 'Answer the question from the first turn.',
        currentDateTime: CURRENT_DATE_TIME,
      })
    ).resolves.toEqual({
      outcome: 'no_action',
      reply: 'The answer is already in the first turn: use the narrower fallback.',
    });
    expect(client.calls[0]?.tools).toEqual([]);
  });
```

Add this helper near existing classifier helpers:

```typescript
function conversationIntentClassifier(): IntexAgentIntentClassifier {
  return {
    async classify() {
      return { kind: 'no_action', reason: 'conversation' };
    },
  };
}
```

Expected before implementation: the runner returns `needs_clarification` with `fallbackReason: 'tool_result_mismatch'`.

- [ ] **Step 2: Pass intent context into response parsing**

In `apps/intex-agent/src/domain/agent/intexAgentRunner.ts`, extend `RunnerOutputValidationInput` or add a sibling context object so `parseRunnerContent(...)` receives:

```typescript
intent: IntexAgentIntentClassification | IntexAgentIntentDecision;
exposedToolNames: IntexAgentToolName[];
```

Pass these values from `run(...)`:

```typescript
const exposedToolNames = tools.map((tool) => tool.name as IntexAgentToolName);
```

- [ ] **Step 3: Normalize conversation-only completed output**

Inside the `case 'completed'` branch in `parseRunnerContent(...)`, before returning `fallbackClarificationResult(...)`, add this branch:

```typescript
      if (
        toolExecution === undefined &&
        input.exposedToolNames.length === 0 &&
        isConversationIntent(input.intent)
      ) {
        return {
          outcome: 'no_action',
          reply: parsed.reply,
          ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
        };
      }
```

Add helper:

```typescript
function isConversationIntent(
  intent: IntexAgentIntentClassification | IntexAgentIntentDecision
): boolean {
  return intent.kind === 'no_action' && intent.reason === 'conversation';
}
```

Do not apply this salvage path when tools were exposed. A tool-intent `completed` response without a tracked tool execution still means no resource was created.

- [ ] **Step 4: Run focused runner tests**

Run:

```bash
pnpm --filter @intexuraos/intex-agent exec vitest run src/__tests__/domain/intexAgentRunner.test.ts
```

Expected after implementation: runner tests pass, including the direct-answer regression.

---

### Task 4: Session-Level Regressions For WhatsApp Behavior

**Files:**
- Modify: `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`

**Interfaces:**
- Consumes: `handleIncomingMessage(...)`
- Produces: persisted events and published replies that do not expose generic fallback for direct answer or direct code-task requests

- [ ] **Step 1: Add direct-answer session regression**

Add this test near existing fallback tests in `apps/intex-agent/src/__tests__/domain/handleIncomingMessage.test.ts`:

```typescript
  it('publishes the direct answer instead of generic Polish fallback when runner normalizes a conversation label mistake', async () => {
    const repo = new FakeSessionRepository();
    repo.seedSession({
      id: 'session-existing',
      userId: 'user-1',
      channel: 'whatsapp',
      status: 'waiting_for_user',
      startedAt: '2026-06-24T09:50:00.000Z',
      lastUserMessageAt: '2026-06-24T09:50:00.000Z',
      startReason: 'no_active_session',
    });
    repo.seedEvent('session-existing', 'user_message', {
      messageId: 'wamid-prior',
      text: 'Jaki jest właściwy następny krok?',
      sourceType: 'whatsapp_text',
    });
    const runner = new FakeRunner([
      {
        outcome: 'no_action',
        reply: 'Właściwy następny krok to utworzyć zadanie programistyczne z opisem problemu.',
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-answer',
        text: 'Odpowiedz na pytanie z pierwszej wiadomości.',
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'agent_fallback')).toEqual([]);
    expect(eventPayloads(repo, 'clarification_requested')).toEqual([]);
    expect(replies.messages[0]?.message).toBe(
      'Właściwy następny krok to utworzyć zadanie programistyczne z opisem problemu.'
    );
    expect(replies.messages[0]?.message).not.toBe('Co mam z tym zrobić?');
  });
```

- [ ] **Step 2: Add direct code-task confirmation regression**

Add this test in the same file:

```typescript
  it('publishes a code-task confirmation instead of generic fallback for a direct code-task request', async () => {
    const repo = new FakeSessionRepository();
    const runner = new FakeRunner([
      {
        outcome: 'needs_confirmation',
        reply: [
          'Czy utworzyć zadanie programistyczne?',
          '',
          'Polecenie: Investigate direct WhatsApp request fallback.',
          'Tryb: execution',
          'Typ workera: codex-xhigh',
        ].join('\n'),
        toolName: 'create_code_task',
        toolArgs: {
          prompt: 'Investigate direct WhatsApp request fallback.',
          taskMode: 'execution',
          workerType: 'codex-xhigh',
        },
      },
    ]);
    const replies = new FakeReplyPublisher();

    await handleIncomingMessage(
      message({
        messageId: 'wamid-code-task',
        text: 'Utwórz code task execution: investigate direct WhatsApp request fallback.',
      }),
      deps(repo, runner, replies)
    );

    expect(eventPayloads(repo, 'agent_fallback')).toEqual([]);
    expect(eventPayloads(repo, 'clarification_requested')).toEqual([]);
    expect(eventPayloads(repo, 'confirmation_requested')[0]).toMatchObject({
      toolName: 'create_code_task',
      toolArgs: {
        prompt: 'Investigate direct WhatsApp request fallback.',
        taskMode: 'execution',
        workerType: 'codex-xhigh',
      },
    });
    expect(replies.messages[0]?.message).toContain('Czy utworzyć zadanie programistyczne?');
    expect(replies.messages[0]?.message).not.toBe('Co mam z tym zrobić?');
  });
```

- [ ] **Step 3: Run session tests**

Run:

```bash
pnpm --filter @intexuraos/intex-agent exec vitest run src/__tests__/domain/handleIncomingMessage.test.ts
```

Expected after implementation: session tests pass.

---

### Task 5: Verification And Deployment Handoff

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: changed prompt package and `intex-agent`
- Produces: verified implementation ready for PR review

- [ ] **Step 1: Run prompt package tests**

Run:

```bash
pnpm exec vitest run packages/llm-prompts/src/intex-agent/__tests__/systemPrompt.test.ts packages/llm-prompts/src/intex-agent/__tests__/runnerOutputRepairPrompt.test.ts packages/llm-prompts/src/intex-agent/__tests__/runnerOutputSchemas.test.ts packages/llm-prompts/src/intex-agent/__tests__/intentClassifierPrompt.test.ts
```

Expected: all targeted prompt tests pass.

- [ ] **Step 2: Run Intex Agent domain tests**

Run:

```bash
pnpm --filter @intexuraos/intex-agent exec vitest run src/__tests__/domain/intexAgentRunner.test.ts src/__tests__/domain/handleIncomingMessage.test.ts src/__tests__/domain/intentClassifier.test.ts
```

Expected: all targeted Intex Agent tests pass.

- [ ] **Step 3: Run workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- intex-agent
```

Expected: workspace verification passes.

- [ ] **Step 4: Run final CI gate**

Run:

```bash
pnpm run ci:tracked
```

Expected: CI passes completely before committing implementation changes.

## Self-Review Notes

- This plan intentionally does not split subtasks because all changes are in the Intex Agent prompt/runtime boundary plus the shared prompt package.
- The direct code-task failure is addressed by `toolChoice: 'required'`, not only prompt wording.
- The direct answer failure is addressed by preserving conversation replies when the model makes a protocol-label mistake.
- Confirmation gating remains intact: mutating tools still produce `needs_confirmation` before execution.
- The production evidence section redacts private user message bodies.
