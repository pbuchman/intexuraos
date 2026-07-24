# Intex Agent Matrix Corpus Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the canonical production Matrix corpus to run with MiniMax M3 as the
Intex Agent model without changing its scenarios, transport, strict tool mocks, or
MiniMax evaluator.

**Architecture:** A two-value Matrix corpus agent-model contract is selected once by the
CLI, included in the catalog digest, persisted through run/session state, and passed to
the production LLM client factory. DeepSeek remains the absent-value default. Reports
and Test Runs expose the immutable selected model.

**Tech Stack:** TypeScript, Zod, Fastify, Firestore, OpenRouter, Vitest, Bash, React.

## Global Constraints

- Supported agent models are exactly `or:deepseek/deepseek-v4-flash` and
  `or:minimax/minimax-m3`.
- The evaluator is always `or:minimax/minimax-m3`.
- The canonical corpus remains exactly 20 scenarios and 59 turns.
- All tools remain strict mocks and production executor admissions remain zero.
- Unsupported selectors fail before external effects.
- Existing no-selector commands remain DeepSeek-compatible.

---

### Task 1: Agent-model contract and CLI selection

**Files:**
- Modify: `tools/intex-agent-evals/src/matrixCorpus/types.ts`
- Modify: `tools/intex-agent-evals/src/matrixCorpus/catalog.ts`
- Modify: `tools/intex-agent-evals/src/cli.ts`
- Modify: `scripts/run-intex-agent-evals-home-dev.sh`
- Modify: `scripts/run-intex-agent-evals-prod.sh`
- Test: `tools/intex-agent-evals/src/__tests__/cli.test.ts`
- Test: `tools/intex-agent-evals/src/__tests__/matrixCorpusCatalog.test.ts`
- Test: `scripts/__tests__/run-intex-agent-evals-home-dev.test.ts`

**Interfaces:**
- Consumes: optional CLI selector `--agent-model=<supported-model>`.
- Produces: `loadCanonicalMatrixCorpus(directory, agentModel)` with an immutable
  `MatrixCorpusAgentModel`.

- [ ] Write tests proving the default remains DeepSeek, explicit MiniMax changes the
      catalog and digest, and unsupported selectors fail before preflight.
- [ ] Run the focused tests and verify they fail because MiniMax selection is absent.
- [ ] Add the shared supported-model parser and thread the selected model into catalog
      construction.
- [ ] Extend both wrappers without accepting unrelated additional arguments.
- [ ] Run the focused tests and verify they pass.

### Task 2: Persist and execute the selected production model

**Files:**
- Modify: `apps/intex-agent/src/domain/sessions/types.ts`
- Modify: `apps/intex-agent/src/domain/matrixCorpus/ports/matrixCorpusContextRepository.ts`
- Modify: `apps/intex-agent/src/domain/matrixCorpus/contextService.ts`
- Modify: `apps/intex-agent/src/domain/matrixCorpus/matrixCorpusExecutionService.ts`
- Modify: `apps/intex-agent/src/infra/firestore/sessionRepository.ts`
- Modify: `apps/intex-agent/src/infra/firestore/matrixCorpusContextRepository.ts`
- Modify: `apps/intex-agent/src/services.ts`
- Test: corresponding domain, repository, route, service, and integration tests under
  `apps/intex-agent/src/__tests__/`.

**Interfaces:**
- Consumes: immutable model in run registration and session profile.
- Produces: runner factory input `agentModel`, used as
  `IntexAgentRuntimeSnapshot.effectiveModel` and `explicitModel`.

- [ ] Add failing tests for MiniMax context registration, persistence round trips,
      session validation, and client-factory model binding.
- [ ] Run the focused tests and verify the DeepSeek literal rejects MiniMax.
- [ ] Broaden only Matrix corpus model fields to the supported union.
- [ ] Pass the session model into `createRunner` and bind production model clients to it.
- [ ] Run the focused tests and verify both supported models pass while unsupported
      models remain rejected.

### Task 3: Protected routes, reports, and Test Runs UI

**Files:**
- Modify: `apps/intex-agent/src/routes/matrixCorpusRoutes.ts`
- Modify: `apps/intex-agent/src/domain/testRuns/types.ts`
- Modify: `tools/intex-agent-evals/src/endpointClient.ts`
- Modify: `tools/intex-agent-evals/src/matrixCorpus/reportSchema.ts`
- Modify: `packages/http-contracts/src/intexAgentTestRuns.ts`
- Modify: `apps/web/src/types/intexAgentTestRuns.ts`
- Modify: `apps/web/src/services/intexAgentTestRunsDecoder.ts`
- Test: focused route, report, HTTP-contract, decoder, and presentation tests.

**Interfaces:**
- Consumes: the two-value agent-model union.
- Produces: safe retained run and report records that preserve the selected agent model.

- [ ] Add failing MiniMax fixtures to route, decoder, report, and UI presentation tests.
- [ ] Run the focused tests and verify schema rejection.
- [ ] Replace DeepSeek-only literals with the supported union without widening evaluator
      fields.
- [ ] Run focused tests and verify MiniMax displays as `MiniMax M3`.

### Task 4: Verification, release, and live acceptance

**Files:**
- Modify: `docs/testing/intex-agent-evals.md`
- Verify: all files changed by Tasks 1–3.

**Interfaces:**
- Consumes: production wrapper model selector.
- Produces: retained production Test Run and ready JSON/Markdown report.

- [ ] Document the exact MiniMax invocation.
- [ ] Run focused workspace verification for changed packages and apps.
- [ ] Run `pnpm run ci:tracked` once at the commit gate.
- [ ] Commit, push, open a PR targeting `development`, wait for GitHub CI, merge, and
      verify the exact deployed SHA on Hetzner.
- [ ] Run
      `scripts/run-intex-agent-evals-prod.sh matrix-corpus --agent-model=or:minimax/minimax-m3`.
- [ ] Verify 20/20 scenarios, 59/59 turns, 17/17 confirmations, 19/19 strict mock
      completions, zero production executor resolutions/admissions, and MiniMax M3 in
      both the agent and evaluator report fields.
