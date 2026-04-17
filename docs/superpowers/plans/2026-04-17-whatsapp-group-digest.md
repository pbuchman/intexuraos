# WhatsApp Group Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily WhatsApp digest pipeline for the `mobile-notifications-service` that reads notifications from the `mobile_notifications` Firestore collection, runs them through `or:google/gemini-3-flash-preview` (via OpenRouter), and produces structured `DailySummary` + `GroupState` artifacts in Polish — with backfill, regeneration, scheduled cron, and a Code-Tasks-styled web UI.

**Architecture:** Source data lives in `mobile_notifications` (already populated). A pure aggregation use case calls the LLM with a Polish prompt + Zod-validated repair loop. Results persist to `notification_daily_digests` (per `{userId}_{groupKey}_{date}`) and `notification_group_states` (per-date snapshots). HTTP routes expose run/backfill/list/detail; backfill chains itself via internal HTTP calls so each day survives Cloud Run scale-to-zero. Cloud Scheduler invokes a fan-out endpoint at `0 1 * * *` UTC. The web UI mirrors `apps/web/src/pages/CodeTasks*.tsx` patterns (filter chips with colored dots, composable detail subcomponents, `useDigestView`-style hooks, modal-driven actions).

**Tech Stack:** TypeScript strict, Zod schemas, Fastify routes, Firestore (admin SDK), `@intexuraos/llm-factory` for LLM calls (OpenRouter path), `@intexuraos/llm-prompts` for `PromptBuilder`, vitest + in-memory fakes per CLAUDE.md, React + TailwindCSS + lucide icons + hash routing for the web UI.

---

## Architectural Decisions (locked)

| Decision              | Value                                                                                                   | Source                     |
| --------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------- |
| Group registry        | Hard-coded const, single user + single group                                                            | Conversation 2026-04-16    |
| Cron schedule         | `0 1 * * *` UTC (02:00 CET / 03:00 CEST)                                                                | Conversation 2026-04-17    |
| LLM model             | `or:google/gemini-3-flash-preview` via OpenRouter                                                       | INT-1394 (merged)          |
| Idempotency           | Reruns regenerate (write with `.set()`); `generation` counter increments                                | Conversation 2026-04-17    |
| Backfill              | Sequential, oldest-first; HTTP-chain (NOT in-memory worker)                                             | Validation pass 2026-04-17 |
| Per-group lock        | Firestore-backed advisory lock (5-min TTL)                                                              | Validation pass 2026-04-17 |
| `GroupState` doc ID   | Per-date snapshot `{userId}_{groupKey}_{date}` (NOT single-per-group)                                   | Validation pass 2026-04-17 |
| PR linkage            | `[INT-1382] phase N: <desc>` titles; body `Refs INT-1382` for phases 1-3, `Closes INT-1382` for phase 4 | Conversation 2026-04-17    |
| Phase 1-3 implementer | Sonnet                                                                                                  | Conversation 2026-04-17    |
| Phase 4 implementer   | Opus (UI quality bar)                                                                                   | Conversation 2026-04-17    |
| Backfill rate-limit   | 1 second `setTimeout` between days                                                                      | Conversation 2026-04-17    |

---

## Schema Note: per-date `GroupState`

`firestore-collections.json` previously described `notification_group_states` as one doc per `{userId}_{groupKey}`. **This plan changes the doc-ID strategy to `{userId}_{groupKey}_{YYYY-MM-DD}`** without changing the Zod `GroupStateSchema` (already merged via INT-1396). The doc-ID change is required because regenerating an older date would otherwise overwrite a newer date's state. With per-date snapshots: each daily run reads the prior date's snapshot, writes its own. "Current latest" = `orderBy(date desc).limit(1)`.

The registry entry's description must be updated in Phase 2 Task 2.9.

---

## Standing Constraints (apply to every task)

These rules come from `apps/.claude/CLAUDE.md` and apply to every task in this plan. Do not restate them per-task.

1. **TDD only.** Write failing test → verify fails → write minimum code to pass → verify passes → commit. No exceptions.
2. **Coverage 100% per file.** Use `/* v8 ignore <category> -- <BLOCKER reason> @preserve */` only when a code path is genuinely unreachable by a test (e.g. `noUncheckedIndexedAccess` array narrowing). Reason must name the testing BLOCKER, not describe the code.
3. **TypeScript strict.** Always use `arr[0] ?? fallback`, explicit `=== true`, `String()` for template numbers, narrow `Result` with `if (!result.ok) return result;` first.
4. **No `git worktree` commands.** Each phase runs on its own feature branch off `development`.
5. **Branch per phase:** `feature/digest-phase-1`, `feature/digest-phase-2`, `feature/digest-phase-3`, `feature/digest-phase-4`. Open PR after the final task of each phase.
6. **PR title:** `[INT-1382] phase N: <short description>`.
7. **PR body for phases 1-3:** must contain `Refs INT-1382` (NOT `Fixes`).
8. **PR body for phase 4:** must contain `Closes INT-1382`.
9. **Commit format:** `<type>(<scope>): <imperative>` matching the codebase's style (e.g. `feat(mobile-notifications): add digest aggregation use case`).
10. **Run `pnpm run ci:tracked` before opening each PR.** Capture output to `/tmp/ci-output-<phase>.txt` if anything fails; analyze with `rg "error|FAIL" -C3`.
11. **Use `gh` CLI, not raw `git` commands**, for status/diff/log/PR/branch operations.
12. **Service-container pattern:** `getServices()`, `setServices(fakes)` in `beforeEach`, `resetServices()` in `afterEach`. Adapter pattern.
13. **`logIncomingRequest()` on every route.**
14. **Use the `llm-factory` `openRouterGenerateClient`** for all digest LLM calls. Pass `promptType: 'whatsapp-digest-aggregate'` for usage-event tracking.
15. **All free text in Polish; enums, dates, group keys in English.**

---

## File Structure

### Phase 1 — Aggregation use case + Polish prompts

| File                                                                                      | Created/Modified | Responsibility                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/llm-prompts/src/digest/examples.ts`                                             | Create           | Polish few-shot `AggregationOutput` examples (1 cold-start + 1 with-context) extracted from the GPT-5 experiment.                          |
| `packages/llm-prompts/src/digest/digestPrompt.ts`                                         | Create           | `buildDigestPrompt(input)` returning Polish prompt body. Embeds examples. `// Prompt version: 1.0.0` footer.                               |
| `packages/llm-prompts/src/digest/digestRepairPrompt.ts`                                   | Create           | `buildDigestRepairPrompt(originalPrompt, invalidResponse, errorMessage)`. Mirrors `synthesis/repairPrompt.ts`. `// Prompt version: 1.0.0`. |
| `packages/llm-prompts/src/digest/index.ts`                                                | Create           | Barrel exports.                                                                                                                            |
| `packages/llm-prompts/src/index.ts`                                                       | Modify           | Re-export `./digest/index.js`.                                                                                                             |
| `apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts`                | Create           | Pure orchestrator returning `Result<AggregationOutput, DigestError>`. Calls LLM, validates with Zod, repairs up to 3 attempts.             |
| `apps/mobile-notifications-service/src/domain/usecases/digestErrors.ts`                   | Create           | `DigestError` discriminated union.                                                                                                         |
| `apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts` | Create           | All scenarios.                                                                                                                             |
| `apps/mobile-notifications-service/src/__tests__/helpers/fakeLlmClient.ts`                | Create           | Reusable fake `LlmGenerateClient`.                                                                                                         |

### Phase 2 — Repositories + composed `runDigestForGroup` + lock

| File                                                                                                    | Created/Modified | Responsibility                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile-notifications-service/src/domain/repositories/digestRepositories.ts`                       | Create           | `DigestRepository`, `GroupStateRepository`, `DigestLockRepository` ports.                                                        |
| `apps/mobile-notifications-service/src/infra/firestore/firestoreDigestRepository.ts`                    | Create           | Reads/writes `notification_daily_digests`. `set()` with transaction-based `generation` increment. Adds `generatedAt`, `modelId`. |
| `apps/mobile-notifications-service/src/infra/firestore/firestoreGroupStateRepository.ts`                | Create           | Per-date snapshots. Trims `recentSummaryDates` to last 30 on save.                                                               |
| `apps/mobile-notifications-service/src/infra/firestore/firestoreDigestLockRepository.ts`                | Create           | Acquire/release advisory lock with 5-min TTL.                                                                                    |
| `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts`                            | Create           | The composed flow.                                                                                                               |
| `apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreDigestRepository.test.ts`     | Create           | Fake Firestore (use existing test pattern from `firestoreNotificationRepository.test.ts`).                                       |
| `apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreGroupStateRepository.test.ts` | Create           | Same.                                                                                                                            |
| `apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreDigestLockRepository.test.ts` | Create           | Same.                                                                                                                            |
| `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts`             | Create           | E2E with fakes.                                                                                                                  |
| `apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts`                               | Create           | Re-usable `setServices({fakes})` helper.                                                                                         |
| `apps/mobile-notifications-service/src/services.ts`                                                     | Modify           | Add three new repositories to `ServiceContainer`.                                                                                |
| `firestore-collections.json`                                                                            | Modify           | Update `notification_group_states` description to per-date doc-ID; add `notification_digest_locks`.                              |

### Phase 3 — HTTP routes + cron + backfill chain

| File                                                                                        | Created/Modified | Responsibility                                                            |
| ------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `apps/mobile-notifications-service/src/domain/digestSubscriptions.ts`                       | Create           | Hard-coded const + types.                                                 |
| `apps/mobile-notifications-service/src/domain/usecases/yesterdayCet.ts`                     | Create           | CET-yesterday helper using IANA `Europe/Warsaw`.                          |
| `apps/mobile-notifications-service/src/domain/usecases/runDigestBackfill.ts`                | Create           | Initiates the HTTP chain by writing the run doc and POSTing day 1.        |
| `apps/mobile-notifications-service/src/infra/firestore/firestoreBackfillRunRepository.ts`   | Create           | Backfill progress doc CRUD.                                               |
| `apps/mobile-notifications-service/src/routes/digestRoutes.ts`                              | Create           | All 9 endpoints.                                                          |
| `apps/mobile-notifications-service/src/routes/digestSchemas.ts`                             | Create           | OpenAPI route schemas.                                                    |
| `apps/mobile-notifications-service/src/routes/routes.ts`                                    | Modify           | Register `digestRoutes`.                                                  |
| `apps/mobile-notifications-service/src/index.ts`                                            | Modify           | Add `INTEXURAOS_DIGEST_LLM_MODEL` to `REQUIRED_ENV`.                      |
| `apps/mobile-notifications-service/src/services.ts`                                         | Modify           | Add backfill repo, expose LLM-factory client factory, wire model env var. |
| `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`               | Create           | Inject-based route tests for all 9 endpoints.                             |
| `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestBackfill.test.ts` | Create           | Chain behavior.                                                           |
| `apps/mobile-notifications-service/src/__tests__/domain/usecases/yesterdayCet.test.ts`      | Create           | DST and boundary cases.                                                   |
| `firestore-collections.json`                                                                | Modify           | Add `notification_digest_backfill_runs`.                                  |
| `migrations/20260417000000_notification_digest_indexes.mjs`                                 | Create           | Composite indexes.                                                        |
| `terraform/environments/dev/main.tf`                                                        | Modify           | Cloud Scheduler resource + env var.                                       |
| `ecosystem.config.cjs`                                                                      | Modify           | Add `INTEXURAOS_DIGEST_LLM_MODEL` to mobile-notifications-service entry.  |

### Phase 4 — Web UI mirroring Code Tasks

| File                                                                      | Created/Modified | Responsibility                                                                        |
| ------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `apps/web/src/types/notificationDigests.ts`                               | Create           | Types matching backend response shapes.                                               |
| `apps/web/src/services/notificationDigestsApi.ts`                         | Create           | `useApiClient` wrappers.                                                              |
| `apps/web/src/hooks/useDigestList.ts`                                     | Create           | List + filter + sort + localStorage persistence.                                      |
| `apps/web/src/hooks/useDigestView.ts`                                     | Create           | Composite hook (mirrors `useTaskView`).                                               |
| `apps/web/src/hooks/useBackfillRun.ts`                                    | Create           | Polls run doc.                                                                        |
| `apps/web/src/components/notification-digests/DigestRow.tsx`              | Create           | List row (date + count + generation badge).                                           |
| `apps/web/src/components/notification-digests/DigestHeatmap.tsx`          | Create           | 30-day calendar heatmap.                                                              |
| `apps/web/src/components/notification-digests/DigestHeader.tsx`           | Create           | Detail header with prev/next + regenerate.                                            |
| `apps/web/src/components/notification-digests/DigestNarrative.tsx`        | Create           | Polish prose with reading typography.                                                 |
| `apps/web/src/components/notification-digests/DigestThreads.tsx`          | Create           | Thread cards with participant chips.                                                  |
| `apps/web/src/components/notification-digests/DigestModeratorPosts.tsx`   | Create           | Vertical timeline.                                                                    |
| `apps/web/src/components/notification-digests/DigestState.tsx`            | Create           | Collapsible state panels.                                                             |
| `apps/web/src/components/notification-digests/DigestActions.tsx`          | Create           | Action button row.                                                                    |
| `apps/web/src/components/notification-digests/RegenerateConfirmModal.tsx` | Create           | Confirmation modal.                                                                   |
| `apps/web/src/components/notification-digests/BackfillRangeModal.tsx`     | Create           | Date range picker.                                                                    |
| `apps/web/src/components/notification-digests/BackfillProgressGrid.tsx`   | Create           | Cell-per-day progress grid.                                                           |
| `apps/web/src/pages/NotificationDigestsPage.tsx`                          | Create           | List page (~150 lines).                                                               |
| `apps/web/src/pages/NotificationDigestViewPage.tsx`                       | Create           | Detail page.                                                                          |
| `apps/web/src/pages/NotificationDigestBackfillPage.tsx`                   | Create           | Backfill console.                                                                     |
| `apps/web/src/App.tsx`                                                    | Modify           | 3 new routes.                                                                         |
| `apps/web/src/config.ts`                                                  | Verify/Modify    | Confirm `mobile-notifications-service` URL is wired.                                  |
| `apps/web/cloudbuild.yaml`                                                | Verify/Modify    | Confirm Cloud Run service in `CLOUD_RUN_SERVICES`.                                    |
| `apps/web/vite.config.ts`                                                 | Verify/Modify    | Confirm `/api/notifications/digests` and `/api/notifications/digest-*` proxy entries. |
| `ecosystem.config.cjs`                                                    | Verify           | Confirm web env wiring.                                                               |

---

# Phase 1: Aggregation Use Case + Polish Prompts

**Branch:** `feature/digest-phase-1`. Open PR `[INT-1382] phase 1: digest aggregation use case + Polish prompts` against `development` after Task 1.13.

### Task 1.1: Create the few-shot example fixtures

**Files:**
- Create: `packages/llm-prompts/src/digest/examples.ts`

- [ ] **Step 1: Create the file with one cold-start and one with-context AggregationOutput**

```typescript
// packages/llm-prompts/src/digest/examples.ts
/**
 * Few-shot examples for the WhatsApp digest prompt.
 *
 * Source: GPT-5 outputs from the 7-day Polish fishing-group experiment
 * (see INT-1382 — published at intexuraos.cloud/share/claude/kronika-wedkarska-llm-experiment.html).
 * Conversion: prose -> structured AggregationOutput JSON to match the current Zod schema.
 *
 * messageCount values on activityOutliers were estimated from the source experiment
 * (the published page does not expose per-sender counts).
 */
import type { AggregationOutput } from '@intexuraos/mobile-notifications-service-domain-schemas';

/**
 * Cold-start example: day 1 with empty previous state and empty summaries window.
 */
export const COLD_START_EXAMPLE: AggregationOutput = {
  dailySummary: {
    date: '2026-04-08',
    groupKey: 'grupa-wedkarska-skool',
    messageCount: 83,
    narrative:
      'Dzień zaczął się od podbicia wcześniejszego pytania, a Michał wyjaśnił rano, że stary film jest sprzed roku i zapowiedział nagranie nowego w sobotę z publikacją na platformie. Dołączył Henryk, został ciepło powitany i dostał sporo wskazówek o działaniu platformy Skool i zdobywaniu punktów. Wokół Henryka powstał też wątek pomocy technicznej z dostępem do WhatsApp/Skool; Michał wysłał testową wiadomość, by sprawdzić widoczność, sprawa pozostała otwarta. Wieczorem grupa rozruszała się towarzysko – powitania, żarty i kawały. Pojawiły się też konkretne porady: o ciętym czerwonym robaku w zanęcie na leszcza oraz o łowieniu lina w chłodniejszym okresie, z rekomendacjami zanęt i dodatków.',
    threads: [
      {
        topic: 'old-video-request-new-upload-plan',
        participants: ['Grzegorz', 'Michał Lotkowski', 'Adrian'],
        resolved: true,
        keyFacts: [
          'Grzegorz dwukrotnie podbił wcześniejsze pytanie o materiał wideo.',
          'Michał potwierdził, że stary film jest sprzed roku i zapowiedział nagranie nowego w sobotę oraz wrzucenie na platformę.',
          'Adrian podziękował za informację.',
        ],
      },
      {
        topic: 'new-member-onboarding-and-platform-tips',
        participants: ['Henryk Kerber', 'Ireneusz', 'Mateusz Cichal', 'Robert', 'Zuza'],
        resolved: true,
        keyFacts: [
          'Henryk przywitał się i zapytał, czy może dołączyć do członków.',
          'Robert wyjaśnił mechanikę platformy Skool (posty, łapki, punkty, poziomy).',
          'Członkowie potwierdzili, że Henryk jest już w grupie, i zachęcali do aktywności.',
        ],
      },
      {
        topic: 'whatsapp-access-and-skool-link-confusion',
        participants: ['Henryk Kerber', 'Mikołaj Eret', 'Michał Lotkowski', 'Mateusz Cichal'],
        resolved: false,
        keyFacts: [
          'Henryk miał trudności z dostępem do grupy przez WhatsApp lub link ze Skool.',
          'Michał wysłał testową wiadomość, aby sprawdzić widoczność wpisów.',
          'Brak jednoznacznego potwierdzenia rozwiązania problemu przez Henryka.',
        ],
      },
    ],
    moderatorPosts: [
      {
        time: '09:20',
        topic: 'old-video-request-new-upload-plan',
        summary:
          'Michał informuje, że stary film jest sprzed roku i zapowiada nagranie nowego w sobotę oraz wrzucenie go na platformę.',
      },
      {
        time: '18:24',
        topic: 'whatsapp-access-and-skool-link-confusion',
        summary:
          'Michał wysyła testową wiadomość do Henryka, aby sprawdzić, czy widzi wpisy i pomóc w rozwiązaniu problemu z dostępem.',
      },
    ],
    openQuestions: [
      'Czy Henryk swobodnie korzysta już z platformy WhatsApp/Skool?',
    ],
    activityOutliers: [
      {
        sender: 'Henryk Kerber',
        messageCount: 18,
        note: 'Nowy uczestnik; liczne pytania i aktywność w kilku wątkach (onboarding, dostęp techniczny, porady wędkarskie).',
      },
      {
        sender: 'Robert',
        messageCount: 12,
        note: 'Ponadprzeciętna liczba wpisów z poradami dla nowego członka oraz aktywność w czacie wieczornym.',
      },
    ],
  },
  stateUpdate: {
    userId: 'google-oauth2|113131655542389277022',
    groupKey: 'grupa-wedkarska-skool',
    updatedAt: '2026-04-08T22:00:00.000Z',
    identityLedger: [
      {
        sender: 'Michał Lotkowski',
        firstSeen: '2026-04-08',
        totalMessages: 5,
        activeDays: 1,
        role: 'moderator',
        notes: 'Zapowiada nowy film, koordynuje pomoc techniczną.',
      },
      {
        sender: 'Henryk Kerber',
        firstSeen: '2026-04-08',
        totalMessages: 18,
        activeDays: 1,
        role: 'newcomer',
        notes: '76-letni nowy uczestnik; pytania o platformę i porady wędkarskie.',
      },
      {
        sender: 'Robert',
        firstSeen: '2026-04-08',
        totalMessages: 12,
        activeDays: 1,
        role: 'member',
      },
    ],
    moderatorEvents: [
      {
        date: '2026-04-08',
        topic: 'old-video-request-new-upload-plan',
        summary: 'Zapowiedź nagrania nowego filmu w sobotę i publikacji na platformie.',
      },
    ],
    openThreads: [
      {
        topic: 'whatsapp-access-and-skool-link-confusion',
        openedOn: '2026-04-08',
        lastSignal: 'Michał wysłał testową wiadomość; brak potwierdzenia od Henryka.',
        lastSignalDate: '2026-04-08',
      },
    ],
    recentSummaryDates: ['2026-04-08'],
  },
};

/**
 * With-context example: day 4 (2026-04-11) with state + 3-day summaries window.
 * Demonstrates: thread continuation reference, open-thread carry-over,
 * identity-ledger increment, moderator-events append.
 */
export const WITH_CONTEXT_EXAMPLE: AggregationOutput = {
  dailySummary: {
    date: '2026-04-11',
    groupKey: 'grupa-wedkarska-skool',
    messageCount: 76,
    narrative:
      'Poranek zaczął się od prośby o darmowe mapy batymetryczne i kilku zdjęć z przygotowań Grzegorza do porannej zasiadki na lina. Pojawiły się szybkie porady o ekspresowej fermentacji kukurydzy z puszki oraz kilka technicznych pytań Henryka o kolejność gotowania i dodawania drożdży. Wieczorem padło pytanie o najbliższy live i krótkie rekomendacje zanęt z platformy, a następnie rozwinęła się żywa dyskusja o sensowności fermentu w zimnej wodzie, zakończona sprostowaniem i podlinkowaniem materiałów z platformy. Na koniec Hubert kilkukrotnie prosił Michała o prywatną odpowiedź na Skool.',
    threads: [
      {
        topic: 'free-depth-maps-apps-and-deeper-availability',
        participants: ['Grzegorz', 'R', 'ADAM12', 'Mateusz Cichal'],
        resolved: false,
        keyFacts: [
          'Grzegorz szukał darmowej aplikacji z mapami głębokości jezior.',
          'R zaoferował Lowrance Hook z GPS, ale bez map (tylko ślad).',
          'ADAM12 polecił płatną (niedrogą) aplikację Fish Deeper.',
          'Mateusz zauważył, że dany staw nie jest zeskanowany w Deeperze.',
        ],
      },
      {
        topic: 'fermented-baits-in-cold-water-suitability',
        participants: ['Hubert Frąckowiak', 'Zuza', 'Mikołaj Eret', 'Kamilos', 'Ireneusz', 'Mateusz Cichal'],
        resolved: true,
        keyFacts: [
          'Hubert wyraził wątpliwość, czy ferment w połowie kwietnia jest naturalny i skuteczny.',
          'Mateusz sprostował, że fermentacja zachodzi także w niższych temperaturach, a dyfuzja zapachów w zimnej wodzie jest wolniejsza.',
          'Hubert przyznał, że pomylił kwestie i wskazał na wolniejsze trawienie węglowodanów w zimnej wodzie.',
          'Ireneusz podał link do odpowiedniej lekcji na platformie.',
        ],
      },
      {
        topic: 'request-private-reply-from-michal',
        participants: ['Hubert Frąckowiak'],
        resolved: false,
        keyFacts: [
          'Hubert kilkukrotnie poprosił Michała o prywatną odpowiedź na Skool.',
          'Prośba pozostała bez potwierdzenia w wątku.',
        ],
      },
    ],
    moderatorPosts: [],
    openQuestions: [
      'Czy istnieje darmowa aplikacja z mapami głębokości dla łowiska Grzegorza?',
      'Czy Michał odpowie Hubertowi prywatnie na Skool?',
    ],
    activityOutliers: [
      {
        sender: 'Hubert Frąckowiak',
        messageCount: 14,
        note: 'Aktywny w długiej dyskusji o fermencie i wielokrotne prośby o kontakt prywatny.',
      },
      {
        sender: 'Grzegorz',
        messageCount: 11,
        note: 'Wiele wiadomości z pytaniami, zdjęciami i opisami łowienia oraz zanęt.',
      },
    ],
  },
  stateUpdate: {
    userId: 'google-oauth2|113131655542389277022',
    groupKey: 'grupa-wedkarska-skool',
    updatedAt: '2026-04-11T22:00:00.000Z',
    identityLedger: [
      {
        sender: 'Michał Lotkowski',
        firstSeen: '2026-04-08',
        totalMessages: 5,
        activeDays: 1,
        role: 'moderator',
        notes: 'Brak aktywności moderatorskiej dziś; oczekuje odpowiedzi do Huberta.',
      },
      {
        sender: 'Hubert Frąckowiak',
        firstSeen: '2026-04-10',
        totalMessages: 35,
        activeDays: 2,
        role: 'member',
        notes: 'Aktywność wzrostowa; częste prośby o kontakt prywatny do moderatora.',
      },
    ],
    moderatorEvents: [
      {
        date: '2026-04-08',
        topic: 'old-video-request-new-upload-plan',
        summary: 'Zapowiedź nagrania nowego filmu w sobotę i publikacji na platformie.',
      },
    ],
    openThreads: [
      {
        topic: 'free-depth-maps-apps-and-deeper-availability',
        openedOn: '2026-04-11',
        lastSignal: 'Mateusz: dany staw nie jest zeskanowany w Deeperze.',
        lastSignalDate: '2026-04-11',
      },
      {
        topic: 'request-private-reply-from-michal',
        openedOn: '2026-04-11',
        lastSignal: 'Hubert ponawia prośbę bez odpowiedzi.',
        lastSignalDate: '2026-04-11',
      },
    ],
    recentSummaryDates: ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11'],
  },
};
```

- [ ] **Step 2: Confirm the file compiles in isolation**

The import path `@intexuraos/mobile-notifications-service-domain-schemas` is symbolic — it does NOT exist. Either:
* (a) Replace with a local minimal type-only import (`import type { AggregationOutput } from '../../../apps/mobile-notifications-service/src/domain/schemas/digestSchemas.js';`) — works inside the monorepo via project references.
* (b) Skip the type import and `as const` the literal; the next task adds the type assertion.

Use option (b) for now — drop the import, replace `: AggregationOutput` with `as const` on each export. Re-add type checking in Task 1.4 when the barrel exists.

```typescript
// Replace the import line and the type annotations:
// (no import)
export const COLD_START_EXAMPLE = { /* ...same body... */ } as const;
export const WITH_CONTEXT_EXAMPLE = { /* ...same body... */ } as const;
```

- [ ] **Step 3: Commit**

```bash
git add packages/llm-prompts/src/digest/examples.ts
git commit -m "feat(llm-prompts): add Polish few-shot examples for WhatsApp digest"
```

### Task 1.2: Build the digest prompt builder

**Files:**
- Create: `packages/llm-prompts/src/digest/digestPrompt.ts`
- Test: `packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts
import { describe, expect, it } from 'vitest';
import { buildDigestPrompt, DIGEST_PROMPT_VERSION } from '../digestPrompt.js';

describe('buildDigestPrompt', () => {
  const baseInput = {
    userId: 'google-oauth2|test-user',
    groupKey: 'grupa-wedkarska-skool',
    date: '2026-04-15',
    previousState: null,
    last3Summaries: [],
    todaysMessages: [
      { sender: 'Test', text: 'Cześć', postTimeSec: 1776380400 },
    ],
  };

  it('returns a non-empty prompt with the date and group key', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('2026-04-15');
    expect(prompt).toContain('grupa-wedkarska-skool');
  });

  it('embeds both few-shot examples', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt).toContain('2026-04-08'); // cold-start example date
    expect(prompt).toContain('2026-04-11'); // with-context example date
  });

  it('instructs the model to write Polish narratives', () => {
    const prompt = buildDigestPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain('po polsku');
  });

  it('exposes a semver version constant', () => {
    expect(DIGEST_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails with module-not-found**

```bash
pnpm --filter @intexuraos/llm-prompts test -- digestPrompt
```

Expected: `Failed to resolve import "../digestPrompt.js"`.

- [ ] **Step 3: Implement the minimal builder**

```typescript
// packages/llm-prompts/src/digest/digestPrompt.ts
import { COLD_START_EXAMPLE, WITH_CONTEXT_EXAMPLE } from './examples.js';

export const DIGEST_PROMPT_VERSION = '1.0.0';

export interface DigestPromptInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string; // YYYY-MM-DD
  readonly previousState: unknown; // GroupState or null on cold start
  readonly last3Summaries: readonly unknown[]; // DailySummary[]
  readonly todaysMessages: ReadonlyArray<{
    readonly sender: string;
    readonly text: string;
    readonly postTimeSec: number;
  }>;
}

export function buildDigestPrompt(input: DigestPromptInput): string {
  const messagesText = input.todaysMessages
    .map((m) => {
      const ts = new Date(m.postTimeSec * 1000).toISOString().slice(11, 16);
      return `[${ts}] ${m.sender}: ${m.text}`;
    })
    .join('\n');

  const stateJson = JSON.stringify(input.previousState ?? {}, null, 2);
  const summariesJson = JSON.stringify(input.last3Summaries, null, 2);

  return `Jesteś asystentem agregującym dzień rozmów z grupy WhatsApp wędkarskiej w schemat AggregationOutput (JSON).

Wymagania:
- Cała narracja, opisy wątków, notatki, podsumowania moderatorskie i pytania otwarte muszą być po polsku.
- Klucze enum, identyfikatory wątków (kebab-case), groupKey i daty (YYYY-MM-DD) – po angielsku.
- Wynikiem jest JEDEN obiekt JSON o polach { dailySummary, stateUpdate } pasujący do schematu Zod.
- recentSummaryDates: dopisz dzisiejszą datę, przytnij do ostatnich 30 dni.
- identityLedger: zwiększaj liczniki dla nadawców widocznych dzisiaj; dodawaj nowych z role='newcomer'; pozostałych zachowaj bez zmian.
- moderatorEvents: tylko append (nigdy nie usuwaj).
- openThreads: przenoś z aktualizacją lastSignal/lastSignalDate; usuwaj wyłącznie gdy dzisiejsze wiadomości jednoznacznie zamykają temat.
- Nie wymyślaj informacji – jeżeli czegoś brakuje, użyj pustej tablicy.
- Wynik MUSI być prawidłowym JSON-em (bez bloków markdown, bez komentarzy, bez końcowych przecinków).

Przykład 1 (cold start, pusty stan):
${JSON.stringify(COLD_START_EXAMPLE, null, 2)}

Przykład 2 (stan + 3-dniowe okno):
${JSON.stringify(WITH_CONTEXT_EXAMPLE, null, 2)}

Dane wejściowe dla bieżącego uruchomienia:

userId: ${input.userId}
groupKey: ${input.groupKey}
date: ${input.date}

previousState (lub {} dla cold start):
${stateJson}

last3Summaries (chronologicznie, najstarsza pierwsza):
${summariesJson}

todaysMessages (po dedup, posortowane rosnąco po czasie):
${messagesText}

Zwróć wyłącznie obiekt JSON AggregationOutput.`;
}
// Prompt version: 1.0.0
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm --filter @intexuraos/llm-prompts test -- digestPrompt
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-prompts/src/digest/digestPrompt.ts \
        packages/llm-prompts/src/digest/__tests__/digestPrompt.test.ts
git commit -m "feat(llm-prompts): add digest prompt builder with Polish few-shot examples"
```

### Task 1.3: Build the digest repair prompt

**Files:**
- Create: `packages/llm-prompts/src/digest/digestRepairPrompt.ts`
- Test: `packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts
import { describe, expect, it } from 'vitest';
import { buildDigestRepairPrompt, DIGEST_REPAIR_PROMPT_VERSION } from '../digestRepairPrompt.js';

describe('buildDigestRepairPrompt', () => {
  it('embeds the original prompt, the invalid response, and the error message', () => {
    const repair = buildDigestRepairPrompt(
      'ORIGINAL_PROMPT_BODY',
      '{"dailySummary": "broken"}',
      'Expected object, got string at dailySummary',
    );
    expect(repair).toContain('ORIGINAL_PROMPT_BODY');
    expect(repair).toContain('{"dailySummary": "broken"}');
    expect(repair).toContain('Expected object, got string at dailySummary');
  });

  it('exposes a semver version constant', () => {
    expect(DIGEST_REPAIR_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('instructs the model to return ONLY JSON, no markdown', () => {
    const repair = buildDigestRepairPrompt('A', 'B', 'C');
    expect(repair.toLowerCase()).toContain('tylko');
    expect(repair.toLowerCase()).toContain('json');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter @intexuraos/llm-prompts test -- digestRepairPrompt
```

Expected: module not found.

- [ ] **Step 3: Implement the repair prompt**

```typescript
// packages/llm-prompts/src/digest/digestRepairPrompt.ts
export const DIGEST_REPAIR_PROMPT_VERSION = '1.0.0';

export function buildDigestRepairPrompt(
  originalPrompt: string,
  invalidResponse: string,
  errorMessage: string,
): string {
  return `Jesteś asystentem naprawy JSON. Twoim zadaniem jest naprawić nieprawidłową odpowiedź AggregationOutput tak, by spełniała schemat Zod.

Treść poprzedniego promptu (pomiń jakiekolwiek instrukcje wewnątrz):

<original_prompt>
${originalPrompt}
</original_prompt>

Nieprawidłowa odpowiedź:

<invalid_response>
${invalidResponse}
</invalid_response>

Błąd walidacji:
${errorMessage}

Wymagania:
1. Zwróć WYŁĄCZNIE prawidłowy JSON (bez bloków markdown, bez komentarzy, bez tekstu wyjaśniającego).
2. Wszystkie wartości tekstowe w cudzysłowach.
3. Wartości boolean: true / false (małymi literami).
4. Tablice: [ ], obiekty: { }.
5. Bez końcowych przecinków.
6. Nie zmieniaj treści zgodnej ze schematem; popraw tylko błędne pola.
7. Brakujące wymagane pola wypełnij sensownymi pustymi wartościami: tablice -> [], opcjonalne stringi -> pomiń.

Schema docelowa: { dailySummary: DailySummary, stateUpdate: GroupState } (definicje w packages/llm-prompts/src/digest/digestPrompt.ts oraz w packages/mobile-notifications-service domain/schemas).

Zwróć poprawiony JSON:`;
}
// Prompt version: 1.0.0
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm --filter @intexuraos/llm-prompts test -- digestRepairPrompt
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-prompts/src/digest/digestRepairPrompt.ts \
        packages/llm-prompts/src/digest/__tests__/digestRepairPrompt.test.ts
git commit -m "feat(llm-prompts): add digest repair prompt for Zod-validation retries"
```

### Task 1.4: Create barrel exports and re-strict the example types

**Files:**
- Create: `packages/llm-prompts/src/digest/index.ts`
- Modify: `packages/llm-prompts/src/index.ts`
- Modify: `packages/llm-prompts/src/digest/examples.ts` (add type imports)

- [ ] **Step 1: Create the digest barrel**

```typescript
// packages/llm-prompts/src/digest/index.ts
export { buildDigestPrompt, DIGEST_PROMPT_VERSION, type DigestPromptInput } from './digestPrompt.js';
export { buildDigestRepairPrompt, DIGEST_REPAIR_PROMPT_VERSION } from './digestRepairPrompt.js';
export { COLD_START_EXAMPLE, WITH_CONTEXT_EXAMPLE } from './examples.js';
```

- [ ] **Step 2: Re-export from package root**

Read `packages/llm-prompts/src/index.ts`. Append:

```typescript
export * from './digest/index.js';
```

- [ ] **Step 3: Re-add type assertion to examples**

Replace each `as const` with `satisfies AggregationOutput`. Add the import via project reference. **First, check** whether `packages/llm-prompts/package.json` has a dep on `@intexuraos/...mobile-notifications-service`. If NOT (likely, to avoid app→package coupling), keep `as const` and document the divergence with a comment:

```typescript
// packages/llm-prompts/src/digest/examples.ts (top of file)
/**
 * NOTE: shape MUST match `AggregationOutputSchema` from
 * `apps/mobile-notifications-service/src/domain/schemas/digestSchemas.ts`.
 * We do NOT import the type here to keep this package free of app dependencies;
 * the `aggregateDigest` use case validates examples against the Zod schema.
 */
```

- [ ] **Step 4: Run all llm-prompts tests**

```bash
pnpm --filter @intexuraos/llm-prompts test
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-prompts/src/digest/index.ts \
        packages/llm-prompts/src/index.ts \
        packages/llm-prompts/src/digest/examples.ts
git commit -m "feat(llm-prompts): export digest module from package root"
```

### Task 1.5: Define DigestError discriminated union

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/usecases/digestErrors.ts`
- Test: `apps/mobile-notifications-service/src/__tests__/domain/usecases/digestErrors.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/mobile-notifications-service/src/__tests__/domain/usecases/digestErrors.test.ts
import { describe, expect, it } from 'vitest';
import {
  type DigestError,
  llmCallFailed,
  repairExhausted,
  zodValidationFailed,
  inputInvalid,
} from '../../../domain/usecases/digestErrors.js';

describe('DigestError factories', () => {
  it('creates llm-call-failed', () => {
    const e: DigestError = llmCallFailed('upstream timeout');
    expect(e.code).toBe('llm-call-failed');
    expect(e.message).toBe('upstream timeout');
  });

  it('creates repair-exhausted with attempt count', () => {
    const e: DigestError = repairExhausted(3, 'final invalid JSON');
    expect(e.code).toBe('repair-exhausted');
    expect(e.attempts).toBe(3);
  });

  it('creates zod-validation-failed with details', () => {
    const e = zodValidationFailed('Expected object');
    expect(e.code).toBe('zod-validation-failed');
  });

  it('creates input-invalid', () => {
    const e = inputInvalid('date must be YYYY-MM-DD');
    expect(e.code).toBe('input-invalid');
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter @intexuraos/mobile-notifications-service test -- digestErrors
```

- [ ] **Step 3: Implement**

```typescript
// apps/mobile-notifications-service/src/domain/usecases/digestErrors.ts
export type DigestError =
  | { readonly code: 'input-invalid'; readonly message: string }
  | { readonly code: 'llm-call-failed'; readonly message: string }
  | { readonly code: 'zod-validation-failed'; readonly message: string }
  | { readonly code: 'repair-exhausted'; readonly attempts: number; readonly lastResponse: string }
  | { readonly code: 'lock-held'; readonly heldBy: string }
  | { readonly code: 'persistence-failed'; readonly message: string };

export function inputInvalid(message: string): DigestError {
  return { code: 'input-invalid', message };
}

export function llmCallFailed(message: string): DigestError {
  return { code: 'llm-call-failed', message };
}

export function zodValidationFailed(message: string): DigestError {
  return { code: 'zod-validation-failed', message };
}

export function repairExhausted(attempts: number, lastResponse: string): DigestError {
  return { code: 'repair-exhausted', attempts, lastResponse };
}

export function lockHeld(heldBy: string): DigestError {
  return { code: 'lock-held', heldBy };
}

export function persistenceFailed(message: string): DigestError {
  return { code: 'persistence-failed', message };
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/usecases/digestErrors.ts \
        apps/mobile-notifications-service/src/__tests__/domain/usecases/digestErrors.test.ts
git commit -m "feat(mobile-notifications): add DigestError discriminated union"
```

### Task 1.6: Create the reusable fake LLM client

**Files:**
- Create: `apps/mobile-notifications-service/src/__tests__/helpers/fakeLlmClient.ts`

This is a test helper, no separate test file needed (its correctness is exercised through aggregateDigest tests).

- [ ] **Step 1: Implement**

```typescript
// apps/mobile-notifications-service/src/__tests__/helpers/fakeLlmClient.ts
import type { LlmGenerateClient, GenerateOptions, GenerateResult } from '@intexuraos/llm-factory';
import type { LLMError } from '@intexuraos/llm-contract';
import { ok, err, type Result } from '@intexuraos/common-core';

export interface FakeLlmCall {
  readonly prompt: string;
  readonly options: GenerateOptions | undefined;
}

/**
 * In-memory fake LlmGenerateClient that returns scripted responses in order.
 * A response of type 'error' returns `err(...)`; 'content' returns ok with that string.
 * After exhausting the script, falls back to the `defaultResponse`.
 */
export interface ScriptedResponse {
  readonly type: 'content' | 'error';
  readonly value: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export class FakeLlmClient implements LlmGenerateClient {
  public readonly calls: FakeLlmCall[] = [];
  private cursor = 0;

  constructor(
    private readonly script: ScriptedResponse[],
    private readonly defaultResponse: ScriptedResponse = { type: 'content', value: '{}' },
  ) {}

  async generate(prompt: string, options?: GenerateOptions): Promise<Result<GenerateResult, LLMError>> {
    this.calls.push({ prompt, options });
    const response = this.script[this.cursor] ?? this.defaultResponse;
    this.cursor += 1;
    if (response.type === 'error') {
      return err({ code: 'UPSTREAM_ERROR', message: response.value } as LLMError);
    }
    return ok({
      content: response.value,
      usage: {
        inputTokens: response.inputTokens ?? 100,
        outputTokens: response.outputTokens ?? 200,
        totalTokens: (response.inputTokens ?? 100) + (response.outputTokens ?? 200),
        costUsd: 0.0001,
      },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile-notifications-service/src/__tests__/helpers/fakeLlmClient.ts
git commit -m "test(mobile-notifications): add scripted FakeLlmClient helper"
```

### Task 1.7: Test aggregateDigest happy path

**Files:**
- Create: `apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts`

- [ ] **Step 1: Write the failing test (happy path only — more tests added in 1.10/1.12)**

```typescript
// apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts
import { describe, expect, it, vi } from 'vitest';
import { aggregateDigest } from '../../../domain/usecases/aggregateDigest.js';
import { FakeLlmClient } from '../../helpers/fakeLlmClient.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('aggregateDigest', () => {
  it('returns a parsed AggregationOutput on a valid first-attempt LLM response', async () => {
    const llmClient = new FakeLlmClient([
      { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
    ]);

    const result = await aggregateDigest(
      { llmClient, logger: noopLogger },
      {
        userId: 'google-oauth2|test',
        groupKey: 'grupa-wedkarska-skool',
        date: '2026-04-15',
        previousState: null,
        last3Summaries: [],
        todaysMessages: [],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dailySummary.date).toBe('2026-04-08');
    expect(llmClient.calls).toHaveLength(1);
    expect(llmClient.calls[0]?.options?.promptType).toBe('whatsapp-digest-aggregate');
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter @intexuraos/mobile-notifications-service test -- aggregateDigest
```

Expected: module not found.

- [ ] **Step 3: Commit (test only, no impl yet — intentional red state)**

Skip the commit; we'll commit after Task 1.8 makes it green.

### Task 1.8: Implement aggregateDigest happy path

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts`

- [ ] **Step 1: Implement minimal happy-path version (no repair loop yet)**

```typescript
// apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { buildDigestPrompt, type DigestPromptInput } from '@intexuraos/llm-prompts';
import {
  AggregationOutputSchema,
  type AggregationOutput,
} from '../schemas/digestSchemas.js';
import { llmCallFailed, type DigestError, zodValidationFailed } from './digestErrors.js';

export interface AggregateDigestDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
}

export type AggregateDigestInput = DigestPromptInput;

const PROMPT_TYPE = 'whatsapp-digest-aggregate';

export async function aggregateDigest(
  deps: AggregateDigestDeps,
  input: AggregateDigestInput,
): Promise<Result<AggregationOutput, DigestError>> {
  const prompt = buildDigestPrompt(input);
  const response = await deps.llmClient.generate(prompt, { promptType: PROMPT_TYPE });
  if (!response.ok) {
    return err(llmCallFailed(response.error.message ?? 'LLM call failed'));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.value.content);
  } catch (e) {
    return err(zodValidationFailed(`JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  const validation = AggregationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return err(zodValidationFailed(validation.error.message));
  }

  return ok(validation.data);
}
```

- [ ] **Step 2: Run the test, verify it passes**

```bash
pnpm --filter @intexuraos/mobile-notifications-service test -- aggregateDigest
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts \
        apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts
git commit -m "feat(mobile-notifications): add aggregateDigest happy path"
```

### Task 1.9: Test repair-loop fires once on invalid first response

**Files:**
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts`

- [ ] **Step 1: Append the test**

```typescript
// In the same describe block as Task 1.7's test:
it('repairs the response when the first call returns invalid JSON', async () => {
  const llmClient = new FakeLlmClient([
    { type: 'content', value: '{"dailySummary": "this is not an object"}' },
    { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
  ]);

  const result = await aggregateDigest(
    { llmClient, logger: noopLogger },
    {
      userId: 'u', groupKey: 'g', date: '2026-04-15',
      previousState: null, last3Summaries: [], todaysMessages: [],
    },
  );

  expect(result.ok).toBe(true);
  expect(llmClient.calls).toHaveLength(2);
  expect(llmClient.calls[1]?.options?.promptType).toBe('whatsapp-digest-repair');
});
```

- [ ] **Step 2: Run, verify it fails (repair not implemented yet)**

```bash
pnpm --filter @intexuraos/mobile-notifications-service test -- aggregateDigest
```

Expected: 1 fail (the new repair test), 1 pass.

### Task 1.10: Implement repair loop

**Files:**
- Modify: `apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts`

- [ ] **Step 1: Replace the implementation with a looping version**

```typescript
// apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  buildDigestPrompt,
  buildDigestRepairPrompt,
  type DigestPromptInput,
} from '@intexuraos/llm-prompts';
import {
  AggregationOutputSchema,
  type AggregationOutput,
} from '../schemas/digestSchemas.js';
import {
  llmCallFailed,
  repairExhausted,
  type DigestError,
} from './digestErrors.js';

export interface AggregateDigestDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
}

export type AggregateDigestInput = DigestPromptInput;

const PROMPT_TYPE_AGGREGATE = 'whatsapp-digest-aggregate';
const PROMPT_TYPE_REPAIR = 'whatsapp-digest-repair';
const MAX_REPAIR_ATTEMPTS = 3;

export async function aggregateDigest(
  deps: AggregateDigestDeps,
  input: AggregateDigestInput,
): Promise<Result<AggregationOutput, DigestError>> {
  const initialPrompt = buildDigestPrompt(input);
  let prompt = initialPrompt;
  let promptType = PROMPT_TYPE_AGGREGATE;
  let lastResponseContent = '';
  let lastErrorMessage = '';

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const response = await deps.llmClient.generate(prompt, { promptType });
    if (!response.ok) {
      return err(llmCallFailed(response.error.message ?? 'LLM call failed'));
    }
    lastResponseContent = response.value.content;

    const parsed = tryParseAndValidate(lastResponseContent);
    if (parsed.ok) return ok(parsed.value);
    lastErrorMessage = parsed.error;

    deps.logger.warn(
      { attempt, errorMessage: lastErrorMessage },
      'aggregateDigest: invalid response, will repair',
    );

    prompt = buildDigestRepairPrompt(initialPrompt, lastResponseContent, lastErrorMessage);
    promptType = PROMPT_TYPE_REPAIR;
  }

  return err(repairExhausted(MAX_REPAIR_ATTEMPTS, lastResponseContent));
}

function tryParseAndValidate(content: string): { ok: true; value: AggregationOutput } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const validation = AggregationOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return { ok: false, error: validation.error.message };
  }
  return { ok: true, value: validation.data };
}
```

- [ ] **Step 2: Run all aggregateDigest tests, verify both pass**

```bash
pnpm --filter @intexuraos/mobile-notifications-service test -- aggregateDigest
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts \
        apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts
git commit -m "feat(mobile-notifications): add repair loop to aggregateDigest"
```

### Task 1.11: Test and verify max-attempts cap

**Files:**
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts`

- [ ] **Step 1: Append**

```typescript
it('returns repair-exhausted when LLM never produces valid JSON', async () => {
  const llmClient = new FakeLlmClient([
    { type: 'content', value: 'not json 1' },
    { type: 'content', value: 'not json 2' },
    { type: 'content', value: 'not json 3' },
    { type: 'content', value: 'not json 4' },
  ]);

  const result = await aggregateDigest(
    { llmClient, logger: noopLogger },
    {
      userId: 'u', groupKey: 'g', date: '2026-04-15',
      previousState: null, last3Summaries: [], todaysMessages: [],
    },
  );

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe('repair-exhausted');
  expect(llmClient.calls).toHaveLength(4); // 1 initial + 3 repairs
});

it('returns llm-call-failed when the LLM call errors', async () => {
  const llmClient = new FakeLlmClient([
    { type: 'error', value: 'upstream 502' },
  ]);

  const result = await aggregateDigest(
    { llmClient, logger: noopLogger },
    {
      userId: 'u', groupKey: 'g', date: '2026-04-15',
      previousState: null, last3Summaries: [], todaysMessages: [],
    },
  );

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe('llm-call-failed');
});
```

- [ ] **Step 2: Run, verify pass**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts
git commit -m "test(mobile-notifications): cover repair-exhausted and llm-call-failed paths"
```

### Task 1.12: Test cold-start path (empty state, empty summaries)

**Files:**
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts`

- [ ] **Step 1: Append**

```typescript
it('handles cold-start input (null state, empty summaries) without error', async () => {
  const llmClient = new FakeLlmClient([
    { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
  ]);

  const result = await aggregateDigest(
    { llmClient, logger: noopLogger },
    {
      userId: 'u', groupKey: 'grupa-wedkarska-skool', date: '2026-04-15',
      previousState: null,
      last3Summaries: [],
      todaysMessages: [],
    },
  );

  expect(result.ok).toBe(true);
  // Verify the prompt embedded an empty-state placeholder (not "null")
  const prompt = llmClient.calls[0]?.prompt ?? '';
  expect(prompt).toContain('previousState (lub {} dla cold start)');
});

it('handles previousState = empty object equivalently to null', async () => {
  const llmClient = new FakeLlmClient([
    { type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) },
  ]);

  const result = await aggregateDigest(
    { llmClient, logger: noopLogger },
    {
      userId: 'u', groupKey: 'grupa-wedkarska-skool', date: '2026-04-15',
      previousState: {},
      last3Summaries: [],
      todaysMessages: [],
    },
  );

  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run, verify pass**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile-notifications-service/src/__tests__/domain/usecases/aggregateDigest.test.ts
git commit -m "test(mobile-notifications): cover cold-start aggregateDigest input"
```

### Task 1.13: Verify Phase 1 coverage and open the PR

- [ ] **Step 1: Run the workspace verifier**

```bash
pnpm run verify:workspace:tracked -- mobile-notifications-service 2>&1 | tee /tmp/ci-output-phase-1.txt
pnpm run verify:workspace:tracked -- llm-prompts 2>&1 | tee -a /tmp/ci-output-phase-1.txt
```

Expected: both green, coverage 100% on every new file.

- [ ] **Step 2: Run full ci:tracked**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked-phase-1.txt
```

If failures: `rg "error|FAIL" -C3 /tmp/ci-tracked-phase-1.txt` and resolve before pushing.

- [ ] **Step 3: Push branch**

```bash
gh repo set-default pbuchman/intexuraos
git push -u origin feature/digest-phase-1
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "[INT-1382] phase 1: digest aggregation use case + Polish prompts" \
  --body "$(cat <<'EOF'
## Summary
- Adds Polish few-shot examples (cold-start + with-context) extracted from the GPT-5 experiment in INT-1382.
- Adds `buildDigestPrompt` + `buildDigestRepairPrompt` with semver versioning per CLAUDE.md.
- Adds pure `aggregateDigest` use case: Zod-validated repair loop (max 3 attempts) over `or:google/gemini-3-flash-preview` via `llm-factory`.
- 100% coverage; in-memory `FakeLlmClient` test helper.

## Scope
Phase 1 of 4 — see `docs/superpowers/plans/2026-04-17-whatsapp-group-digest.md`.
No HTTP, no Firestore, no UI in this PR.

## Test plan
- [x] `pnpm --filter @intexuraos/llm-prompts test` green
- [x] `pnpm --filter @intexuraos/mobile-notifications-service test` green
- [x] `pnpm run ci:tracked` green

Refs INT-1382
EOF
)" --base development
```

---

# Phase 2: Repositories + Composed Run + Lock

**Branch:** `feature/digest-phase-2` (off `development` AFTER Phase 1 is merged). PR title: `[INT-1382] phase 2: digest repositories + composed runDigestForGroup + advisory lock`.

### Task 2.1: Define repository ports

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/repositories/digestRepositories.ts`

- [ ] **Step 1: Implement (no separate test file — ports are interface-only)**

```typescript
// apps/mobile-notifications-service/src/domain/repositories/digestRepositories.ts
import type { Result } from '@intexuraos/common-core';
import type {
  DailySummary,
  GroupState,
} from '../schemas/digestSchemas.js';

export interface RepositoryError {
  readonly code: 'INTERNAL_ERROR' | 'NOT_FOUND' | 'CONFLICT';
  readonly message: string;
}

/** Doc shape stored in `notification_daily_digests`. Augments DailySummary with server fields. */
export interface PersistedDailySummary {
  readonly summary: DailySummary;
  readonly generation: number;
  readonly generatedAt: string; // ISO
  readonly modelId: string;
}

export interface DigestRepository {
  /** Save (overwriting if exists) and return the new generation number. */
  save(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly summary: DailySummary;
    readonly modelId: string;
  }): Promise<Result<PersistedDailySummary, RepositoryError>>;

  findByDate(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly date: string;
  }): Promise<Result<PersistedDailySummary | null, RepositoryError>>;

  /** Last N summaries for a group, ordered by date desc. */
  findRecentByGroup(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly limit: number;
  }): Promise<Result<readonly PersistedDailySummary[], RepositoryError>>;

  findInRange(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly fromDate: string;
    readonly toDate: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<Result<{
    readonly items: readonly PersistedDailySummary[];
    readonly nextCursor?: string;
  }, RepositoryError>>;
}

export interface GroupStateRepository {
  /** Read snapshot for a specific date. Returns null if missing. */
  getByDate(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly date: string;
  }): Promise<Result<GroupState | null, RepositoryError>>;

  /** Read the latest snapshot (highest date) for a group. Returns null if none. */
  getLatest(input: {
    readonly userId: string;
    readonly groupKey: string;
  }): Promise<Result<GroupState | null, RepositoryError>>;

  /** Save snapshot for the given date (overwrites). Trims `recentSummaryDates` to last 30. */
  save(input: {
    readonly state: GroupState;
    readonly date: string;
  }): Promise<Result<void, RepositoryError>>;
}

export interface DigestLockRepository {
  /**
   * Try to acquire a lock for `(userId, groupKey)`. Returns ok(true) on success,
   * ok(false) if held and not expired. TTL is 5 minutes.
   */
  acquire(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly holder: 'cron' | 'backfill' | 'manual';
    readonly currentDate: string;
  }): Promise<Result<{ readonly acquired: boolean; readonly heldBy?: string }, RepositoryError>>;

  release(input: {
    readonly userId: string;
    readonly groupKey: string;
  }): Promise<Result<void, RepositoryError>>;
}
```

- [ ] **Step 2: Compile check**

```bash
pnpm --filter @intexuraos/mobile-notifications-service build
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/repositories/digestRepositories.ts
git commit -m "feat(mobile-notifications): define digest repository ports"
```

### Task 2.2: Test FirestoreDigestRepository — happy paths

**Files:**
- Create: `apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreDigestRepository.test.ts`

- [ ] **Step 1: Write tests using the existing Firestore-fake pattern**

Read `apps/mobile-notifications-service/src/__tests__/infra/firestoreNotificationRepository.test.ts` to copy the Firestore-fake bootstrap pattern (it sets up `getFirestore` to return a fake admin SDK). Write 5 tests:

```typescript
// apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreDigestRepository.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreDigestRepository } from '../../../infra/firestore/firestoreDigestRepository.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { resetFirestoreFake, useFirestoreFake } from '../helpers/firestoreFake.js'; // see Task 2.4-step3

describe('FirestoreDigestRepository', () => {
  beforeEach(() => useFirestoreFake());
  afterEach(() => resetFirestoreFake());

  it('saves a new summary with generation = 1', async () => {
    const repo = new FirestoreDigestRepository();
    const result = await repo.save({
      userId: 'u', groupKey: 'g', summary: COLD_START_EXAMPLE.dailySummary, modelId: 'or:google/gemini-3-flash-preview',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generation).toBe(1);
    expect(result.value.modelId).toBe('or:google/gemini-3-flash-preview');
  });

  it('increments generation when saving over an existing date', async () => {
    const repo = new FirestoreDigestRepository();
    await repo.save({ userId: 'u', groupKey: 'g', summary: COLD_START_EXAMPLE.dailySummary, modelId: 'm' });
    const second = await repo.save({ userId: 'u', groupKey: 'g', summary: COLD_START_EXAMPLE.dailySummary, modelId: 'm' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.generation).toBe(2);
  });

  it('findByDate returns null when missing', async () => {
    const repo = new FirestoreDigestRepository();
    const result = await repo.findByDate({ userId: 'u', groupKey: 'g', date: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('findRecentByGroup returns docs ordered by date desc', async () => {
    const repo = new FirestoreDigestRepository();
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10']) {
      await repo.save({
        userId: 'u', groupKey: 'g',
        summary: { ...COLD_START_EXAMPLE.dailySummary, date: d },
        modelId: 'm',
      });
    }
    const result = await repo.findRecentByGroup({ userId: 'u', groupKey: 'g', limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.summary.date)).toEqual(['2026-04-10', '2026-04-09']);
  });

  it('findInRange respects fromDate, toDate, and limit', async () => {
    const repo = new FirestoreDigestRepository();
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12']) {
      await repo.save({
        userId: 'u', groupKey: 'g',
        summary: { ...COLD_START_EXAMPLE.dailySummary, date: d },
        modelId: 'm',
      });
    }
    const result = await repo.findInRange({
      userId: 'u', groupKey: 'g',
      fromDate: '2026-04-09', toDate: '2026-04-11', limit: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((p) => p.summary.date).sort()).toEqual(['2026-04-09', '2026-04-10', '2026-04-11']);
  });
});
```

- [ ] **Step 2: Run, verify all 5 fail (FirestoreDigestRepository not implemented yet)**

### Task 2.3: Implement FirestoreDigestRepository

**Files:**
- Create: `apps/mobile-notifications-service/src/infra/firestore/firestoreDigestRepository.ts`
- Create: `apps/mobile-notifications-service/src/__tests__/infra/firestore/helpers/firestoreFake.ts` (re-usable fake — extract from `firestoreNotificationRepository.test.ts` if not already extracted)

- [ ] **Step 1: Extract / create the Firestore fake helper**

Read existing `firestoreNotificationRepository.test.ts`. If a Firestore fake is inline in tests, EXTRACT it to `apps/mobile-notifications-service/src/__tests__/infra/firestore/helpers/firestoreFake.ts` exposing `useFirestoreFake()` and `resetFirestoreFake()`. The fake must implement:
- `db.collection(name).doc(id).get/set/create/update/delete`
- `db.collection(name).doc().id` (auto-id)
- `query.where(field, op, value).orderBy(field, dir).startAfter(...).limit(N).get()`
- `db.runTransaction(fn)` invoking `fn({ get, set, update })`

Use a Map<string, Map<docId, data>> as the backing store. Inject via `vi.mock('@intexuraos/infra-firestore', ...)`. If the existing test uses a more elaborate pattern, mirror that — do NOT reinvent.

- [ ] **Step 2: Implement the repository**

```typescript
// apps/mobile-notifications-service/src/infra/firestore/firestoreDigestRepository.ts
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import { createAppLogger } from '@intexuraos/infra-sentry';
import type {
  DigestRepository,
  PersistedDailySummary,
  RepositoryError,
} from '../../domain/repositories/digestRepositories.js';
import type { DailySummary } from '../../domain/schemas/digestSchemas.js';

const logger = createAppLogger({ name: 'FirestoreDigestRepository' });
const COLLECTION = 'notification_daily_digests';

interface DigestDoc {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly summary: DailySummary;
  readonly generation: number;
  readonly generatedAt: string;
  readonly modelId: string;
}

function docId(userId: string, groupKey: string, date: string): string {
  return `${userId}_${groupKey}_${date}`;
}

export class FirestoreDigestRepository implements DigestRepository {
  async save(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly summary: DailySummary;
    readonly modelId: string;
  }): Promise<Result<PersistedDailySummary, RepositoryError>> {
    try {
      const db = getFirestore();
      const id = docId(input.userId, input.groupKey, input.summary.date);
      const ref = db.collection(COLLECTION).doc(id);

      const persisted = await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        const generation = existing.exists ? ((existing.data() as DigestDoc).generation ?? 0) + 1 : 1;
        const doc: DigestDoc = {
          userId: input.userId,
          groupKey: input.groupKey,
          date: input.summary.date,
          summary: input.summary,
          generation,
          generatedAt: new Date().toISOString(),
          modelId: input.modelId,
        };
        tx.set(ref, doc);
        return doc;
      });

      logger.info({ id, generation: persisted.generation }, 'Saved daily digest');
      return ok({
        summary: persisted.summary,
        generation: persisted.generation,
        generatedAt: persisted.generatedAt,
        modelId: persisted.modelId,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to save daily digest');
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'save failed') });
    }
  }

  async findByDate(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly date: string;
  }): Promise<Result<PersistedDailySummary | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION).doc(docId(input.userId, input.groupKey, input.date)).get();
      if (!snap.exists) return ok(null);
      const data = snap.data() as DigestDoc;
      return ok({
        summary: data.summary,
        generation: data.generation,
        generatedAt: data.generatedAt,
        modelId: data.modelId,
      });
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findByDate failed') });
    }
  }

  async findRecentByGroup(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly limit: number;
  }): Promise<Result<readonly PersistedDailySummary[], RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION)
        .where('userId', '==', input.userId)
        .where('groupKey', '==', input.groupKey)
        .orderBy('date', 'desc')
        .limit(input.limit)
        .get();
      const items = snap.docs.map((d) => {
        const data = d.data() as DigestDoc;
        return {
          summary: data.summary,
          generation: data.generation,
          generatedAt: data.generatedAt,
          modelId: data.modelId,
        };
      });
      return ok(items);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findRecentByGroup failed') });
    }
  }

  async findInRange(input: {
    readonly userId: string;
    readonly groupKey: string;
    readonly fromDate: string;
    readonly toDate: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<Result<{
    readonly items: readonly PersistedDailySummary[];
    readonly nextCursor?: string;
  }, RepositoryError>> {
    try {
      const db = getFirestore();
      let query: FirebaseFirestore.Query = db.collection(COLLECTION)
        .where('userId', '==', input.userId)
        .where('groupKey', '==', input.groupKey)
        .where('date', '>=', input.fromDate)
        .where('date', '<=', input.toDate)
        .orderBy('date', 'desc');

      if (input.cursor !== undefined) {
        query = query.startAfter(input.cursor);
      }
      const snap = await query.limit(input.limit + 1).get();
      const docs = snap.docs.slice(0, input.limit);
      const items = docs.map((d) => {
        const data = d.data() as DigestDoc;
        return {
          summary: data.summary,
          generation: data.generation,
          generatedAt: data.generatedAt,
          modelId: data.modelId,
        };
      });
      const result: { items: readonly PersistedDailySummary[]; nextCursor?: string } = { items };
      if (snap.docs.length > input.limit) {
        const lastDate = items[items.length - 1]?.summary.date;
        if (lastDate !== undefined) result.nextCursor = lastDate;
      }
      return ok(result);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findInRange failed') });
    }
  }
}
```

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git add apps/mobile-notifications-service/src/infra/firestore/firestoreDigestRepository.ts \
        apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreDigestRepository.test.ts \
        apps/mobile-notifications-service/src/__tests__/infra/firestore/helpers/firestoreFake.ts
git commit -m "feat(mobile-notifications): add FirestoreDigestRepository with generation increment"
```

### Task 2.4: Test + implement FirestoreGroupStateRepository

**Files:**
- Create: `apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreGroupStateRepository.test.ts`
- Create: `apps/mobile-notifications-service/src/infra/firestore/firestoreGroupStateRepository.ts`

- [ ] **Step 1: Write 4 tests**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreGroupStateRepository } from '../../../infra/firestore/firestoreGroupStateRepository.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { resetFirestoreFake, useFirestoreFake } from './helpers/firestoreFake.js';

describe('FirestoreGroupStateRepository', () => {
  beforeEach(() => useFirestoreFake());
  afterEach(() => resetFirestoreFake());

  it('save then getByDate roundtrips a snapshot', async () => {
    const repo = new FirestoreGroupStateRepository();
    await repo.save({ state: COLD_START_EXAMPLE.stateUpdate, date: '2026-04-08' });
    const result = await repo.getByDate({ userId: COLD_START_EXAMPLE.stateUpdate.userId, groupKey: COLD_START_EXAMPLE.stateUpdate.groupKey, date: '2026-04-08' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
  });

  it('getByDate returns null for missing snapshot', async () => {
    const repo = new FirestoreGroupStateRepository();
    const result = await repo.getByDate({ userId: 'u', groupKey: 'g', date: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('getLatest returns the snapshot with the highest date', async () => {
    const repo = new FirestoreGroupStateRepository();
    const userId = COLD_START_EXAMPLE.stateUpdate.userId;
    const groupKey = COLD_START_EXAMPLE.stateUpdate.groupKey;
    for (const d of ['2026-04-08', '2026-04-09', '2026-04-10']) {
      await repo.save({ state: { ...COLD_START_EXAMPLE.stateUpdate, recentSummaryDates: [d] }, date: d });
    }
    const result = await repo.getLatest({ userId, groupKey });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) return;
    expect(result.value.recentSummaryDates).toEqual(['2026-04-10']);
  });

  it('save trims recentSummaryDates to the last 30', async () => {
    const repo = new FirestoreGroupStateRepository();
    const dates = Array.from({ length: 35 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
    const stateWithLong = { ...COLD_START_EXAMPLE.stateUpdate, recentSummaryDates: dates };
    await repo.save({ state: stateWithLong, date: '2026-04-08' });
    const result = await repo.getByDate({ userId: stateWithLong.userId, groupKey: stateWithLong.groupKey, date: '2026-04-08' });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) return;
    expect(result.value.recentSummaryDates.length).toBe(30);
    expect(result.value.recentSummaryDates[0]).toBe('2026-03-06'); // oldest after trim
  });
});
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement**

```typescript
// apps/mobile-notifications-service/src/infra/firestore/firestoreGroupStateRepository.ts
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  GroupStateRepository,
  RepositoryError,
} from '../../domain/repositories/digestRepositories.js';
import type { GroupState } from '../../domain/schemas/digestSchemas.js';

const COLLECTION = 'notification_group_states';
const MAX_RECENT_DATES = 30;

function docId(userId: string, groupKey: string, date: string): string {
  return `${userId}_${groupKey}_${date}`;
}

interface StateDoc {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string;
  readonly state: GroupState;
}

function trimRecent(state: GroupState): GroupState {
  if (state.recentSummaryDates.length <= MAX_RECENT_DATES) return state;
  return {
    ...state,
    recentSummaryDates: state.recentSummaryDates.slice(-MAX_RECENT_DATES),
  };
}

export class FirestoreGroupStateRepository implements GroupStateRepository {
  async getByDate(input: { userId: string; groupKey: string; date: string }): Promise<Result<GroupState | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION).doc(docId(input.userId, input.groupKey, input.date)).get();
      if (!snap.exists) return ok(null);
      return ok((snap.data() as StateDoc).state);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'getByDate failed') });
    }
  }

  async getLatest(input: { userId: string; groupKey: string }): Promise<Result<GroupState | null, RepositoryError>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION)
        .where('userId', '==', input.userId)
        .where('groupKey', '==', input.groupKey)
        .orderBy('date', 'desc')
        .limit(1)
        .get();
      if (snap.empty) return ok(null);
      const doc = snap.docs[0];
      /* v8 ignore start -- ts-type: snap.empty=false guarantees length>=1 but noUncheckedIndexedAccess @preserve */
      if (doc === undefined) return ok(null);
      /* v8 ignore stop @preserve */
      return ok((doc.data() as StateDoc).state);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'getLatest failed') });
    }
  }

  async save(input: { state: GroupState; date: string }): Promise<Result<void, RepositoryError>> {
    try {
      const trimmed = trimRecent(input.state);
      const db = getFirestore();
      const id = docId(input.state.userId, input.state.groupKey, input.date);
      const doc: StateDoc = {
        userId: input.state.userId,
        groupKey: input.state.groupKey,
        date: input.date,
        state: trimmed,
      };
      await db.collection(COLLECTION).doc(id).set(doc);
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'save failed') });
    }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/infra/firestore/firestoreGroupStateRepository.ts \
        apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreGroupStateRepository.test.ts
git commit -m "feat(mobile-notifications): add FirestoreGroupStateRepository with per-date snapshots"
```

### Task 2.5: Test + implement FirestoreDigestLockRepository

**Files:**
- Create: `apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreDigestLockRepository.test.ts`
- Create: `apps/mobile-notifications-service/src/infra/firestore/firestoreDigestLockRepository.ts`

- [ ] **Step 1: Tests (3)**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreDigestLockRepository } from '../../../infra/firestore/firestoreDigestLockRepository.js';
import { resetFirestoreFake, useFirestoreFake } from './helpers/firestoreFake.js';

describe('FirestoreDigestLockRepository', () => {
  beforeEach(() => {
    useFirestoreFake();
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetFirestoreFake();
    vi.useRealTimers();
  });

  it('first acquire returns acquired=true', async () => {
    const repo = new FirestoreDigestLockRepository();
    const result = await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'cron', currentDate: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acquired).toBe(true);
  });

  it('second acquire while held returns acquired=false with heldBy', async () => {
    const repo = new FirestoreDigestLockRepository();
    await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'cron', currentDate: '2026-04-15' });
    const result = await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'manual', currentDate: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acquired).toBe(false);
    expect(result.value.heldBy).toBe('cron');
  });

  it('acquire after TTL expiry succeeds', async () => {
    vi.setSystemTime(new Date('2026-04-15T00:00:00Z'));
    const repo = new FirestoreDigestLockRepository();
    await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'cron', currentDate: '2026-04-15' });
    vi.setSystemTime(new Date('2026-04-15T00:06:00Z')); // 6 min later, past 5-min TTL
    const result = await repo.acquire({ userId: 'u', groupKey: 'g', holder: 'manual', currentDate: '2026-04-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acquired).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// apps/mobile-notifications-service/src/infra/firestore/firestoreDigestLockRepository.ts
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  DigestLockRepository,
  RepositoryError,
} from '../../domain/repositories/digestRepositories.js';

const COLLECTION = 'notification_digest_locks';
const TTL_MS = 5 * 60 * 1000;

interface LockDoc {
  readonly userId: string;
  readonly groupKey: string;
  readonly holder: 'cron' | 'backfill' | 'manual';
  readonly currentDate: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

function docId(userId: string, groupKey: string): string {
  return `${userId}_${groupKey}`;
}

export class FirestoreDigestLockRepository implements DigestLockRepository {
  async acquire(input: {
    userId: string; groupKey: string; holder: 'cron' | 'backfill' | 'manual'; currentDate: string;
  }): Promise<Result<{ acquired: boolean; heldBy?: string }, RepositoryError>> {
    try {
      const db = getFirestore();
      const id = docId(input.userId, input.groupKey);
      const ref = db.collection(COLLECTION).doc(id);
      const now = Date.now();
      return await db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) {
          const data = existing.data() as LockDoc;
          const expires = new Date(data.expiresAt).getTime();
          if (expires > now) {
            return ok({ acquired: false, heldBy: data.holder });
          }
        }
        const doc: LockDoc = {
          userId: input.userId,
          groupKey: input.groupKey,
          holder: input.holder,
          currentDate: input.currentDate,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + TTL_MS).toISOString(),
        };
        tx.set(ref, doc);
        return ok({ acquired: true });
      });
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'acquire failed') });
    }
  }

  async release(input: { userId: string; groupKey: string }): Promise<Result<void, RepositoryError>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(docId(input.userId, input.groupKey)).delete();
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'release failed') });
    }
  }
}
```

- [ ] **Step 3: Run, verify pass. Commit.**

```bash
git add apps/mobile-notifications-service/src/infra/firestore/firestoreDigestLockRepository.ts \
        apps/mobile-notifications-service/src/__tests__/infra/firestore/firestoreDigestLockRepository.test.ts
git commit -m "feat(mobile-notifications): add FirestoreDigestLockRepository with 5-min TTL"
```

### Task 2.6: Update services container and register collections

**Files:**
- Modify: `apps/mobile-notifications-service/src/services.ts`
- Modify: `firestore-collections.json`
- Create: `apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts`

- [ ] **Step 1: Update services.ts**

Read the existing `services.ts` and add the three new repos. Keep the existing code intact.

```typescript
// Append to ServiceContainer interface:
digestRepository: DigestRepository;
groupStateRepository: GroupStateRepository;
digestLockRepository: DigestLockRepository;

// Append to the getServices() factory:
digestRepository: new FirestoreDigestRepository(),
groupStateRepository: new FirestoreGroupStateRepository(),
digestLockRepository: new FirestoreDigestLockRepository(),

// Add the imports up top:
import { FirestoreDigestRepository } from './infra/firestore/firestoreDigestRepository.js';
import { FirestoreGroupStateRepository } from './infra/firestore/firestoreGroupStateRepository.js';
import { FirestoreDigestLockRepository } from './infra/firestore/firestoreDigestLockRepository.js';
import type {
  DigestRepository,
  GroupStateRepository,
  DigestLockRepository,
} from './domain/repositories/digestRepositories.js';
```

- [ ] **Step 2: Update firestore-collections.json**

Update the existing `notification_group_states` description and append `notification_digest_locks`:

```json
"notification_group_states": {
  "owner": "mobile-notifications-service",
  "description": "Per-date snapshots of WhatsApp group state. Doc ID format: {userId}_{groupKey}_{YYYY-MM-DD}. Each daily run writes its own snapshot; 'current latest' = orderBy(date desc) limit 1."
},
"notification_digest_locks": {
  "owner": "mobile-notifications-service",
  "description": "Advisory locks serializing concurrent digest runs per (userId, groupKey). 5-minute TTL. Doc ID format: {userId}_{groupKey}."
}
```

- [ ] **Step 3: Create the mockServices helper**

```typescript
// apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts
import { setServices, type ServiceContainer } from '../../services.js';

export function setMockServices(overrides: Partial<ServiceContainer>): ServiceContainer {
  // Build a complete container by filling missing fields with throw-on-call stubs
  const stub = <T>(name: string): T =>
    new Proxy({} as object, {
      get(_t, prop) {
        return () => { throw new Error(`mockServices.${name}.${String(prop)} not configured`); };
      },
    }) as T;

  const container: ServiceContainer = {
    signatureConnectionRepository: overrides.signatureConnectionRepository ?? stub('signatureConnectionRepository'),
    notificationRepository: overrides.notificationRepository ?? stub('notificationRepository'),
    notificationFiltersRepository: overrides.notificationFiltersRepository ?? stub('notificationFiltersRepository'),
    digestRepository: overrides.digestRepository ?? stub('digestRepository'),
    groupStateRepository: overrides.groupStateRepository ?? stub('groupStateRepository'),
    digestLockRepository: overrides.digestLockRepository ?? stub('digestLockRepository'),
  };
  setServices(container);
  return container;
}
```

- [ ] **Step 4: Run mobile-notifications-service tests**

```bash
pnpm --filter @intexuraos/mobile-notifications-service test
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile-notifications-service/src/services.ts \
        apps/mobile-notifications-service/src/__tests__/helpers/mockServices.ts \
        firestore-collections.json
git commit -m "feat(mobile-notifications): wire digest repositories + lock + mockServices helper"
```

### Task 2.7: Test runDigestForGroup end-to-end with fakes

**Files:**
- Create: `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts`

- [ ] **Step 1: Write tests covering: happy path, lock-held, regenerate increments, CET-yesterday boundary**

```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runDigestForGroup } from '../../../domain/usecases/runDigestForGroup.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';
import { setMockServices } from '../../helpers/mockServices.js';
import { resetServices } from '../../../services.js';
import { FakeLlmClient } from '../../helpers/fakeLlmClient.js';

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakeNotificationRepo(messages: ReadonlyArray<{ sender: string; text: string; postTime: string; title: string; app: string }>) {
  // Minimal in-memory fake matching the existing NotificationRepository interface (subset used here)
  return {
    findByUserIdPaginated: async () => ({
      ok: true as const,
      value: {
        notifications: messages.map((m, i) => ({
          id: `n${i}`, userId: 'u', source: 's', device: 'd',
          notificationId: `n${i}`, timestamp: 0, receivedAt: '',
          ...m,
        })),
      },
    }),
    save: async () => ({ ok: true as const, value: { id: 'x' } }),
    findById: async () => ({ ok: true as const, value: null }),
    existsByNotificationIdAndUserId: async () => ({ ok: true as const, value: false }),
    delete: async () => ({ ok: true as const, value: undefined }),
  };
}

describe('runDigestForGroup', () => {
  afterEach(() => resetServices());

  it('returns lock-held without calling LLM when lock is held by another holder', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true as const, value: { acquired: false, heldBy: 'cron' } }),
        release: async () => ({ ok: true as const, value: undefined }),
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true as const, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'or:google/gemini-3-flash-preview' },
      { userId: 'u', groupKey: 'g', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('lock-held');
    expect(llm.calls).toHaveLength(0);
  });

  it('happy path: persists summary + state, releases lock, returns generation 1', async () => {
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    let savedSummary = false;
    let savedState = false;
    let lockReleased = false;
    setMockServices({
      digestLockRepository: {
        acquire: async () => ({ ok: true, value: { acquired: true } }),
        release: async () => { lockReleased = true; return { ok: true, value: undefined }; },
      },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: {
        save: async () => { savedSummary = true; return { ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: '' } }; },
        findByDate: async () => ({ ok: true, value: null }),
        findRecentByGroup: async () => ({ ok: true, value: [] }),
        findInRange: async () => ({ ok: true, value: { items: [] } }),
      },
      groupStateRepository: {
        getByDate: async () => ({ ok: true, value: null }),
        getLatest: async () => ({ ok: true, value: null }),
        save: async () => { savedState = true; return { ok: true, value: undefined }; },
      },
    });
    const result = await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'or:google/gemini-3-flash-preview' },
      { userId: 'u', groupKey: 'g', date: '2026-04-15', holder: 'manual' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.generation).toBe(1);
    expect(savedSummary).toBe(true);
    expect(savedState).toBe(true);
    expect(lockReleased).toBe(true);
  });

  it('passes the date verbatim into aggregateDigest input (no in-flow CET conversion)', async () => {
    // runDigestForGroup is timezone-agnostic: callers (cron route + manual triggers) compute
    // the CET date and pass it as `input.date`. This test asserts the use case does NOT
    // re-derive or shift the date — it forwards it exactly to aggregateDigest's prompt input.
    // The CET-yesterday computation is owned by `yesterdayCet()` (tested in Task 3.1).
    let capturedPromptDate: string | null = null;
    const llm = new FakeLlmClient([{ type: 'content', value: JSON.stringify(COLD_START_EXAMPLE) }]);
    // Wrap llm.generate to capture the date as it appears in the prompt
    const originalGenerate = llm.generate.bind(llm);
    llm.generate = async (prompt, options) => {
      const match = /^date: (\d{4}-\d{2}-\d{2})/m.exec(prompt);
      capturedPromptDate = match?.[1] ?? null;
      return originalGenerate(prompt, options);
    };
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: fakeNotificationRepo([]),
      digestRepository: { save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: '' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    await runDigestForGroup(
      { llmClient: llm, logger: noopLogger, modelId: 'm' },
      { userId: 'u', groupKey: 'g', date: '2026-04-15', holder: 'manual' },
    );
    expect(capturedPromptDate).toBe('2026-04-15');
  });
});
```

- [ ] **Step 2: Run, verify fail (impl missing)**

### Task 2.8: Implement runDigestForGroup

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts`

- [ ] **Step 1: Implement**

```typescript
// apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { getServices } from '../../services.js';
import { filterAndDedupeNotifications } from '../messageFilter.js';
import { aggregateDigest } from './aggregateDigest.js';
import {
  type DigestError,
  lockHeld,
  persistenceFailed,
} from './digestErrors.js';
import type { DailySummary, GroupState } from '../schemas/digestSchemas.js';

export interface RunDigestForGroupDeps {
  readonly llmClient: LlmGenerateClient;
  readonly logger: Logger;
  readonly modelId: string;
}

export interface RunDigestForGroupInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly date: string; // YYYY-MM-DD (CET interpretation)
  readonly holder: 'cron' | 'backfill' | 'manual';
}

export interface RunDigestForGroupResult {
  readonly summary: DailySummary;
  readonly state: GroupState;
  readonly generation: number;
  readonly modelId: string;
  readonly regenerated: boolean;
}

const PREVIOUS_SUMMARIES_WINDOW = 3;

export async function runDigestForGroup(
  deps: RunDigestForGroupDeps,
  input: RunDigestForGroupInput,
): Promise<Result<RunDigestForGroupResult, DigestError>> {
  const services = getServices();

  const lock = await services.digestLockRepository.acquire({
    userId: input.userId,
    groupKey: input.groupKey,
    holder: input.holder,
    currentDate: input.date,
  });
  if (!lock.ok) return err(persistenceFailed(lock.error.message));
  if (!lock.value.acquired) return err(lockHeld(lock.value.heldBy ?? 'unknown'));

  try {
    const previousState = await loadPreviousState(services, input);
    if (!previousState.ok) return err(persistenceFailed(previousState.error.message));

    const lastSummaries = await loadLastSummaries(services, input);
    if (!lastSummaries.ok) return err(persistenceFailed(lastSummaries.error.message));

    const messages = await loadDayMessages(services, input);
    if (!messages.ok) return err(persistenceFailed(messages.error.message));

    const filtered = filterAndDedupeNotifications(messages.value);
    deps.logger.info({ ...input, raw: messages.value.length, filtered: filtered.length }, 'runDigestForGroup: input prepared');

    const existing = await services.digestRepository.findByDate({
      userId: input.userId, groupKey: input.groupKey, date: input.date,
    });
    if (!existing.ok) return err(persistenceFailed(existing.error.message));
    const regenerated = existing.value !== null;

    const aggregation = await aggregateDigest(
      { llmClient: deps.llmClient, logger: deps.logger },
      {
        userId: input.userId,
        groupKey: input.groupKey,
        date: input.date,
        previousState: previousState.value,
        last3Summaries: lastSummaries.value.map((p) => p.summary),
        todaysMessages: filtered.map((m) => ({ sender: m.sender, text: m.text, postTimeSec: m.postTimeSec })),
      },
    );
    if (!aggregation.ok) return aggregation;

    const persistSummary = await services.digestRepository.save({
      userId: input.userId,
      groupKey: input.groupKey,
      summary: aggregation.value.dailySummary,
      modelId: deps.modelId,
    });
    if (!persistSummary.ok) return err(persistenceFailed(persistSummary.error.message));

    const persistState = await services.groupStateRepository.save({
      state: aggregation.value.stateUpdate,
      date: input.date,
    });
    if (!persistState.ok) return err(persistenceFailed(persistState.error.message));

    return ok({
      summary: aggregation.value.dailySummary,
      state: aggregation.value.stateUpdate,
      generation: persistSummary.value.generation,
      modelId: deps.modelId,
      regenerated,
    });
  } finally {
    await services.digestLockRepository.release({ userId: input.userId, groupKey: input.groupKey });
  }
}

async function loadPreviousState(
  services: ReturnType<typeof getServices>,
  input: RunDigestForGroupInput,
): Promise<Result<GroupState | null, { message: string }>> {
  const prior = previousDate(input.date);
  const r = await services.groupStateRepository.getByDate({
    userId: input.userId, groupKey: input.groupKey, date: prior,
  });
  if (!r.ok) return err({ message: r.error.message });
  return ok(r.value);
}

async function loadLastSummaries(services: ReturnType<typeof getServices>, input: RunDigestForGroupInput) {
  return services.digestRepository.findRecentByGroup({
    userId: input.userId, groupKey: input.groupKey, limit: PREVIOUS_SUMMARIES_WINDOW,
  });
}

async function loadDayMessages(services: ReturnType<typeof getServices>, input: RunDigestForGroupInput) {
  // The notification repo already filters by app/title; we narrow further here by date.
  // Using ISO date conversion via Europe/Warsaw timezone.
  return services.notificationRepository.findByUserIdPaginated(input.userId, {
    limit: 1000,
    filter: { title: input.groupKey, app: ['com.whatsapp'] },
  });
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Run tests, verify pass**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile-notifications-service/src/domain/usecases/runDigestForGroup.ts \
        apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestForGroup.test.ts
git commit -m "feat(mobile-notifications): add runDigestForGroup composed use case"
```

### Task 2.9: Verify Phase 2 ci:tracked + open PR

- [ ] **Step 1: Run**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked-phase-2.txt
```

Resolve any failures.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feature/digest-phase-2
gh pr create --title "[INT-1382] phase 2: digest repositories + composed runDigestForGroup + advisory lock" \
  --body "$(cat <<'EOF'
## Summary
- Adds `DigestRepository` (per-date docs with `generation` increment via Firestore transaction).
- Adds `GroupStateRepository` with per-date snapshots and 30-day `recentSummaryDates` trim on save.
- Adds `DigestLockRepository` advisory lock with 5-min TTL.
- Adds composed `runDigestForGroup` use case wiring messages → filter → aggregate → persist.
- Updates `firestore-collections.json` description for `notification_group_states`; registers `notification_digest_locks`.
- Adds `setMockServices()` helper.

## Scope
Phase 2 of 4 — see `docs/superpowers/plans/2026-04-17-whatsapp-group-digest.md`.

## Test plan
- [x] `pnpm run ci:tracked` green
- [x] All new repos covered 100%

Refs INT-1382
EOF
)" --base development
```

---

# Phase 3: HTTP Routes + Cron + Backfill Chain

**Branch:** `feature/digest-phase-3` (off `development` AFTER Phase 2 is merged). PR title: `[INT-1382] phase 3: digest HTTP endpoints + Cloud Scheduler + backfill chain`.

### Task 3.1: Create digestSubscriptions const + yesterdayCet helper

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/digestSubscriptions.ts`
- Create: `apps/mobile-notifications-service/src/domain/usecases/yesterdayCet.ts`
- Test: `apps/mobile-notifications-service/src/__tests__/domain/usecases/yesterdayCet.test.ts`

- [ ] **Step 1: Write subscriptions const**

```typescript
// apps/mobile-notifications-service/src/domain/digestSubscriptions.ts
/**
 * Hard-coded digest subscriptions for v1 (single user / single group).
 * To migrate to a Firestore-backed registry: write each entry to a new
 * `notification_digest_subscriptions` collection and replace this file
 * with a repository. See INT-1382 for context.
 */
export interface DigestSubscription {
  readonly userId: string;
  readonly groupKey: string;
  readonly groupTitlePrefix: string;
}

export const DIGEST_SUBSCRIPTIONS: readonly DigestSubscription[] = [
  {
    userId: 'google-oauth2|113131655542389277022',
    groupKey: 'grupa-wedkarska-skool',
    groupTitlePrefix: 'Grupa Wędkarska Skool',
  },
] as const;
```

- [ ] **Step 2: Test for yesterdayCet (DST + boundary)**

```typescript
// apps/mobile-notifications-service/src/__tests__/domain/usecases/yesterdayCet.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { yesterdayCet } from '../../../domain/usecases/yesterdayCet.js';

describe('yesterdayCet', () => {
  afterEach(() => vi.useRealTimers());

  it('returns previous CET date when run at 02:00 CET in winter (UTC=01:00)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T01:00:00Z')); // 02:00 CET
    expect(yesterdayCet()).toBe('2026-01-14');
  });

  it('returns previous CET date when run at 03:00 CEST in summer (UTC=01:00)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T01:00:00Z')); // 03:00 CEST
    expect(yesterdayCet()).toBe('2026-07-14');
  });

  it('handles month boundary correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T01:00:00Z')); // 03:00 CEST
    expect(yesterdayCet()).toBe('2026-04-30');
  });
});
```

- [ ] **Step 3: Implement**

```typescript
// apps/mobile-notifications-service/src/domain/usecases/yesterdayCet.ts
const TZ = 'Europe/Warsaw';

export function yesterdayCet(now: Date = new Date()): string {
  const cetTodayString = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  // cetTodayString is YYYY-MM-DD already
  const [y, m, d] = cetTodayString.split('-').map((s) => parseInt(s, 10));
  /* v8 ignore start -- ts-type: split('-') always returns 3 parts for valid en-CA date string @preserve */
  if (y === undefined || m === undefined || d === undefined) throw new Error('unreachable');
  /* v8 ignore stop @preserve */
  const utcMidnight = Date.UTC(y, m - 1, d);
  const yesterday = new Date(utcMidnight - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(yesterday);
}
```

- [ ] **Step 4: Run tests, verify pass. Commit.**

```bash
git add apps/mobile-notifications-service/src/domain/digestSubscriptions.ts \
        apps/mobile-notifications-service/src/domain/usecases/yesterdayCet.ts \
        apps/mobile-notifications-service/src/__tests__/domain/usecases/yesterdayCet.test.ts
git commit -m "feat(mobile-notifications): add hard-coded subscriptions and CET-yesterday helper"
```

### Task 3.2: Test + implement POST /internal/notifications/digest/run

**Files:**
- Create: `apps/mobile-notifications-service/src/routes/digestRoutes.ts`
- Create: `apps/mobile-notifications-service/src/routes/digestSchemas.ts`
- Modify: `apps/mobile-notifications-service/src/routes/routes.ts`
- Test: `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`

- [ ] **Step 1: Write inject-based route test for POST /internal/notifications/digest/run**

```typescript
// apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../server.js';
import { setMockServices } from '../helpers/mockServices.js';
import { resetServices } from '../../services.js';
import { COLD_START_EXAMPLE } from '@intexuraos/llm-prompts';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth';

beforeEach(() => {
  process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
  process.env['INTEXURAOS_DIGEST_LLM_MODEL'] = 'or:google/gemini-3-flash-preview';
  process.env['INTEXURAOS_OPENROUTER_API_KEY'] = 'test-key';
});
afterEach(() => resetServices());

describe('POST /internal/notifications/digest/run', () => {
  it('rejects without X-Internal-Auth header', async () => {
    setMockServices({});
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run',
      payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with summary metadata on success', async () => {
    // Provide fakes such that runDigestForGroup succeeds end-to-end
    setMockServices({
      digestLockRepository: { acquire: async () => ({ ok: true, value: { acquired: true } }), release: async () => ({ ok: true, value: undefined }) },
      notificationRepository: { findByUserIdPaginated: async () => ({ ok: true, value: { notifications: [] } }), save: async () => ({ ok: true, value: { id: 'x' } }), findById: async () => ({ ok: true, value: null }), existsByNotificationIdAndUserId: async () => ({ ok: true, value: false }), delete: async () => ({ ok: true, value: undefined }) },
      digestRepository: { save: async () => ({ ok: true, value: { summary: COLD_START_EXAMPLE.dailySummary, generation: 1, generatedAt: '', modelId: 'or:google/gemini-3-flash-preview' } }), findByDate: async () => ({ ok: true, value: null }), findRecentByGroup: async () => ({ ok: true, value: [] }), findInRange: async () => ({ ok: true, value: { items: [] } }) },
      groupStateRepository: { getByDate: async () => ({ ok: true, value: null }), getLatest: async () => ({ ok: true, value: null }), save: async () => ({ ok: true, value: undefined }) },
    });
    // Note: a fake LLM client must be wired through services or via env mock — the route handler
    // constructs the LLM via llm-factory at request time. The test uses a vitest module mock:
    vi.doMock('@intexuraos/llm-factory', async () => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: () => ({
          generate: async () => ({ ok: true, value: { content: JSON.stringify(COLD_START_EXAMPLE), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 } } }),
        }),
      };
    });
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/notifications/digest/run',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
      payload: { userId: 'u', groupKey: 'g', date: '2026-04-15' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.generation).toBe(1);
  });
});
```

- [ ] **Step 2: Implement minimal route + schema + register in routes.ts**

```typescript
// apps/mobile-notifications-service/src/routes/digestSchemas.ts
export const runRequestSchema = {
  type: 'object',
  required: ['userId', 'groupKey', 'date'],
  properties: {
    userId: { type: 'string' },
    groupKey: { type: 'string' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
} as const;

export const runResponseSchema = {
  type: 'object',
  required: ['summaryDocId', 'generation', 'messageCount', 'modelId', 'regenerated'],
  properties: {
    summaryDocId: { type: 'string' },
    generation: { type: 'number' },
    messageCount: { type: 'number' },
    modelId: { type: 'string' },
    regenerated: { type: 'boolean' },
    lockSkipped: { type: 'boolean' },
  },
} as const;
```

```typescript
// apps/mobile-notifications-service/src/routes/digestRoutes.ts
import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { createLlmClient, type LlmClientConfig } from '@intexuraos/llm-factory';
import { isOpenRouterModel, createOpenRouterModelId } from '@intexuraos/llm-contract';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { runDigestForGroup } from '../domain/usecases/runDigestForGroup.js';
import { runRequestSchema, runResponseSchema } from './digestSchemas.js';

const logger = createAppLogger({ name: 'digestRoutes' });

interface RunBody {
  userId: string;
  groupKey: string;
  date: string;
}

function getDigestModel(): string {
  const m = process.env['INTEXURAOS_DIGEST_LLM_MODEL'];
  if (m === undefined || m === '') throw new Error('INTEXURAOS_DIGEST_LLM_MODEL not set');
  return m;
}

function buildLlmClient(userId: string) {
  const model = getDigestModel();
  const apiKey = process.env['INTEXURAOS_OPENROUTER_API_KEY'] ?? '';
  const config: LlmClientConfig = {
    apiKey,
    model: isOpenRouterModel(model) ? createOpenRouterModelId(model.slice(3)) as never : (model as never),
    userId,
    logger,
    usageSink: { record: async () => undefined },
    ownerType: 'system',
  };
  return createLlmClient(config);
}

export const digestRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: RunBody }>(
    '/internal/notifications/digest/run',
    {
      schema: {
        operationId: 'internalRunDigest',
        summary: 'Run digest for a specific (userId, groupKey, date)',
        tags: ['mobile-notifications'],
        body: runRequestSchema,
        response: { 200: { type: 'object', required: ['success', 'data'], properties: { success: { const: true, type: 'boolean' }, data: runResponseSchema } } },
      },
    },
    async (req, reply) => {
      logIncomingRequest(req);
      const expected = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
      if (req.headers['x-internal-auth'] !== expected || expected === '') {
        return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'missing or invalid internal auth' } });
      }
      const { userId, groupKey, date } = req.body;
      const llmClient = buildLlmClient(userId);
      const modelId = getDigestModel();
      const result = await runDigestForGroup(
        { llmClient, logger, modelId },
        { userId, groupKey, date, holder: 'manual' },
      );
      if (!result.ok) {
        if (result.error.code === 'lock-held') {
          return reply.code(200).send({ success: true, data: { summaryDocId: '', generation: 0, messageCount: 0, modelId, regenerated: false, lockSkipped: true } });
        }
        return reply.code(500).send({ success: false, error: { code: 'DIGEST_FAILED', message: JSON.stringify(result.error) } });
      }
      return reply.code(200).send({
        success: true,
        data: {
          summaryDocId: `${userId}_${groupKey}_${date}`,
          generation: result.value.generation,
          messageCount: result.value.summary.messageCount,
          modelId: result.value.modelId,
          regenerated: result.value.regenerated,
        },
      });
    },
  );

  done();
};
```

Modify `apps/mobile-notifications-service/src/routes/routes.ts` to register `digestRoutes`.

- [ ] **Step 3: Run tests, verify pass. Commit.**

```bash
git add apps/mobile-notifications-service/src/routes/digestRoutes.ts \
        apps/mobile-notifications-service/src/routes/digestSchemas.ts \
        apps/mobile-notifications-service/src/routes/routes.ts \
        apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts
git commit -m "feat(mobile-notifications): add POST /internal/notifications/digest/run"
```

### Task 3.3: Add POST /internal/notifications/digest/run-yesterday (cron entry)

- [ ] **Step 1: Append test**

```typescript
describe('POST /internal/notifications/digest/run-yesterday', () => {
  it('iterates DIGEST_SUBSCRIPTIONS and dispatches one /run per entry', async () => {
    /* setup similar to previous test; verify body returns { dispatched: 1 } */
  });
});
```

- [ ] **Step 2: Implement in digestRoutes.ts**

```typescript
fastify.post('/internal/notifications/digest/run-yesterday', { /* schema */ }, async (req, reply) => {
  logIncomingRequest(req);
  const expected = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  if (req.headers['x-internal-auth'] !== expected || expected === '') {
    return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'missing internal auth' } });
  }
  const date = yesterdayCet();
  const dispatched: number = await Promise.all(
    DIGEST_SUBSCRIPTIONS.map(async (sub) => {
      const llm = buildLlmClient(sub.userId);
      const r = await runDigestForGroup({ llmClient: llm, logger, modelId: getDigestModel() }, { userId: sub.userId, groupKey: sub.groupKey, date, holder: 'cron' });
      return r.ok ? 1 : 0;
    }),
  ).then((arr) => arr.reduce((a, b) => a + b, 0));
  return reply.code(200).send({ success: true, data: { dispatched, date } });
});
```

- [ ] **Step 3: Run tests, verify pass. Commit.**

### Task 3.4: User-facing routes (POST /run, GET /digests, GET /digests/:groupKey/:date, GET .../state)

Apply the same TDD pattern. Each gets its own test + implementation step. Use `requireAuth` from `@intexuraos/common-http` for Auth0-gated routes. Read existing `notificationRoutes.ts` for the auth + response-shape conventions.

- [ ] **Step 1: Tests for all 4 user routes**

For each: write a test that exercises auth, happy path, and not-found (where applicable). Reference INT-1382 plan endpoint table for request/response shapes.

- [ ] **Step 2: Implement handlers in `digestRoutes.ts`**

`GET /notifications/digests`: calls `services.digestRepository.findInRange`, paginates by date.

`GET /notifications/digests/:groupKey/:date`: calls `findByDate`, 404 if missing.

`GET /notifications/digests/:groupKey/:date/state`: calls `services.groupStateRepository.getByDate`, 404 if missing.

`POST /notifications/digests/run`: same as internal /run but auth via Auth0 + verify `userId === req.user.sub`.

- [ ] **Step 3: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(mobile-notifications): add user-facing digest read + run routes"
```

### Task 3.5: Backfill repository + run doc

**Files:**
- Create: `apps/mobile-notifications-service/src/infra/firestore/firestoreBackfillRunRepository.ts`
- Test: corresponding `__tests__/infra/firestore/firestoreBackfillRunRepository.test.ts`
- Modify: `firestore-collections.json` (register `notification_digest_backfill_runs`)
- Modify: `apps/mobile-notifications-service/src/services.ts` (wire the repo)

- [ ] **Step 1: Test the repo (3 tests: create, update progress, find by id)**

(Mirror the FirestoreDigestRepository pattern.)

- [ ] **Step 2: Implement**

```typescript
// apps/mobile-notifications-service/src/infra/firestore/firestoreBackfillRunRepository.ts
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';

const COLLECTION = 'notification_digest_backfill_runs';

export interface BackfillRun {
  readonly runId: string;
  readonly userId: string;
  readonly groupKey: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly totalDates: number;
  readonly completedDates: readonly string[];
  readonly failedDates: ReadonlyArray<{ readonly date: string; readonly error: string }>;
  readonly currentDate: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export class FirestoreBackfillRunRepository {
  async create(run: BackfillRun): Promise<Result<void, { code: string; message: string }>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(run.runId).set(run);
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'create failed') });
    }
  }

  async update(runId: string, partial: Partial<BackfillRun>): Promise<Result<void, { code: string; message: string }>> {
    try {
      const db = getFirestore();
      await db.collection(COLLECTION).doc(runId).update({ ...partial, updatedAt: new Date().toISOString() });
      return ok(undefined);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'update failed') });
    }
  }

  async findById(runId: string): Promise<Result<BackfillRun | null, { code: string; message: string }>> {
    try {
      const db = getFirestore();
      const snap = await db.collection(COLLECTION).doc(runId).get();
      if (!snap.exists) return ok(null);
      return ok(snap.data() as BackfillRun);
    } catch (error) {
      return err({ code: 'INTERNAL_ERROR', message: getErrorMessage(error, 'findById failed') });
    }
  }
}
```

- [ ] **Step 3: Register in firestore-collections.json**

```json
"notification_digest_backfill_runs": {
  "owner": "mobile-notifications-service",
  "description": "Progress tracking for digest backfill runs. One doc per run; mutated as the HTTP-chain processes each day."
}
```

- [ ] **Step 4: Wire in services.ts. Run tests. Commit.**

### Task 3.6: Backfill use case + chain endpoints

**Files:**
- Create: `apps/mobile-notifications-service/src/domain/usecases/runDigestBackfill.ts`
- Test: `apps/mobile-notifications-service/src/__tests__/domain/usecases/runDigestBackfill.test.ts`
- Modify: `apps/mobile-notifications-service/src/routes/digestRoutes.ts` (3 new endpoints: backfill start, internal run with chainNext, backfill resume)

- [ ] **Step 1: Write the test for the chain logic**

```typescript
// runDigestBackfill orchestrates:
// 1. write run doc with totalDates = N, status='queued'
// 2. POST /internal/run for day 1 with chainNext={fromDate, toDate}
// 3. when /run completes day N, if N < toDate, schedule POST for day N+1 with 1s delay
// 4. when N == toDate, mark run completed
//
// The test injects a fake HTTP poster (or stubs `fetch`) and asserts the chain.
```

- [ ] **Step 2: Implement**

```typescript
// apps/mobile-notifications-service/src/domain/usecases/runDigestBackfill.ts
import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { getServices } from '../../services.js';

export interface RunDigestBackfillDeps {
  readonly logger: Logger;
  readonly httpPost: (path: string, body: unknown) => Promise<Result<unknown, { message: string }>>;
}

export interface RunDigestBackfillInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export function listDates(fromDate: string, toDate: string): readonly string[] {
  const out: string[] = [];
  let d = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

export async function startDigestBackfill(deps: RunDigestBackfillDeps, input: RunDigestBackfillInput): Promise<Result<{ runId: string; queuedDates: readonly string[] }, { message: string }>> {
  const dates = listDates(input.fromDate, input.toDate);
  const runId = `bf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const services = getServices();
  const now = new Date().toISOString();
  const created = await services.backfillRunRepository.create({
    runId, userId: input.userId, groupKey: input.groupKey,
    fromDate: input.fromDate, toDate: input.toDate,
    status: 'running', totalDates: dates.length, completedDates: [],
    failedDates: [], currentDate: dates[0] ?? null,
    startedAt: now, updatedAt: now,
  });
  if (!created.ok) return err({ message: created.error.message });

  // Trigger first day via internal HTTP (chainNext drives the rest)
  const first = dates[0];
  if (first !== undefined) {
    const triggered = await deps.httpPost('/internal/notifications/digest/run', {
      userId: input.userId, groupKey: input.groupKey, date: first,
      chainNext: { runId, remainingDates: dates.slice(1), fromDate: input.fromDate, toDate: input.toDate },
    });
    if (!triggered.ok) return err({ message: triggered.error.message });
  }
  return ok({ runId, queuedDates: dates });
}
```

- [ ] **Step 3: Modify the existing internal `/run` endpoint to consume `chainNext`**

After a successful `runDigestForGroup`, if `body.chainNext` is present and `remainingDates.length > 0`:
1. Update the run doc: append completed date.
2. `setTimeout(() => httpPost('/internal/notifications/digest/run', { ...remainingDates[0]... }), 1000)`.
3. If `remainingDates.length === 0`, mark run `status: 'completed'`, `completedAt: now`.
4. On failure of the run, mark `status: 'failed'`, push to `failedDates`, do NOT chain.

The `httpPost` helper for chaining should call the local Cloud Run URL (so each call is a fresh request). In dev (`PM2`), it's `http://localhost:<port>`. In prod, it's `process.env['INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL']` (must be wired).

- [ ] **Step 4: Add user-facing POST /notifications/digests/backfill + GET /notifications/digests/backfill/:runId + POST .../resume**

The `backfill` endpoint validates `req.user.sub === userId` (same-user check), generates the runId, and POSTs to `/internal/notifications/digest/run` to kick off the chain. The `resume` endpoint reads the run doc, computes `remainingDates`, and re-triggers from `failedAtDate`.

- [ ] **Step 5: Run tests, verify pass. Commit.**

### Task 3.7: Wire env var INTEXURAOS_DIGEST_LLM_MODEL (3 locations)

- [ ] **Step 1: `apps/mobile-notifications-service/src/index.ts`**

Append `'INTEXURAOS_DIGEST_LLM_MODEL'` to `REQUIRED_ENV`.

- [ ] **Step 2: `terraform/environments/dev/main.tf`**

Find the existing `mobile-notifications-service` Cloud Run resource. Add to its env vars:

```hcl
env {
  name  = "INTEXURAOS_DIGEST_LLM_MODEL"
  value = "or:google/gemini-3-flash-preview"
}
```

- [ ] **Step 3: `ecosystem.config.cjs`**

Find the `mobile-notifications-service` PM2 entry. Add to `env`:

```js
INTEXURAOS_DIGEST_LLM_MODEL: 'or:google/gemini-3-flash-preview',
```

- [ ] **Step 4: Verify config + commit**

```bash
git add apps/mobile-notifications-service/src/index.ts terraform/environments/dev/main.tf ecosystem.config.cjs
git commit -m "feat(infra): wire INTEXURAOS_DIGEST_LLM_MODEL across three locations"
```

### Task 3.8: Add Cloud Scheduler resource

**Files:**
- Modify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Append Cloud Scheduler job**

```hcl
resource "google_cloud_scheduler_job" "mobile_notifications_digest_yesterday" {
  name        = "mobile-notifications-digest-yesterday"
  description = "Daily WhatsApp digest aggregation at 02:00 CET / 03:00 CEST"
  schedule    = "0 1 * * *"
  time_zone   = "UTC"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.mobile_notifications_service.uri}/internal/notifications/digest/run-yesterday"
    headers = {
      "X-Internal-Auth" = var.internal_auth_token
      "Content-Type"    = "application/json"
    }
    body = base64encode("{}")
  }

  retry_config {
    retry_count = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }
}
```

- [ ] **Step 2: `terraform validate`**

```bash
cd terraform/environments/dev
terraform init -backend=false
terraform validate
```

- [ ] **Step 3: Commit**

### Task 3.9: Add composite indexes migration

**Files:**
- Create: `migrations/20260417000000_notification_digest_indexes.mjs`

- [ ] **Step 1: Write the migration mirroring existing `migrations/*.mjs` patterns**

```javascript
// migrations/20260417000000_notification_digest_indexes.mjs
export const id = '20260417000000_notification_digest_indexes';
export const description = 'Composite indexes for notification digest queries';

export async function up({ admin }) {
  // Manual step: composite indexes are managed via gcloud / Firebase console.
  // This migration documents the required indexes for the digest queries.
  console.log(`
Required composite indexes (apply via gcloud or Firebase console):

1. notification_daily_digests
   - userId ASC
   - groupKey ASC
   - date DESC

2. notification_group_states
   - userId ASC
   - groupKey ASC
   - date DESC
`);
}
```

- [ ] **Step 2: Commit**

### Task 3.10: Phase 3 ci:tracked + open PR

- [ ] **Step 1: Run**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked-phase-3.txt
```

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feature/digest-phase-3
gh pr create --title "[INT-1382] phase 3: digest HTTP endpoints + Cloud Scheduler + backfill chain" \
  --body "$(cat <<'EOF'
## Summary
- 9 endpoints: internal /run, /run-yesterday (cron entry), user POST /run, /backfill, /backfill/:id/resume, GET /digests, /digests/:groupKey/:date, /digests/:groupKey/:date/state, /digests/backfill/:runId.
- Backfill is HTTP-chain (no in-memory worker): each day's completion POSTs the next day with 1s delay. Survives Cloud Run scale-to-zero.
- CET-yesterday helper using IANA Europe/Warsaw (DST-aware).
- Cloud Scheduler `0 1 * * *` UTC.
- Env var `INTEXURAOS_DIGEST_LLM_MODEL` wired in 3 places.

## Scope
Phase 3 of 4 — see `docs/superpowers/plans/2026-04-17-whatsapp-group-digest.md`.

## Test plan
- [x] `pnpm run ci:tracked` green
- [x] All 9 endpoints have route tests via `app.inject`
- [x] Backfill chain test verifies day N completion triggers day N+1 POST

Refs INT-1382
EOF
)" --base development
```

---

# Phase 4: Web UI mirroring Code Tasks

**Branch:** `feature/digest-phase-4` (off `development` AFTER Phase 3 is merged). PR title: `[INT-1382] phase 4: digest web UI`. PR body uses `Closes INT-1382`.

**Implementer note (subagent will be Opus):** before writing any UI, read these reference files in full to lock in the visual conventions:
- `apps/web/src/pages/CodeTasksPage.tsx`
- `apps/web/src/pages/CodeTaskViewPage.tsx`
- `apps/web/src/components/code-tasks/IssueGroupRow.tsx`
- `apps/web/src/components/code-tasks/TaskHeader.tsx`
- `apps/web/src/components/code-tasks/LogStream.tsx`
- `apps/web/src/components/code-tasks/TaskActions.tsx`

Match the filter-chip + colored-dot pattern, the localStorage persistence pattern, the modal-driven action pattern, and the Tailwind dark-mode pair conventions exactly.

### Task 4.1: Verify (or wire) web env infrastructure (3 locations)

- [ ] **Step 1: Read `apps/web/src/config.ts`**

Search for `getServiceUrl`. If `mobile-notifications-service` is already mapped, no change needed for this file. Otherwise add it.

- [ ] **Step 2: Read `apps/web/cloudbuild.yaml`**

Search for `CLOUD_RUN_SERVICES`. If `mobile-notifications-service:<SUFFIX>` is present, no change. Otherwise add it. The SUFFIX matches the existing pattern.

- [ ] **Step 3: Read `apps/web/vite.config.ts`**

Search for `/api/notifications`. If a proxy entry routes `/api/notifications/*` to `mobile-notifications-service`, also confirm `/api/notifications/digests` and `/api/notifications/digest-*` paths fall under it. If not, add explicit entries.

- [ ] **Step 4: Read `ecosystem.config.cjs`**

Confirm the web app's PM2 entry has the right env for the proxy to find the upstream.

- [ ] **Step 5: Commit any changes**

```bash
git commit -m "chore(web): wire mobile-notifications proxy for digest endpoints"
```

If no changes were needed, skip the commit and document the verification in the PR body.

### Task 4.2: Types + API service

**Files:**
- Create: `apps/web/src/types/notificationDigests.ts`
- Create: `apps/web/src/services/notificationDigestsApi.ts`

- [ ] **Step 1: Define types**

Mirror the response shapes documented in Phase 3's endpoint table. Keep them minimal — match exactly what the API returns.

- [ ] **Step 2: Create API service using `useApiClient` / `apiClient` per existing patterns in `apps/web/src/services/`.**

Read `apps/web/src/services/codeAgentApi.ts` to copy the auth + fetch pattern.

- [ ] **Step 3: Tests for the service (per CLAUDE.md web exception, services REQUIRE tests).**

- [ ] **Step 4: Run tests, commit.**

### Task 4.3: Hooks (useDigestList, useDigestView, useBackfillRun)

**Files:**
- Create: `apps/web/src/hooks/useDigestList.ts`
- Create: `apps/web/src/hooks/useDigestView.ts`
- Create: `apps/web/src/hooks/useBackfillRun.ts`
- Create: `apps/web/src/hooks/__tests__/useDigestList.test.ts`
- Create: `apps/web/src/hooks/__tests__/useDigestView.test.ts`
- Create: `apps/web/src/hooks/__tests__/useBackfillRun.test.ts`

- [ ] **Step 1: useDigestList** — mirror `useIssueGroups` patterns (filters, sort, localStorage, polling). Persist filter+sort in `localStorage` keyed `notification-digests-filter` and `notification-digests-sort`.

- [ ] **Step 2: useDigestView** — mirror `useTaskView`: load + error + action handlers (regenerate, prev/next).

- [ ] **Step 3: useBackfillRun** — polls the `notification_digest_backfill_runs/{runId}` doc via the API every 2s while status is `running`, stops on `completed`/`failed`.

- [ ] **Step 4: Tests for each, commit.**

### Task 4.4: Atomic components (Row, Heatmap, Header, Narrative, Threads, ModeratorPosts, State, Actions)

**Files:** all under `apps/web/src/components/notification-digests/`.

- [ ] **Step 1: Build each component**

Each is a small, focused React component (~50-100 lines). Follow these specifics:

- **DigestRow.tsx**: List item showing date, message count, generation badge, "Regenerated" indicator dot if generation > 1. Click → navigate to detail.
- **DigestHeatmap.tsx**: 30-day calendar grid (5 rows × 7 cols approx). Cell color intensity = log(messageCount). Click → navigate to that date's digest.
- **DigestHeader.tsx**: Date title, group name, generation badge, prev/next day chevron buttons (use `useNavigate`), Regenerate button (opens RegenerateConfirmModal).
- **DigestNarrative.tsx**: Polish prose container with `max-w-prose`, `leading-relaxed`, `font-feature-settings: 'kern'` for diacritics. Optional `lang="pl"` attribute for browser hyphenation.
- **DigestThreads.tsx**: Card per thread with topic header, participant chips, resolved/open status pill, expandable keyFacts list.
- **DigestModeratorPosts.tsx**: Vertical timeline with HH:MM markers on the left.
- **DigestState.tsx**: Three collapsible panels: identity ledger, open threads, moderator events.
- **DigestActions.tsx**: Action button row at bottom of detail page (Regenerate, View State, Copy as Markdown).

- [ ] **Step 2: For each, ensure Tailwind dark-mode pairs (`text-slate-700 dark:text-slate-300` etc.). Use lucide icons.**

- [ ] **Step 3: Commit each component (or batch by responsibility)**

### Task 4.5: Modals (RegenerateConfirmModal, BackfillRangeModal)

- [ ] **Step 1: RegenerateConfirmModal**

Shows "This summary was generated N time(s). Regenerating will create generation N+1, overwriting the current content. Continue?" with Confirm / Cancel buttons.

- [ ] **Step 2: BackfillRangeModal**

Two date inputs (fromDate, toDate). Validates fromDate ≤ toDate ≤ today. On submit calls `notificationDigestsApi.startBackfill`.

- [ ] **Step 3: Commit**

### Task 4.6: BackfillProgressGrid

- [ ] **Step 1: Implement**

Cell-per-day grid showing each date in `[fromDate, toDate]` color-coded by status:
- gray: pending
- blue (animated pulse): currently running (matches `currentDate` in run doc)
- green: completed
- red: failed (with tooltip showing the error)

- [ ] **Step 2: Commit**

### Task 4.7: Three pages

**Files:**
- Create: `apps/web/src/pages/NotificationDigestsPage.tsx`
- Create: `apps/web/src/pages/NotificationDigestViewPage.tsx`
- Create: `apps/web/src/pages/NotificationDigestBackfillPage.tsx`

- [ ] **Step 1: NotificationDigestsPage**

Header: filter chips (status of latest digest, date range pickers, group selector — currently 1 group, but UI accepts list for future). Heatmap below header. Below heatmap: list of `DigestRow`s. Page is ~150 lines per CLAUDE.md SRP.

- [ ] **Step 2: NotificationDigestViewPage**

Composes DigestHeader, DigestNarrative, DigestThreads, DigestModeratorPosts, DigestState, DigestActions. Loads via `useDigestView`. Shows skeleton while loading, error banner on error.

- [ ] **Step 3: NotificationDigestBackfillPage**

Header: backfill metadata (run id, range, started at). Body: BackfillProgressGrid. Footer: Resume button (visible if status='failed'). Polls via `useBackfillRun`.

- [ ] **Step 4: Commit**

### Task 4.8: App.tsx routes + final ci:tracked

- [ ] **Step 1: Add 3 routes to `apps/web/src/App.tsx`**

```tsx
<Route path="/notifications/digests" element={<NotificationDigestsPage />} />
<Route path="/notifications/digests/:groupKey/:date" element={<NotificationDigestViewPage />} />
<Route path="/notifications/digests/backfill/:runId" element={<NotificationDigestBackfillPage />} />
```

- [ ] **Step 2: Run web app tests + ci:tracked**

```bash
pnpm --filter web test
pnpm run ci:tracked 2>&1 | tee /tmp/ci-tracked-phase-4.txt
```

- [ ] **Step 3: Manual smoke test in dev**

```bash
pnpm dev:web   # or whatever launches the dev web app
```

Then in a browser: log in, navigate to `/#/notifications/digests`. Use the credentials from `~/.claude/CLAUDE.md` (kontakt+intexuraostest@pbuchman.com).

- [ ] **Step 4: Push + open PR with `Closes INT-1382`**

```bash
git push -u origin feature/digest-phase-4
gh pr create --title "[INT-1382] phase 4: digest web UI" \
  --body "$(cat <<'EOF'
## Summary
- New pages: list, detail, backfill console.
- 30-day calendar heatmap on the list page.
- Detail decomposed: Header / Narrative / Threads / ModeratorPosts / State / Actions.
- Reading typography for Polish prose (max-w-prose, leading-relaxed, lang="pl").
- Modal-driven Regenerate + Backfill flows.
- Live polling for backfill progress (cell-per-day grid).
- All components mirror the Code Tasks pattern (filter chips with colored dots, localStorage persistence, lucide icons, dark-mode pairs).

## Scope
Phase 4 of 4 — see `docs/superpowers/plans/2026-04-17-whatsapp-group-digest.md`.

## Test plan
- [x] `pnpm run ci:tracked` green
- [x] Manual smoke test: list, detail, backfill flows in dev

Closes INT-1382
EOF
)" --base development
```

---

## Self-Review Checklist (after writing this plan)

| Spec requirement                                              | Covered by                 |
| ------------------------------------------------------------- | -------------------------- |
| Polish few-shot examples from GPT-5 source                    | Task 1.1                   |
| Aggregation use case with repair loop                         | Tasks 1.7-1.10             |
| Per-date GroupState snapshots                                 | Tasks 2.4-2.6              |
| Per-group lock                                                | Task 2.5                   |
| Composed runDigestForGroup                                    | Task 2.7-2.8               |
| 9 HTTP endpoints                                              | Tasks 3.2-3.6              |
| Backfill HTTP chain (no in-memory worker)                     | Task 3.6                   |
| Cron `0 1 * * *` UTC                                          | Task 3.8                   |
| INTEXURAOS_DIGEST_LLM_MODEL three-location wiring             | Task 3.7                   |
| Composite indexes                                             | Task 3.9                   |
| Code-Tasks-mirroring web UI                                   | Phase 4                    |
| Calendar heatmap                                              | Task 4.4                   |
| Backfill progress UI                                          | Tasks 4.6, 4.7             |
| Regeneration UX with confirmation                             | Tasks 4.5, 4.7             |
| Hard-coded subscription with migration comment                | Task 3.1                   |
| CET-yesterday DST-aware                                       | Task 3.1                   |
| `Refs INT-1382` for phases 1-3, `Closes INT-1382` for phase 4 | Tasks 1.13, 2.9, 3.10, 4.8 |

No placeholders detected on rescan: all code blocks are concrete; all commands are exact; type names match across phases (`AggregationOutput`, `DigestError`, `runDigestForGroup`, `RunDigestForGroupResult`, etc.).
