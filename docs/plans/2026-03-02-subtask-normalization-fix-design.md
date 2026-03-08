# Subtask Normalization Fix — Thread URLs Through Pipeline

**Date:** 2026-03-02
**Linear Issue:** INT-681 (investigation origin)
**Status:** Design approved

## Problem

When the planning agent creates subtasks via Linear MCP, the `enforcePlanningOutcome` function in code-agent fails to normalize them (set state to Todo, add `code-task` label). Root cause: subtask discovery relies on `fetchIssueTree` which reads from the linear-agent's local Firestore sync, but Linear webhooks for newly-created subtasks haven't been processed yet.

The subtask URLs ARE available in the planning agent's `PLANNING_AGENT_FINAL` output, but the Gemini completion verifier drops them because `subtask_urls` is not in the Zod extraction schema.

## Solution

Thread `subtask_urls` through the existing pipeline: verifier schema → orchestrator result builder → webhook payload → enforcement code. Replace `fetchIssueTree` with direct resolution via `validateIssue` (which queries Linear API, not local sync).

## Changes by Service

### 1. Orchestrator — completion-verifier.ts

- Add `subtask_urls: z.string()` to `PLANNING_SCHEMA`
- Add `subtask_urls: string` to `PlanningAgentData` interface
- Add extraction instruction to `buildPlanningPrompt()` fields list
- Update example JSON in prompt to include `subtask_urls`

### 2. Orchestrator — task-dispatcher.ts

- Thread `agentData.subtask_urls` → `base.planning_subtask_urls` in `buildResultFromVerification`

### 3. Code-agent — webhookRoutes.ts

- Add `planning_subtask_urls?: string` to webhook body type and JSON schema
- Add `planning_subtask_urls` to `codeTask.ts` result type
- Rewrite the `isComplex` branch in `enforcePlanningOutcome`:
  - Parse subtask URLs using existing `parseLinearIdentifierFromUrl`
  - For each identifier, call `validateIssue` (hits Linear API directly)
  - Validate `parentId === originalIssueUuid`
  - Normalize state → todo, remove planned/unclear labels
  - Stamp `code-task` label
  - Fall back to `fetchIssueTree` if URLs empty but `isComplex === '1'`

### 4. Tests

- Update orchestrator completion-verifier tests for new schema field
- Update orchestrator task-dispatcher tests for new result field
- Update code-agent webhook tests for URL-based normalization path
- Add test for fallback to fetchIssueTree when URLs empty

## What Stays the Same

- Planning agent system prompt (already outputs `Subtask URLs`)
- Linear-agent service (no changes)
- `fetchIssueTree` endpoint (kept as fallback)

## What This Eliminates

| Before                                     | After                                        |
| ------------------------------------------ | -------------------------------------------- |
| Subtask discovery via local Firestore sync | Direct resolution via Linear API             |
| Race condition with webhook delivery       | No timing dependency                         |
| Silent success on empty descendants        | Empty URLs + isComplex=1 = logged warning    |
