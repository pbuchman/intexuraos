# Research Flow - Complete Lifecycle

## Status State Machine

```
                                    ┌─────────────┐
                                    │   draft     │
                                    └──────┬──────┘
                                           │ POST /research (start)
                                           ▼
                                    ┌─────────────┐
                              ┌─────│ processing  │─────┐
                              │     └─────────────┘     │
                              │                         │
                   all LLMs   │                         │  some LLMs
                   complete   │                         │  failed
                              ▼                         ▼
                       ┌─────────────┐          ┌───────────────────┐
                       │synthesizing │          │awaiting_confirmation│
                       └──────┬──────┘          └─────────┬─────────┘
                              │                           │
              ┌───────────────┼───────────────┐           │
              │               │               │           │
         success         skip synth      failure    ┌─────┴─────┐
              │               │               │     │     │     │
              ▼               ▼               ▼     ▼     ▼     ▼
        ┌──────────┐   ┌──────────┐    ┌────────┐ proceed retry cancel
        │completed │   │completed │    │ failed │   │     │     │
        │(w/synth) │   │(no synth)│    └────┬───┘   │     │     │
        └──────────┘   └──────────┘         │       │     │     ▼
                                            │       │     │  ┌────────┐
                                            │       │     │  │ failed │
                                            │       │     │  └────────┘
                                            │       │     ▼
                                            │       │  ┌──────────┐
                                            │       │  │ retrying │──┐
                                            │       │  └──────────┘  │
                                            │       │       ▲        │
                                            │       │       └────────┘
                                            │       │      (back to LLM
                                            │       │       processing)
                                            │       ▼
                                            │  ┌─────────────┐
                                            │  │synthesizing │
                                            │  └──────┬──────┘
                                            │         │
                                            └─────────┴──► completed/failed
```

---

## Phase 1: Research Creation

### Draft Creation

```
User fills form → POST /research/draft → status: draft
```

| Field | Source |
|-------|--------|
| `title` | Auto-generated from prompt (Gemini) or fallback |
| `prompt` | User input |
| `selectedLlms` | User selection (default: all available) |
| `synthesisLlm` | User selection (default: google) |
| `externalReports` | Optional user-provided context |
| `status` | `draft` |

### Start Research

```
User clicks Start → POST /research → status: processing
```

**Validation:**
- At least 1 LLM selected
- User has API keys for selected LLMs

**Actions:**
1. Update status to `processing`
2. Set `startedAt` timestamp
3. Initialize `llmResults` array with `pending` status for each provider
4. Publish `llm.call` event for each selected LLM

---

## Phase 2: LLM Execution

### Pub/Sub Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ llm.call    │────▶│ process-llm │────▶│ LLM API     │
│ event       │     │ -call       │     │ (Google/    │
│             │     │ endpoint    │     │ OpenAI/etc) │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │ Update      │
                                        │ llmResult   │
                                        │ in Firestore│
                                        └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │ checkLlm    │
                                        │ Completion  │
                                        └─────────────┘
```

### LLM Result States

| Status | Meaning |
|--------|---------|
| `pending` | Waiting to be processed |
| `processing` | Currently calling LLM API |
| `completed` | Success, result stored |
| `failed` | Error occurred |

---

## Phase 3: Completion Detection

### checkLlmCompletion Logic

```typescript
// Called after each LLM result is stored
function checkLlmCompletion(researchId): CompletionAction {
  const pending = results.filter(r => r.status === 'pending' || r.status === 'processing');
  const completed = results.filter(r => r.status === 'completed');
  const failed = results.filter(r => r.status === 'failed');

  if (pending.length > 0) return { type: 'pending' };
  if (completed.length === 0) return { type: 'all_failed' };
  if (failed.length === 0) return { type: 'all_completed' };
  return { type: 'partial_failure', failedProviders };
}
```

### Decision Matrix

| Completed | Failed | Pending | Action |
|-----------|--------|---------|--------|
| 0 | > 0 | 0 | Mark `failed`, error: "All LLM calls failed" |
| > 0 | 0 | 0 | Run synthesis (or skip) |
| > 0 | > 0 | 0 | Set `awaiting_confirmation` |
| any | any | > 0 | Wait (no action) |

---

## Phase 4: Synthesis

### Synthesis Skip Logic

```typescript
const successfulResults = llmResults.filter(r => r.status === 'completed');
const externalReportsCount = externalReports?.length ?? 0;

const shouldSkipSynthesis = successfulResults.length <= 1 && externalReportsCount === 0;
```

| Successful LLMs | External Reports | Action |
|-----------------|------------------|--------|
| 0 | 0 | Error: "No successful LLM results" |
| 0 | > 0 | Run synthesis (external only) |
| 1 | 0 | Skip synthesis, mark completed |
| 1 | > 0 | Run synthesis |
| > 1 | any | Run synthesis |

### Synthesis Flow

```
┌─────────────────┐
│ runSynthesis    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Skip synthesis? │─YES─▶│ Mark completed  │
│                 │      │ (no synthesized │
└────────┬────────┘      │  Result)        │
         │ NO            └─────────────────┘
         ▼
┌─────────────────┐
│ Build prompt    │
│ with source     │
│ attribution     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Call synthesis  │
│ LLM             │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
 success   failure
    │         │
    ▼         ▼
┌────────┐ ┌────────┐
│complete│ │ failed │
│+ synth │ │+ error │
└────────┘ └────────┘
```

### Post-Synthesis Actions

1. Generate shareable HTML (if share storage configured)
2. Upload to GCS
3. Store `shareInfo` in research
4. Send notification (WhatsApp/push) with share URL

---

## Phase 5: Partial Failure Handling

### awaiting_confirmation State

```
Research has:
- status: 'awaiting_confirmation'
- partialFailure: {
    failedProviders: ['openai', 'anthropic'],
    detectedAt: '2024-01-01T10:00:00Z',
    retryCount: 0
  }
```

### User Actions (POST /research/:id/confirm)

| Action | Effect |
|--------|--------|
| `proceed` | Run synthesis with successful results only |
| `retry` | Re-run failed LLMs (max 2 retries) |
| `cancel` | Mark as `failed` with "Cancelled by user" |

### Retry Flow (from awaiting_confirmation)

```
┌─────────────────────┐
│ User clicks Retry   │
│ (awaiting_confirm.) │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ retryCount < 2?     │
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     │ YES       │ NO
     ▼           ▼
┌──────────┐  ┌──────────┐
│ Reset    │  │ Mark     │
│ failed   │  │ failed   │
│ LLMs to  │  │ "Max     │
│ pending  │  │ retries" │
└────┬─────┘  └──────────┘
     │
     ▼
┌──────────────┐
│ status:      │
│ retrying     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Publish      │
│ llm.call     │
│ events       │
└──────────────┘
       │
       ▼
  (back to Phase 2)
```

---

## Phase 6: Retry from Failed (NEW)

### Entry Condition

```
research.status === 'failed'
```

### Retry Flow

```
┌─────────────────────┐
│ User clicks Retry   │
│ (status: failed)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Any failed LLMs?    │
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     │ YES       │ NO
     ▼           ▼
┌──────────┐  ┌──────────────┐
│ Retry    │  │ synthesisErr │
│ LLMs     │  │ exists?      │
│ (same as │  └──────┬───────┘
│ Phase 5) │         │
└──────────┘   ┌─────┴─────┐
               │ YES       │ NO
               ▼           ▼
         ┌──────────┐  ┌──────────┐
         │ Re-run   │  │ Mark as  │
         │ synthesis│  │ completed│
         └──────────┘  │(idempot.)│
                       └──────────┘
```

### Endpoint: POST /research/:id/retry

| Current Status | Action | Result |
|----------------|--------|--------|
| `failed` + failed LLMs | Retry LLMs | `retrying` → processing |
| `failed` + synthesis error | Re-run synthesis | `completed` or `failed` |
| `failed` + nothing to retry | No-op | `completed` (idempotent) |
| Other status | Error | 409 Conflict |

---

## Frontend Display Logic

### Status → UI Mapping

| Status | Card Display |
|--------|--------------|
| `draft` | Edit form |
| `processing` | Progress indicator per LLM |
| `synthesizing` | "Synthesizing results..." |
| `retrying` | "Retrying failed providers..." |
| `awaiting_confirmation` | Proceed/Retry/Cancel dialog |
| `completed` (with synthesis) | Synthesis + individual reports |
| `completed` (no synthesis) | "Synthesis not available" + individual report |
| `failed` | Error message + Retry button |

### Synthesis Not Available Condition

```typescript
const showSynthesisNotAvailable =
  research.status === 'completed' &&
  !research.synthesizedResult &&
  research.llmResults.filter(r => r.status === 'completed').length <= 1 &&
  !research.inputContexts?.length;
```

---

## Error Handling Summary

| Error Type | Status | User Action |
|------------|--------|-------------|
| All LLMs failed | `failed` | Retry |
| Synthesis failed | `failed` | Retry |
| Max retries exceeded | `failed` | Create new research |
| API key invalid | `failed` | Update API keys, retry |
| Cancelled by user | `failed` | Create new research |

---

## Pub/Sub Topics

| Topic | Publisher | Subscriber | Purpose |
|-------|-----------|------------|---------|
| `llm-call` | llm-orchestrator | llm-orchestrator | Trigger LLM API call |
| `research-events` | llm-orchestrator | actions-agent | Research lifecycle events |

---

## Key Files

| File | Purpose |
|------|---------|
| `routes/researchRoutes.ts` | All research HTTP endpoints |
| `usecases/runSynthesis.ts` | Synthesis execution |
| `usecases/checkLlmCompletion.ts` | Completion detection |
| `usecases/retryFailedLlms.ts` | Retry logic |
| `routes/internalRoutes.ts` | Pub/Sub handlers |
