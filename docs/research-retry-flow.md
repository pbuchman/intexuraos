# Research Retry Flow - Detailed Specification

## Problem

Gdy research ma status `failed`, brak jest przycisku "Retry" który umożliwiłby inteligentne ponowienie próby.

## Current State vs Desired State

### Current Behavior
```
Research (status: failed)
└── No retry option available
└── User must create new research from scratch
```

### Desired Behavior
```
Research (status: failed)
└── [Retry Button] → Intelligent retry based on failure analysis
    ├── Check individual LLM results
    ├── Retry only failed LLM calls
    ├── Re-run synthesis if needed
    └── Complete research successfully
```

---

## Retry Flow Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│                  USER CLICKS "RETRY" BUTTON                     │
│                     (status: failed)                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │   Analyze Research State     │
              │  (retryResearch use case)    │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  Check Individual LLM Results│
              └──────────────┬───────────────┘
                             │
           ┌─────────────────┴─────────────────┐
           │                                   │
           ▼                                   ▼
    ┌──────────────┐                   ┌──────────────┐
    │  All LLMs    │                   │  Some LLMs   │
    │  succeeded   │                   │  failed      │
    └──────┬───────┘                   └──────┬───────┘
           │                                   │
           │                                   ▼
           │                          ┌─────────────────┐
           │                          │ Retry Failed    │
           │                          │ LLM Calls       │
           │                          │ (publish events)│
           │                          └────────┬────────┘
           │                                   │
           │                                   ▼
           │                          ┌─────────────────┐
           │                          │ Wait for        │
           │                          │ Completion      │
           │                          │ (checkLlmComp.) │
           │                          └────────┬────────┘
           │                                   │
           └───────────────┬───────────────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │   Check Synthesis Status     │
            └──────────────┬───────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
         ▼                                   ▼
  ┌─────────────┐                   ┌──────────────────┐
  │ Synthesis   │                   │ Synthesis exists │
  │ not run or  │                   │ and is valid     │
  │ failed      │                   │                  │
  └──────┬──────┘                   └────────┬─────────┘
         │                                   │
         ▼                                   ▼
  ┌──────────────┐                   ┌──────────────────┐
  │ Run Synthesis│                   │  Complete        │
  │ (runSynthesis│                   │  Research        │
  │  use case)   │                   │  (skip synthesis)│
  └──────┬───────┘                   └────────┬─────────┘
         │                                   │
         └───────────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   STATUS: COMPLETED  │
              └──────────────────────┘
```

---

## Detailed Decision Logic

### Step 1: Analyze Individual LLM Results

```typescript
interface RetryAnalysis {
  failedLlms: LlmProvider[];
  successfulLlms: LlmProvider[];
  hasValidSynthesis: boolean;
  synthesisStatus: 'not_run' | 'failed' | 'completed' | 'skipped';
}

function analyzeResearchForRetry(research: Research): RetryAnalysis {
  const failedLlms: LlmProvider[] = [];
  const successfulLlms: LlmProvider[] = [];

  for (const llmResult of research.llmResults) {
    if (llmResult.status === 'failed') {
      failedLlms.push(llmResult.provider);
    } else if (llmResult.status === 'completed') {
      successfulLlms.push(llmResult.provider);
    }
  }

  let synthesisStatus: 'not_run' | 'failed' | 'completed' | 'skipped';
  if (research.skipSynthesis === true) {
    synthesisStatus = 'skipped';
  } else if (research.synthesizedResult !== undefined) {
    synthesisStatus = 'completed';
  } else if (research.synthesisError !== undefined) {
    synthesisStatus = 'failed';
  } else {
    synthesisStatus = 'not_run';
  }

  const hasValidSynthesis = synthesisStatus === 'completed';

  return {
    failedLlms,
    successfulLlms,
    hasValidSynthesis,
    synthesisStatus,
  };
}
```

### Step 2: Retry Decision Matrix

| Scenario | Failed LLMs | Successful LLMs | Synthesis | Action |
|----------|-------------|-----------------|-----------|---------|
| A | > 0 | ≥ 0 | any | Retry failed LLMs → wait → proceed to Step 3 |
| B | 0 | > 0 | not_run | Run synthesis |
| C | 0 | > 0 | failed | Run synthesis |
| D | 0 | > 0 | completed | Mark as completed (already done) |
| E | 0 | 0 | any | Cannot retry (no successful results) |

### Step 3: Synthesis Decision (after LLM retry)

This step only runs if:
- All LLM calls completed (no pending/processing)
- At least one successful result exists

| Synthesis Status | Any Result Changed? | Action |
|------------------|---------------------|---------|
| not_run | N/A | Run synthesis |
| failed | N/A | Run synthesis |
| completed | Yes (new LLM results) | Re-run synthesis |
| completed | No (same results) | Keep existing synthesis, mark completed |
| skipped | N/A | Skip synthesis, mark completed |

**Result Changed Definition:**
- A previously failed LLM now has a successful result
- A previously successful LLM was retried and has new result (edge case, shouldn't happen)

---

## Implementation Details

### New Use Case: `retryResearch.ts`

```typescript
export async function retryResearch(
  researchId: string,
  deps: RetryResearchDeps
): Promise<RetryResult> {
  // 1. Load research
  const research = await deps.researchRepo.findById(researchId);

  // 2. Validate status
  if (research.status !== 'failed') {
    return { ok: false, error: 'Can only retry failed research' };
  }

  // 3. Analyze state
  const analysis = analyzeResearchForRetry(research);

  // 4. If there are failed LLMs, retry them
  if (analysis.failedLlms.length > 0) {
    // Mark as retrying
    await deps.researchRepo.update(researchId, {
      status: 'retrying',
    });

    // Reset failed LLM results to pending
    for (const provider of analysis.failedLlms) {
      await deps.researchRepo.updateLlmResult(researchId, provider, {
        status: 'pending',
        error: undefined,
      });
    }

    // Publish retry events
    for (const provider of analysis.failedLlms) {
      await deps.llmCallPublisher.publishLlmCall({
        type: 'llm.call',
        researchId,
        userId: research.userId,
        provider,
        prompt: research.prompt,
      });
    }

    return { ok: true, action: 'retrying_llms', retriedProviders: analysis.failedLlms };
  }

  // 5. If no failed LLMs, check synthesis
  if (analysis.successfulLlms.length === 0) {
    return { ok: false, error: 'No successful LLM results to work with' };
  }

  // 6. Run synthesis if needed
  if (analysis.synthesisStatus === 'not_run' || analysis.synthesisStatus === 'failed') {
    const synthesisResult = await deps.runSynthesis(researchId);
    if (synthesisResult.ok) {
      return { ok: true, action: 'synthesis_completed' };
    } else {
      return { ok: false, error: synthesisResult.error };
    }
  }

  // 7. Already completed
  await deps.researchRepo.update(researchId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  return { ok: true, action: 'already_completed' };
}
```

### Modified: `checkLlmCompletion.ts`

After each LLM completion, check if research was in 'retrying' status:

```typescript
// ... existing code ...

// If all completed/failed, decide next step
if (allDone) {
  const failedCount = research.llmResults.filter(r => r.status === 'failed').length;

  // Check if we're in retry mode
  const wasRetrying = research.status === 'retrying';

  if (failedCount === 0) {
    // All succeeded → run synthesis
    await runSynthesis(researchId, deps);
  } else if (wasRetrying) {
    // Retry mode and still have failures → mark as failed
    await researchRepo.update(researchId, {
      status: 'failed',
      synthesisError: `${failedCount} LLM(s) still failed after retry`,
      completedAt: new Date().toISOString(),
    });
  } else {
    // First run with failures → awaiting_confirmation (existing behavior)
    await researchRepo.update(researchId, {
      status: 'awaiting_confirmation',
      partialFailure: { ... },
    });
  }
}
```

### Modified: `runSynthesis.ts`

Add logic to detect if synthesis should be re-run:

```typescript
export async function runSynthesis(
  researchId: string,
  deps: RunSynthesisDeps,
  forceRerun = false
): Promise<{ ok: boolean; error?: string }> {
  // ... existing code ...

  // Check if synthesis already exists and is valid
  if (!forceRerun && research.synthesizedResult !== undefined) {
    // Check if any LLM results changed since last synthesis
    const hasNewResults = research.llmResults.some(r => {
      // If completedAt is after the last synthesis run
      return r.completedAt !== undefined && /* compare timestamps */;
    });

    if (!hasNewResults) {
      // Synthesis is still valid, no need to re-run
      return { ok: true };
    }
  }

  // ... rest of synthesis logic ...
}
```

---

## API Changes

### New Endpoint: POST `/research/:id/retry`

**Request:**
```typescript
POST /research/:id/retry
Authorization: Bearer <token>
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "action": "retrying_llms",
    "retriedProviders": ["google", "openai"],
    "message": "Retrying 2 failed LLM providers"
  }
}
```

**Response (Synthesis):**
```json
{
  "success": true,
  "data": {
    "action": "synthesis_completed",
    "message": "Synthesis completed successfully"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATUS",
    "message": "Can only retry failed research"
  }
}
```

---

## Frontend Changes

### Research Detail View

When `research.status === 'failed'`, show retry button:

```tsx
{research.status === 'failed' && (
  <button
    onClick={() => retryResearch(research.id)}
    className="btn-primary"
  >
    🔄 Retry Research
  </button>
)}
```

### Retry Handler

```typescript
async function retryResearch(researchId: string) {
  try {
    setRetrying(true);
    const response = await apiClient.post(`/research/${researchId}/retry`);

    if (response.data.success) {
      // Show success message
      toast.success(response.data.data.message);

      // Refresh research data
      await refetchResearch();
    }
  } catch (error) {
    toast.error('Failed to retry research');
  } finally {
    setRetrying(false);
  }
}
```

---

## Edge Cases

### 1. Concurrent Retries
**Scenario:** User clicks retry multiple times
**Solution:** Add optimistic locking or status check before retry

### 2. Partial Success During Retry
**Scenario:** Retry 2 LLMs, only 1 succeeds
**Solution:** Still run synthesis with available results (existing behavior)

### 3. Max Retries Exceeded
**Scenario:** User retries multiple times
**Solution:** Track retry count, max 3 total retries per research

### 4. Synthesis Fails During Retry
**Scenario:** LLMs succeed on retry, but synthesis fails
**Solution:** Mark as failed, allow retry again (synthesis will be retried)

### 5. No Results to Retry
**Scenario:** All LLMs failed, no external reports
**Solution:** Return error "Cannot retry - no successful results available"

---

## Testing Strategy

### Unit Tests

1. `retryResearch.ts`
   - ✅ Retries failed LLMs only
   - ✅ Runs synthesis if LLMs succeeded but synthesis failed
   - ✅ Returns error for invalid status
   - ✅ Returns error for no successful results
   - ✅ Handles max retry limit

2. `checkLlmCompletion.ts`
   - ✅ Detects retry mode and handles failures accordingly
   - ✅ Runs synthesis after successful retry

### Integration Tests

1. Full retry flow with failed LLM
2. Full retry flow with failed synthesis
3. Multiple retry attempts
4. Retry with partial success

---

## Migration Notes

No database migration needed - all fields already exist in Research model.

---

## Summary

**Key Changes:**
1. ✅ New use case: `retryResearch.ts`
2. ✅ Modified: `checkLlmCompletion.ts` (handle retry mode)
3. ✅ Modified: `runSynthesis.ts` (detect changed results)
4. ✅ New endpoint: `POST /research/:id/retry`
5. ✅ Frontend: Add retry button for failed research

**Benefits:**
- Users can recover from transient failures without starting over
- Intelligent retry only re-runs what failed
- Synthesis is only re-run when results change
- Preserves successful LLM results
