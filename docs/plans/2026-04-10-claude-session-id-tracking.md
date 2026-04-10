# Claude Session ID Tracking for Reliable Resume (Ask-Agent Fix)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude worker resumes reliably carry conversation context across attempts by using explicit session IDs (`--resume <uuid>`) instead of the unreliable `--continue` flag, matching the Codex runtime's existing design.

**Architecture:** The orchestrator already parses Claude's `session_id` from the CLI's `system.init` stream message (`claude-log-processor.ts:112-121`) and persists it on the task (`task-dispatcher.ts:2301-2307`). The missing piece is passing that ID back into the container when reusing the worker. This plan (a) wires a `CLAUDE_SESSION_ID` env var into the `docker exec run-attempt` call, (b) updates `entrypoint.sh` to invoke `claude --resume "$CLAUDE_SESSION_ID"` instead of `claude --continue`, and (c) extends the existing codex-only fail-fast guard at `task-dispatcher.ts:1793` to cover both runtimes.

**Tech Stack:** TypeScript, Vitest, Docker (dockerode), Bash (`entrypoint.sh`)

---

## Root Cause Recap (Evidence)

1. **`SessionStart:startup` hook fires on resume attempts** (visible in the user's production log for `task_52567a29-21b6-40d9-9ada-95b8e0c240dc`). Claude Code's hook matchers distinguish `startup` (fresh) from `resume` (continuation). Seeing `startup` on what should be a `--continue` invocation is definitive evidence that Claude Code is not treating the invocation as a resume.
2. **Claude's own response confirms no prior history**: *"This is the first user message in the current session. ... no prior conversation context or contacts are available to me in this session."*
3. **The codebase expects multiple session files per task**: `workers/orchestrator/src/services/__tests__/transcript-reader.test.ts:131-133` yields both `sess1.jsonl` and `sess2.jsonl` for a single task. The transcript reader stitches them server-side precisely because each `claude --print` invocation creates a new session file. A working `--continue` would append to one.
4. **INT-1308 fixes are already merged** (`task-dispatcher.ts:636`, `:747`, `:964`) but only addressed the PR-preamble side-effect. They did not fix the underlying `--continue` failure.

## Endpoint Changes

| Type      | Endpoint   | Details                                                                        |
| --------- | ---------- | ------------------------------------------------------------------------------ |
| Unchanged | *(all)*    | No HTTP API surface is touched. This is purely worker-infrastructure plumbing. |

---

## File Structure

| File                                                                            | Action   | Responsibility                                                                                                       |
| ------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `workers/orchestrator/src/services/isolation/docker-provider.ts`                | Modify   | Propagate `CLAUDE_SESSION_ID` env var to the `docker exec` call for claude resumes                                   |
| `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts` | Modify   | Assert the exec env contains `CLAUDE_SESSION_ID=<id>` for claude runtime resumes                                     |
| `workers/orchestrator/src/services/task-dispatcher.ts`                          | Modify   | Extend the resume session-id guard from codex-only to cover claude too                                               |
| `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`                    | Modify   | Assert claude resume rejects when `runtimeSessionId` is undefined                                                    |
| `workers/code-worker/entrypoint.sh`                                             | Modify   | Require `CLAUDE_SESSION_ID` on claude resumes, invoke `claude --resume "$CLAUDE_SESSION_ID"` instead of `--continue` |
| `workers/orchestrator/src/services/system-prompt.ts`                            | Modify   | Update `askAgentPrompt` "Session Continuity" note to reflect the new resume mechanism; bump version to `1.2.0`       |
| `workers/orchestrator/src/__tests__/system-prompt.test.ts`                      | Modify   | Update the ask-agent prompt assertion to match the new Session Continuity text                                       |

---

## Task 0: Pre-Implementation Smoke Verification

**Purpose:** Before touching any code, confirm two assumptions — (a) Claude CLI's `--resume <session-id>` flag works in `--print` mode with `--system-prompt` override, and (b) the session ID that `claude-log-processor.ts` captures from `system.init` is the same ID that `--resume` accepts. If either assumption fails, **abort this plan and pivot to Option B** (inline transcript injection).

**Why this is gated:** If `--resume` also silently no-ops (like `--continue` does in this context), the entire plan is moot. One manual smoke-test before writing four tasks' worth of code is cheap insurance.

- [ ] **Step 1: Find an existing preserved container on the dev host**

Run on the orchestrator host (`home-dev`):

```bash
docker ps -a --filter "name=code-worker-" --format "{{.Names}} {{.Status}}"
```

Pick any running `code-worker-task_*` container that was started by a Claude worker (not Codex). Record the `<task-id>` and `<container-id>`.

- [ ] **Step 2: Read the captured session id from the first attempt's log**

```bash
TASK_ID=<task-id>
grep -o '"session_id":"[^"]*"' \
    /var/lib/orchestrator/secrets/claude-session-${TASK_ID}/projects/-repo/*.jsonl \
    | head -1
```

Expected: a single UUID line like `"session_id":"e0a48ae3-4f90-422e-ae42-5accb61ee3fc"`. Record it as `<session-uuid>`.

If the file does not exist or the field is missing, the log parser is NOT capturing session IDs in production (contrary to the unit test at `claude-runtime.test.ts:36`). Stop and investigate before proceeding.

- [ ] **Step 3: Manually invoke `claude --print --resume` inside the container**

```bash
docker exec -i code-worker-${TASK_ID} bash -lc '
    cd /repo && \
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "You are a test prompt." \
        --resume "<session-uuid>" \
        <<< "What was the first thing I asked you to do in this conversation? Answer in one sentence."
' 2>&1 | tee /tmp/resume-smoke.log
```

Expected: Claude's answer references content from the previous conversation turns (not "this is the first message"). Look for `"subtype":"init"` in the JSON stream and confirm the `session_id` matches the one passed via `--resume`.

- [ ] **Step 4: Verify the SessionStart hook fires as `resume` (not `startup`)**

```bash
grep -E 'SessionStart:(startup|resume)' /tmp/resume-smoke.log
```

Expected: `SessionStart:resume started` (not `startup`). This is the definitive signal that Claude Code treats it as a continuation. If it still says `startup`, `--resume` has the same bug as `--continue` and the plan must be aborted.

- [ ] **Step 5: Decision gate**

- **Both Step 3 and Step 4 pass** → Proceed to Task 1.
- **Either fails** → STOP. Document the failure in this plan as a "verification failure" addendum, then brainstorm Option B (inline transcript injection via `readSessionTranscript`) as a new plan. Do not continue.

This task does not produce a commit. It is pure verification.

---

## Task 1: Propagate `CLAUDE_SESSION_ID` From docker-provider to the exec

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/docker-provider.ts:1558-1564`
- Test: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`

Currently the `runAttemptInContainer` exec env only contains `CODEX_THREAD_ID` for codex runtimes. Add a symmetric `CLAUDE_SESSION_ID` entry for the claude runtime when `config.runtimeSessionId` is defined.

- [ ] **Step 1: Write the failing test**

Find the `describe('continueSession with existing container'` or similar `runAttemptInContainer` exec-env test block. If there isn't one, add the test near the existing `reuses existing container for continued attempts` test (line 587). Add this test:

```typescript
it('passes CLAUDE_SESSION_ID env var to exec when claude runtime is resumed with a session id', async () => {
  const initialConfig = createTestConfig({ continueSession: false });
  await provider.createWorker(initialConfig);
  await new Promise((resolve) => setTimeout(resolve, 0));

  mocks.mockContainer.exec.mockClear();

  await provider.createWorker(
    createTestConfig({
      continueSession: true,
      runtimeSessionId: 'e0a48ae3-4f90-422e-ae42-5accb61ee3fc',
      prompt: 'Follow-up message',
      systemPrompt: 'Second attempt system prompt',
    }),
  );

  // Last exec call is run-attempt; earlier calls are setup (ready marker etc.)
  const execCalls = mocks.mockContainer.exec.mock.calls;
  const runAttemptCall = execCalls.find((call) =>
    (call[0]?.Cmd as string[] | undefined)?.join(' ') === '/entrypoint.sh run-attempt',
  );
  expect(runAttemptCall).toBeDefined();
  const env = runAttemptCall?.[0]?.Env as string[];
  expect(env).toContainEqual('CLAUDE_SESSION_ID=e0a48ae3-4f90-422e-ae42-5accb61ee3fc');
  // Sanity: codex env var should NOT be set for claude runtime
  expect(env.some((e) => e.startsWith('CODEX_THREAD_ID='))).toBe(false);
});

it('omits CLAUDE_SESSION_ID when continueSession is false (fresh attempt)', async () => {
  mocks.mockContainer.exec.mockClear();
  await provider.createWorker(
    createTestConfig({
      continueSession: false,
      runtimeSessionId: 'should-be-ignored-on-fresh-start',
    }),
  );

  const execCalls = mocks.mockContainer.exec.mock.calls;
  const runAttemptCall = execCalls.find((call) =>
    (call[0]?.Cmd as string[] | undefined)?.join(' ') === '/entrypoint.sh run-attempt',
  );
  if (runAttemptCall !== undefined) {
    const env = runAttemptCall[0]?.Env as string[];
    expect(env.some((e) => e.startsWith('CLAUDE_SESSION_ID='))).toBe(false);
  }
});
```

- [ ] **Step 2: Run the failing test**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/services/isolation/__tests__/docker-provider.test.ts -t "CLAUDE_SESSION_ID"
```

Expected: FAIL — the docker-provider currently only sets `CODEX_THREAD_ID`, never `CLAUDE_SESSION_ID`.

- [ ] **Step 3: Implement the env var propagation**

In `workers/orchestrator/src/services/isolation/docker-provider.ts`, find the `runAttemptInContainer` exec invocation (around line 1551-1565):

**Before:**
```typescript
const execInstance = await container.exec({
  Cmd: ['/entrypoint.sh', 'run-attempt'],
  AttachStdout: true,
  AttachStderr: true,
  Tty: false,
  WorkingDir: '/',
  User: getHostUserInfo().userString,
  Env: [
    `WORKER_CONTINUE=${config.continueSession === true ? '1' : '0'}`,
    `WORKER_RUNTIME=${worker.runtime}`,
    ...(worker.runtime === 'codex' && config.runtimeSessionId !== undefined
      ? [`CODEX_THREAD_ID=${config.runtimeSessionId}`]
      : []),
  ],
});
```

**After:**
```typescript
const execInstance = await container.exec({
  Cmd: ['/entrypoint.sh', 'run-attempt'],
  AttachStdout: true,
  AttachStderr: true,
  Tty: false,
  WorkingDir: '/',
  User: getHostUserInfo().userString,
  Env: [
    `WORKER_CONTINUE=${config.continueSession === true ? '1' : '0'}`,
    `WORKER_RUNTIME=${worker.runtime}`,
    ...(worker.runtime === 'codex' && config.runtimeSessionId !== undefined
      ? [`CODEX_THREAD_ID=${config.runtimeSessionId}`]
      : []),
    ...(worker.runtime === 'claude' &&
    config.continueSession === true &&
    config.runtimeSessionId !== undefined
      ? [`CLAUDE_SESSION_ID=${config.runtimeSessionId}`]
      : []),
  ],
});
```

Note the extra `config.continueSession === true` guard: we only want to leak the session id into the environment on resume attempts, not on fresh starts where Claude should generate its own ID and we capture it via the log parser.

- [ ] **Step 4: Run the test to verify it passes**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/services/isolation/__tests__/docker-provider.test.ts -t "CLAUDE_SESSION_ID"
```

Expected: PASS.

- [ ] **Step 5: Run the full docker-provider test suite**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/services/isolation/__tests__/docker-provider.test.ts
```

Expected: All pass (the change is additive — existing assertions should be unaffected).

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/isolation/docker-provider.ts \
  workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): propagate CLAUDE_SESSION_ID env var on claude resumes

Mirrors the existing CODEX_THREAD_ID plumbing for codex runtimes. The
claude log processor already captures session_id from system.init
messages; this patch wires it back into the docker exec env so the
entrypoint can pass --resume to the Claude CLI on subsequent attempts.

No behavior change yet — the entrypoint still uses --continue. That
change is in the next commit, gated by this env var being available.
EOF
)"
```

---

## Task 2: Extend the Resume Session-ID Guard to Claude

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:1791-1798`
- Test: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

Currently the guard only errors for codex resumes missing a session id. After Task 1, a claude resume without a session id would silently omit `CLAUDE_SESSION_ID`, and the entrypoint would then have no fallback. Rather than hiding this with a `--continue` fallback, fail fast — symmetric with Codex. This is stricter but matches the `ownership-mindset` rule in CLAUDE.md (no silent degradation).

- [ ] **Step 1: Write the failing test**

Find the existing codex-guard test at `task-dispatcher.test.ts:7086` (`'rejects codex resume when runtimeSessionId is missing'`). Add a parallel test below it:

```typescript
it('rejects claude resume when runtimeSessionId is missing', async () => {
  const task = createTestTask({
    status: 'completed',
    agentType: 'ask_agent',
    workerType: 'opus',
    runtime: 'claude',
    // Intentionally no runtimeSessionId — simulates a task from before the
    // session-id tracking feature existed, or one where the first attempt
    // crashed before the log parser captured the id.
  });
  await statePersistence.save({ tasks: { [task.taskId]: task } });
  fakeWorktreeManager.setWorktreeExists(task.taskId, true);

  const result = await dispatcher.sendMessage(task.taskId, 'Follow-up that should fail');

  // sendMessage accepts the resume intent, but the background
  // resumeTaskWithUserMessage must fail with failAcceptedResume.
  expect(result.ok).toBe(true);

  // Drain pending async work
  await new Promise((resolve) => setImmediate(resolve));

  const finalTask = await dispatcher.getTask(task.taskId);
  expect(finalTask?.status).toBe('failed');
  expect(finalTask?.error?.code).toBe('RESUME_ATTEMPT_FAILED');
  expect(finalTask?.error?.message).toContain('runtime session ID');
});
```

If `createTestTask` doesn't accept `runtime`, check existing tests that use codex and mirror that helper shape. The key is that the task must have `runtime: 'claude'` and no `runtimeSessionId`.

- [ ] **Step 2: Run the failing test**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts -t "rejects claude resume when runtimeSessionId is missing"
```

Expected: FAIL — the current guard only checks codex, so claude silently continues and the task never fails.

- [ ] **Step 3: Extend the guard**

In `workers/orchestrator/src/services/task-dispatcher.ts`, find the existing guard at line 1793:

**Before:**
```typescript
const runtimeAttemptState = runtime.createAttemptState(task.taskId, this.logger);
if (params.continueSession && runtimeName === 'codex' && task.runtimeSessionId === undefined) {
  return {
    ok: false,
    error: new Error('Codex resume requires a persisted runtime session ID'),
  };
}
```

**After:**
```typescript
const runtimeAttemptState = runtime.createAttemptState(task.taskId, this.logger);
if (params.continueSession && task.runtimeSessionId === undefined) {
  return {
    ok: false,
    error: new Error(
      `${runtimeName === 'codex' ? 'Codex' : 'Claude'} resume requires a persisted runtime session ID`,
    ),
  };
}
```

Note: we removed the `runtimeName === 'codex'` specificity and generalized to both runtimes. The error message still names the specific runtime for operator clarity.

- [ ] **Step 4: Run the test to verify it passes**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts -t "rejects claude resume when runtimeSessionId is missing"
```

Expected: PASS.

- [ ] **Step 5: Run the existing codex guard test to confirm no regression**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts -t "rejects codex resume"
```

Expected: PASS (the behavior for codex is unchanged).

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts \
  workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): require runtimeSessionId for claude resumes too

Generalizes the existing codex-only guard at startWorkerAttempt so
claude resumes also fail fast if no session id was captured. Matches
the ownership-mindset principle: no silent degradation to --continue
(which we now know does not actually restore session context in
--print mode with --system-prompt override).

Tasks started before this change that get a follow-up message will
fail fast with RESUME_ATTEMPT_FAILED. Users must cancel and restart.
This is acceptable in dev env; no production migration needed.
EOF
)"
```

---

## Task 3: Update `entrypoint.sh` to Use `--resume` Instead of `--continue`

**Files:**
- Modify: `workers/code-worker/entrypoint.sh:166-200` (`run_claude_attempt` function)

This is the core change. Replace `--continue` with `--resume "$CLAUDE_SESSION_ID"` and add a fail-fast guard mirroring the codex one at line 259-262.

- [ ] **Step 1: Understand the current claude-attempt invocation structure**

Read `workers/code-worker/entrypoint.sh` lines 125-214. Note that `run_claude_attempt` has four nearly-identical invocations of `claude`: two for the `forensics_enabled` branch (with `tee` logging), two for the non-forensics branch. Each pair has a `continue_flag` variant and a fresh variant. We need to update all four.

- [ ] **Step 2: Add the CLAUDE_SESSION_ID guard**

In `workers/code-worker/entrypoint.sh`, find the `run_claude_attempt` function. Locate the block:

**Before (around line 166-169):**
```bash
local continue_flag="${WORKER_CONTINUE:-0}"
if [ "$continue_flag" = "1" ]; then
    echo "[entrypoint] Resuming previous Claude session with --continue"
fi
```

**After:**
```bash
local continue_flag="${WORKER_CONTINUE:-0}"
if [ "$continue_flag" = "1" ]; then
    if [ -z "${CLAUDE_SESSION_ID:-}" ]; then
        echo "[entrypoint] ERROR: CLAUDE_SESSION_ID is required for resumed Claude attempts" >&2
        return 1
    fi
    echo "[entrypoint] Resuming previous Claude session with --resume ${CLAUDE_SESSION_ID}"
fi
```

This mirrors the codex guard at line 259-262 exactly.

- [ ] **Step 3: Update all four claude invocations to use `--resume`**

Still in `run_claude_attempt`, find the four `claude --print ... --continue` invocations (lines 174-199). Replace each `--continue \` line with `--resume "$CLAUDE_SESSION_ID" \`.

The forensics branch:

**Before:**
```bash
if [ "$continue_flag" = "1" ]; then
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        --continue \
        < /secrets/user-prompt.txt 2>&1 | tee -a "${attempt_forensics_dir}/claude-stream.log"
else
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        < /secrets/user-prompt.txt 2>&1 | tee -a "${attempt_forensics_dir}/claude-stream.log"
fi
```

**After:**
```bash
if [ "$continue_flag" = "1" ]; then
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        --resume "$CLAUDE_SESSION_ID" \
        < /secrets/user-prompt.txt 2>&1 | tee -a "${attempt_forensics_dir}/claude-stream.log"
else
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        < /secrets/user-prompt.txt 2>&1 | tee -a "${attempt_forensics_dir}/claude-stream.log"
fi
```

The non-forensics branch:

**Before:**
```bash
if [ "$continue_flag" = "1" ]; then
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        --continue \
        < /secrets/user-prompt.txt
else
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        < /secrets/user-prompt.txt
fi
```

**After:**
```bash
if [ "$continue_flag" = "1" ]; then
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        --resume "$CLAUDE_SESSION_ID" \
        < /secrets/user-prompt.txt
else
    claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$system_prompt" \
        < /secrets/user-prompt.txt
fi
```

Double-check with `grep -c -- '--continue' workers/code-worker/entrypoint.sh` — the claude-specific usages should be gone (expect the codex runtime's `codex exec resume` to remain unchanged).

- [ ] **Step 4: Lint the shell script**

```
cd /repo && shellcheck workers/code-worker/entrypoint.sh
```

Expected: No new warnings introduced. If `shellcheck` is not installed, at minimum verify the file is syntactically valid:

```
cd /repo && bash -n workers/code-worker/entrypoint.sh
```

- [ ] **Step 5: Rebuild the code-worker image**

The entrypoint is baked into the worker image. Rebuild it locally before the smoke test in Task 5:

```
cd /repo && pnpm --filter code-worker run build:image 2>&1 | tail -20
```

If there's no `build:image` script in `workers/code-worker/package.json`, fall back to the raw docker build referenced in `workers/orchestrator/DEPLOYMENT.md`:

```
docker build -f workers/code-worker/Dockerfile -t code-worker:local .
```

Expected: successful build. Record the resulting image tag/digest.

- [ ] **Step 6: Commit**

```bash
git add workers/code-worker/entrypoint.sh
git commit -m "$(cat <<'EOF'
fix(code-worker): use --resume with explicit session id for claude resumes

Replaces --continue with --resume "$CLAUDE_SESSION_ID" in all four
claude invocations inside run_claude_attempt. Adds a fail-fast guard
that mirrors the existing codex one at line 259-262: if WORKER_CONTINUE=1
and CLAUDE_SESSION_ID is unset, the attempt errors out before invoking
Claude.

Root cause fix: --continue in --print mode with --system-prompt override
silently creates a fresh session instead of resuming the prior one. This
was provable from the SessionStart hook firing as "startup" instead of
"resume" on resume attempts, and from the codebase's own transcript
reader expecting multiple session files per task. --resume <id> is the
only reliable mechanism.

Breaks ask-agent follow-ups for in-flight tasks that were started before
this change (no captured session id). Dev env only; acceptable.
EOF
)"
```

---

## Task 4: Update Ask-Agent Prompt "Session Continuity" Note

**Files:**
- Modify: `workers/orchestrator/src/services/system-prompt.ts:1197-1199`
- Test: `workers/orchestrator/src/__tests__/system-prompt.test.ts`

The ask-agent system prompt currently says:

```
### Session Continuity
If this session was started with --continue, you have context from previous turns.
Review any prior conversation context before responding.
```

This is now obsolete — the resume mechanism is `--resume`, not `--continue`. More importantly, this instruction is currently a LIE (the prior implementation was broken). Let's make it accurate.

- [ ] **Step 1: Find or add the failing test**

In `workers/orchestrator/src/__tests__/system-prompt.test.ts`, find any existing assertion that references `--continue` or `Session Continuity`. Update or add:

```typescript
it('instructs ask-agent that resumed sessions carry prior turns without naming the CLI flag', () => {
  const result = buildSystemPrompt({
    taskId: 'task_test',
    linearIssueLabels: [],
    workerType: 'opus',
    taskUrl: 'https://intexuraos.cloud/#/code-tasks/task_test',
    agentType: 'ask_agent',
  });

  // New neutral language — should not mention --continue or --resume by name
  expect(result).toContain('Session Continuity');
  expect(result).not.toContain('--continue');
  expect(result).not.toContain('--resume');
  // Positive assertion: the prompt should tell Claude prior turns may be visible
  expect(result).toMatch(/prior (conversation|turns|context)/i);
});
```

- [ ] **Step 2: Run the failing test**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/__tests__/system-prompt.test.ts -t "Session Continuity"
```

Expected: FAIL — current prompt contains `--continue`.

- [ ] **Step 3: Update the prompt text and bump the version**

In `workers/orchestrator/src/services/system-prompt.ts`, modify `askAgentPrompt`:

**Before (lines 1161 and 1197-1199):**
```typescript
export const askAgentPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-ask-agent',
  description: 'Ask Agent system prompt for interactive code assistance',
  version: '1.1.0',
  build(params: SystemPromptParams): string {
    // ...

### Session Continuity
If this session was started with --continue, you have context from previous turns.
Review any prior conversation context before responding.
```

**After:**
```typescript
export const askAgentPrompt: PromptBuilder<SystemPromptParams> = {
  name: 'orchestrator-ask-agent',
  description: 'Ask Agent system prompt for interactive code assistance',
  version: '1.2.0',
  build(params: SystemPromptParams): string {
    // ...

### Session Continuity
If this is a resumed session, prior conversation turns from earlier in the
conversation will be present in your context. Read them before responding so
your answers build on what was already discussed.
```

Version bump rationale (per CLAUDE.md Prompt Versioning rule): minor bump because this clarifies existing guidance without changing agent behavior.

- [ ] **Step 4: Run the test to verify it passes**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/__tests__/system-prompt.test.ts -t "Session Continuity"
```

Expected: PASS.

- [ ] **Step 5: Run the full system-prompt suite**

```
cd /repo && pnpm --filter orchestrator exec vitest run src/__tests__/system-prompt.test.ts
```

Expected: All pass. If any existing assertion references `--continue`, update it to match the new wording.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/system-prompt.ts \
  workers/orchestrator/src/__tests__/system-prompt.test.ts
git commit -m "$(cat <<'EOF'
docs(orchestrator): update ask-agent Session Continuity note for --resume

The prior wording referenced --continue, which (a) no longer matches the
actual invocation after the CLAUDE_SESSION_ID plumbing, and (b) was
misleading because --continue never actually restored session context
in print mode. The new wording is flag-neutral.

Bumps askAgentPrompt version to 1.2.0.
EOF
)"
```

---

## Task 5: End-to-End Dev-Env Smoke Test

**Files:** None (verification only)

- [ ] **Step 1: Restart the orchestrator with the new binaries**

From the repo root on the orchestrator host:

```
cd /repo && pnpm --filter orchestrator build && pm2 restart orchestrator
pm2 logs orchestrator --lines 20
```

Expected: clean restart, no startup errors.

- [ ] **Step 2: Start a fresh ask-agent task**

Via the web UI at `https://dev.intexuraos.cloud/#/ask-agent`, send:

> "Read the file `workers/code-worker/entrypoint.sh` and tell me how many functions it defines."

Wait for the response. Record the `task_id` from the URL.

- [ ] **Step 3: Verify the session id was captured**

```
grep 'Detected runtime session start' \
    /var/log/orchestrator/orchestrator.log \
    | grep "${TASK_ID}" | tail -1
```

Expected: one line showing `taskId=<id> sessionId=<uuid>`. If missing, the log parser isn't running — abort and investigate.

Also verify persistence:

```
jq ".tasks[\"${TASK_ID}\"].runtimeSessionId" /var/lib/orchestrator/state.json
```

Expected: a UUID string (not `null`).

- [ ] **Step 4: Send a follow-up that requires prior context**

From the web UI:

> "Which function did you say defines the Claude runtime attempt? Give me the exact line number."

The correct answer requires Claude to remember the previous response. If `--resume` is working, Claude answers directly; if it's broken, Claude says "I don't see a previous answer in this session" or reads the file again from scratch.

- [ ] **Step 5: Verify the SessionStart hook fires as `resume`**

Tail the worker logs for the second attempt:

```
docker logs code-worker-${TASK_ID} 2>&1 | grep 'SessionStart:' | tail -5
```

Expected: at least one line matching `SessionStart:resume` (NOT `SessionStart:startup`). This is the single most important signal — it's the exact inverse of the bug in the original incident report.

- [ ] **Step 6: Verify Claude actually used prior context in its response**

Read the UI response to the follow-up. If it references a specific line number or function name from the first response (without re-reading the file), `--resume` worked end-to-end. If it re-reads the file or asks which function you mean, the fix didn't take — roll back and investigate.

- [ ] **Step 7: Run the third follow-up (multi-hop test)**

To catch bugs where only attempt 2 works but attempt 3 regresses (e.g., session id gets cleared between attempts):

> "How many arguments does that function take?"

Expected: Claude answers without re-asking.

- [ ] **Step 8: Cancel the test task**

Archive the task via the UI so it doesn't pollute the active-session query.

This task does not produce a commit. It is pure verification.

---

## Task 6: Full CI and Final Cleanup

- [ ] **Step 1: Build all workspaces**

```
cd /repo && pnpm build
```

Expected: clean build, no type errors.

- [ ] **Step 2: Run orchestrator workspace verification**

```
cd /repo && pnpm run verify:workspace:tracked -- orchestrator
```

Expected: all tests pass, coverage thresholds met.

- [ ] **Step 3: Run full CI**

```
cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-claude-session-id.txt
```

Expected: all checks pass. Per CLAUDE.md Commit Gate, `ci:tracked` must be green before the final commit. If anything fails — **even in a workspace you didn't touch** — fix it or ask the user (no "pre-existing failures", no "unrelated to my changes").

- [ ] **Step 4: Final commit (only if CI required adjustments)**

If CI demanded lint/format fixes only, commit them as a separate cleanup commit:

```bash
git add -p  # stage only the cleanup hunks
git commit -m "chore: CI cleanup for claude session id tracking"
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --base development --title "fix(orchestrator): use --resume with explicit session id for claude workers" --body "$(cat <<'EOF'
## Summary
- Fixes ask-agent follow-up messages losing all prior conversation context.
- Root cause: `claude --print --continue --system-prompt <text>` creates a fresh session instead of resuming. Proven by `SessionStart:startup` hook firing on resume attempts (should be `resume`), and by the codebase's transcript reader expecting multiple session files per task (`transcript-reader.test.ts:131-133`).
- Fix: mirror the Codex runtime's design — pass an explicit `CLAUDE_SESSION_ID` env var to `docker exec run-attempt`, and invoke `claude --resume "$CLAUDE_SESSION_ID"` from the entrypoint.
- Fail-fast: the existing codex-only guard at `task-dispatcher.ts:1793` now covers claude too. Resumes without a session id are rejected instead of silently degrading.

## Test plan
- [ ] `pnpm --filter orchestrator exec vitest run src/services/isolation/__tests__/docker-provider.test.ts`
- [ ] `pnpm --filter orchestrator exec vitest run src/__tests__/task-dispatcher.test.ts`
- [ ] `pnpm --filter orchestrator exec vitest run src/__tests__/system-prompt.test.ts`
- [ ] `pnpm run ci:tracked`
- [ ] Dev smoke: start ask-agent task, send follow-up, verify response references prior context AND worker log shows `SessionStart:resume` (not `startup`).

## Breaking changes
Tasks in a terminal state before this PR merges that receive a follow-up will fail fast with `RESUME_ATTEMPT_FAILED`. Dev env only, acceptable.
EOF
)"
```

**Before pushing:** confirm the PR title contains an INT number if you have one. If the user hasn't provided a Linear issue id, ask for one — do NOT fabricate per CLAUDE.md.

---

## Self-Review Checklist (run before handoff)

| Check                                                                                                           | Status   |
| --------------------------------------------------------------------------------------------------------------- | -------- |
| Every task has exact file paths with line numbers where applicable                                              | ✓        |
| Every code step shows the actual before/after code, no "similar to X"                                           | ✓        |
| Tests are written before implementation (TDD) in every code task                                                | ✓        |
| Expected outcomes specified for every shell command                                                             | ✓        |
| No placeholders ("TBD", "appropriate error handling", etc.)                                                     | ✓        |
| Commit messages follow Conventional Commits                                                                     | ✓        |
| Final step opens a PR with a body that satisfies CLAUDE.md Cross-Linking requirements                           | ✓        |
| Rollback path documented (Task 0 decision gate)                                                                 | ✓        |
| Type consistency: `runtimeSessionId`, `CLAUDE_SESSION_ID`, and `--resume` naming is consistent across all tasks | ✓        |

---

## Key Design Decisions

1. **Auto-capture session id instead of generating one.** The orchestrator's log processor already parses `session_id` from Claude's `system.init` stream message (`claude-log-processor.ts:112-121`). Reusing this pipeline means zero additional code in the capture path — we only need to start USING what's already captured. A `--session-id <uuid>` approach (orchestrator generates UUID in advance) would be slightly more deterministic but requires bidirectional plumbing we don't need.

2. **Fail-fast on missing session id, no `--continue` fallback.** Per the ownership-mindset rule and CLAUDE.md's "Don't add error handling, fallbacks, or validation for scenarios that can't happen," we reject the scenario rather than paper over it with a broken `--continue` path. Tasks from before this fix that get a follow-up will fail once — users cancel and restart. Dev-env-only, so acceptable.

3. **Generalize the guard rather than duplicating.** The existing codex guard at `task-dispatcher.ts:1793` checks `runtimeName === 'codex'`. We drop that specificity and require a session id for ALL resumes. This means any future runtime added will inherit the fail-fast behavior automatically.

4. **Smoke-verify `--resume` in Task 0 before writing code.** This is the single biggest risk in the plan. If `claude --print --resume <id> --system-prompt <text>` has the same bug as `--continue` (silently creates fresh session), we need to pivot to Option B (inline transcript injection via the existing `readSessionTranscript` helper). One manual docker-exec command is cheap insurance against writing four tasks of code that don't fix the problem.

5. **Keep `--continue` for the Codex path.** Codex runtime uses `codex exec resume`, not Claude CLI — it's a completely different code path. The grep at the end of Task 3 (`grep -c -- '--continue'`) should still find codex references (zero — codex doesn't use `--continue`). But the Claude-side count must go to zero.

6. **Bump ask-agent prompt version to `1.2.0`.** Per CLAUDE.md Prompt Versioning rule, minor bump for "new examples / clarifications without behavior change." The text change is clarifying, not behavioral.
