# 3-2: Synthesis Config

**Tier:** 3 - LLM Orchestrator Domain
**Status:** Pending

## Context

Create synthesis prompt configuration file.

## Problem Statement

The synthesis prompt needs to be stored in a separate config file within the domain.

## Scope

**In Scope:**
- Create synthesis prompt configuration
- Define input format markers
- Define expected output structure

**Out of Scope:**
- Actual synthesis implementation (3-3)

## Required Approach

1. Store full prompt as exported constant
2. Define helper to format input with markers
3. Keep in domain config directory

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/domain/research/config/synthesisPrompt.ts`
- [ ] Define `SYNTHESIS_PROMPT` constant with full prompt text
- [ ] Create `formatSynthesisInput(prompt: string, reports: LlmResult[])` helper
- [ ] Use markers: `===ORIGINAL_PROMPT_START===`, `===REPORT_START model: X===`
- [ ] Export from domain index

## Definition of Done

- [ ] Prompt stored in config file
- [ ] Input formatter works correctly
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete config file.
