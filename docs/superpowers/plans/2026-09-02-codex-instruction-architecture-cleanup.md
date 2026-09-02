# Codex Instruction Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AGENTS.md` the single source of general repository instructions, reduce `.claude/CLAUDE.md` to a reference to `AGENTS.md`, and remove duplicated coding-agent boilerplate without changing any supported worker type or runtime behavior.

**Architecture:** Codex and other repository-aware agents read the same compact contract from `AGENTS.md`. Claude compatibility is a two-line adapter in `.claude/CLAUDE.md`; Claude-specific runtime assets remain only where non-Codex production workers actually consume them. Codex-specific skills stay under `.codex/`, shared diagnostic executables move to a neutral `scripts/agent-tools/` location, and machine-enforced runtime contracts stay in the orchestrator and CI rather than in duplicated prose or lifecycle hooks.

**Tech Stack:** Markdown, Node.js ESM, TypeScript, Vitest, Bash, pnpm, Codex hooks, Claude Code worker runtime.

**Spec:** User-approved decisions captured in **Global Constraints** below; there is no separate specification file.

## Global Constraints

- `AGENTS.md` is the only source of general repository instructions.
- `.claude/CLAUDE.md` contains only a reference to `../AGENTS.md`; it does not restate or extend general rules.
- Keep the exact worker type set: `auto`, `opus`, `sonnet`, `codex`, `codex-xhigh`, `openrouter-free`.
- Preserve worker capabilities, runtime selection, authentication, model selection, dispatch, completion verification, logs, metrics, and telemetry.
- In particular, preserve the non-Codex runtime paths for `auto`, `opus`, `sonnet`, and `openrouter-free`.
- Keep `.mcp.json`, `docker/code-worker/**`, orchestrator runtime/auth code, and provider integrations unless a step below explicitly changes a reference without changing behavior.
- Keep `.claude/skills/linear/**` as a Claude-worker runtime asset. It is not a general instruction source.
- Keep `.claude/skills/nitpick-nuker/**` as the remediation-worker runtime asset required by active prompts.
- Do not change HTTP contracts, schemas, Firestore data, migrations, Terraform, deployment topology, or environment configuration.
- Do not use Git worktrees. Execute on a `codex/` branch unless the user explicitly selects an existing branch.
- Preserve unrelated tracked, untracked, and ignored user files.
- Do not rewrite historical plans merely because they mention old paths. Validate active instructions, executable scripts, tests, and current operational documentation.

## Target Repository Shape

```text
AGENTS.md                              # canonical, compact general rules
.claude/CLAUDE.md                      # compatibility pointer only
.claude/skills/linear/**               # retained non-Codex worker runtime asset
.claude/skills/nitpick-nuker/**        # retained remediation-worker runtime asset
.codex/skills/**                       # Codex workflows, no .claude dependencies
.codex/hooks.json                      # one portable infrastructure-safety hook
.codex/hooks/pre-tool-policy.sh        # no logging or workflow enforcement
scripts/agent-tools/**                 # runtime-neutral diagnostic executables
.mcp.json                              # retained Claude worker MCP contract
workers/orchestrator/**                # source of runtime/completion enforcement
```

## Files in Scope

**Create**

- `scripts/verify-agent-instructions.mjs`
- `scripts/__tests__/verify-agent-instructions.test.ts`
- `scripts/agent-tools/fetch-code-task.cjs`
- `scripts/agent-tools/fetch-intex-session.cjs`
- `.codex/hooks.json`
- `.codex/hooks/pre-tool-policy.sh`
- `.codex/hooks/__tests__/pre-tool-policy.test.ts`

**Modify**

- `AGENTS.md`
- `.claude/CLAUDE.md`
- `.gitignore`
- `package.json`
- `scripts/ci.mjs`
- `packages/code-task-domain/src/__tests__/codeTaskWorkerTypes.test.ts`
- `.codex/skills/commit-push/SKILL.md`
- `.codex/skills/release/SKILL.md`
- `.codex/skills/release/reference/subagent-execution.md`
- `.codex/skills/release/workflows/full-release.md`
- `.codex/skills/debug-code-task/scripts/fetch-task.sh`
- `.codex/skills/debug-intex-session/scripts/fetch-session.sh`
- `workers/orchestrator/src/services/prompts/prompt-shared.ts`
- `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- `workers/orchestrator/src/services/isolation/__tests__/worker-image.test.ts`
- `.github/copilot-instructions.md`

**Delete after reference and runtime verification**

- `.claude/settings.json`
- `.claude/hooks/**`
- `.claude/agents/**`
- `.claude/commands/**`
- `.claude/reference/**`
- `.claude/ci-failures/**`
- `.claude/skills/coverage/**`
- `.claude/skills/debug-code-task/**`
- `.claude/skills/debug-intex-session/**`
- `.claude/skills/release/**`
- `.claude/skills/share/**`
- `.github/workflows/hooks-tests.yml`
- `scripts/ci-failure-report.mjs`

The deletion list deliberately excludes `.claude/skills/linear/**`, `.claude/skills/nitpick-nuker/**`, `.mcp.json`, and every production worker implementation.

---

### Task 1: Freeze the supported worker contract

**Files:**

- Modify: `packages/code-task-domain/src/__tests__/codeTaskWorkerTypes.test.ts`
- Verify: `packages/code-task-domain/src/codeTaskWorkerTypes.ts`
- Verify: `workers/orchestrator/src/services/isolation/types.ts`

- [ ] **Step 1: Strengthen the existing worker capability regression test**

Replace the partial `sonnet` check with an exact capability snapshot covering every worker:

```ts
expect(capabilities).toEqual({
  auto: expect.objectContaining({ runtimeFamily: 'claude', auth: { kind: 'claude' } }),
  opus: expect.objectContaining({ runtimeFamily: 'claude', auth: { kind: 'claude' } }),
  sonnet: expect.objectContaining({ runtimeFamily: 'claude', auth: { kind: 'claude' } }),
  codex: expect.objectContaining({ runtimeFamily: 'codex', auth: { kind: 'codex' } }),
  'codex-xhigh': expect.objectContaining({ runtimeFamily: 'codex', auth: { kind: 'codex' } }),
  'openrouter-free': expect.objectContaining({
    runtimeFamily: 'provider',
    auth: { kind: 'api_key', envVar: 'OPENROUTER_API_KEY' },
  }),
});
```

- [ ] **Step 2: Assert that the canonical list remains exact and ordered**

Keep the existing expectation:

```ts
expect(commonCore['CODE_TASK_WORKER_TYPES']).toEqual([
  'auto',
  'opus',
  'sonnet',
  'codex',
  'codex-xhigh',
  'openrouter-free',
]);
```

- [ ] **Step 3: Run the focused contract test**

Run:

```bash
pnpm exec vitest run packages/code-task-domain/src/__tests__/codeTaskWorkerTypes.test.ts
```

Expected: all worker type and capability tests pass before instruction cleanup begins.

- [ ] **Step 4: Record the baseline diff**

Run:

```bash
git diff -- packages/code-task-domain/src/codeTaskWorkerTypes.ts workers/orchestrator/src/services/isolation/types.ts
```

Expected: no production worker-type source change.

- [ ] **Step 5: Commit the worker contract guard**

```bash
git add packages/code-task-domain/src/__tests__/codeTaskWorkerTypes.test.ts
git commit -m "test(workers): freeze supported runtime contract"
```

---

### Task 2: Make `AGENTS.md` canonical and `CLAUDE.md` a pointer

**Files:**

- Create: `scripts/verify-agent-instructions.mjs`
- Create: `scripts/__tests__/verify-agent-instructions.test.ts`
- Modify: `AGENTS.md`
- Modify: `.claude/CLAUDE.md`
- Modify: `package.json`
- Modify: `scripts/ci.mjs`

- [ ] **Step 1: Write a failing verifier test**

Export `validateAgentInstructions(repoRoot)` from `scripts/verify-agent-instructions.mjs`. Test these cases with temporary directories:

```ts
it('accepts canonical AGENTS and pointer-only CLAUDE files', () => {
  expect(validateAgentInstructions(fixtureRoot)).toEqual([]);
});

it('rejects duplicated rules in CLAUDE.md', () => {
  writeFileSync(
    join(fixtureRoot, '.claude/CLAUDE.md'),
    '# CLAUDE.md\n\nRead and follow `../AGENTS.md`.\n\nRun extra checks.\n'
  );
  expect(validateAgentInstructions(fixtureRoot)).toContain(
    '.claude/CLAUDE.md must be the exact compatibility pointer'
  );
});

it('rejects an oversized general instruction file', () => {
  writeFileSync(join(fixtureRoot, 'AGENTS.md'), 'x'.repeat(4097));
  expect(validateAgentInstructions(fixtureRoot)).toContain('AGENTS.md must be at most 4096 bytes');
});
```

- [ ] **Step 2: Run the test and confirm it fails because the verifier does not exist**

```bash
pnpm exec vitest run scripts/__tests__/verify-agent-instructions.test.ts
```

Expected: failure identifying the missing verifier module.

- [ ] **Step 3: Implement the verifier**

The executable must enforce these invariants:

```js
const CLAUDE_POINTER = '# CLAUDE.md\n\nRead and follow `../AGENTS.md`.\n';
const MAX_AGENTS_BYTES = 4096;
```

`validateAgentInstructions(repoRoot)` returns errors when:

- `AGENTS.md` or `.claude/CLAUDE.md` is missing;
- `AGENTS.md` exceeds 4096 bytes;
- `.claude/CLAUDE.md` differs byte-for-byte from `CLAUDE_POINTER`;
- `AGENTS.md` routes general rules back into `.claude/`.

When executed directly, print each error to stderr and exit `1`; otherwise print `Agent instruction contract verified.` and exit `0`.

- [ ] **Step 4: Replace `AGENTS.md` with the compact repository contract**

Use this content as the initial target, adjusting only commands that fail repository verification:

```markdown
# IntexuraOS

## Work safely

- Never commit directly to `development` or `main`; use a `codex/` branch unless the user specifies another branch.
- Do not use Git worktrees in this repository.
- Preserve unrelated user changes and never discard files you did not create.
- Do not mutate Linear issues, external services, deployments, or persistent data unless the user explicitly asks.

## Verify changes

- For a changed workspace, run `pnpm run verify:workspace:tracked <workspace>`.
- Before a commit or pull request, run `pnpm run ci:tracked`.
- Do not weaken tests, coverage thresholds, lint rules, or verification scripts to make a change pass.

## Repository invariants

- Manage persistent infrastructure through Terraform; do not create it directly with cloud CLIs.
- Treat committed migrations as immutable and keep local, dev, and production Firestore data persistent.
- Keep HTTP handlers thin and preserve package boundaries and established error/response contracts.
- Never log secrets, credentials, authorization headers, or raw sensitive payloads.

## Use local context

- Read the nearest `README.md`, package manifest, tests, and implementation before changing a subsystem.
- Follow task-specific skills when their trigger matches; skills add workflow detail but do not override this file.
- When rules and executable behavior disagree, verify the behavior and update the stale rule in the same change.
```

- [ ] **Step 5: Reduce `.claude/CLAUDE.md` to the exact pointer**

```markdown
# CLAUDE.md

Read and follow `../AGENTS.md`.
```

- [ ] **Step 6: Wire the verifier into repository checks**

Add to `package.json`:

```json
"verify:agent-instructions": "node scripts/verify-agent-instructions.mjs"
```

Add to the `Static Validation` commands in `scripts/ci.mjs`:

```js
{ name: 'agent-instructions', script: 'verify-agent-instructions.mjs' },
```

- [ ] **Step 7: Run the focused test and verifier**

```bash
pnpm exec vitest run scripts/__tests__/verify-agent-instructions.test.ts
pnpm run verify:agent-instructions
```

Expected: tests pass and the verifier prints `Agent instruction contract verified.`

- [ ] **Step 8: Commit the canonical instruction contract**

```bash
git add AGENTS.md .claude/CLAUDE.md package.json scripts/ci.mjs scripts/verify-agent-instructions.mjs scripts/__tests__/verify-agent-instructions.test.ts
git commit -m "refactor(agents): make AGENTS canonical"
```

---

### Task 3: Move shared diagnostic executables out of `.claude`

**Files:**

- Create by move: `scripts/agent-tools/fetch-code-task.cjs`
- Create by move: `scripts/agent-tools/fetch-intex-session.cjs`
- Modify: `.codex/skills/debug-code-task/scripts/fetch-task.sh`
- Modify: `.codex/skills/debug-intex-session/scripts/fetch-session.sh`
- Modify: `workers/orchestrator/src/services/prompts/prompt-shared.ts`
- Modify: `workers/orchestrator/src/services/__tests__/system-prompt.test.ts`
- Delete later: `.claude/skills/debug-code-task/**`
- Delete later: `.claude/skills/debug-intex-session/**`

- [ ] **Step 1: Update the prompt test first**

Change the system-prompt expectation to require:

```ts
expect(prompt).toContain('scripts/agent-tools/fetch-code-task.cjs');
expect(prompt).not.toContain('.claude/skills/debug-code-task');
```

- [ ] **Step 2: Run the prompt test and confirm the old path causes failure**

```bash
pnpm exec vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts
```

Expected: the new neutral-path assertion fails.

- [ ] **Step 3: Move the diagnostic scripts without rewriting their behavior**

```bash
mkdir -p scripts/agent-tools
git mv .claude/skills/debug-code-task/scripts/fetch-task.cjs scripts/agent-tools/fetch-code-task.cjs
git mv .claude/skills/debug-intex-session/scripts/fetch-session.cjs scripts/agent-tools/fetch-intex-session.cjs
```

Preserve arguments, production/dev boundaries, authentication, output format, and exit codes.

- [ ] **Step 4: Update both Codex wrapper scripts**

Set the resolved paths to:

```bash
fetch_script="$repo_root/scripts/agent-tools/fetch-code-task.cjs"
```

and:

```bash
fetch_script="$repo_root/scripts/agent-tools/fetch-intex-session.cjs"
```

- [ ] **Step 5: Update the worker prompt to use the neutral executable**

Replace the Claude skill routing with:

```markdown
For production code tasks (`intexuraos.cloud`), run:
`node scripts/agent-tools/fetch-code-task.cjs <taskId> [--logs] [--logs-only]`
```

Keep the existing dev-environment rejection and all other worker instructions unchanged.

- [ ] **Step 6: Run diagnostic unit/syntax checks and prompt tests**

```bash
node --check scripts/agent-tools/fetch-code-task.cjs
node --check scripts/agent-tools/fetch-intex-session.cjs
pnpm exec vitest run workers/orchestrator/src/services/__tests__/system-prompt.test.ts
```

Expected: both scripts parse and prompt tests pass with no `.claude/skills/debug-code-task` reference.

- [ ] **Step 7: Commit the neutral tooling move**

```bash
git add scripts/agent-tools .codex/skills/debug-code-task .codex/skills/debug-intex-session workers/orchestrator/src/services/prompts/prompt-shared.ts workers/orchestrator/src/services/__tests__/system-prompt.test.ts .claude/skills/debug-code-task .claude/skills/debug-intex-session
git commit -m "refactor(workers): move diagnostics to neutral tooling"
```

---

### Task 4: Remove `.claude` dependencies from Codex skills

**Files:**

- Modify: `.codex/skills/commit-push/SKILL.md`
- Modify: `.codex/skills/release/SKILL.md`
- Modify: `.codex/skills/release/reference/subagent-execution.md`
- Modify: `.codex/skills/release/workflows/full-release.md`
- Verify: `.codex/skills/share/SKILL.md`

- [ ] **Step 1: Capture every active Codex-to-Claude dependency**

```bash
rg -n '\.claude/(CLAUDE\.md|skills/|reference/|commands/)' .codex
```

Expected before edits: matches in commit/push, release, and the two diagnostic wrappers.

- [ ] **Step 2: Change general-rule references to `AGENTS.md`**

Use this instruction wherever a Codex skill currently tells the agent to read `.claude/CLAUDE.md`:

```markdown
Read and follow the repository `AGENTS.md` before taking project actions.
```

- [ ] **Step 3: Keep task-specific behavior inside the owning Codex skill**

Remove cross-references to Claude release/share skills. Do not duplicate whole Claude files; retain only steps that the Codex workflow actually executes.

- [ ] **Step 4: Prove Codex skills no longer depend on `.claude`**

```bash
rg -n '\.claude/(CLAUDE\.md|skills/|reference/|commands/)' .codex
```

Expected: no matches.

- [ ] **Step 5: Commit Codex skill independence**

```bash
git add .codex/skills
git commit -m "refactor(codex): remove Claude instruction dependencies"
```

---

### Task 5: Replace lifecycle-hook boilerplate with one portable safety hook

**Files:**

- Create: `.codex/hooks.json`
- Create: `.codex/hooks/pre-tool-policy.sh`
- Create: `.codex/hooks/__tests__/pre-tool-policy.test.ts`
- Modify: `.gitignore`
- Verify: `.claude/hooks/validate-terraform.sh`
- Verify: `.claude/hooks/validate-gcloud-resources.sh`

- [ ] **Step 1: Write failing table-driven hook tests**

Cover exactly these cases:

```ts
const cases = [
  { command: 'terraform apply', allowed: false },
  { command: 'gcloud run deploy api', allowed: false },
  { command: 'gcloud pubsub topics create events', allowed: false },
  { command: 'gcloud run services describe api', allowed: true },
  { command: 'pnpm run ci:tracked', allowed: true },
];
```

The test invokes the hook with JSON on stdin and asserts its exit code and response. It must also assert that no command, prompt, or tool payload is appended to a log file.

- [ ] **Step 2: Run the test and confirm it fails because the new hook is absent**

```bash
pnpm exec vitest run .codex/hooks/__tests__/pre-tool-policy.test.ts
```

- [ ] **Step 3: Implement one hook with only infrastructure mutation guards**

`.codex/hooks/pre-tool-policy.sh` must:

- resolve the repository root at runtime;
- read the tool input from stdin;
- reject direct persistent-resource creation and Terraform apply without the established project guard;
- allow reads, tests, formatting, builds, and normal repository commands;
- write no command history, prompt history, evidence ledger, flag file, or status file;
- contain no absolute user path.

- [ ] **Step 4: Add a tracked, portable `.codex/hooks.json`**

Register only the single pre-tool policy hook. The command must derive the repository root dynamically and must not contain `/Users/`.

- [ ] **Step 5: Stop ignoring the tracked hook contract**

Remove ignore rules for `.codex/hooks.json` and the new `.codex/hooks/` source files. Continue ignoring runtime logs and generated state.

- [ ] **Step 6: Run the hook tests and scan for hardcoded paths/logging**

```bash
pnpm exec vitest run .codex/hooks/__tests__/pre-tool-policy.test.ts
rg -n '/Users/|command-log|prompt-log|hook-state|evidence' .codex/hooks.json .codex/hooks
```

Expected: tests pass; the scan returns no matches.

- [ ] **Step 7: Commit the minimal Codex safety hook**

```bash
git add .codex/hooks.json .codex/hooks .gitignore
git commit -m "refactor(codex): keep one portable safety hook"
```

---

### Task 6: Remove Claude coding-agent boilerplate without removing Claude workers

**Files:**

- Delete: `.claude/settings.json`
- Delete: `.claude/hooks/**`
- Delete: `.claude/agents/**`
- Delete: `.claude/commands/**`
- Delete: `.claude/reference/**`
- Delete: `.claude/skills/coverage/**`
- Delete: `.claude/skills/release/**`
- Delete: `.claude/skills/share/**`
- Delete remaining docs/wrappers under `.claude/skills/debug-code-task/**`
- Delete remaining docs/wrappers under `.claude/skills/debug-intex-session/**`
- Keep: `.claude/CLAUDE.md`
- Keep: `.claude/skills/linear/**`
- Keep: `.claude/skills/nitpick-nuker/**`
- Keep: `.mcp.json`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/worker-image.test.ts`

- [ ] **Step 1: Add explicit non-Codex preservation assertions**

Extend `worker-image.test.ts` to assert that the worker image and entrypoint still stage and execute Claude, Codex, and provider-backed paths. Retain the existing Linear/Error Hub assertions and add:

```ts
expect(entrypoint).toContain('claude');
expect(entrypoint).toContain('codex');
expect(readFileSync(claudeMcpConfigPath, 'utf8')).toContain('linear');
expect(readFileSync(claudeMcpConfigPath, 'utf8')).toContain('error_hub');
expect(existsSync(nitpickNukerSkillPath)).toBe(true);
```

Use stronger existing runtime markers when the file exposes them; do not introduce assertions against comments alone.

- [ ] **Step 2: Run worker and completion-verifier tests before deletion**

```bash
pnpm exec vitest run workers/orchestrator/src/services/isolation/__tests__/worker-image.test.ts
pnpm exec vitest run workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts
```

Expected: the orchestrator already owns completion validation and all worker families pass their current contract tests.

- [ ] **Step 3: Prove the deletion candidates are not active runtime dependencies**

```bash
rg -n '\.claude/(hooks|agents|commands|reference|ci-failures|skills/(coverage|release|share|debug-code-task|debug-intex-session))' \
  --glob '!docs/superpowers/plans/**' \
  --glob '!docs/archive/**' \
  --glob '!.git/**'
```

Resolve every active match by pointing it to `AGENTS.md`, a Codex skill, `scripts/agent-tools/`, or orchestrator-owned validation. Do not delete a path while active runtime code still consumes it.

- [ ] **Step 4: Delete the verified boilerplate**

Remove the files listed in this task while retaining `.claude/CLAUDE.md`, `.claude/skills/linear/**`, `.claude/skills/nitpick-nuker/**`, and `.mcp.json`.

- [ ] **Step 5: Assert the resulting Claude directory boundary**

```bash
find .claude -type f -print | sort
```

Expected: only `.claude/CLAUDE.md` and files under `.claude/skills/linear/` and `.claude/skills/nitpick-nuker/` remain tracked.

- [ ] **Step 6: Re-run non-Codex worker tests after deletion**

```bash
pnpm exec vitest run packages/code-task-domain/src/__tests__/codeTaskWorkerTypes.test.ts
pnpm exec vitest run workers/orchestrator/src/services/isolation/__tests__/worker-image.test.ts
pnpm exec vitest run workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts
```

Expected: exact worker list, Claude MCP contract, provider auth, image bootstrap, and orchestrator completion validation remain green.

- [ ] **Step 7: Inspect production-source diff for accidental worker changes**

```bash
git diff -- packages/code-task-domain/src/codeTaskWorkerTypes.ts workers/orchestrator/src/services/isolation docker/code-worker .mcp.json
```

Expected: only planned tests or neutral path references changed; no worker type, runtime, auth, model, or dispatch behavior changed.

- [ ] **Step 8: Commit the Claude boilerplate cleanup**

```bash
git add .claude .mcp.json workers/orchestrator/src/services/isolation/__tests__/worker-image.test.ts
git commit -m "refactor(agents): remove legacy Claude coding boilerplate"
```

---

### Task 7: Remove generated feedback-loop artifacts and duplicate adapters

**Files:**

- Delete: `.claude/ci-failures/**`
- Delete: `scripts/ci-failure-report.mjs`
- Delete: `.github/workflows/hooks-tests.yml`
- Modify: `scripts/ci-tracked.mjs`
- Modify: `scripts/verify-workspace-tracked.mjs`
- Modify: `package.json`
- Modify: `.github/copilot-instructions.md`

- [ ] **Step 1: Find active consumers of CI-failure persistence**

```bash
rg -n 'ci-failure-report|ci-failures|analyze-ci-failures|hooks-tests' \
  package.json scripts .github --glob '!docs/**'
```

- [ ] **Step 2: Remove history writes while preserving command compatibility**

Keep `pnpm run ci:tracked` and `pnpm run verify:workspace:tracked <workspace>` as supported entry points, but make them execute current verification without appending JSONL history under `.claude/`.

- [ ] **Step 3: Remove the unused analyzer and hook-only workflow**

Delete `scripts/ci-failure-report.mjs`, tracked `.claude/ci-failures/**`, and `.github/workflows/hooks-tests.yml`. Remove their package scripts and imports.

- [ ] **Step 4: Reduce Copilot instructions to a compatibility pointer**

Use:

```markdown
# Copilot instructions

Read and follow `../AGENTS.md`.
```

Do not add Copilot-specific copies of general rules.

- [ ] **Step 5: Verify both compatibility commands without creating instruction-state files**

```bash
pnpm run verify:workspace:tracked @intexuraos/code-task-domain
find .claude -type f -print | sort
```

Expected: workspace verification passes; no `.claude/ci-failures`, hook logs, ledgers, or flags appear.

- [ ] **Step 6: Commit feedback-loop cleanup**

```bash
git add package.json scripts .github .claude
git commit -m "refactor(ci): remove agent feedback artifacts"
```

---

### Task 8: Final reference sweep and full verification

**Files:**

- Verify: all active repository files
- Update only when stale: current operational documentation that references removed paths

- [ ] **Step 1: Verify the canonical instruction contract**

```bash
pnpm run verify:agent-instructions
```

Expected: `Agent instruction contract verified.`

- [ ] **Step 2: Verify there are no active references to removed boilerplate**

```bash
rg -n '\.claude/(hooks|agents|commands|reference|ci-failures|skills/(coverage|release|share|debug-code-task|debug-intex-session))' \
  --glob '!docs/superpowers/plans/**' \
  --glob '!docs/archive/**' \
  --glob '!.git/**'
```

Expected: no active matches.

- [ ] **Step 3: Verify Codex independence and portability**

```bash
rg -n '\.claude/' .codex
rg -n '/Users/' AGENTS.md .claude/CLAUDE.md .codex scripts/agent-tools
```

Expected: no matches.

- [ ] **Step 4: Re-run focused regression suites**

```bash
pnpm exec vitest run \
  packages/code-task-domain/src/__tests__/codeTaskWorkerTypes.test.ts \
  scripts/__tests__/verify-agent-instructions.test.ts \
  .codex/hooks/__tests__/pre-tool-policy.test.ts \
  workers/orchestrator/src/services/__tests__/system-prompt.test.ts \
  workers/orchestrator/src/services/isolation/__tests__/worker-image.test.ts \
  workers/orchestrator/src/services/__tests__/agent-compliance-validator.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run the complete tracked CI pipeline**

```bash
pnpm run ci:tracked
```

Expected: typecheck, lint, static validation, coverage, build, formatting, and post-build checks all pass.

- [ ] **Step 6: Audit the final repository diff**

```bash
git status --short
git diff --stat development...HEAD
git diff development...HEAD -- packages/code-task-domain/src/codeTaskWorkerTypes.ts workers/orchestrator/src/services/isolation/types.ts docker/code-worker .mcp.json
```

Expected:

- the diff contains instruction consolidation, neutral diagnostic paths, one safety hook, tests, and boilerplate deletion;
- the exact worker type set is unchanged;
- non-Codex worker runtime/auth/dispatch behavior is unchanged;
- unrelated user files are absent from the diff.

- [ ] **Step 7: Commit any final reference corrections**

```bash
git add AGENTS.md .claude .codex .github package.json scripts packages/code-task-domain workers/orchestrator docs
git commit -m "docs(agents): finish Codex instruction cleanup"
```

Skip this commit when the working tree is already clean after the prior task commits.

## Acceptance Criteria

- [ ] `AGENTS.md` is the sole general instruction source and is no larger than 4096 bytes.
- [ ] `.claude/CLAUDE.md` is exactly the pointer defined by the verifier.
- [ ] `CODE_TASK_WORKER_TYPES` still equals `auto`, `opus`, `sonnet`, `codex`, `codex-xhigh`, `openrouter-free` in that order.
- [ ] Claude worker types retain Claude auth/runtime behavior; OpenRouter retains API-key/provider behavior; Codex worker types retain Codex auth/runtime behavior.
- [ ] `.claude/skills/linear/**`, `.claude/skills/nitpick-nuker/**`, and `.mcp.json` remain available to non-Codex workers.
- [ ] Codex skills contain no dependency on `.claude` instruction or skill paths.
- [ ] Shared diagnostic executables live under `scripts/agent-tools/`.
- [ ] Only one project-local Codex hook remains, it protects infrastructure mutations, is portable, and records no commands or prompts.
- [ ] No tracked hook logs, evidence ledgers, flags, CI-failure histories, or absolute user paths remain.
- [ ] Historical plan documents are left intact; active paths and operational documentation are clean.
- [ ] Focused worker, prompt, hook, and instruction tests pass.
- [ ] `pnpm run ci:tracked` passes without recreating deleted agent-state artifacts.
