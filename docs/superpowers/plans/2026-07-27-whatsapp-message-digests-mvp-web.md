# WhatsApp Message Digests — MVP Web Implementation Plan

> **For the primary agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute every
> task in order. Implementation subagents are forbidden; review subagents are read-only and may be
> used only after a bounded artifact is complete.

**Goal:** Deliver and prove the fastest polished UI vertical slice for creating, previewing,
running, inspecting, editing, and deleting both group and direct WhatsApp Message Digests.

**Architecture:** The Web app owns presentation state only. It reads source conversations from the
existing authenticated Private WhatsApp API, reads connection presentation from the existing
WhatsApp status API, and sends all digest commands to `message-digest-service`. Canonical digest
routes live under WhatsApp; recipient choice never enters form state or an API request.

**Tech stack:** React 19, React Router hash routing, TypeScript, Tailwind, Radix-backed existing UI
components, Lucide, existing API client/Auth0 hooks, Vitest, Testing Library, the already-running
system Google Chrome.

**Authoritative input:**
`docs/superpowers/plans/2026-07-27-whatsapp-message-digests-execution-goal.md` and the completed backend
contract in `2026-07-27-whatsapp-message-digests-mvp-backend.md`.

## Global execution constraints

- Continue on `codex/whatsapp-message-digests`; execute sequentially in the primary agent.
- Write and observe one focused RED test before every behavior change, then minimal GREEN and local
  refactor. Do not delegate implementation.
- Do not add feature flags, alternate routes behind toggles, a recipient selector, a model selector,
  a Mobile Notifications source/fallback, or a second visual system.
- Do not commit, deploy, migrate production data, or run `pnpm run ci:tracked` in this plan.
- Preserve unrelated user files and do not capture private chat names/messages or full phone numbers
  in fixtures, snapshots, screenshots, logs, or handoff text.
- Browser acceptance uses only the system Google Chrome that is already running with the user's
  profile. Control it through the Chrome integration; do not launch Chrome, Chromium, Playwright,
  Computer Use as a substitute browser, or a temporary profile.
- Local auth starts at `http://localhost:3000/#/login` and uses Google account
  `kontakt@pbuchman.com`. If that same Chrome requires an interactive sign-in the user must complete
  it there; no credential store, cookie DB, browser profile DB, or auth token may be inspected.
- All temporary definitions created in the isolated local Message Digest emulator namespace must be
  deleted through the UI before this plan completes; real WhatsApp receipt metadata may still be
  written by the authorized owner service. Source WhatsApp chats are read-only.

## UX direction fixed for MVP

Use the existing slate/blue IntexuraOS language, existing `Button`, `Card`, `Input`, `Modal`,
`ErrorBanner`, and typography. The feature is distinctive through clarity, not decoration:

```text
[Group or contact]  →  [Daily · local time]  →  [Primary WhatsApp]
      Source                 Digest                    Delivery
```

The delivery-path component appears on create/edit and detail. It explains that the selected chat
is the source while delivery goes to the user's primary mapped number. Display only a locally masked
number such as `•••• 1234`; never pass it in digest payloads.

MVP supports daily cadence in UI. Weekdays/weekly controls remain absent until the feature-completion
plan; this is sequential construction of one unreleased change, not a feature flag.

### Canonical routes

- `/whatsapp/message-digests`
- `/whatsapp/message-digests/new`
- `/whatsapp/message-digests/:definitionId`
- `/whatsapp/message-digests/:definitionId/edit`
- `/whatsapp/message-digests/:definitionId/history`
- `/whatsapp/message-digests/:definitionId/history/:runId`

MVP legacy routes redirect without rendering old digest data:

- `/notifications/digests` and `/notifications/digests/backfill` → canonical list;
- `/notifications/digests/:groupKey/:date` → an owner-safe alias-resolution loading route, then the
  canonical run when available, otherwise the canonical list with an explanatory notice;
- Fishing digest redirects are added later when the internal Fishing migration exists.

### MVP state model

`types/messageDigests.ts` mirrors public response fields only:

```ts
type MessageDigestChatType = 'group' | 'direct';
type MessageDigestDefinitionStatus = 'active' | 'paused' | 'deleting';
type MessageDigestEffectiveStatus = MessageDigestDefinitionStatus | 'needs_attention';
type MessageDigestGenerationStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped_no_activity';
type MessageDigestProcessingStage =
  | 'queued'
  | 'reading_messages'
  | 'aggregating'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'skipped_no_activity';
type MessageDigestDeliveryStatus = 'not_sent' | 'pending' | 'sent' | 'ambiguous' | 'failed';

interface MessageDigestSchedule {
  kind: 'daily';
  localTime: string;
  timeZone: string;
}
```

Definition DTOs include ID/revision/name, safe source snapshot, exact instructions/template ID,
schedule, effective status/readiness, checkpoint/next/last timestamps, latest run, and timestamps.
They never include source account/generation, phone, raw source messages, LLM input, or model
reasoning. Run DTOs include immutable window/count/output, coarse generation status, exact
processing stage, delivery status, prompt snapshot, and safe failure code. Erasure is never squeezed
into definition or run status; it has its own progress DTO and `nextAction`.

### Interaction requirements owned by MVP

- `NAV-01..03`
- `LIST-01..08`, `LIST-10..12`; `LIST-09` covers View/Edit/Run/Delete
- `FORM-01..04`
- `PICK-01..04`
- `PROMPT-01..06`
- daily portions of `SCHED-01..02`, plus `SCHED-03..04`
- `DETAIL-01..02`, `DETAIL-06..07`
- `HIST-02..03`
- `RUN-01`
- `CTA-01`

Use the exact labels, empty/loading/error behavior, disabled reasons, focus, and 44px target contracts
from the execution goal's UX matrix.

## File inventory

### Create

- `apps/web/src/types/messageDigests.ts`
- `apps/web/src/services/messageDigestsApi.ts`
- `apps/web/src/services/__tests__/messageDigestsApi.test.ts`
- `apps/web/src/hooks/useMessageDigests.ts`
- `apps/web/src/hooks/__tests__/useMessageDigests.test.ts`
- `apps/web/src/components/message-digests/MessageDigestDeliveryPath.tsx`
- `apps/web/src/components/message-digests/MessageDigestStatusBadge.tsx`
- `apps/web/src/components/message-digests/MessageDigestConversationPicker.tsx`
- `apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx`
- `apps/web/src/components/message-digests/MessageDigestList.tsx`
- `apps/web/src/components/message-digests/MessageDigestRunStatus.tsx`
- `apps/web/src/components/message-digests/MessageDigestDeleteDialog.tsx`
- `apps/web/src/components/message-digests/index.ts`
- focused component tests under
  `apps/web/src/components/message-digests/__tests__/`
- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestNewPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestEditPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestHistoryPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestRunPage.tsx`
- `apps/web/src/pages/MessageDigestLegacyRedirectPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx`

### Modify

- `apps/web/service-manifest.json`
- generated `apps/web/src/config.generated.ts`
- `apps/web/src/config.ts`
- `apps/web/src/types/index.ts`
- `apps/web/vitest.config.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/sidebar/navItems.ts`
- `apps/web/src/components/sidebar/NotificationsSection.tsx`
- `apps/web/src/components/sidebar/useSidebarState.ts`
- `apps/web/src/__tests__/navigationStructure.test.ts`
- existing App/routing/sidebar tests that assert route ownership
- `scripts/dev-setup.mjs`
- `scripts/log-viewer.mjs`
- `ecosystem.config.cjs`
- `ecosystem.generated.cjs`
- `scripts/__tests__/ecosystem.config.test.ts`
- `scripts/__tests__/verify-web-service-manifest.test.ts`

Do not delete the old Web digest implementation yet. This plan removes its active navigation and
replaces its routes with redirects; physical deletion belongs to the migration/removal plan after
Fishing compatibility and migration aliases exist.

## Sequential TDD tasks

### Task 1: Wire the local service URL and canonical routes

1. Add a manifest verification test expecting `message-digest-service`,
   `INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL`, `/api/message-digests`, and port `8135`. Observe RED.
2. Add the manifest entry, run `pnpm run generate:service-wiring`, add the config/AppConfig property,
   and add the test env URL. Re-run the manifest test; expect GREEN.
3. Add navigation tests asserting `Message Digests` appears inside WhatsApp, the Mobile Notifications
   digest item is absent, nested digest routes keep WhatsApp expanded/active, and the six canonical
   routes lazy-load. Observe RED.
4. Add route placeholders as real accessible loading pages, route registrations, nav item, and legacy
   redirects. Remove only the active old Mobile digest nav entry, not files. Re-run; expect GREEN.
5. Add local PM2/dev setup/log-viewer entries and tests for port/order/env wiring. Do not touch
   production PM2/nginx in this plan.

Focused commands:

```bash
pnpm exec vitest run scripts/__tests__/verify-web-service-manifest.test.ts scripts/__tests__/ecosystem.config.test.ts apps/web/src/__tests__/navigationStructure.test.ts apps/web/src/__tests__/App.lazyRoutes.test.tsx apps/web/src/components/__tests__/Sidebar.test.tsx
pnpm run verify:service-wiring
```

### Task 2: Implement strict API types and transport

1. Add API tests for the exact list/history filter grammar, cursor/sort query fingerprints, create
   client request ID, get, CAS patch, delivery readiness, schedule preview, content preview, run
   preparation token, confirm-run request ID/token, run detail, repeated deletion request ID,
   erasure status recovery, URL encoding, and error envelopes. Observe RED on missing service.
2. Implement public-only types and `messageDigestsApi.ts` with `apiRequest`. Build query strings with
   `URLSearchParams`; never interpolate an unencoded opaque ID.
3. Add presentation helper tests for status labels, safe dates/time zones, phone masking, and source
   type labels. Implement pure helpers in `types/messageDigests.ts` or the relevant components.
4. Re-run API/helper tests; expect GREEN. Confirm no DTO accepts `recipient`, `phoneNumber`,
   `userId`, `sourceAccountId`, or `generationId`.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/services/__tests__/messageDigestsApi.test.ts
```

### Task 3: Implement hooks as explicit request state machines

1. Add hook tests for initial load, background refresh preserving data, refresh error preserving data,
   load more/deduplication, stale response cancellation, auth user switch reset, create recovery,
   patch conflict, stable request IDs across retry/reload, run-prepare stale-token refresh, run
   polling to terminal, no duplicate run on reload, repeated DELETE progress, GET-only deletion
   recovery with `nextAction=resume_delete`, and terminal polling stop. Observe RED incrementally.
2. Implement hooks/reducers in `useMessageDigests.ts`. Keep server state authoritative; optimistic
   pause/delete UI is not part of MVP. Store active request IDs in component state/session-safe
   request state only, never private data in local storage.
3. Use bounded exponential polling for non-terminal generation stages, pending delivery, and erasure.
   When erasure GET says `resume_delete`, repeat DELETE with the original request ID; GET itself never
   advances deletion. Cancel timers on unmount/auth change. Treat sent, failed, ambiguous,
   skipped-no-activity, and completed erasure according to the separate DTOs as terminal.
4. Re-run the hook file after each behavior; expect GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/hooks/__tests__/useMessageDigests.test.ts
```

### Task 4: Build the list with truthful complete states

1. Add component/page tests for initial skeleton, background refresh, first-use empty state, Private
   Mirror missing, mapping missing, initial error/retry, refresh error with retained rows, filter empty,
   pagination, source unavailable, needs attention, desktop table, mobile cards, and independent
   44×44 action menu. Observe RED one state at a time.
2. Implement header, `Refresh`, `New digest`, search, status chips, source filter, clear filters, table,
   cards, and menu. A non-empty search switches to backend-required name sorting with accessible
   explanatory copy; clearing it restores the user's prior sort. Status always has text/icon, never
   color only.
3. Actions are `View details`, `Edit`, `Run now`, and `Delete digest` at MVP. Disable unsafe actions
   with a visible reason; do not hide errors behind empty states.
4. Preserve rows during refresh/load-more errors and announce transitions using `role=status` or
   `role=alert`. Re-run list/page tests; expect GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestList.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx
```

### Task 5: Build the group/direct conversation picker

1. Add picker tests for initial chats, search, All/Groups/Direct tabs, cursor load more, group/direct
   metadata, unknown type disabled, selected row, Cancel, `Use conversation`, retry, and focus return.
   Observe RED.
2. Implement the dialog using the existing Private WhatsApp chat list API and Radix-backed `Modal`.
   Reuse chat presentation conventions but do not copy the full Private WhatsApp page.
3. Ensure all row actions are keyboard reachable, target size is 44px, long names wrap, and the
   selected value contains only public `chatId`, type, and display snapshot needed by create.
4. Re-run; expect GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx
```

### Task 6: Build create/edit with templates, preview, daily schedule, and readiness

1. Add form tests for required name/source/instructions, trimmed limits, focus-first-error, group
   default, direct default, template insertion into empty instructions, replace confirmation for
   non-empty instructions, `Custom` preserving text/focus (`PROMPT-05`), preview close/retry focus
   (`PROMPT-06`), daily local time/time zone, backend-calculated next-delivery copy, readiness card,
   missing mapping paused create, dirty navigation, pending disables, and source change before first
   run. Observe RED incrementally.
2. Implement the four sections: Digest details, Source conversation, Digest instructions, Schedule
   and delivery. Use the exact fishing and sentiment template text returned/exported for Web display;
   copied text remains editable.
3. Fetch `GET /message-digests/delivery-readiness` for the exact backend-derived status,
   observation version, and masked first number. Fetch `POST /message-digests/schedule-preview` for
   prior/next window copy. Never include a number in create/update/preview; do not duplicate schedule
   or readiness business rules in React. The backend response remains authoritative if mapping
   status changes between render and submit.
4. Add preview tests for exact window display, loading, empty/no-activity result, successful Markdown,
   recoverable error, zero form mutation, and no success copy implying delivery. Implement preview.
5. Add page tests for create redirect/detail focus, edit CAS conflict/reload, locked source once any run
   exists, cancel/back, and discarded-change confirmation. Implement pages and re-run; expect GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx
```

### Task 7: Build detail, Run now, basic history, run detail, and deletion

1. Add detail tests for delivery path, schedule, prompt copy, readiness, latest run, last five runs,
   source/mapping disabled reasons, edit, history link, and owner-safe 404. Observe RED.
2. Add Run-now tests proving the dialog first calls `POST /run/prepare` and shows its exact
   checkpoint/window/time zone/readiness. Confirm sends the short-lived token once; a stale token
   leaves everything unsent, refreshes preparation, and requires confirmation again. Cover
   double-click, `Starting…`, every processing stage, page reload, completed `Sent`, skipped no
   activity, generation failure, delivery failure/ambiguous, and exact run link. Observe RED.
3. Implement detail and run polling. Never compute the window client-side or label transport
   acceptance as provider delivery; use `Sent` exactly.
4. Add history/run-detail tests for empty state, active row polling, generation stage and delivery
   badges as separate columns, exact date/status URL filters and sort, cursor-filter fingerprint,
   `View full history` navigation/focus (`DETAIL-07`), cursor load more, retained load-more error,
   local-zone `<time>`, Markdown output, source count, prompt/config snapshot, technical details
   collapsed, and canonical back links. Implement basic history/detail.
5. Add delete tests for explicit confirmation, original-chat safety copy, non-dismissible pending
   phase, reload/resume by erasure ID, terminal redirect/list focus, and error retry. Implement using
   the existing deletion-dialog interaction pattern.
6. Re-run the consolidated page suite; expect GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestRunStatus.test.tsx src/components/message-digests/__tests__/MessageDigestDeleteDialog.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx
```

### Task 8: Close automated MVP Web quality gates

1. Add responsive contract tests at 390×844 and desktop semantics: cards vs table, no nested links,
   `min-w-0`, wrapping, 44px controls, no required horizontal scroll, dialog focus/Escape/return,
   visible disabled reasons, live regions, semantic table headers, and reduced motion. Observe RED for
   every missing contract, then fix.
2. Verify dark class styling and 200% zoom-friendly layout without fixed content heights.
3. Run all focused Web tests, typecheck, targeted lint, service-wiring verification, and
   `git diff --check`. Fix only observed issues and repeat the affected command.
4. Self-review every MVP interaction ID. Request one read-only UX/accessibility review against the
   completed pages; resolve accepted Critical/Important findings with RED/GREEN tests.

Commands:

```bash
pnpm --filter @intexuraos/web test -- src/services/__tests__/messageDigestsApi.test.ts src/hooks/__tests__/useMessageDigests.test.ts src/components/message-digests/__tests__ src/pages/__tests__/MessageDigestsPages.test.tsx src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx src/__tests__/navigationStructure.test.ts src/__tests__/App.lazyRoutes.test.tsx src/components/__tests__/Sidebar.test.tsx
pnpm --filter @intexuraos/web typecheck
pnpm exec eslint apps/web/src/types/messageDigests.ts apps/web/src/services/messageDigestsApi.ts apps/web/src/hooks/useMessageDigests.ts apps/web/src/components/message-digests apps/web/src/pages/WhatsAppMessageDigest*.tsx apps/web/src/pages/MessageDigestLegacyRedirectPage.tsx --max-warnings 0
pnpm run verify:service-wiring
pnpm run verify:workspace:tracked -- web
git diff --check
```

### Task 9: Run the local real-Chrome/WhatsApp MVP gate

1. Start/update required local services through the repository PM2 workflow. Confirm port `8135`
   health and `http://localhost:3000` without launching any browser.
2. Attach only to the already-running system Chrome. Inspect current tabs, reuse or open
   `http://localhost:3000/#/login`, and authenticate as `kontakt@pbuchman.com` through Google only if
   needed in that same profile.
3. At 1280×800 verify WhatsApp navigation, list states, and create a timestamp-named temporary group
   digest using the fishing template. Change its source once before the first run, restore the intended
   group, preview, save active daily, and inspect detail.
4. Create a timestamp-named temporary direct digest using the sentiment template. Verify no recipient
   field exists and the read-only primary mapping is masked.
5. Run both using `Run and send`. Reload one page while active. Verify exactly one logical run each,
   queued/generating → completed plus truthful `Sent`, history persistence, run detail, and CTA.
6. In WhatsApp Web in the same Chrome, verify exactly one new IntexuraOS message for each recorded
   start time. Open each CTA and confirm the exact local canonical run route/content. In the product
   UI, double-click the confirmation action and reload the same in-flight manual request; confirm no
   duplicate message appears. Duplicate scheduler-tick and exact-request-ID replay are proven by the
   backend integration gates, not by calling internal routes from Chrome.
7. At 390×844 verify cards, menus, create/detail/history/run routes, focus visibility, 44px targets,
   keyboard reachability, long-text wrapping, and zero horizontal overflow. Also inspect console and
   network panels through Chrome integration for unexpected errors or duplicate requests.
8. Delete both temporary definitions through the UI, wait for terminal cleanup, refresh list/history,
   and verify source chats remain. Record only safe route/state/timestamp/run-count evidence in the
   execution goal; do not record names, source text, IDs that expose chats, or phone digits.
9. Stop only temporary schedules/data created by this acceptance. Keep repository services available
   for the next sequential plan if healthy.

## Plan completion gate

This plan is complete only after automated MVP UX gates, review, and the real Chrome/WhatsApp gate
all pass for one group and one direct definition, with cleanup complete. Continue directly to
`2026-07-27-whatsapp-message-digests-feature-completion.md`; do not commit, deploy, migrate legacy
data, or run full CI.
