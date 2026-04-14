# INT-1373 Investigation: Why Orchestrator Validation Still Uses Gemini

> **Investigation date:** 2026-04-14

**Question:** Why does orchestrator validation use `gemini-2.5-flash` instead of the user's default model, and why wasn't it transitioned during the INT-1362 default model feature?

---

## Evidence From Logs

| Time   | Owner                   | Provider   | Model            | Component                  | Service             | Tokens     | Cost   |
| ------ | ----------------------- | ---------- | ---------------- | -------------------------- | ------------------- | ---------- | ------ |
| 3m ago | google-oauth2\          | ...        | openrouter       | google/gemma-4-31b-it:free | user-service-client | code-agent | 2.3K   | $0.0000 |
| 4m ago | orchestrator-validation | google     | gemini-2.5-flash | validation                 | orchestrator        | 44.8K      | $0.02  |

The `code-agent` row uses the user's chosen OpenRouter model (respecting user default). The `orchestrator` row uses a hardcoded Gemini model with a synthetic userId `orchestrator-validation`.

---

## Root Cause: Architectural Separation

Orchestrator validation **intentionally** uses a fixed model, not the user's default. This is not a bug or incomplete migration -- it is a deliberate architectural decision. Here's the full trace:

### 1. Model Configuration Chain

**Entry point:** `workers/orchestrator/src/start.ts:736-738`

```typescript
const validationModelsRaw = getOptionalEnv(
  'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS',
  'or:google/gemma-4-31b-it:free,gemini-2.5-flash'   // hardcoded default
);
```

The env var `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS` defines an ordered model list. If unset, it defaults to two models: an OpenRouter free model (primary) and `gemini-2.5-flash` (fallback).

**Parser:** `workers/orchestrator/src/services/validation-model-clients.ts:36-71`

Models prefixed with `or:` route to OpenRouter; unprefixed models route to Gemini. The parser produces a `ParsedValidationModel[]` list preserving priority order.

**Client builder:** `workers/orchestrator/src/services/validation-model-clients.ts:95-156`

Each model gets a dedicated `LlmGenerateClient`. Both use:
- `userId: 'orchestrator-validation'` (hardcoded, line 113 and 141)
- `service: 'orchestrator'`, `component: 'validation'` (usage sink labels)
- Static pricing (not user-specific)

Two separate client sets are built (line 755-762 in `start.ts`) -- one for the completion verifier, one for the compliance validator -- each with their own task-correlation function.

### 2. No User Context Available at Validation Time

**Task request interface:** `workers/orchestrator/src/types/api.ts:7-40`

The `CreateTaskRequest` sent from code-agent to orchestrator contains:
- `taskId`, `workerType`, `prompt`, `repository`, `agentType`
- `executionMemoryContext`, `linearIssueId`

**Missing fields:**
- No `userId`
- No `userDefaultModel` or `userPreferences`
- No reference to user LLM configuration

**Validation input:** `workers/orchestrator/src/services/completion-verifier.ts:23-28`

```typescript
export interface CompletionVerifierInput {
  taskId: string;
  attempt: number;
  maxAttempts: number;
  agentType: CompletionAgentType;
  rawLogs: string;
}
```

No user identity is threaded through. The orchestrator has zero knowledge of which user submitted the task at validation time.

### 3. INT-1362 Explicitly Excluded Orchestrator

The plan document `docs/plans/INT-1362-default-fallback-llm-models.md` implements user default model selection across:
- `llm-contract` (new `DefaultEligibleModel` type)
- `user-service` (stores/retrieves user model preferences)
- `internal-clients` (retry-on-fallback logic in `getLlmClient`)
- `web` (UI for selecting primary + fallback models)

**What INT-1362 does NOT touch:**
- `workers/orchestrator/` -- not in the file structure table
- Validation model selection -- not mentioned anywhere in the plan
- `CreateTaskRequest` -- no user context additions

This exclusion is intentional. Key design decision #1 in INT-1362:

> "DefaultEligibleModel vs expanding FastModel: We introduce a new type rather than adding OpenRouter models to FastModel, because FastModel is used elsewhere (e.g., tool calling, cheap validation) where OpenRouter models aren't appropriate."

The phrase "cheap validation" directly references orchestrator validation as a use case that should NOT use user-selected models.

---

## Why This Design Is Intentional

| Concern                    | Why fixed model is preferred                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Determinism**            | Validation verdicts (pass/fail/retry) should be consistent across all users. Different models could disagree on whether a task completed successfully.                                       |
| **Cost control**           | Validation uses 44K+ tokens per invocation. User-selected models could be expensive (e.g., Opus). A cheap, fast model keeps per-task overhead predictable.                                   |
| **No user context**        | The orchestrator is a service-to-service layer. Threading userId through CreateTaskRequest, then into the verifier, then into a user-service lookup would add latency and coupling.          |
| **Infrastructure concern** | Validation is an infrastructure function (did the worker finish its job?) not a user-facing feature. It's analogous to health checks or log parsing -- infrastructure owns the model choice. |
| **Consensus verification** | The verifier uses structured output (JSON schema) to parse completion status. The chosen model must reliably follow structured output constraints. Not all user-selectable models do.        |

---

## What Would It Take To Change This?

If we wanted orchestrator validation to respect user model preferences, we'd need:

1. **Thread user context:** Add `userId` to `CreateTaskRequest` (code-agent already knows it)
2. **Lookup at validation time:** Inject `user-service` client into verifier, fetch user preferences per task
3. **Per-user client pooling:** Cache `LlmGenerateClient` instances per user+model combo (currently singletons built at startup)
4. **Fallback guarantee:** If user's model fails structured output, fall back to the hardcoded Gemini model anyway

**Trade-offs:**
- Adds latency (user-service HTTP call per validation)
- Breaks validation determinism
- Adds complexity for marginal user benefit (users don't see validation results directly)
- Risk of validation failures if user's model can't handle structured output reliably

---

## Follow-up: Why Gemini Instead of Gemma Specifically?

The validation model list is `or:google/gemma-4-31b-it:free,gemini-2.5-flash`. Gemma is the **primary** and Gemini is the **fallback**. Yet the logs show only Gemini ran. This is because the completion verifier uses a sequential try-each-model loop with automatic fallback.

### The Fallback Loop (`completion-verifier.ts:637-713`)

```typescript
// Try each model (primary + fallbacks) until one produces a valid, parseable response.
const allModels = [
  { client: this.primaryClient, modelName: this.primaryModelName },  // gemma (OR)
  ...this.fallbacks,                                                  // gemini
];

for (const { client, modelName } of allModels) {
  const result = await client.generate(prompt);
  if (!result.ok) {
    this.logger.warn({ model: modelName, errorCode: result.error.code },
      'Completion verifier model call failed, trying next');
    continue;  // ← falls back to gemini
  }
  // ... then tries JSON extraction, then Zod schema validation
  // If either fails → continue to next model
}
```

Three failure modes cause fallback:
1. **API call fails** (`!result.ok`) — rate limit, timeout, HTTP error
2. **JSON extraction fails** — response isn't parseable JSON
3. **Zod schema validation fails** — JSON doesn't match expected structured output schema

### Why Gemma Failed This Time

The logs show **no usage entry** for `orchestrator-validation` + `google/gemma-4-31b-it:free`. The OpenRouter client records usage even on failure — but with 0 tokens and $0.00 cost (`client.ts:306-312`). The dashboard likely filters out 0-token entries, or the entry exists but wasn't in the user's view.

The most likely cause: **the free OpenRouter model hit a rate limit (HTTP 429) or was temporarily unavailable**. Free-tier OpenRouter models (`:free` suffix) have aggressive rate limits and availability constraints. The code-agent had _just_ used the same `google/gemma-4-31b-it:free` model moments before (row 1 in the log table), which may have exhausted the rate limit window for the same API key.

### This Is Working As Designed

The entire point of the fallback list is to handle exactly this scenario. Gemma (free) is tried first for cost savings. When it fails, Gemini (paid, reliable) provides the safety net. The $0.02 cost for the Gemini fallback is the expected price of reliability.

---

## Recommendation

**No change needed.** The current design is correct. Orchestrator validation is an infrastructure concern that should use a fixed, cheap, reliable model. The user's default model preference correctly applies to `generate()` calls in user-facing services (code-agent, research, etc.) but not to internal verification.

The Gemma→Gemini fallback is working as designed: free model tried first, paid model catches failures. If cost is the concern (the $0.02/task overhead), the existing `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS` env var already allows swapping to a cheaper or free model without code changes.
