# Fix Ask-Agent Losing Context and Using Interactive Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs in the ask-agent code task type: (1) session context loss on resume due to PR-focused resume preamble, (2) pending messages dropped during ask_agent completion, and (3) agent using AskUserQuestion in a non-interactive environment.

**Architecture:** All changes are in the orchestrator worker (`workers/orchestrator/`). The ask-agent system prompt needs a non-interactive mode clause. The task-dispatcher's `sendMessage()` resume path needs an ask_agent-specific preamble (not the PR-focused one). The ask_agent completion handler needs to check for pending messages before finalizing.

**Tech Stack:** TypeScript, Vitest, Docker (entrypoint.sh unchanged)

---

## Root Cause Analysis

### Bug 1: Ask-Agent Loses Context on Resume (picks up "different session")

**Flow:** User sends follow-up message → `sendMessage()` → `resumeTaskWithUserMessage()` → `startWorkerAttempt(continueSession: true)` → Claude runs with `--continue` flag.

**Root cause:** When `sendMessage()` resumes a completed task (line 632 of `task-dispatcher.ts`), it builds the user prompt as:
```typescript
const prompt = this.buildResumePreamble(task) + message;
```

`buildResumePreamble()` (line 1481) generates PR-focused instructions:
```
[RESUME PRE-FLIGHT — MANDATORY]
Before making ANY changes, check your PR state:
  gh pr view --json state,mergedAt,number 2>/dev/null || echo "NO_PR"

If PR is MERGED or CLOSED or NO_PR:
  1. git fetch origin
  2. git checkout -b followup/<short-desc> origin/development
  ...
```

For ask-agent tasks that have **no PR or branch**, Claude runs `gh pr view` → gets `NO_PR` → follows the "checkout a new branch from development" instruction → **switches to a clean branch and loses all working context**. This is why it "picks up a completely different thing."

Additionally, `injectActiveGoal: true` appends `[ACTIVE GOAL — HIGHEST PRIORITY]` to the system prompt, which is designed for execution/planning agents and adds unnecessary noise for ask-agent.

**Fix:** Skip `buildResumePreamble()` for ask_agent tasks and use a simple, ask-agent-appropriate preamble. Also skip the active goal injection for ask_agent.

### Bug 2: Pending Messages Lost During Ask-Agent Completion

**Flow:** User sends a message while ask-agent attempt is completing → message queued in `pendingMessages` map → ask_agent completion handler fires.

**Root cause:** The ask_agent completion path at line 929 of `task-dispatcher.ts`:
```typescript
if (completionAgentType === 'ask_agent') {
  // ... flush logs, extract summary
  await this.finalizeTaskWithResult(task, 'ask_agent', { summary });
  return;  // ← Early return, SKIPS pending messages check at line 1122
}
```

The pending messages check at line 1122 is only reached by non-ask_agent agents. When `finalizeTaskWithResult` runs, it calls `this.pendingMessages.delete(task.taskId)` (line 2047), discarding any queued messages.

**Fix:** Check for pending messages in the ask_agent completion path before finalizing.

### Bug 3: Ask-Agent Uses AskUserQuestion

**Root cause:** The ask-agent prompt (`askAgentPrompt` in `system-prompt.ts`, line 1158) doesn't mention that it runs in a non-interactive environment. Claude's tool suite includes `AskUserQuestion`, and without an explicit prohibition, the agent uses it.

**Fix:** Add explicit instructions to the ask-agent prompt prohibiting interactive tools.

---

## File Structure

| File                                                         | Action   | Responsibility                                                                             |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------ |
| `workers/orchestrator/src/services/system-prompt.ts`         | Modify   | Add non-interactive clause to ask-agent prompt                                             |
| `workers/orchestrator/src/services/task-dispatcher.ts`       | Modify   | (a) Skip PR preamble for ask_agent, (b) add pending messages check to ask_agent completion |
| `workers/orchestrator/src/__tests__/system-prompt.test.ts`   | Modify   | Test ask-agent prompt includes non-interactive instructions                                |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` | Modify   | Test ask_agent resume preamble and pending messages                                        |

---

## Task 1: Prohibit AskUserQuestion in Ask-Agent Prompt

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:1175-1191` (askAgentPrompt build function)
- Modify: `workers/orchestrator/src/__tests__/system-prompt.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

Add a test to the existing ask-agent prompt test suite in `system-prompt.test.ts`:

```typescript
it('includes non-interactive environment instructions for ask_agent', () => {
  const result = buildSystemPrompt({
    taskId: 'task_test',
    linearIssueLabels: [],
    workerType: 'opus',
    taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_test',
    agentType: 'ask_agent',
  });

  expect(result).toContain('non-interactive');
  expect(result).toContain('AskUserQuestion');
  expect(result).toContain('NEVER use interactive tools');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/system-prompt.test.ts -t "non-interactive"`
Expected: FAIL — current prompt doesn't mention AskUserQuestion or non-interactive

- [ ] **Step 3: Update the ask-agent prompt**

In `workers/orchestrator/src/services/system-prompt.ts`, modify the `askAgentPrompt.build()` function. Replace the `### Instructions` section (lines 1179-1185) with:

```typescript
### Instructions
- Respond naturally and helpfully to user questions
- You have full access to the repository at /repo
- You can read, search, and analyze code
- You can make code changes if the user asks
- Do NOT create pull requests or Linear issues unless the user explicitly asks
- Do NOT produce structured completion blocks (no PLANNING_AGENT_FINAL, EXECUTION_AGENT_FINAL, etc.)
- Focus on being helpful, accurate, and concise

### Non-Interactive Environment (MANDATORY)
You are running in a non-interactive, headless environment. There is NO human operator
watching your session. You MUST complete your work autonomously.

- NEVER use interactive tools like \`AskUserQuestion\` — there is no one to answer
- NEVER ask clarifying questions — make reasonable assumptions and proceed
- NEVER wait for user input — fulfill the request with the information available
- If the request is ambiguous, state your assumptions and proceed with the most likely interpretation
- Deliver complete, actionable answers in every response
```

Also bump the prompt version from `'1.0.0'` to `'1.1.0'` (minor: new instructions, no behavior change to existing functionality).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/system-prompt.test.ts -t "non-interactive"`
Expected: PASS

- [ ] **Step 5: Run full system-prompt test suite**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/system-prompt.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts workers/orchestrator/src/__tests__/system-prompt.test.ts
git commit -m "fix(orchestrator): prohibit AskUserQuestion in ask-agent prompt

Ask-agent runs in a non-interactive Docker environment with no human
operator. Add explicit instructions forbidding AskUserQuestion and
other interactive tools."
```

---

## Task 2: Skip PR Resume Preamble for Ask-Agent Tasks

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:603-655` (sendMessage resume path)
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` (add test)

The `sendMessage()` method at line 632 uses `buildResumePreamble(task)` which generates PR-focused instructions. For ask-agent tasks, this preamble causes Claude to run `gh pr view` → get NO_PR → checkout a new branch from development → lose all context.

- [ ] **Step 1: Write the failing test**

Find the existing `sendMessage` test section in `task-dispatcher.test.ts`. Add a test:

```typescript
it('uses ask-agent-specific resume preamble without PR instructions for ask_agent tasks', async () => {
  // Setup: create a completed ask_agent task
  const task = createTestTask({
    status: 'completed',
    agentType: 'ask_agent',
    completedAt: new Date().toISOString(),
  });
  await statePersistence.save({ tasks: { [task.taskId]: task } });
  fakeWorktreeManager.setWorktreeExists(task.taskId, true);

  const result = await dispatcher.sendMessage(task.taskId, 'What about the filter counts?');

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.action).toBe('resumed');
  }

  // Verify the prompt does NOT contain PR pre-flight instructions
  const workerConfig = fakeIsolationProvider.getLastWorkerConfig();
  expect(workerConfig?.prompt).not.toContain('RESUME PRE-FLIGHT');
  expect(workerConfig?.prompt).not.toContain('gh pr view');
  expect(workerConfig?.prompt).not.toContain('git checkout -b followup');

  // Verify it DOES contain the user's message
  expect(workerConfig?.prompt).toContain('What about the filter counts?');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "ask-agent-specific resume preamble"`
Expected: FAIL — current code always uses `buildResumePreamble()` which contains PR instructions

- [ ] **Step 3: Implement ask-agent resume preamble bypass**

In `workers/orchestrator/src/services/task-dispatcher.ts`, modify the `sendMessage()` method. Find the line (around 632):

```typescript
const prompt = this.buildResumePreamble(task) + message;
```

Replace with:

```typescript
const prompt = task.agentType === 'ask_agent'
  ? message
  : this.buildResumePreamble(task) + message;
```

This gives ask-agent tasks just the raw user message as the prompt, without any PR-related preamble.

- [ ] **Step 4: Also skip injectActiveGoal for ask_agent**

In the same `sendMessage()` method, find where `resumeTaskWithUserMessage` is called. The task's `pendingResumeStart` prompt is set at line 638:

```typescript
task.pendingResumeStart = {
  prompt,
  acceptedAt: new Date().toISOString(),
};
```

Then in `resumeTaskWithUserMessage()` (line 740):

```typescript
const resumeResult = await this.startWorkerAttempt(task, {
  prompt,
  continueSession: true,
  injectActiveGoal: true,
});
```

Change `injectActiveGoal` to be conditional on agent type:

```typescript
const resumeResult = await this.startWorkerAttempt(task, {
  prompt,
  continueSession: true,
  injectActiveGoal: task.agentType !== 'ask_agent',
});
```

The `[ACTIVE GOAL]` section is designed for execution/planning agents and adds confusing instructions for ask-agent. For ask-agent, the user message alone is sufficient since `--continue` preserves the full conversation context.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "ask-agent-specific resume preamble"`
Expected: PASS

- [ ] **Step 6: Write test verifying injectActiveGoal is false for ask_agent**

```typescript
it('does not inject ACTIVE GOAL section for ask_agent resume', async () => {
  const task = createTestTask({
    status: 'completed',
    agentType: 'ask_agent',
    completedAt: new Date().toISOString(),
  });
  await statePersistence.save({ tasks: { [task.taskId]: task } });
  fakeWorktreeManager.setWorktreeExists(task.taskId, true);

  await dispatcher.sendMessage(task.taskId, 'Continue from where we left off');

  const workerConfig = fakeIsolationProvider.getLastWorkerConfig();
  expect(workerConfig?.systemPrompt).not.toContain('ACTIVE GOAL');
});
```

- [ ] **Step 7: Run all sendMessage tests**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "sendMessage"`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "fix(orchestrator): skip PR resume preamble for ask-agent tasks

The generic resume preamble runs 'gh pr view' and checks out a new
branch from development when no PR exists. For ask-agent tasks (which
never have PRs), this causes Claude to switch branches and lose all
working context. Now ask-agent resumes pass only the user message,
relying on --continue for conversation history."
```

---

## Task 3: Check Pending Messages in Ask-Agent Completion Path

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:928-946` (ask_agent completion handler)
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` (add test)

The ask_agent completion handler at line 929 returns early without checking `this.pendingMessages`, causing any messages sent during the brief completion window to be discarded.

- [ ] **Step 1: Write the failing test**

Add a test in the completion monitoring section of `task-dispatcher.test.ts`:

```typescript
it('delivers pending messages for ask_agent before finalizing', async () => {
  // Setup: start an ask_agent task
  const taskId = await startAskAgentTask(dispatcher);

  // Queue a message while task is running
  await dispatcher.sendMessage(taskId, 'Follow-up question');

  // Trigger completion
  await triggerTaskCompletion(taskId, 0);

  // Verify the task was NOT finalized (should have started a new attempt with the message)
  const task = await dispatcher.getTask(taskId);
  expect(task?.status).toBe('running');

  // Verify the pending message was delivered as a new attempt
  const workerConfig = fakeIsolationProvider.getLastWorkerConfig();
  expect(workerConfig?.prompt).toContain('Follow-up question');
  expect(workerConfig?.continueSession).toBe(true);
});
```

Note: The exact test helper names (`startAskAgentTask`, `triggerTaskCompletion`) should follow the patterns already established in the test file. Read the existing test helpers before implementing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "pending messages for ask_agent"`
Expected: FAIL — current code finalizes without checking pending messages

- [ ] **Step 3: Implement pending messages check for ask_agent**

In `workers/orchestrator/src/services/task-dispatcher.ts`, modify the ask_agent completion handler (around line 929). Change:

```typescript
// ask_agent: skip structured completion verification — extract summary and finalize
if (completionAgentType === 'ask_agent') {
  try {
    await this.logForwarder.flushAndStop(task.taskId);
  } catch (flushError: unknown) {
    this.logger.error(
      { taskId: task.taskId, error: flushError },
      'Failed to flush logs on ask_agent task completion'
    );
  }
  const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);
  const summary = getLast50ClaudeLines(rawLogs);
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Ask agent completed — skipping structured verification`
  );
  await this.finalizeTaskWithResult(task, 'ask_agent', { summary });
  return;
}
```

To:

```typescript
// ask_agent: skip structured completion verification — extract summary and finalize
if (completionAgentType === 'ask_agent') {
  try {
    await this.logForwarder.flushAndStop(task.taskId);
  } catch (flushError: unknown) {
    this.logger.error(
      { taskId: task.taskId, error: flushError },
      'Failed to flush logs on ask_agent task completion'
    );
  }

  // Check for pending messages before finalizing — user may have sent
  // a follow-up while this attempt was completing.
  const pendingQueue = this.pendingMessages.get(task.taskId);
  if (pendingQueue !== undefined && pendingQueue.length > 0) {
    this.pendingMessages.delete(task.taskId);
    const combinedPrompt = pendingQueue.join('\n\n');
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Ask agent: delivering ${String(pendingQueue.length)} queued message(s) instead of finalizing`
    );
    this.appendTaggedTaskLog(
      task.taskId,
      'prompt',
      combinedPrompt.length > 200 ? combinedPrompt.slice(0, 200) + '\u2026' : combinedPrompt
    );
    await this.teardownAttempt(task.taskId, true);
    const resumeResult = await this.startWorkerAttempt(task, {
      prompt: combinedPrompt,
      continueSession: true,
      injectActiveGoal: false,
    });
    if (resumeResult.ok) {
      task.containerId = resumeResult.containerId;
      await this.saveTask(task);
      this.claudeErrors.delete(task.taskId);
      this.taskExitCodes.delete(task.taskId);
      return;
    }
    this.appendOrchestratorTaskLog(
      task.taskId,
      'Failed to deliver queued messages, finalizing normally'
    );
  }

  const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);
  const summary = getLast50ClaudeLines(rawLogs);
  this.appendOrchestratorTaskLog(
    task.taskId,
    `Ask agent completed — skipping structured verification`
  );
  await this.finalizeTaskWithResult(task, 'ask_agent', { summary });
  return;
}
```

Key details:
- `injectActiveGoal: false` — matches the Task 2 decision: ask-agent doesn't use active goal injection
- `teardownAttempt(taskId, true)` — keeps session state for `--continue`
- Pattern matches the existing pending messages delivery at line 1122

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "pending messages for ask_agent"`
Expected: PASS

- [ ] **Step 5: Run full task-dispatcher test suite**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "fix(orchestrator): check pending messages in ask-agent completion path

The ask_agent completion handler returned early without checking for
queued messages. If a user sent a follow-up while the current attempt
was completing, the message was silently discarded. Now the handler
checks pendingMessages and delivers them as a continued session before
finalizing."
```

---

## Task 4: Run Full CI and Verify

- [ ] **Step 1: Build packages**

Run: `cd /repo && pnpm build`
Expected: Clean build, no errors

- [ ] **Step 2: Run orchestrator workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- orchestrator`
Expected: All tests pass, coverage thresholds met

- [ ] **Step 3: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All checks pass

- [ ] **Step 4: Final commit (if any formatting/lint fixes needed)**

Only if CI required adjustments.

---

## Summary of Changes

| Bug                    | Root Cause                                                                                  | Fix                                                       | File                 |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------- |
| Context loss on resume | `buildResumePreamble()` generates PR instructions that cause `git checkout` to a new branch | Skip preamble for `ask_agent` tasks                       | `task-dispatcher.ts` |
| Pending messages lost  | `ask_agent` completion early-returns before `pendingMessages` check                         | Add pending messages check to `ask_agent` completion path | `task-dispatcher.ts` |
| Uses AskUserQuestion   | Prompt doesn't mention non-interactive environment                                          | Add `### Non-Interactive Environment` section to prompt   | `system-prompt.ts`   |
