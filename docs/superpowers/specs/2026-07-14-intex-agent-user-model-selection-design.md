# Intex Agent Per-User Model Selection Design

**Date:** 2026-07-14
**Status:** Proposed for user review
**Program order:** 2 of 4

## Purpose

Give every authenticated user an independent Intex Agent model preference with the same interaction pattern as the existing default-model setting, while keeping the platform OpenRouter credential, agent prompt, tool surface, and safety behavior under IntexuraOS control.

This specification depends on the [evaluation foundation](./2026-07-14-intex-agent-evaluation-foundation-design.md). It is consumed by the [session-regression workflow](./2026-07-14-intex-session-regression-skills-design.md) and the [WhatsApp live canary](./2026-07-14-intex-agent-whatsapp-live-canary-design.md).

## Current State

- Intex Agent always uses `or:google/gemini-3-flash-preview`, exposed as `INTEX_AGENT_MODEL`.
- `ServiceConfig.model` is narrowed to that one constant.
- Both the intent-classifier client and the tool-calling client are created with the same static model in `apps/intex-agent/src/services.ts`.
- The shared tool-calling contract accepts Gemini 2.5 Flash and OpenRouter Gemini 3 Flash Preview only.
- User settings already store `llmPreferences.defaultModel` and optional `fallbackModel` in `user_settings`.
- The web settings screen loads those preferences through `GET /users/:uid/settings/llm-keys`, updates the default through an authenticated settings contract, and uses an optimistic update with rollback.
- Intex Agent does not currently call user-service and has no `INTEXURAOS_USER_SERVICE_URL` configuration.
- Intex Agent already uses the platform-owned `INTEXURAOS_OPENROUTER_APP_API_KEY`; its model must not depend on a user's BYOK key.

## Goals

1. Offer exactly these initial choices:
   - `or:deepseek/deepseek-v4-flash`
   - `or:minimax/minimax-m3`
   - `or:google/gemini-3-flash-preview`
2. Store the selection independently from the user's general default and fallback models.
3. Reuse the existing LLM settings page, authenticated user contract style, loading state, optimistic save, rollback, and error presentation.
4. Resolve one model once per incoming product message and use it for classification, structured repair, tool calling, and response repair.
5. Keep Gemini 3 Flash Preview as the default for users without the new field.
6. Use the platform OpenRouter API key for all three options.
7. Make the effective model visible in evaluation diagnostics, session diagnostics, and sanitized logs.
8. Prevent API-key deletion or general-model updates from erasing the Intex Agent preference.

## Non-Goals

- Users cannot enter arbitrary OpenRouter model IDs.
- Users cannot supply a separate API key for Intex Agent.
- This setting does not change the conversation-assistant model, research model, code-agent model, or general `defaultModel`.
- There is no per-session or per-message production override.
- A provider failure does not silently switch a user to another model.
- The first release does not expose reasoning controls, temperature, token limits, or prompt versions.

## Considered Approaches

### A. Add an independent field to `llmPreferences` — selected

Store `llmPreferences.intexAgentModel` beside, but independently from, `defaultModel` and `fallbackModel`. Expose it through the existing settings read model and a narrow authenticated update route. Intex Agent resolves the field through the internal user-service client.

Advantages:

- matches the existing settings ownership boundary;
- avoids another Firestore collection and duplicate authorization logic;
- preserves platform-managed credentials;
- allows immediate per-user changes without redeploying Intex Agent.

Trade-off: Intex Agent gains a synchronous user-service dependency. The fallback policy below prevents a settings outage from stopping all messages.

### B. Store the preference inside Intex Agent

This would avoid the runtime user-service call but duplicate user settings, authenticated settings routes, web API code, and data ownership.

Decision: rejected.

### C. Use the user's general `defaultModel`

This gives no independent control and would allow models that do not satisfy the Intex tool-calling contract.

Decision: rejected.

## Shared Model Contract

Add an agent-specific contract in `@intexuraos/llm-contract`:

```ts
export const IntexAgentModels = {
  DeepSeekV4Flash: createOpenRouterModelId(
    'deepseek/deepseek-v4-flash'
  ) as OpenRouterDeepSeekV4Flash,
  MiniMaxM3: createOpenRouterModelId('minimax/minimax-m3') as OpenRouterMiniMaxM3,
  Gemini3FlashPreview: createOpenRouterModelId(
    'google/gemini-3-flash-preview'
  ) as OpenRouterGemini3FlashPreview,
} as const;

export type IntexAgentModel =
  | typeof IntexAgentModels.DeepSeekV4Flash
  | typeof IntexAgentModels.MiniMaxM3
  | typeof IntexAgentModels.Gemini3FlashPreview;

export const DEFAULT_INTEX_AGENT_MODEL = IntexAgentModels.Gemini3FlashPreview;
export const INTEX_AGENT_MODEL_OPTIONS: readonly IntexAgentModelOption[] = [
  { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash', provider: 'DeepSeek' },
  { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3', provider: 'MiniMax' },
  {
    id: IntexAgentModels.Gemini3FlashPreview,
    label: 'Gemini 3 Flash Preview',
    provider: 'Google',
  },
];
export function isIntexAgentModel(value: string): value is IntexAgentModel;
```

Each option contains an ID, stable display label, and provider label. Model IDs are defined once; the web app, user-service, Intex Agent, evaluator, and tests import them.

Extend `ToolCallingModel` and `ALL_TOOL_CALLING_MODELS` with DeepSeek V4 Flash and MiniMax M3. Add both raw IDs and fallback pricing to the applicable OpenRouter allowlists. Tool-calling conformance is established through live tests; declaring a type alone is not evidence that a provider honors the schema.

## Persistence

Extend the existing aggregate:

```ts
export interface LlmPreferences {
  defaultModel?: string;
  fallbackModel?: string;
  intexAgentModel?: IntexAgentModel;
  intexAgentModelRevision?: number;
}
```

Requirements:

- Existing documents remain valid; no migration job is required.
- A missing `intexAgentModelRevision` is exactly revision `0`; the first successful mutation requires `expectedRevision = 0` and commits revision `1`. Persisted revisions must be safe non-negative integers or the settings read fails as corrupt rather than casting.
- Absence resolves to `DEFAULT_INTEX_AGENT_MODEL` at runtime.
- `updateIntexAgentModel(userId, model, expectedRevision)` transactionally writes only the Intex Agent model/revision fields and creates the settings document when absent.
- The repository validates the value before persistence even though the route also validates it.
- General default/fallback updates preserve `intexAgentModel`.
- Replace `clearLlmPreferences()` with a narrow operation that deletes only `defaultModel` and `fallbackModel`. Deleting a user's provider key must never delete `intexAgentModel`, because Intex Agent uses the platform key.
- Firestore converters and test fakes reject a persisted invalid value at the domain boundary or return it as invalid for safe fallback; they must not cast unchecked strings.

## Public Settings Contract

### Read

Extend `GET /users/:uid/settings/llm-keys` with:

```ts
interface LlmKeysResponse {
  // existing fields
  intexAgentModel: IntexAgentModel | null;
  intexAgentModelRevision: number;
}
```

`null` means no explicit preference and lets the UI show the documented default. The read always returns a concrete revision, using `0` for a legacy/missing field. The existing authentication and `params.uid === token userId` authorization remain unchanged.

### Update

Create:

```http
PATCH /users/:uid/settings/intex-agent-model
Content-Type: application/json

{
  "model": "or:deepseek/deepseek-v4-flash",
  "expectedRevision": 3
}
```

Success data:

```json
{
  "model": "or:deepseek/deepseek-v4-flash",
  "revision": 4
}
```

Requirements:

- exact `isIntexAgentModel()` validation;
- require `expectedRevision` as a safe non-negative integer; missing, fractional, negative, string, or additional values are `400`;
- reject additional fields;
- same authenticated-user ownership check as the default-model route;
- no check for a user-owned OpenRouter key;
- no endpoint for arbitrary strings;
- `400` for an unsupported model, `401` for missing/invalid authentication, `403` for another user's settings, and `500` for persistence failure;
- request logging must not include tokens or credentials.
- update the model and monotonically increment `intexAgentModelRevision` in one Firestore transaction;
- return `409` with the current revision when `expectedRevision` is stale, without writing;
- let the client refetch and retry only its newest queued intent after a conflict.

Create the matching reset operation:

```http
DELETE /users/:uid/settings/intex-agent-model
If-Match: <revision>
```

It deletes only the explicit Intex Agent field, increments the revision transactionally, and returns Gemini as the effective default plus the new revision. `If-Match` is required (`428` when absent), must be one safe non-negative decimal integer (`400` otherwise), and receives `409` on a stale revision. Ownership and other errors match the update route.

A dedicated update route is intentionally narrower than overloading `PATCH /users/:uid/settings`, whose existing body requires `defaultModel` and enforces BYOK-provider ownership. The UI and client path remain the same style, while the two credential policies cannot be accidentally mixed.

## Internal Model-Resolution Contract

Create a narrow route instead of expanding the broad settings envelope:

```http
POST /internal/users/settings/intex-agent-model:resolve

{ "userId": "<internal subject>" }
```

It requires existing internal auth, rejects unknown fields, and never writes or echoes the request body/UID into access logs, application logs, or artifacts. A generic path avoids leaking the subject through edge access logs. Its discriminated wire contract is:

```ts
type InternalIntexAgentModelResponse =
  | { status: 'ok'; model: IntexAgentModel | null }
  | { status: 'invalid_stored_value' };
```

`invalid_stored_value` is returned with `422` and never echoes the bad value. Repository failure returns a sanitized `500` error envelope. The broad `GET /internal/users/:uid/settings` remains unchanged.

The route must distinguish “settings document/field absent” from “settings repository failed.” Missing settings remains a successful response with absent preferences; a repository failure returns `500` instead of the current successful empty envelope. Without this distinction, Intex Agent cannot truthfully report `default` versus `fallback` resolution.

Extend `@intexuraos/internal-clients` with a transport-only result:

```ts
type IntexAgentModelPreferenceResult =
  | { ok: true; model: IntexAgentModel | null }
  | {
      ok: false;
      reason: 'timeout' | 'network' | 'non_2xx' | 'malformed' | 'invalid_value';
    };

getIntexAgentModelPreference(userId: string): Promise<IntexAgentModelPreferenceResult>;
```

The shared package contains no Intex-specific default/fallback policy. An Intex Agent application use case maps the result:

1. A valid stored value returns it with `source = user_setting`.
2. A missing value returns Gemini with `source = default`.
3. A network error, repository `500`, malformed envelope, or explicit `422 invalid_stored_value` returns Gemini with `source = fallback` and emits a sanitized warning; other non-2xx responses are typed `non_2xx` failures.
4. The transport client and application resolver never throw for a recoverable settings lookup failure.
5. User IDs remain in the non-logged request body and are never included in response artifacts.

The lookup uses a two-second abort deadline configured by `INTEXURAOS_INTEX_AGENT_SETTINGS_TIMEOUT_MS=2000`. A timeout follows the same sanitized `fallback` path as another settings-service availability failure; it cannot delay the much longer LLM call budget.

This availability fallback applies only to settings resolution. Once a model is resolved, an LLM/provider failure follows the normal explicit agent-fallback path and must not invoke another model silently.

## Intex Agent Runtime

Add `INTEXURAOS_USER_SERVICE_URL` and `INTEXURAOS_INTEX_AGENT_SETTINGS_TIMEOUT_MS` to `ServiceConfig`, startup validation, local configuration, deployment configuration, and Terraform-managed environment values.

At the beginning of each `runner.run()` call:

1. Resolve the model once for `input.session.userId`.
2. Create the classifier and tool-calling clients from that same model.
3. Pass the same resolved model to classifier repair and runner response repair.
4. Record the model and resolution source in request-scoped diagnostics.
5. Do not cache across product messages in the first version, so a saved setting takes effect on the next message.

Confirmed-button execution that does not invoke an LLM does not perform an unnecessary settings lookup. If it falls back to a new LLM turn under existing domain behavior, resolution happens before that LLM call.

The test-conversation endpoint adds one higher-precedence source:

```text
test override > valid user setting > Gemini default > Gemini settings-failure fallback
```

The override is request-local and cannot mutate Firestore or `ServiceConfig`.

## Web Experience

Add a section named **Intex Agent model** to the existing LLM settings page.

Behavior:

- show exactly three options using shared display labels;
- show Gemini selected when the API returns `null`;
- explain that the setting affects the WhatsApp Assistant and uses the IntexuraOS platform key;
- do not disable the selector when the user has no OpenRouter BYOK key;
- save immediately on selection, matching the existing default-model interaction;
- optimistically update the selector;
- show a saving state for only this selector while keeping the newest UI intent queued;
- on failure, restore the previous value and show the existing settings error treatment;
- serialize mutations, collapse queued changes to the newest intent, and use the server revision so an older request cannot overwrite a newer persisted intent;
- offer **Use default** through the dedicated reset operation;
- preserve keyboard navigation, label association, focus, and mobile layout;
- never display provider credentials or internal resolution diagnostics.

Extend `useLlmKeys` with separate `intexAgentModel`, `savingIntexAgentModel`, and `setIntexAgentModel()` state. Do not reuse `savingDefaultModel`; concurrent saves of independent preferences must not block or overwrite each other.

## Observability

Sanitized structured logs include:

- model ID;
- resolution source;
- a request-scoped correlation ID that is not a session/user lookup key;
- stage (`classifier`, `runner`, or repair);
- duration, token totals, cost, and result code.

They exclude user message content, assistant content, user ID, phone, e-mail, prompt preferences, API keys, and raw provider responses.

The session event model gains one `model_resolved` event for every LLM-backed product turn, linked to that input/event and containing the model and resolution source. A session may legitimately contain multiple models if the user changes the setting between messages; session metadata and list UI may expose only the explicitly named **latest model**. The debugger, evaluator, and canary use the failing/specific turn's event, never an ambiguous session-wide model. The value is one of the three public model IDs; no provider payload is persisted.

## Failure Handling

- Unsupported public value: reject before persistence.
- Invalid legacy/corrupt stored value: Gemini fallback plus warning; do not rewrite automatically.
- User-service unavailable: Gemini fallback for availability, marked `fallback` in diagnostics.
- OpenRouter unavailable or selected model rejects tool schemas: existing user-facing fallback response, explicit failure event, no silent model substitution.
- Save request failure: web rollback.
- Two concurrent saves: transactional revision checks plus serialized/collapsed client mutations guarantee the final persisted value corresponds to the latest accepted UI intent; a stale request receives `409` and cannot write.
- Deleting the user's OpenRouter key: general default/fallback cascade only; Intex preference remains.

## Security and Privacy

- The public update route is self-only.
- Internal reads require the existing internal-auth contract.
- All model IDs use an exact allowlist.
- The platform OpenRouter secret remains server-side and is never returned by user-service or web.
- The model choice is ordinary user settings data, not a credential.
- No production endpoint accepts a per-request model override.

## Endpoint Changes

### Created

- `PATCH /users/:uid/settings/intex-agent-model`
- `DELETE /users/:uid/settings/intex-agent-model`
- `POST /internal/users/settings/intex-agent-model:resolve`

### Modified

- `GET /users/:uid/settings/llm-keys` adds `intexAgentModel`.
- `GET /users/:uid/settings/llm-keys` adds `intexAgentModelRevision`.
- `POST /internal/intex-agent/test/conversation` accepts a local/dev-only model override as specified by the evaluation foundation.

### Removed

- None.

## Testing Strategy

Implementation follows test-first development. Minimum groups:

1. Shared contract tests for exact membership, display names, default, type guards, and tool-calling membership.
2. OpenRouter allowlist/pricing tests for all three raw IDs.
3. Repository tests for create, update, preservation of sibling preferences, and narrow default/fallback clearing.
4. Public route tests for each model, reset, revision conflicts, reversed request order, invalid/additional fields, self-only authorization, missing BYOK key, and persistence errors.
5. Read-contract tests for explicit and absent values.
6. Narrow internal-route/client and application-resolver tests for explicit/default/fallback resolution, repository `500`, two-second timeout/abort, malformed data, body redaction, absence of unrelated settings, transport/domain separation, and sanitized logging.
7. Intex service tests proving one lookup per LLM-backed product message and the same model in classifier, repair, and tool runner.
8. Tests proving confirmation-only execution performs no lookup or LLM call.
9. Web API/hook tests for optimistic save, rollback, stale response ordering, independent save flags, and `null` defaulting.
10. Page tests for three options, accessibility, helper text, and independence from BYOK state.
11. Terraform/config/startup-validation tests for the user-service URL.
12. Protected live conformance tests that require each model to classify, emit valid tool calls, accept tool results, repair structured output, and complete the same Gold scenario.

## Acceptance Criteria

- A new/existing user with no stored field runs Gemini 3 Flash Preview.
- The settings page offers exactly DeepSeek V4 Flash, MiniMax M3, and Gemini 3 Flash Preview.
- Saving each option persists it and the next WhatsApp Assistant LLM turn uses it for every LLM stage.
- A user without an OpenRouter BYOK key can save and use the setting.
- General default/fallback changes and provider-key deletion preserve the Intex preference.
- A user-service outage keeps the agent available on Gemini and records `fallback` without leaking identity.
- A selected-provider failure is explicit and never silently changes model.
- All three models pass the protected tool-calling conformance suite before their options are released.
- DeepSeek V4 Flash has measured Gold-suite quality, cost, and latency baselines before it is considered a production recommendation.

## Rollout

1. Land shared model types and conformance tests.
2. Land additive storage and API contracts with Gemini default behavior.
3. Land Intex runtime resolution and diagnostics.
4. Run the protected three-model smoke matrix.
5. Land the web selector only after all three options pass conformance.
6. Measure DeepSeek against the approved baseline; change the product default only in a separate reviewed decision.
