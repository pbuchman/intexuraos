# 3-0: Create Attribution Repair Helper

**Tier:** 3 (Dependent Deliverable)

## Context Snapshot

Create a helper function that attempts to repair invalid attributions using a single LLM call.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- Usecases accept `logger: Logger` as dependency
- Return Result types for operations that can fail
- No domain logic in infra

## Dependencies

- **Requires:** Tier 1 complete (attribution module)
- **Requires:** Tier 2 complete (prompt changes)

## Problem Statement

When synthesis output has missing or malformed Attribution lines, attempt a single repair pass using GeminiAdapter. The repair prompt is constrained: only fix Attribution lines, don't change other content.

## Files to Create

| File | Action |
|------|--------|
| `apps/llm-orchestrator/src/domain/research/usecases/repairAttribution.ts` | **CREATE** |

## Files to Read First

1. `apps/llm-orchestrator/src/domain/research/usecases/runSynthesis.ts` — understand synthesizer interface
2. `apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts` — understand how to call synthesizer
3. `packages/common-core/src/prompts/attribution.ts` — types and validation
4. `packages/common-core/src/result.ts` — Result type pattern

## Required Implementation

```typescript
import type { Result } from '@intexuraos/common-core';
import type { SourceMapItem } from '@intexuraos/common-core';

export interface RepairAttributionDeps {
  synthesizer: {
    synthesize: (
      prompt: string,
      reports: Array<{ model: string; content: string }>,
      additionalSources?: Array<{ content: string; label?: string }>,
    ) => Promise<Result<{ content: string; usage?: unknown }, Error>>;
  };
  logger?: { info: (msg: string) => void; error: (obj: object, msg: string) => void };
}

export async function repairAttribution(
  rawContent: string,
  sourceMap: ReadonlyArray<SourceMapItem>,
  deps: RepairAttributionDeps
): Promise<Result<string, Error>> {
  // Implementation here
}
```

## Repair Prompt Template

```typescript
const repairPrompt = `The following synthesis output is missing or has malformed Attribution lines.

ALLOWED SOURCE IDs: ${sourceMap.map((s) => s.id).join(', ')}

REQUIRED FORMAT (exactly, at end of each ## section):
Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false

RULES:
1. Add or fix Attribution lines ONLY at the end of each ## section
2. DO NOT change any other content (text, links, formatting)
3. If uncertain about attribution for a section, set UNK=true
4. Use ONLY the allowed source IDs listed above

SYNTHESIS TO REPAIR:
${rawContent}

OUTPUT the repaired synthesis with correct Attribution lines:`;
```

## Algorithm

1. Build repair prompt with allowed IDs and raw content
2. Call synthesizer with empty reports (prompt is the content)
3. If success, validate the repaired output
4. If repaired output is valid, return it
5. If still invalid, return error

## Edge Cases

- Synthesizer call fails → return error
- Repaired output still invalid → return error (don't retry)
- Empty source map → return error

## Step Checklist

- [ ] Create repairAttribution.ts file
- [ ] Define RepairAttributionDeps interface
- [ ] Implement repairAttribution function
- [ ] Build repair prompt template
- [ ] Call synthesizer
- [ ] Validate repaired output
- [ ] Return appropriate Result
- [ ] Add logging
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Function created and exported
- Uses synthesizer for repair call
- Validates output after repair
- Returns Result type
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

```bash
rm apps/llm-orchestrator/src/domain/research/usecases/repairAttribution.ts
```

## Non-Negotiable Quality Bar

- Single repair attempt only (no retries)
- Must validate repaired output
- Must use Result type for error handling
- Logger must be passed as dependency
- Repair prompt must be constrained (no content changes)
