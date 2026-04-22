# INT-1418 — WhatsApp notification importance level (user setting + optional `important` flag)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user opt into receiving only important WhatsApp notifications. Adds a per-user `notificationLevel` (`all` | `important`) owned by `whatsapp-service`, an optional `important?: boolean` flag on the WhatsApp send interface, delivery-side filtering that drops non-important messages when the user has opted in, and a settings UI in the existing WhatsApp tab.

**Architecture:**
- **Owner service:** `apps/whatsapp-service`. The setting lives next to the WhatsApp mapping and is never exposed through any other service — no cross-service reads, no fields in `user_settings`, no propagation through Pub/Sub to consumers.
- **Storage:** Extend the existing `whatsapp_user_mappings` Firestore collection (owned by `whatsapp-service`) with an optional `notificationLevel` field. Default behavior (field missing or `'all'`) = every message is delivered; `'important'` = drop messages whose `important !== true`. Treating a missing field as `all` makes the migration zero-step for existing users.
- **Send interface:** Add `important?: boolean` (default `false`) to `SendMessageEvent` in `@intexuraos/infra-pubsub`, to the `publishSendMessage(...)` call signature, and to the internal `whatsapp-service` `SendMessageEvent`. Publishers forward it through, the `whatsapp-service` Pub/Sub consumer is the **only** place that compares the flag against the user's `notificationLevel` and decides to send vs. drop.
- **Filtering is a domain decision.** Introduce a tiny domain use case `ShouldDeliverMessageUseCase` inside `apps/whatsapp-service` and call it from `POST /internal/whatsapp/pubsub/send-message`. That keeps the decision unit-testable and avoids leaking the concept into callers.
- **UI:** A new "Notification Preferences" card in the existing `WhatsAppConnectionPage.tsx` (the Settings → WhatsApp tab). Segmented-control between "All messages" and "Important only" with inline explainer copy. Calls two new endpoints on `whatsapp-service`: `GET /whatsapp/preferences` and `PUT /whatsapp/preferences`.
- **Privacy contract:** The setting is **not** returned by `GET /whatsapp/status`, not published on any Pub/Sub topic, not read by any other service, and not included in any existing response body. Only the owning user (via their Auth0 JWT) can read/write it, and only the `whatsapp-service` consumer reads it internally during delivery.

**Tech Stack:**
- TypeScript (strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`).
- `@intexuraos/infra-pubsub` (publisher interface change).
- `@intexuraos/infra-firestore` (Firestore access inside `whatsapp-service`).
- `@intexuraos/common-http` → `requireAuth`, `logIncomingRequest`.
- React + Tailwind (web).
- Vitest (in-memory fakes, `app.inject()`, no network).

**Endpoint Changes:**
- **Modified:** none (no existing endpoint shape changes — `GET /whatsapp/status` deliberately does **not** expose the new field).
- **Created:**
  - `GET /whatsapp/preferences` — returns `{ notificationLevel: 'all' | 'important' }` for the authenticated user.
  - `PUT /whatsapp/preferences` — body `{ notificationLevel: 'all' | 'important' }`, returns the saved value.
- **Removed:** none.
- **Unchanged:** `POST /whatsapp/connect`, `GET /whatsapp/status`, `DELETE /whatsapp/disconnect`, `GET /whatsapp/messages`, all `/whatsapp/webhooks`, all `/whatsapp/verify/*`, all `/whatsapp/messages/:id/*`, `POST /internal/whatsapp/pubsub/send-message` (request/response schema unchanged — the `important` flag arrives via the Pub/Sub event body, not a new HTTP field), `POST /internal/whatsapp/pubsub/media-cleanup`, `POST /internal/whatsapp/pubsub/transcription-completed`, `POST /internal/whatsapp/pubsub/process-webhook`.

---

## Audit of every WhatsApp `publishSendMessage` call site in the monorepo

Identified via `rg "publishSendMessage\s*\("` across `apps/**/*.ts`. This is the exhaustive list the user needs in order to annotate which sends are "important". For each, the **recommended default** is listed; the user can override by passing `important: true` in the implementation PR.

### bookmarks-agent
| File                                                                | Call site                                        | Recommendation                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `apps/bookmarks-agent/src/domain/usecases/summarizeBookmark.ts:114` | Bookmark summary ready (`📑 *Bookmark Summary*`) | **important** (user-facing summary of explicitly-saved content) |

### actions-agent
| File                                                                                        | Call site                                          | Recommendation                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/actions-agent/src/infra/notification/whatsappNotificationSender.ts:41`                | `📚 Research Complete!` message                    | **important**                                                                                                                                                                                                                                             |
| `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts:174`                         | "Action no longer available" error reply           | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts:240`                         | Approval buttons resend                            | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/handleActionTemplate.ts:64`                         | Approval-request buttons for new action            | **important** (user must act)                                                                                                                                                                                                                             |
| `apps/actions-agent/src/domain/usecases/executeActionTemplate.ts:*`                         | Template execution completion notice               | **important**                                                                                                                                                                                                                                             |
| `apps/actions-agent/src/domain/usecases/executeLinkAction.ts:200`                           | Bookmark creation complete (`bookmark-complete-*`) | **not important**                                                                                                                                                                                                                                         |
| `apps/actions-agent/src/domain/usecases/executeCodeAction.ts:206`                           | Code action completion                             | **important** — but see "Code-task notification rework (follow-up)" below: this single completion ping needs to be refactored / split into a new "ready-to-merge" notification gated on the code-task's mergeable label, not on raw "execution finished". |
| `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts:*`                         | Calendar action completion                         | **not important**                                                                                                                                                                                                                                         |
| `apps/actions-agent/src/domain/usecases/approval/executeRejection.ts:39`                    | "Action no longer available" on rejection          | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/executeRejection.ts:59`                    | `🛑 Got it. Cancelled ...`                         | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/handleButtonResponse.ts:83`                | "Action no longer available"                       | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/handleButtonResponse.ts:100`               | `✅ Approved! Processing ...`                       | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/handleCancelTaskButton.ts:22`              | "Service temporarily unavailable"                  | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/handleCancelTaskButton.ts:32`              | "Missing security code"                            | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/handleCancelTaskButton.ts:57`              | Cancel-task failure report                         | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/handleCancelTaskButton.ts:71`              | `🛑 Task cancellation requested.`                  | **important** (reply to user action)                                                                                                                                                                                                                      |
| `apps/actions-agent/src/domain/usecases/approval/handleProceedToImplementationButton.ts:55` | Error notifying user the task couldn't start       | **important**                                                                                                                                                                                                                                             |
| `apps/actions-agent/src/domain/usecases/approval/handleProceedToImplementationButton.ts:72` | `🚀 Starting implementation...`                    | **important** (user requested, long-running)                                                                                                                                                                                                              |

### code-agent (via `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` — 13 call sites)
| Line   | Event                                                  | Recommendation                    |
| ------ | ------------------------------------------------------ | --------------------------------- |
| `:150` | Task started (generic notify)                          | **not important** (progress)      |
| `:170` | Task failed                                            | **important**                     |
| `:208` | Task requires human attention (design buttons)         | **important** (user must act)     |
| `:245` | Task requires human attention (implementation buttons) | **important** (user must act)     |
| `:281` | Task resumed (user already acted)                      | **important**                     |
| `:311` | Design complete with buttons                           | **important** (user must act)     |
| `:322` | Fallback design complete (no buttons)                  | **important**                     |
| `:354` | Task queued at position N                              | **not important** (progress)      |
| `:381` | Task timed out (pool exhausted)                        | **important**                     |
| `:410` | Task cancelled by auto-retry guardrail                 | **important**                     |
| `:445` | Auto-dispatched follow-up fix (with PR CTA)            | **not important** (informational) |
| `:470` | Auto-retry triggered (`⟳ ...`)                         | **not important** (progress)      |
| `:496` | Task failed after all auto-retries (`❌ ...`)           | **important**                     |

### research-agent
| File                                                                          | Call site         | Recommendation                             |
| ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| `apps/research-agent/src/infra/notification/WhatsAppNotificationSender.ts:39` | Research complete | **important** (long-running task finished) |
| `apps/research-agent/src/infra/notification/WhatsAppNotificationSender.ts:55` | Research failed   | **important**                              |

### mobile-notifications-service
| File                                                                                    | Call site                       | Recommendation                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile-notifications-service/src/infra/notification/whatsappDigestNotifier.ts:45` | Digest summary ready (INT-1417) | **important** (digest is the curated daily summary the user explicitly opted into — losing it defeats the digest's purpose) |

### Tests and fakes (no production sends — listed for completeness)
- `apps/actions-agent/src/__tests__/fakes.ts:395` — `FakeWhatsAppSendPublisher` must extend its signature to record `important` without changing behavior.
- `apps/bookmarks-agent/src/__tests__/fakeWhatsAppSendPublisher.ts:19` — same.
- Any other test-only fake that implements `WhatsAppSendPublisher`.

**Note on `code-agent/src/services.ts`:** the `services.ts` itself wires the publisher; the classification above is for the 13 call sites inside `whatsappNotifierImpl.ts`. No classification needed on `services.ts`.

### Code-task notification rework (follow-up — review feedback on PR #1880)

Reviewer feedback (`pbuchman` review 4134925744 on PR #1880) called out that the current code-task completion notifications fire on raw "execution finished" events, not on the user-meaningful "ready to merge" state. The user-facing signal that matters is the **mergeable** label that the code-task groups view shows; that's the only point at which a WhatsApp ping reflects a real next-step for the user.

This affects two call-site clusters in the audit above:

1. **`apps/actions-agent/src/domain/usecases/executeCodeAction.ts:206`** — the single "code action completion" send. Today it fires the moment the action's executor returns; tomorrow it should fire when (and only when) the resulting code-task transitions into the `mergeable` state.
2. **`apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`** — the 13 call sites cover task lifecycle phases (started, design ready, queued, retry, failed, etc.). The "task started", "task queued", "auto-retry triggered", and "auto-dispatched follow-up fix" pings (`:150`, `:354`, `:445`, `:470`) are progress noise relative to the mergeable signal; the "design complete with buttons", "task requires human attention", and "task failed" pings remain genuinely user-actionable. A new "ready to merge" notification needs to be added (likely a new method on `WhatsAppNotifier` plus a publisher invocation from wherever the code-task acquires the `mergeable` label) and existing progress pings need to be re-evaluated against the same bar.

Because this is a notification-graph rework — not just an importance flag — it is **explicitly out of scope for the INT-1418 implementation**. The INT-1418 implementer should:

- Mark `executeCodeAction.ts:206` and the appropriate code-agent call sites with `important: true` per the table above so the new `notificationLevel='important'` filter does not accidentally drop them while the rework is pending.
- Open a follow-up Linear issue ("Code-task notifications: gate on mergeable state, not on execution-finished") that owns the actual rework and the new `mergeable` event wiring. Cross-link it to INT-1418.
- Cite this section in the follow-up issue so reviewers have the original feedback context.

---

## File Structure

**Create**
- `apps/whatsapp-service/src/domain/whatsapp/models/NotificationPreferences.ts` — the `NotificationLevel` union + default constant.
- `apps/whatsapp-service/src/domain/whatsapp/ports/notificationPreferencesRepository.ts` — domain port.
- `apps/whatsapp-service/src/domain/whatsapp/usecases/shouldDeliverMessage.ts` — pure decision: `(level, important) => boolean`.
- `apps/whatsapp-service/src/infra/firestore/notificationPreferencesRepository.ts` — Firestore-backed adapter (reads/writes the `notificationLevel` field on the existing `whatsapp_user_mappings` document; creates a minimal doc if none exists).
- `apps/whatsapp-service/src/routes/preferencesRoutes.ts` — `GET`/`PUT /whatsapp/preferences`.
- `apps/whatsapp-service/src/__tests__/preferencesRoutes.test.ts`
- `apps/whatsapp-service/src/__tests__/domain/shouldDeliverMessage.test.ts`
- `apps/whatsapp-service/src/__tests__/infra/notificationPreferencesRepository.test.ts`
- `apps/web/src/services/whatsappPreferencesApi.ts` — thin client for the two new endpoints.
- `apps/web/src/components/WhatsAppPreferencesCard.tsx` — the UI card.
- `apps/web/src/__tests__/pages/WhatsAppConnectionPage.preferences.test.tsx` — UI behavior tests.

**Modify**
- `packages/infra-pubsub/src/types.ts` — add `important?: boolean` to `SendMessageEvent`.
- `packages/infra-pubsub/src/whatsappSendPublisher.ts` — add `important?: boolean` to the `publishSendMessage(...)` param type and event mapping.
- `packages/infra-pubsub/src/__tests__/whatsappSendPublisher.test.ts` — assert the flag is forwarded when supplied, omitted when not.
- `apps/whatsapp-service/src/domain/whatsapp/events/events.ts` — add `important?: boolean` to the local `SendMessageEvent` interface (mirrors the publisher type — kept in sync).
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts` — in the `/internal/whatsapp/pubsub/send-message` handler, look up the user's `NotificationPreferences`, run `ShouldDeliverMessageUseCase`, log-and-ack when dropped (HTTP 200, no retry).
- `apps/whatsapp-service/src/routes/index.ts` — register `preferencesRoutes`.
- `apps/whatsapp-service/src/routes/routes.ts` — extend the route map comment with the two new endpoints.
- `apps/whatsapp-service/src/services.ts` — add `notificationPreferencesRepository: NotificationPreferencesRepository` to `ServiceContainer`.
- `apps/whatsapp-service/src/adapters.ts` — expose the Firestore-backed repository adapter wrapper.
- `apps/whatsapp-service/src/infra/firestore/index.ts` — barrel re-export for the new function-based repository.
- `apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts` — add `notificationLevel?: NotificationLevel` to the stored doc shape (`WhatsAppUserMappingDoc`); **do not** return it from `getUserMapping`/`saveUserMapping` (those power `GET /whatsapp/status` which must stay clean).
- `apps/whatsapp-service/src/domain/whatsapp/ports/index.ts` + `apps/whatsapp-service/src/domain/whatsapp/usecases/index.ts` + `apps/whatsapp-service/src/domain/whatsapp/models/index.ts` — barrel re-exports.
- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts` — new `describe('important filtering')` block covering: `level='all'` always delivers, `level='important'` + `important=true` delivers, `level='important'` + missing/false drops (200, no `messageSender.sendTextMessage` call).
- `apps/whatsapp-service/src/__tests__/fakes.ts` — add a `FakeNotificationPreferencesRepository` helper used by the tests above.
- All call-site files listed in the audit (one-liner change each: pass `important: true` or leave it off per the table above).
- `apps/actions-agent/src/__tests__/fakes.ts` — extend `FakeWhatsAppSendPublisher.publishSendMessage` signature with `important?: boolean` (record it if tests later need to assert).
- `apps/bookmarks-agent/src/__tests__/fakeWhatsAppSendPublisher.ts` — same extension.
- `apps/web/src/pages/WhatsAppConnectionPage.tsx` — mount `<WhatsAppPreferencesCard />` beneath the existing "Connection Settings" card when `status?.connected === true`.
- `firestore-collections.json` — update the description of `whatsapp_user_mappings` to mention `notificationLevel` (still owned by `whatsapp-service`, no new collection).

**Unchanged (explicitly called out)**
- `apps/user-service` — the setting is NOT in `user_settings`. Do not touch `user-service`.
- `packages/infra-whatsapp/src/types.ts` — the raw Cloud-API `SendMessageParams` does NOT gain `important`. Importance is a domain concept filtered BEFORE the Cloud-API call, so it never appears in the outbound Graph request.
- `terraform/**`, `ecosystem.config.cjs`, `apps/whatsapp-service/src/index.ts` — no new env vars required.
- The WhatsApp `sendMessage` domain port in `apps/whatsapp-service/src/domain/whatsapp/ports/messageSender.ts` — unchanged (filtering happens before we call the sender).

---

## Pre-Flight (do these before starting)

- Read `/repo/apps/whatsapp-service/src/routes/pubsubRoutes.ts` (lines 108–310) — the exact block where the filtering hook goes.
- Read `/repo/apps/whatsapp-service/src/routes/mappingRoutes.ts` (all) — the reference route style.
- Read `/repo/apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts` (all 194 lines) — you're adding an optional field to the same doc.
- Read `/repo/packages/infra-pubsub/src/whatsappSendPublisher.ts` + `/repo/packages/infra-pubsub/src/types.ts` — the publisher contract you're extending.
- Read `/repo/apps/whatsapp-service/src/services.ts` (all) — the DI shape.
- Read `/repo/apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts` (structure, fakes wiring).
- Read `/repo/apps/web/src/pages/WhatsAppConnectionPage.tsx` (all) — the page you're extending.
- Read `/repo/.claude/reference/env-vars-patterns.md` — confirm no env changes are needed (this plan intentionally adds none).
- Run `pnpm build` once from the repo root so `packages/infra-pubsub/dist` is populated.

---

## Task 1 — Domain model for `NotificationLevel`

**Files:**
- Create: `apps/whatsapp-service/src/domain/whatsapp/models/NotificationPreferences.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/models/index.ts` (barrel export)

- [ ] **Step 1: Write the failing test**

Create `apps/whatsapp-service/src/__tests__/domain/notificationPreferences.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_LEVEL,
  isNotificationLevel,
  type NotificationLevel,
} from '../../domain/whatsapp/models/NotificationPreferences.js';

describe('NotificationPreferences', () => {
  it('default level is "all"', () => {
    const level: NotificationLevel = DEFAULT_NOTIFICATION_LEVEL;
    expect(level).toBe('all');
  });

  it('isNotificationLevel accepts "all" and "important"', () => {
    expect(isNotificationLevel('all')).toBe(true);
    expect(isNotificationLevel('important')).toBe(true);
  });

  it('isNotificationLevel rejects anything else', () => {
    expect(isNotificationLevel('ALL')).toBe(false);
    expect(isNotificationLevel('')).toBe(false);
    expect(isNotificationLevel(undefined)).toBe(false);
    expect(isNotificationLevel(null)).toBe(false);
    expect(isNotificationLevel(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- notificationPreferences`
Expected: FAIL with "cannot find module '.../NotificationPreferences.js'"

- [ ] **Step 3: Write minimal implementation**

`apps/whatsapp-service/src/domain/whatsapp/models/NotificationPreferences.ts`:

```ts
/**
 * User-scoped preferences for WhatsApp notification delivery.
 * Owned exclusively by whatsapp-service. Never exposed via user-service
 * or any cross-service contract — see INT-1418 privacy contract.
 */
export type NotificationLevel = 'all' | 'important';

export const DEFAULT_NOTIFICATION_LEVEL: NotificationLevel = 'all';

/**
 * Runtime guard — safe against `undefined`, `null`, and arbitrary input
 * from Firestore documents created before this field existed.
 */
export function isNotificationLevel(value: unknown): value is NotificationLevel {
  return value === 'all' || value === 'important';
}

export interface NotificationPreferences {
  readonly notificationLevel: NotificationLevel;
}
```

Add to `apps/whatsapp-service/src/domain/whatsapp/models/index.ts`:

```ts
export * from './NotificationPreferences.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- notificationPreferences`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/whatsapp-service/src/domain/whatsapp/models/NotificationPreferences.ts \
        apps/whatsapp-service/src/domain/whatsapp/models/index.ts \
        apps/whatsapp-service/src/__tests__/domain/notificationPreferences.test.ts
git commit -m "feat(whatsapp-service): add NotificationLevel domain model (INT-1418)"
```

---

## Task 2 — Domain use case `ShouldDeliverMessage`

**Files:**
- Create: `apps/whatsapp-service/src/domain/whatsapp/usecases/shouldDeliverMessage.ts`
- Create: `apps/whatsapp-service/src/__tests__/domain/shouldDeliverMessage.test.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/index.ts` (barrel)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { shouldDeliverMessage } from '../../domain/whatsapp/usecases/shouldDeliverMessage.js';

describe('shouldDeliverMessage', () => {
  it('delivers every message when level="all" (flag ignored)', () => {
    expect(shouldDeliverMessage({ level: 'all', important: true })).toBe(true);
    expect(shouldDeliverMessage({ level: 'all', important: false })).toBe(true);
    expect(shouldDeliverMessage({ level: 'all', important: undefined })).toBe(true);
  });

  it('delivers only important messages when level="important"', () => {
    expect(shouldDeliverMessage({ level: 'important', important: true })).toBe(true);
  });

  it('drops non-important messages when level="important"', () => {
    expect(shouldDeliverMessage({ level: 'important', important: false })).toBe(false);
    expect(shouldDeliverMessage({ level: 'important', important: undefined })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- shouldDeliverMessage`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { NotificationLevel } from '../models/NotificationPreferences.js';

export interface ShouldDeliverMessageInput {
  readonly level: NotificationLevel;
  readonly important: boolean | undefined;
}

/**
 * Pure decision: should the consumer deliver this send event to the
 * WhatsApp Cloud API, given the recipient's notification level and the
 * message's `important` flag?
 *
 *   level = 'all'       → always deliver
 *   level = 'important' → deliver only if important === true
 */
export function shouldDeliverMessage(input: ShouldDeliverMessageInput): boolean {
  if (input.level === 'all') return true;
  return input.important === true;
}
```

Add to `apps/whatsapp-service/src/domain/whatsapp/usecases/index.ts`:

```ts
export * from './shouldDeliverMessage.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- shouldDeliverMessage`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/whatsapp-service/src/domain/whatsapp/usecases/shouldDeliverMessage.ts \
        apps/whatsapp-service/src/domain/whatsapp/usecases/index.ts \
        apps/whatsapp-service/src/__tests__/domain/shouldDeliverMessage.test.ts
git commit -m "feat(whatsapp-service): add shouldDeliverMessage use case (INT-1418)"
```

---

## Task 3 — Domain port `NotificationPreferencesRepository`

**Files:**
- Create: `apps/whatsapp-service/src/domain/whatsapp/ports/notificationPreferencesRepository.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/index.ts` (barrel)

- [ ] **Step 1: Write the failing test**

Add to `apps/whatsapp-service/src/__tests__/domain/notificationPreferences.test.ts`:

```ts
import type { NotificationPreferencesRepository } from '../../domain/whatsapp/ports/notificationPreferencesRepository.js';

describe('NotificationPreferencesRepository port shape', () => {
  it('has getPreferences and savePreferences methods', () => {
    // Type-level test: this compiles only if the interface exists with those names.
    const repo: NotificationPreferencesRepository = {
      async getPreferences() {
        return { ok: true, value: { notificationLevel: 'all' } };
      },
      async savePreferences() {
        return { ok: true, value: { notificationLevel: 'important' } };
      },
    };
    expect(typeof repo.getPreferences).toBe('function');
    expect(typeof repo.savePreferences).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- notificationPreferences`
Expected: FAIL, "Cannot find module '.../notificationPreferencesRepository.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  NotificationLevel,
  NotificationPreferences,
} from '../models/NotificationPreferences.js';

export interface NotificationPreferencesRepository {
  /**
   * Return the user's preferences. Always resolves successfully for a
   * connected user — returns `notificationLevel: 'all'` as the default
   * when the field is missing on the Firestore doc.
   */
  getPreferences(userId: string): Promise<Result<NotificationPreferences, WhatsAppError>>;

  /**
   * Persist the preferences. Creates a minimal mapping doc if none exists
   * (so preferences can be set before the user has verified phone numbers).
   */
  savePreferences(
    userId: string,
    level: NotificationLevel
  ): Promise<Result<NotificationPreferences, WhatsAppError>>;
}
```

Add to `apps/whatsapp-service/src/domain/whatsapp/ports/index.ts`:

```ts
export * from './notificationPreferencesRepository.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- notificationPreferences`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/whatsapp-service/src/domain/whatsapp/ports/notificationPreferencesRepository.ts \
        apps/whatsapp-service/src/domain/whatsapp/ports/index.ts \
        apps/whatsapp-service/src/__tests__/domain/notificationPreferences.test.ts
git commit -m "feat(whatsapp-service): add NotificationPreferencesRepository port (INT-1418)"
```

---

## Task 4 — Firestore adapter for preferences (reuses `whatsapp_user_mappings`)

**Files:**
- Create: `apps/whatsapp-service/src/infra/firestore/notificationPreferencesRepository.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts` (extend the doc shape — optional field)
- Modify: `apps/whatsapp-service/src/infra/firestore/index.ts` (barrel)
- Create: `apps/whatsapp-service/src/__tests__/infra/notificationPreferencesRepository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, it, expect } from 'vitest';
import {
  getPreferences,
  savePreferences,
} from '../../infra/firestore/notificationPreferencesRepository.js';
import { createFakeFirestore, setFakeFirestore } from '../testUtils.js';

describe('notificationPreferencesRepository', () => {
  beforeEach(() => {
    setFakeFirestore(createFakeFirestore());
  });

  it('returns default level "all" when no mapping doc exists yet', async () => {
    const result = await getPreferences('user-new');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notificationLevel).toBe('all');
  });

  it('round-trips a saved "important" preference', async () => {
    const saved = await savePreferences('user-abc', 'important');
    expect(saved.ok).toBe(true);
    const loaded = await getPreferences('user-abc');
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.notificationLevel).toBe('important');
  });

  it('does not overwrite phoneNumbers when only saving preferences', async () => {
    // Seed a mapping with phone numbers
    const fs = setFakeFirestore(createFakeFirestore());
    await fs.collection('whatsapp_user_mappings').doc('user-xyz').set({
      userId: 'user-xyz',
      phoneNumbers: ['48123456789'],
      connected: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const saved = await savePreferences('user-xyz', 'important');
    expect(saved.ok).toBe(true);
    const doc = await fs.collection('whatsapp_user_mappings').doc('user-xyz').get();
    expect(doc.data()?.phoneNumbers).toEqual(['48123456789']);
    expect(doc.data()?.notificationLevel).toBe('important');
  });

  it('coerces unknown stored values back to the "all" default', async () => {
    const fs = setFakeFirestore(createFakeFirestore());
    await fs.collection('whatsapp_user_mappings').doc('user-legacy').set({
      userId: 'user-legacy',
      phoneNumbers: [],
      connected: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      notificationLevel: 'garbage',
    });
    const result = await getPreferences('user-legacy');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notificationLevel).toBe('all');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- notificationPreferencesRepository`
Expected: FAIL, module not found.

- [ ] **Step 3: Extend the doc shape (no behavior change yet)**

In `apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts` extend `WhatsAppUserMappingDoc`:

```ts
interface WhatsAppUserMappingDoc extends WhatsAppUserMappingPublic {
  userId: string;
  /** INT-1418 — user's WhatsApp notification level. Optional for backward compat.
   *  NOT returned by getUserMapping / saveUserMapping (privacy contract). */
  notificationLevel?: 'all' | 'important';
}
```

Do **not** add `notificationLevel` to `WhatsAppUserMappingPublic`. Do **not** include it in any `ok({...})` return in this file.

- [ ] **Step 4: Implement the new repository**

`apps/whatsapp-service/src/infra/firestore/notificationPreferencesRepository.ts`:

```ts
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import {
  DEFAULT_NOTIFICATION_LEVEL,
  isNotificationLevel,
  type NotificationLevel,
  type NotificationPreferences,
} from '../../domain/whatsapp/models/NotificationPreferences.js';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';

const COLLECTION_NAME = 'whatsapp_user_mappings';

export async function getPreferences(
  userId: string
): Promise<Result<NotificationPreferences, WhatsAppError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok({ notificationLevel: DEFAULT_NOTIFICATION_LEVEL });
    const stored = (doc.data() as { notificationLevel?: unknown }).notificationLevel;
    const level: NotificationLevel = isNotificationLevel(stored)
      ? stored
      : DEFAULT_NOTIFICATION_LEVEL;
    return ok({ notificationLevel: level });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to read notification preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function savePreferences(
  userId: string,
  level: NotificationLevel
): Promise<Result<NotificationPreferences, WhatsAppError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();
    const existing = await docRef.get();

    if (!existing.exists) {
      // User has no mapping yet — create a minimal stub doc that carries
      // the preference. phoneNumbers stays empty, connected stays false.
      await docRef.set({
        userId,
        phoneNumbers: [],
        connected: false,
        createdAt: now,
        updatedAt: now,
        notificationLevel: level,
      });
    } else {
      await docRef.update({ notificationLevel: level, updatedAt: now });
    }
    return ok({ notificationLevel: level });
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to save notification preferences: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}
```

Re-export in `apps/whatsapp-service/src/infra/firestore/index.ts`:

```ts
export { getPreferences, savePreferences } from './notificationPreferencesRepository.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- notificationPreferencesRepository`
Expected: PASS (4 tests).

Also run: `pnpm --filter @intexuraos/whatsapp-service test -- userMappingRepository`
Expected: still PASS (no behavior change — doc shape is additive and optional).

- [ ] **Step 6: Commit**

```bash
git add apps/whatsapp-service/src/infra/firestore/notificationPreferencesRepository.ts \
        apps/whatsapp-service/src/infra/firestore/userMappingRepository.ts \
        apps/whatsapp-service/src/infra/firestore/index.ts \
        apps/whatsapp-service/src/__tests__/infra/notificationPreferencesRepository.test.ts
git commit -m "feat(whatsapp-service): persist notificationLevel in whatsapp_user_mappings (INT-1418)"
```

---

## Task 5 — Class adapter + DI wiring

**Files:**
- Modify: `apps/whatsapp-service/src/adapters.ts` (add `NotificationPreferencesRepositoryAdapter`)
- Modify: `apps/whatsapp-service/src/services.ts` (add to container)

- [ ] **Step 1: Write the failing test**

Extend `apps/whatsapp-service/src/__tests__/fakes.ts` with:

```ts
import type {
  NotificationLevel,
  NotificationPreferences,
  NotificationPreferencesRepository,
} from '../domain/whatsapp/index.js';
import { ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../domain/whatsapp/models/error.js';

export class FakeNotificationPreferencesRepository
  implements NotificationPreferencesRepository
{
  private levels = new Map<string, NotificationLevel>();

  setLevel(userId: string, level: NotificationLevel): void {
    this.levels.set(userId, level);
  }

  async getPreferences(
    userId: string
  ): Promise<Result<NotificationPreferences, WhatsAppError>> {
    return ok({ notificationLevel: this.levels.get(userId) ?? 'all' });
  }

  async savePreferences(
    userId: string,
    level: NotificationLevel
  ): Promise<Result<NotificationPreferences, WhatsAppError>> {
    this.levels.set(userId, level);
    return ok({ notificationLevel: level });
  }
}
```

Add to `apps/whatsapp-service/src/__tests__/testUtils.ts` helper `makeServiceContainer(...)` a default instance of this fake (the test file should fail compile until the container accepts it).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/whatsapp-service build 2>&1 | tail -20`
Expected: TypeScript error — `ServiceContainer` missing `notificationPreferencesRepository`.

- [ ] **Step 3: Implement**

`apps/whatsapp-service/src/adapters.ts` add:

```ts
import {
  getPreferences,
  savePreferences,
} from './infra/firestore/index.js';
import type {
  NotificationLevel,
  NotificationPreferences,
  NotificationPreferencesRepository,
} from './domain/whatsapp/index.js';

export class NotificationPreferencesRepositoryAdapter
  implements NotificationPreferencesRepository
{
  async getPreferences(userId: string): Promise<Result<NotificationPreferences, WhatsAppError>> {
    return await getPreferences(userId);
  }
  async savePreferences(
    userId: string,
    level: NotificationLevel
  ): Promise<Result<NotificationPreferences, WhatsAppError>> {
    return await savePreferences(userId, level);
  }
}
```

`apps/whatsapp-service/src/services.ts`:
- Add `notificationPreferencesRepository: NotificationPreferencesRepository` to `ServiceContainer`.
- In `getServices()` construction, add `notificationPreferencesRepository: new NotificationPreferencesRepositoryAdapter(),`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @intexuraos/whatsapp-service test`
Expected: all existing tests still PASS; new fake compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/whatsapp-service/src/adapters.ts \
        apps/whatsapp-service/src/services.ts \
        apps/whatsapp-service/src/__tests__/fakes.ts \
        apps/whatsapp-service/src/__tests__/testUtils.ts
git commit -m "feat(whatsapp-service): wire NotificationPreferencesRepository DI (INT-1418)"
```

---

## Task 6 — Add `important?: boolean` to the publisher contract

**Files:**
- Modify: `packages/infra-pubsub/src/types.ts`
- Modify: `packages/infra-pubsub/src/whatsappSendPublisher.ts`
- Modify: `packages/infra-pubsub/src/__tests__/whatsappSendPublisher.test.ts`

- [ ] **Step 1: Write the failing test**

Add two cases to `packages/infra-pubsub/src/__tests__/whatsappSendPublisher.test.ts`:

```ts
it('publishes with important=true when supplied', async () => {
  const { publisher, captured } = buildFixture();
  const result = await publisher.publishSendMessage({
    userId: 'u1',
    message: 'hi',
    important: true,
  });
  expect(result.ok).toBe(true);
  expect(captured[0]?.important).toBe(true);
});

it('omits the important field from the event when not supplied', async () => {
  const { publisher, captured } = buildFixture();
  await publisher.publishSendMessage({ userId: 'u1', message: 'hi' });
  expect(captured[0]).not.toHaveProperty('important');
});
```

(Reuse the file's existing fixture builder; if none exists, model after the `ctaUrl` test block already in the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/infra-pubsub test -- whatsappSendPublisher`
Expected: FAIL — `important` is not a known property on the publisher params.

- [ ] **Step 3: Extend the type**

`packages/infra-pubsub/src/types.ts` — add to `SendMessageEvent`:

```ts
  /**
   * Optional: marks the message as important. whatsapp-service uses this
   * together with the user's `notificationLevel` to decide whether to
   * deliver. Absent flag == not important. (INT-1418)
   */
  important?: boolean;
```

`packages/infra-pubsub/src/whatsappSendPublisher.ts` — extend the parameter shape on both the interface and the class method, and add the same `exactOptionalPropertyTypes`-safe conditional pass-through used for `ctaUrl`:

```ts
if (params.important !== undefined) {
  event.important = params.important;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @intexuraos/infra-pubsub test`
Expected: all PASS, including the two new cases.

- [ ] **Step 5: Commit**

```bash
git add packages/infra-pubsub/src/types.ts \
        packages/infra-pubsub/src/whatsappSendPublisher.ts \
        packages/infra-pubsub/src/__tests__/whatsappSendPublisher.test.ts
git commit -m "feat(infra-pubsub): add optional important flag to SendMessageEvent (INT-1418)"
```

---

## Task 7 — Mirror the flag on `whatsapp-service`'s internal `SendMessageEvent`

**Files:**
- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`

- [ ] **Step 1: Add the optional field**

Extend `SendMessageEvent` (see events.ts lines 135–177):

```ts
  /**
   * Optional: whether this message is important. Filtering happens inside
   * the Pub/Sub consumer; the user's notificationLevel is the other half
   * of the decision. Missing == not important. (INT-1418)
   */
  important?: boolean;
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @intexuraos/whatsapp-service build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/whatsapp-service/src/domain/whatsapp/events/events.ts
git commit -m "feat(whatsapp-service): mirror important flag on SendMessageEvent (INT-1418)"
```

---

## Task 8 — Pub/Sub consumer filters by `(notificationLevel, important)`

**Files:**
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe('important filtering', ...)` block to `pubsubRoutes.test.ts`. Use the existing fakes pattern (`app.inject()` against the route, fake `messageSender` that records calls, `FakeNotificationPreferencesRepository` from Task 5). Write these cases **before** the code:

```ts
describe('important filtering', () => {
  it('delivers when level="all" and important is absent', async () => {
    prefs.setLevel('user-1', 'all');
    await postSend({ userId: 'user-1', message: 'm' });
    expect(messageSender.sendTextCalls).toHaveLength(1);
  });

  it('delivers when level="important" and important=true', async () => {
    prefs.setLevel('user-1', 'important');
    await postSend({ userId: 'user-1', message: 'm', important: true });
    expect(messageSender.sendTextCalls).toHaveLength(1);
  });

  it('drops when level="important" and important is missing', async () => {
    prefs.setLevel('user-1', 'important');
    const res = await postSend({ userId: 'user-1', message: 'm' });
    expect(res.statusCode).toBe(200);
    expect(messageSender.sendTextCalls).toHaveLength(0);
  });

  it('drops when level="important" and important=false', async () => {
    prefs.setLevel('user-1', 'important');
    await postSend({ userId: 'user-1', message: 'm', important: false });
    expect(messageSender.sendTextCalls).toHaveLength(0);
  });

  it('drops before outboundMessageRepository.save (no wamid written)', async () => {
    prefs.setLevel('user-1', 'important');
    await postSend({ userId: 'user-1', message: 'm' });
    expect(outboundRepo.saved).toHaveLength(0);
  });

  it('delivers on repository read error (fail-open) and logs a warning', async () => {
    prefs.failNext({ code: 'PERSISTENCE_ERROR', message: 'boom' });
    await postSend({ userId: 'user-1', message: 'm' });
    expect(messageSender.sendTextCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- pubsubRoutes`
Expected: 3+ FAILs — filtering not yet implemented; the consumer sends every message.

- [ ] **Step 3: Wire the filter into the route**

In `apps/whatsapp-service/src/routes/pubsubRoutes.ts`, inside the `/internal/whatsapp/pubsub/send-message` handler, AFTER the `phoneResult` null check (line ~198) and BEFORE the `messageSender` dispatch (line ~210), insert:

```ts
const { notificationPreferencesRepository } = getServices();
const prefsResult = await notificationPreferencesRepository.getPreferences(eventData.userId);
// Fail-open: on repository error, deliver the message and log. We must
// not silently swallow user-facing notifications because of a Firestore
// blip.
const level = prefsResult.ok
  ? prefsResult.value.notificationLevel
  : 'all';
if (!prefsResult.ok) {
  request.log.warn(
    {
      userId: eventData.userId,
      correlationId: eventData.correlationId,
      error: prefsResult.error.message,
    },
    'Failed to read notification preferences — falling back to deliver'
  );
}

if (!shouldDeliverMessage({ level, important: eventData.important })) {
  request.log.info(
    {
      userId: eventData.userId,
      correlationId: eventData.correlationId,
      level,
      important: eventData.important ?? false,
    },
    'Dropping non-important WhatsApp message per user preference'
  );
  return await reply.ok({});
}
```

Imports at top of file:

```ts
import { shouldDeliverMessage } from '../domain/whatsapp/index.js';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- pubsubRoutes`
Expected: all PASS including the new `important filtering` block.

- [ ] **Step 5: Commit**

```bash
git add apps/whatsapp-service/src/routes/pubsubRoutes.ts \
        apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts
git commit -m "feat(whatsapp-service): filter sends by notificationLevel+important (INT-1418)"
```

---

## Task 9 — New HTTP endpoints `GET`/`PUT /whatsapp/preferences`

**Files:**
- Create: `apps/whatsapp-service/src/routes/preferencesRoutes.ts`
- Create: `apps/whatsapp-service/src/__tests__/preferencesRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/routes/index.ts` (register)
- Modify: `apps/whatsapp-service/src/routes/routes.ts` (update comment map)

- [ ] **Step 1: Write the failing tests**

`apps/whatsapp-service/src/__tests__/preferencesRoutes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, resetServices, setTestServices, makeUser } from './testUtils.js';

describe('GET /whatsapp/preferences', () => {
  beforeEach(() => setTestServices());
  afterEach(() => resetServices());

  it('401 without a valid bearer token', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/whatsapp/preferences' });
    expect(res.statusCode).toBe(401);
  });

  it('returns default "all" when the user has never saved a preference', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/whatsapp/preferences',
      headers: makeUser('user-1'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ notificationLevel: 'all' });
  });
});

describe('PUT /whatsapp/preferences', () => {
  beforeEach(() => setTestServices());
  afterEach(() => resetServices());

  it('400 when notificationLevel is missing', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/whatsapp/preferences',
      headers: makeUser('user-1'),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when notificationLevel is not "all" or "important"', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/whatsapp/preferences',
      headers: makeUser('user-1'),
      payload: { notificationLevel: 'loud' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists the new level and is reflected in a subsequent GET', async () => {
    const app = await buildTestApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/whatsapp/preferences',
      headers: makeUser('user-1'),
      payload: { notificationLevel: 'important' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ notificationLevel: 'important' });
    const get = await app.inject({
      method: 'GET',
      url: '/whatsapp/preferences',
      headers: makeUser('user-1'),
    });
    expect(get.json().data.notificationLevel).toBe('important');
  });

  it('does not leak notificationLevel on GET /whatsapp/status (privacy contract)', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'PUT',
      url: '/whatsapp/preferences',
      headers: makeUser('user-1'),
      payload: { notificationLevel: 'important' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/whatsapp/status',
      headers: makeUser('user-1'),
    });
    // status may be null when the user has no phones; but if a body
    // returns, the preference field MUST be absent.
    const body = res.json();
    if (body.data !== null) {
      expect(body.data.notificationLevel).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intexuraos/whatsapp-service test -- preferencesRoutes`
Expected: all FAIL (route not registered).

- [ ] **Step 3: Implement the route**

`apps/whatsapp-service/src/routes/preferencesRoutes.ts`:

```ts
/**
 * WhatsApp Notification Preferences routes.
 *
 * GET  /whatsapp/preferences — read the authenticated user's level
 * PUT  /whatsapp/preferences — update it
 *
 * Privacy contract (INT-1418): never returned by /whatsapp/status, never
 * published on Pub/Sub, never read by other services.
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { NotificationLevel } from '../domain/whatsapp/index.js';

const putSchema = z.object({
  notificationLevel: z.enum(['all', 'important']),
});

type PutBody = z.infer<typeof putSchema>;

export const preferencesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/whatsapp/preferences',
    {
      schema: {
        operationId: 'getWhatsAppPreferences',
        summary: 'Get WhatsApp notification preferences',
        tags: ['whatsapp'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['notificationLevel'],
                properties: {
                  notificationLevel: { type: 'string', enum: ['all', 'important'] },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: { $ref: 'ErrorBody#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'GET /whatsapp/preferences' });
      const user = await requireAuth(request, reply);
      if (!user) return;
      const { notificationPreferencesRepository } = getServices();
      const result = await notificationPreferencesRepository.getPreferences(user.userId);
      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }
      return await reply.ok({ notificationLevel: result.value.notificationLevel });
    }
  );

  fastify.put<{ Body: PutBody }>(
    '/whatsapp/preferences',
    {
      schema: {
        operationId: 'updateWhatsAppPreferences',
        summary: 'Update WhatsApp notification preferences',
        tags: ['whatsapp'],
        body: {
          type: 'object',
          required: ['notificationLevel'],
          properties: {
            notificationLevel: { type: 'string', enum: ['all', 'important'] },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['notificationLevel'],
                properties: {
                  notificationLevel: { type: 'string', enum: ['all', 'important'] },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: { $ref: 'ErrorBody#' },
          401: { $ref: 'ErrorBody#' },
        },
      },
    },
    async (request: FastifyRequest<{ Body: PutBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'PUT /whatsapp/preferences' });
      const user = await requireAuth(request, reply);
      if (!user) return;
      const parsed = putSchema.safeParse(request.body);
      if (!parsed.success) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
          errors: parsed.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      const level: NotificationLevel = parsed.data.notificationLevel;
      const { notificationPreferencesRepository } = getServices();
      const result = await notificationPreferencesRepository.savePreferences(user.userId, level);
      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }
      return await reply.ok({ notificationLevel: result.value.notificationLevel });
    }
  );

  done();
};
```

In `apps/whatsapp-service/src/routes/index.ts` add:

```ts
import { preferencesRoutes } from './preferencesRoutes.js';
// ...
fastify.register(preferencesRoutes);
```

Update `apps/whatsapp-service/src/routes/routes.ts` comment map with:

```
 * GET    /whatsapp/preferences        → ./preferencesRoutes.ts
 * PUT    /whatsapp/preferences        → ./preferencesRoutes.ts
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @intexuraos/whatsapp-service test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/whatsapp-service/src/routes/preferencesRoutes.ts \
        apps/whatsapp-service/src/routes/index.ts \
        apps/whatsapp-service/src/routes/routes.ts \
        apps/whatsapp-service/src/__tests__/preferencesRoutes.test.ts
git commit -m "feat(whatsapp-service): GET/PUT /whatsapp/preferences (INT-1418)"
```

---

## Task 10 — Update fakes in caller services (test-only plumbing)

**Files:**
- Modify: `apps/actions-agent/src/__tests__/fakes.ts`
- Modify: `apps/bookmarks-agent/src/__tests__/fakeWhatsAppSendPublisher.ts`
- Modify: any other `FakeWhatsAppSendPublisher` shown by `rg "class Fake.*WhatsAppSendPublisher|publishSendMessage\s*\(" apps/**/__tests__`

- [ ] **Step 1:** In each fake, extend the `publishSendMessage` param type to include `important?: boolean`. No behavior change — the fakes accept the extra field and either store it or ignore it. This is purely to satisfy the new publisher signature so existing tests compile.

Example diff for `apps/bookmarks-agent/src/__tests__/fakeWhatsAppSendPublisher.ts`:

```ts
  async publishSendMessage(params: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    important?: boolean;           // INT-1418
    correlationId?: string;
  }): Promise<Result<void, PublishError>> { ... }
```

- [ ] **Step 2:** Run `pnpm build` from repo root. Expect green.

- [ ] **Step 3: Commit**

```bash
git add apps/actions-agent/src/__tests__/fakes.ts \
        apps/bookmarks-agent/src/__tests__/fakeWhatsAppSendPublisher.ts
git commit -m "test: extend FakeWhatsAppSendPublisher with important flag (INT-1418)"
```

---

## Task 11 — Annotate each call site with `important: true` per the audit table

For each row in the "Audit" section above marked **important**, add `important: true` to the `publishSendMessage({...})` call. Rows marked **not important** get no change.

**Files to modify (one-liner changes each):**
- `apps/actions-agent/src/infra/notification/whatsappNotificationSender.ts` — line 41
- `apps/actions-agent/src/domain/usecases/handleApprovalReply.ts` — lines 174, 240
- `apps/actions-agent/src/domain/usecases/handleActionTemplate.ts` — line 64
- `apps/actions-agent/src/domain/usecases/executeActionTemplate.ts` — the single call site
- `apps/actions-agent/src/domain/usecases/executeCodeAction.ts` — line 206
- `apps/actions-agent/src/domain/usecases/approval/executeRejection.ts` — lines 39, 59
- `apps/actions-agent/src/domain/usecases/approval/handleButtonResponse.ts` — lines 83, 100
- `apps/actions-agent/src/domain/usecases/approval/handleCancelTaskButton.ts` — lines 22, 32, 57, 71
- `apps/actions-agent/src/domain/usecases/approval/handleProceedToImplementationButton.ts` — lines 55, 72
- `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` — lines 170, 208, 245, 281, 311, 322, 381, 410, 496 (see audit for which are important vs not)
- `apps/research-agent/src/infra/notification/WhatsAppNotificationSender.ts` — lines 39, 55

**Deliberately NOT modified (kept as not-important):**
- `apps/bookmarks-agent/src/domain/usecases/summarizeBookmark.ts`
- `apps/actions-agent/src/domain/usecases/executeLinkAction.ts`
- `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts`
- `apps/mobile-notifications-service/src/infra/notification/whatsappDigestNotifier.ts`
- `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` lines 150, 354, 445, 470 (progress / informational)

- [ ] **Step 1: Write the failing tests**

For each service that gets an edit, update one existing test (or add one) to assert `important: true` is passed. Example for actions-agent (add to `apps/actions-agent/src/__tests__/usecases/handleApprovalReply.test.ts`):

```ts
it('marks approval-not-found replies as important', async () => {
  // ... arrange ...
  await usecase.execute(...);
  expect(fakePublisher.lastCall?.important).toBe(true);
});
```

(Requires the fake to expose `lastCall` — add that accessor in Task 10.)

- [ ] **Step 2: Run tests — expect failures**

Run: `pnpm --filter @intexuraos/actions-agent test -- handleApprovalReply`
Expected: FAIL — flag not yet passed.

- [ ] **Step 3: Add `important: true` to the identified call sites**

Do not bulk-edit with sed. Each call site is small; edit them one file at a time. For each change:
- Open the file.
- Locate the `publishSendMessage({...})` call.
- Add `important: true,` as the last property (do not drop the trailing comma in strict style files).

- [ ] **Step 4: Run all tests**

Run: `pnpm run ci:tracked`
Expected: all workspaces green.

- [ ] **Step 5: Commit**

```bash
git add apps/actions-agent apps/code-agent apps/research-agent
git commit -m "feat: mark important WhatsApp notifications per INT-1418 audit"
```

---

## Task 12 — Web: API client for preferences

**Files:**
- Create: `apps/web/src/services/whatsappPreferencesApi.ts`
- Modify: `apps/web/src/services/index.ts` (barrel)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/services/__tests__/whatsappPreferencesApi.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getWhatsAppPreferences,
  updateWhatsAppPreferences,
} from '../whatsappPreferencesApi.js';

describe('whatsappPreferencesApi', () => {
  beforeEach(() => vi.spyOn(global, 'fetch'));
  afterEach(() => vi.restoreAllMocks());

  it('GET hits /whatsapp/preferences with bearer token', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { notificationLevel: 'important' } }))
    );
    const result = await getWhatsAppPreferences('tok');
    expect(result.notificationLevel).toBe('important');
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('PUT sends the new level', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { notificationLevel: 'all' } }))
    );
    const result = await updateWhatsAppPreferences('tok', { notificationLevel: 'all' });
    expect(result.notificationLevel).toBe('all');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/web test -- whatsappPreferencesApi`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { config } from '@/config';
import { apiRequest } from './apiClient.js';

export type NotificationLevel = 'all' | 'important';

export interface WhatsAppPreferences {
  notificationLevel: NotificationLevel;
}

export async function getWhatsAppPreferences(
  accessToken: string
): Promise<WhatsAppPreferences> {
  return await apiRequest<WhatsAppPreferences>(
    config.whatsappServiceUrl,
    '/whatsapp/preferences',
    accessToken
  );
}

export async function updateWhatsAppPreferences(
  accessToken: string,
  body: WhatsAppPreferences
): Promise<WhatsAppPreferences> {
  return await apiRequest<WhatsAppPreferences>(
    config.whatsappServiceUrl,
    '/whatsapp/preferences',
    accessToken,
    { method: 'PUT', body }
  );
}
```

Re-export from `apps/web/src/services/index.ts`.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/whatsappPreferencesApi.ts \
        apps/web/src/services/index.ts \
        apps/web/src/services/__tests__/whatsappPreferencesApi.test.ts
git commit -m "feat(web): whatsappPreferencesApi client (INT-1418)"
```

---

## Task 13 — Web: `WhatsAppPreferencesCard` component

**Files:**
- Create: `apps/web/src/components/WhatsAppPreferencesCard.tsx`

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/__tests__/WhatsAppPreferencesCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WhatsAppPreferencesCard } from '../WhatsAppPreferencesCard.js';

const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock('@/services/whatsappPreferencesApi', () => ({
  getWhatsAppPreferences: (t: string) => mockGet(t),
  updateWhatsAppPreferences: (t: string, b: { notificationLevel: 'all' | 'important' }) =>
    mockPut(t, b),
}));
vi.mock('@/context', () => ({
  useAuth: () => ({ getAccessToken: () => Promise.resolve('tok') }),
}));

describe('WhatsAppPreferencesCard', () => {
  it('renders the current level and switches when user clicks "Important only"', async () => {
    mockGet.mockResolvedValue({ notificationLevel: 'all' });
    mockPut.mockResolvedValue({ notificationLevel: 'important' });
    render(<WhatsAppPreferencesCard />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /all messages/i })).toBeChecked());
    fireEvent.click(screen.getByRole('radio', { name: /important only/i }));
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('tok', { notificationLevel: 'important' })
    );
  });

  it('shows an error toast when the PUT fails', async () => {
    mockGet.mockResolvedValue({ notificationLevel: 'all' });
    mockPut.mockRejectedValue(new Error('boom'));
    render(<WhatsAppPreferencesCard />);
    await waitFor(() => screen.getByRole('radio', { name: /all messages/i }));
    fireEvent.click(screen.getByRole('radio', { name: /important only/i }));
    await waitFor(() => expect(screen.getByText(/failed to update/i)).toBeInTheDocument());
  });

  it('is disabled while the initial fetch is in flight', async () => {
    mockGet.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<WhatsAppPreferencesCard />);
    expect(screen.getByRole('radio', { name: /all messages/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component**

Use the project's existing `Card` + Tailwind patterns (see `WhatsAppConnectionPage.tsx` for examples). Visual spec:

- Title: "Notification Preferences".
- Subtitle: "Choose which WhatsApp messages from IntexuraOS you want to receive."
- Segmented control with two radio buttons:
  - **All messages** (default) — "Everything IntexuraOS sends you, including progress updates and summaries."
  - **Important only** — "Only urgent notifications: task failures, approval requests, and completed long-running work."
- Optimistic UI: click → immediately update state → call PUT → on failure, revert and show an inline red error banner.
- Loading state: disable both radios + show spinner while the initial GET resolves.
- Empty-state hint (shown above the radios only when no phone numbers are connected yet): "You'll start receiving messages once you verify a phone number below."

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components';
import { useAuth } from '@/context';
import {
  getWhatsAppPreferences,
  updateWhatsAppPreferences,
  type NotificationLevel,
} from '@/services/whatsappPreferencesApi';

export function WhatsAppPreferencesCard(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [level, setLevel] = useState<NotificationLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const token = await getAccessToken();
        const prefs = await getWhatsAppPreferences(token);
        setLevel(prefs.notificationLevel);
      } catch {
        setLevel('all');
      }
    })();
  }, [getAccessToken]);

  const change = useCallback(
    async (next: NotificationLevel) => {
      if (level === null || level === next || saving) return;
      const previous = level;
      setLevel(next);
      setSaving(true);
      setError(null);
      try {
        const token = await getAccessToken();
        await updateWhatsAppPreferences(token, { notificationLevel: next });
      } catch {
        setLevel(previous);
        setError('Failed to update notification preferences. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [level, saving, getAccessToken]
  );

  const disabled = level === null;
  const current = level ?? 'all';

  return (
    <Card title="Notification Preferences">
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Choose which WhatsApp messages from IntexuraOS you want to receive.
      </p>
      <fieldset className="space-y-2" disabled={disabled}>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          <input
            type="radio"
            name="wa-level"
            value="all"
            checked={current === 'all'}
            disabled={disabled}
            onChange={() => void change('all')}
          />
          <span>
            <span className="font-medium">All messages</span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">
              Everything IntexuraOS sends you, including progress updates and summaries.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          <input
            type="radio"
            name="wa-level"
            value="important"
            checked={current === 'important'}
            disabled={disabled}
            onChange={() => void change('important')}
          />
          <span>
            <span className="font-medium">Important only</span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">
              Only urgent notifications: task failures, approval requests, and completed
              long-running work.
            </span>
          </span>
        </label>
      </fieldset>
      {error !== null ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @intexuraos/web test -- WhatsAppPreferencesCard`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/WhatsAppPreferencesCard.tsx \
        apps/web/src/components/__tests__/WhatsAppPreferencesCard.test.tsx
git commit -m "feat(web): add WhatsAppPreferencesCard (INT-1418)"
```

---

## Task 14 — Web: mount the card in the existing WhatsApp settings tab

**Files:**
- Modify: `apps/web/src/pages/WhatsAppConnectionPage.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/__tests__/pages/WhatsAppConnectionPage.test.tsx` (or create it if missing):

```tsx
it('renders the preferences card after the connection form', async () => {
  render(<WhatsAppConnectionPage />);
  await waitFor(() => screen.getByRole('heading', { name: /Notification Preferences/i }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — card not rendered.

- [ ] **Step 3: Mount the card**

In `apps/web/src/pages/WhatsAppConnectionPage.tsx`:

```tsx
import { WhatsAppPreferencesCard } from '@/components/WhatsAppPreferencesCard';
// ...
{status?.connected === true ? (
  <>
    <Card title="Current Status" variant="success">...</Card>
    <WhatsAppPreferencesCard />
  </>
) : (
  <WhatsAppPreferencesCard />
)}
```

Place it so it is always visible, even before the user connects a phone — the setting can be configured ahead of time.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @intexuraos/web test -- WhatsAppConnectionPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WhatsAppConnectionPage.tsx \
        apps/web/src/__tests__/pages/WhatsAppConnectionPage.test.tsx
git commit -m "feat(web): mount WhatsAppPreferencesCard in WhatsApp tab (INT-1418)"
```

---

## Task 15 — Update `firestore-collections.json` description

**Files:**
- Modify: `firestore-collections.json`

- [ ] **Step 1:** Edit the `whatsapp_user_mappings` entry's `description` to:

```
"Phone number → user ID mappings for WhatsApp integration; also stores the per-user notificationLevel ('all' | 'important', default 'all') used by whatsapp-service to filter outbound messages (INT-1418)."
```

- [ ] **Step 2:** Run `pnpm run ci:tracked` to confirm no schema validator complains.

- [ ] **Step 3: Commit**

```bash
git add firestore-collections.json
git commit -m "docs(firestore): document notificationLevel on whatsapp_user_mappings (INT-1418)"
```

---

## Task 16 — Final verification

- [ ] Run from repo root: `pnpm run ci:tracked`
- [ ] Verify no tests skipped, no new v8-ignore comments introduced.
- [ ] Verify `GET /whatsapp/status` response does NOT include `notificationLevel` (manually — inspect the route handler and the schema).
- [ ] Verify `user-service` was not touched (`git diff --stat origin/development -- apps/user-service` should be empty).
- [ ] Verify `packages/infra-whatsapp` was not touched (`git diff --stat origin/development -- packages/infra-whatsapp` should be empty).
- [ ] Verify the Pub/Sub contract tests still pass: `pnpm --filter @intexuraos/infra-pubsub test`.

---

## Self-Review

**1. Spec coverage:**
- ✅ "user has its own setting" — `whatsapp_user_mappings.notificationLevel` (Task 4).
- ✅ "belonging strictly to the WhatsApp service" — owned by `whatsapp-service`, no `user-service` changes.
- ✅ "all (default) or important" — `NotificationLevel = 'all' | 'important'`, `DEFAULT_NOTIFICATION_LEVEL = 'all'` (Task 1).
- ✅ "WhatsApp message interface must accept an optional parameter that will indicate if the message is important" — `important?: boolean` on `SendMessageEvent` + `publishSendMessage(...)` (Tasks 6, 7).
- ✅ "nice UI in the WhatsApp settings tab" — `WhatsAppPreferencesCard` in `WhatsAppConnectionPage.tsx` (Tasks 13, 14).
- ✅ "corresponding endpoint" — `GET`/`PUT /whatsapp/preferences` (Task 9).
- ✅ "Firestore storage" — `whatsapp_user_mappings.notificationLevel` (Task 4).
- ✅ "WhatsApp interface changes" — publisher + internal event (Tasks 6, 7) + consumer filter (Task 8).
- ✅ "these settings must not be exposed anywhere" — preferences are never in `GET /whatsapp/status`, never on Pub/Sub topics, never read by other services; Task 9's privacy test makes this machine-enforced.
- ✅ "identify all WhatsApp messages that are sent from IntexuraOS" — exhaustive audit table above with recommended importance.

**2. Placeholder scan:** No "TBD", no "handle edge cases", no "similar to Task N". Every task has complete code blocks.

**3. Type consistency:**
- `NotificationLevel` = `'all' | 'important'` — used identically in: domain model, port, route schemas, Firestore doc, web API client, component.
- `notificationLevel` property name used identically in: Firestore doc, HTTP request/response bodies, web types.
- `important?: boolean` used identically in: `SendMessageEvent` (publisher), `SendMessageEvent` (whatsapp-service internal), Pub/Sub consumer decision, every caller.

---

## Parallel Work Notes

This plan is sequential (Tasks 1→16), intended for a single executor. It is **not** broken into subtasks because the user requested planning only (no subtasks) — see issue INT-1418 classification PLAN-DOC.
