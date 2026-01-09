# 3-1: Add Post-Processing to runSynthesis

**Tier:** 3 (Dependent Deliverable)

## Context Snapshot

Integrate attribution validation, repair, and breakdown generation into the central synthesis orchestrator.

## Codebase Rules

Read `.claude/CLAUDE.md`:

- Logger passed as dependency
- Use `getServices()` pattern in routes
- Domain usecases have no infra imports

## Dependencies

- **Requires:** 3-0-repair-usecase.md completed
- **Requires:** Tier 1 and 2 complete

## Problem Statement

After synthesis completes, add post-processing:

1. Build source map from reports and additionalSources
2. Validate attributions
3. If invalid, attempt single repair
4. Generate breakdown and append to content
5. Track attribution status for Firestore update

## Files to Modify

| File                                                                 | Action     |
| -------------------------------------------------------------------- | ---------- |
| `apps/llm-orchestrator/src/domain/research/usecases/runSynthesis.ts` | **MODIFY** |

## Files to Read First

1. `apps/llm-orchestrator/src/domain/research/usecases/runSynthesis.ts` — lines 163-267
2. `apps/llm-orchestrator/src/domain/research/usecases/repairAttribution.ts` — repair function
3. `packages/common-core/src/prompts/attribution.ts` — all attribution functions

## Exact Changes

### Add Imports (top of file)

```typescript
import {
  buildSourceMap,
  validateSynthesisAttributions,
  parseSections,
  generateBreakdown,
} from '@intexuraos/common-core';
import { repairAttribution } from './repairAttribution.js';
```

### Add to RunSynthesisDeps Interface

```typescript
export interface RunSynthesisDeps {
  // ... existing deps ...
  // No new deps needed - synthesizer is already there
}
```

### Insert After Line 164 (after `const synthesisUsage = ...`)

```typescript
// [4.3.3] Post-process synthesis for attribution
logger?.info('[4.3.3] Starting attribution post-processing');

const sourceMap = buildSourceMap(reports, additionalSources);
let processedContent = synthesisContent;
let attributionStatus: 'complete' | 'incomplete' | 'repaired' = 'incomplete';

const validation = validateSynthesisAttributions(synthesisContent, sourceMap);

if (validation.valid) {
  attributionStatus = 'complete';
  logger?.info('[4.3.3a] Attribution validation passed');
} else {
  logger?.info(`[4.3.3b] Attribution validation failed: ${validation.errors.join(', ')}`);

  // Attempt single repair
  const repairResult = await repairAttribution(synthesisContent, sourceMap, {
    synthesizer,
    logger,
  });

  if (repairResult.ok) {
    const revalidation = validateSynthesisAttributions(repairResult.value, sourceMap);
    if (revalidation.valid) {
      processedContent = repairResult.value;
      attributionStatus = 'repaired';
      logger?.info('[4.3.3c] Attribution repair succeeded');
    } else {
      logger?.info('[4.3.3c] Attribution repair did not fix all issues');
    }
  } else {
    logger?.info('[4.3.3c] Attribution repair failed');
  }
}

// Generate and append breakdown (even if incomplete - show what's derivable)
const sections = parseSections(processedContent);
const breakdown = generateBreakdown(sections, sourceMap);
processedContent = `${processedContent}\n\n${breakdown}`;

logger?.info(`[4.3.4] Attribution status: ${attributionStatus}`);
```

### Update Line ~260 (synthesizedResult)

**Before:**

```typescript
synthesizedResult: synthesisContent,
```

**After:**

```typescript
synthesizedResult: processedContent,
```

### Add attributionStatus to Update (line ~258-267)

Add to the update object:

```typescript
await researchRepo.update(researchId, {
  // ... existing fields ...
  attributionStatus,
});
```

## Step Checklist

- [ ] Add imports for attribution functions
- [ ] Add import for repairAttribution
- [ ] Insert post-processing block after line 164
- [ ] Update synthesizedResult to use processedContent
- [ ] Add attributionStatus to update object
- [ ] Add logging for each step
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Post-processing integrated into runSynthesis
- Validation → repair → breakdown flow works
- attributionStatus tracked
- Logging added for debugging
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Revert changes to runSynthesis.ts (remove imports and post-processing block).

## Non-Negotiable Quality Bar

- Breakdown MUST be appended even if attribution incomplete
- attributionStatus MUST be saved to database
- Single repair attempt only
- Logging at each step for debugging
- processedContent used for all downstream operations (cover image, HTML)
