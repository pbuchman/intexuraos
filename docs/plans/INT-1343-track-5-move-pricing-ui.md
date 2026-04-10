# INT-1343 — Track 5: Move LLM Pricing UI to LLM Usage Section

## Status

- Linear issue: **INT-1343**
- Parent epic: **INT-1338** (LLM Usage Service Phase 2)
- Dependencies: **INT-1340 (Track 1)** and **INT-1339 (Track 4)** — both must be merged before this starts
- Blocks: nothing
- Plan version: **1.0**

## Executive summary

Pure reorganization + data-source swap. The existing LLM Pricing page lives at `/#/settings/llm-pricing` and fetches from `app-settings-service` (`GET /settings/pricing`). After Track 4 this data is owned by `llm-usage-service` (`GET /internal/pricing`), and after Track 1 the web app has a new `llm-usage` sidebar section. This track moves the page to `/#/llm-usage/pricing`, repoints it at the new service, and leaves a redirect shim at the old URL for one release.

No new UX, no new features. If this track drags out longer than a day of focused work, something is wrong. The only real risks are (a) response-shape drift between the old and new endpoints and (b) Track 1 delivering a differently-named helper module than this plan assumes — both handled in Phase 2.

## Pre-flight checks

Before opening a branch for INT-1343, confirm all of the following:

1. **Track 1 merged.** `/#/llm-usage` renders an LLM Usage nav section and a list page. Confirm the file `apps/web/src/services/llmUsageApi.ts` exists and exposes at least one helper using `config.llmUsageServiceUrl`.
2. **Track 1 config wired.** `apps/web/src/config.ts` contains a `llmUsageServiceUrl` entry created from `INTEXURAOS_LLM_USAGE_SERVICE_URL` with a `/api/llm-usage` dev fallback, and `apps/web/src/types/index.ts` `AppConfig` has the matching field. `apps/web/vite.config.ts` has a `/api/llm-usage` proxy entry pointing at `llm-usage-service`'s dev port.
3. **Track 4 merged.** `llm-usage-service` exposes `GET /internal/pricing`, protected by `X-Internal-Auth`. Confirm by grepping `apps/llm-usage-service/src/routes/internalRoutes.ts` (or equivalent) and by running the service locally and calling it.
4. **Track 4 client shipped.** `packages/internal-clients/src/usage-service/` exports `createUsageServicePricingClient` with a `getAllProvidersPricing()` (or similarly-named) method. Its return type matches the web `AllProvidersPricing` contract (modulo `zai`, see Phase 2 notes).
5. **Public endpoint decision.** Track 4 delivers an `/internal/*` endpoint for service-to-service use. The web app is a first-party UI that speaks directly to services (no BFF — see "BFF reality" note below), so `llm-usage-service` must ALSO expose a user-auth public endpoint (`GET /settings/pricing` or `GET /pricing`). **⚠ DECISION NEEDED:** confirm whether Track 4 adds this public endpoint too, or whether this track (INT-1343) adds it. Recommendation: add it in Track 4 since the plumbing is right there. If not, Phase 1 of this plan adds it.
6. **Visual baseline.** Navigate to `/#/settings/llm-pricing` in dev, screenshot each provider card, and save to `docs/plans/assets/INT-1343-baseline-*.png`. Used for the Phase 8 parity check.

## BFF reality (important context)

There is **no BFF server in this repo**. `apps/web` is a pure SPA. The web app calls individual Cloud Run services directly in production (`INTEXURAOS_<SERVICE>_SERVICE_URL` env vars) and uses `vite.config.ts` `server.proxy` to forward `/api/<service>` → `localhost:<port>` in dev. This means:

- **There is no BFF proxy route to add.** The plan the parent issue sketched ("web-app BFF: `/api/llm-usage/pricing` NEW") does not apply — there's nothing to add a route to.
- **The web app authenticates with a real user bearer token** (`Authorization: Bearer <auth0>`), not `X-Internal-Auth`. That's why the new service needs a public authenticated endpoint, not just an `/internal/*` one.
- **The only "proxy route" work** is a one-line addition to `apps/web/vite.config.ts` in the `apiProxy` object — presumed already done by Track 1.

This also means the "BFF proxy unit test" requirement from the parent issue simplifies to "unit test `llmUsageApi.getLlmPricing()` in `services/__tests__/`".

## Context files

- `apps/web/src/pages/LlmPricingPage.tsx` — the page to move. Self-contained: imports `Card`, `Layout`, `useAuth`, `getLlmPricing`, `formatDateTime`, and `AllProvidersPricing` types. No child components to also move.
- `apps/web/src/services/settingsApi.ts` — exports `getLlmPricing` (this track removes it) and `getUsageCosts` (this track leaves it alone — that's a different feature used by `LlmCostsPage`, see Out of Scope).
- `apps/web/src/config.ts` — `getConfig()` and the `getServiceUrl()` dev-fallback helper. Track 1 should have added `llmUsageServiceUrl`.
- `apps/web/src/types/index.ts` lines 725–754 — `ModelPricing`, `ProviderPricing`, `AllProvidersPricing`. Note the web type already includes `zai` (line 753), but the current `app-settings-service` response only returns `google/openai/anthropic/perplexity` (see `publicRoutes.ts`). This is an **existing bug or forward-compat hack** that Track 4 must decide whether to fix. Phase 2 flags it.
- `apps/web/src/App.tsx` — line 223–230 has the current `/settings/llm-pricing` route; line 52 has the `LlmPricingPage` import.
- `apps/web/src/components/Sidebar.tsx` — line 62 has the current `settingsItems` entry; the `llmUsageItems` array created by Track 1 is where the new entry goes.
- `apps/web/src/pages/index.ts` line 31 — re-exports `LlmPricingPage`.
- `apps/web/src/pages/LlmCostsPage.tsx` — **OUT OF SCOPE.** This is `/settings/usage-costs` (user cost totals aggregated from events), a separate feature that still hits `app-settings-service`'s `/settings/usage-costs`. Do not touch in this track. If it ever moves it's a different follow-up (likely to become part of the LLM Usage section too, but not this issue).
- `apps/web/vite.config.ts` lines 78–99 — `apiProxy` object. Track 1 should have added `/api/llm-usage`.
- `apps/app-settings-service/src/routes/publicRoutes.ts` lines 14–141 — the current `GET /settings/pricing` implementation. Useful as a reference for what Track 4's public endpoint should look like if it doesn't already.
- `packages/internal-clients/src/usage-service/` — after Track 4, the client module. This track does NOT use it (the web app doesn't consume `@intexuraos/internal-clients` — that package is for service-to-service auth). It's only relevant if the public endpoint in Track 4 got skipped and we need to proxy through another service.

## Endpoint changes

### Modified

- None.

### Created

- **Web app:** `GET` call from `apps/web/src/services/llmUsageApi.ts#getLlmPricing()` → `llm-usage-service` public endpoint (path TBD by Track 4, likely `/pricing` or `/settings/pricing`).
- **Web app route:** `/#/llm-usage/pricing` — new React Router route.

### Removed

- **Web app route:** `/#/settings/llm-pricing` — replaced by a `<Navigate>` redirect to `/#/llm-usage/pricing`. After one release, the redirect is removed (Phase 10 / followup).
- **Web app service function:** `getLlmPricing` in `apps/web/src/services/settingsApi.ts` — deleted.
- **Web app sidebar entry:** The `settingsItems` entry for `/settings/llm-pricing` — deleted.
- **App-settings-service endpoint:** `GET /settings/pricing` — **NOT removed in this track.** That removal belongs to Track 4 (ownership transfer). This track only stops the web app from calling it; Track 4 handles server-side deletion once no callers remain.

### Unchanged

- `GET /settings/usage-costs` on `app-settings-service` — `LlmCostsPage` still uses it.
- All other `settings/*` routes.

## Step-by-step implementation

### Phase 0 — Branch and TDD setup

- `git checkout -b pbuchman/int-1343-move-pricing-ui`
- Confirm CI baseline: `pnpm run ci:tracked` passes on a fresh `development` pull.
- For every code change in this plan, write the failing test first. Order: Phase 3 tests → Phase 3 impl → Phase 4-7 (UI, no tests required by web-app exception) → Phase 9 cleanup tests.

### Phase 1 — (Conditional) Add public pricing endpoint to llm-usage-service

**Skip this phase if Pre-flight check #5 confirmed Track 4 already added the public endpoint.**

If Track 4 only shipped `/internal/pricing`, this track must add the user-auth public endpoint:

1. File: `apps/llm-usage-service/src/routes/publicRoutes.ts`.
2. Add `GET /pricing` (or `GET /settings/pricing` to match the old path — see ⚠ DECISION below).
3. Handler uses `requireAuth(request, reply)`, calls the same `pricingRepository` that the internal route uses, and returns the same `{ google, openai, anthropic, perplexity }` envelope via `reply.ok(...)`.
4. Must call `logIncomingRequest(request, {...})` per CLAUDE.md rules.
5. Wire into the Fastify app in `apps/llm-usage-service/src/index.ts`.
6. Tests: add a routes test in `apps/llm-usage-service/src/__tests__/routes/publicRoutes.test.ts` with 100% branch coverage (auth fail, missing provider fail path for each of the 4 providers, happy path).

**⚠ DECISION NEEDED:** New path name. `/settings/pricing` preserves the API surface so the client can be a pure URL swap. `/pricing` is cleaner since we're not in a "settings" service anymore. Recommendation: `/pricing`. A public service should own its natural URL, not mirror the old owner's path. The client-side change is a one-liner either way.

### Phase 2 — Add `getLlmPricing` to `llmUsageApi.ts`

Assume Track 1 created this file with an interface like:

```ts
// apps/web/src/services/llmUsageApi.ts (created by Track 1)
import { config } from '@/config';
import { apiRequest } from './apiClient.js';
// existing Track 1 exports, e.g. getUsageEvents, getUsageSummary...
```

Add:

```ts
import type { AllProvidersPricing } from '@/types';

export async function getLlmPricing(accessToken: string): Promise<AllProvidersPricing> {
  return await apiRequest<AllProvidersPricing>(
    config.llmUsageServiceUrl,
    '/pricing', // or '/settings/pricing' per Phase 1 decision
    accessToken
  );
}
```

**Shape adapter — is one needed?**

Compare response shapes:

| Field        | app-settings-service today | llm-usage-service (Track 4)  | Web type `AllProvidersPricing`                                          |
| ------------ | -------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `google`     | `ProviderPricing`          | `ProviderPricing` (expected) | `ProviderPricing`                                                       |
| `openai`     | `ProviderPricing`          | `ProviderPricing` (expected) | `ProviderPricing`                                                       |
| `anthropic`  | `ProviderPricing`          | `ProviderPricing` (expected) | `ProviderPricing`                                                       |
| `perplexity` | `ProviderPricing`          | `ProviderPricing` (expected) | `ProviderPricing`                                                       |
| `openrouter` | absent                     | **unknown**                  | absent                                                                  |
| `zai`        | absent                     | **unknown**                  | present (optional in practice; `LlmPricingPage.tsx` does not render it) |

**⚠ DECISION NEEDED:** What does Track 4's endpoint return for `zai` and `openrouter`? The current `LlmPricingPage` renders exactly `google/openai/anthropic/perplexity` (lines 170–173). If Track 4 returns a superset, no adapter needed — extra fields are ignored. If Track 4 returns a subset (e.g. drops `perplexity`), we need to (a) update the page to render whatever the service returns dynamically, or (b) keep the adapter. Recommendation: **update Track 4 to return the exact four providers** the current page renders, to keep this track a pure move. Escalate to INT-1339 if the shape diverges.

If the shapes match: no adapter. If they don't: add a pure function `adaptPricingResponse(raw: UsageServicePricingResponse): AllProvidersPricing` in `llmUsageApi.ts` and unit-test it.

**Test (required — `services/` has the web-app exception for required tests):**

File: `apps/web/src/services/__tests__/llmUsageApi.test.ts` (extend if Track 1 created it).

Test cases:
1. `getLlmPricing(token)` issues a GET to `${config.llmUsageServiceUrl}/pricing` with `Authorization: Bearer <token>`.
2. Returns the `data` field on success.
3. Throws `ApiError` on 401.
4. Throws `ApiError` with mapped message on 5xx.

Mock `fetch` globally (this is how other `*Api.test.ts` files do it — grep `apps/web/src/services/__tests__/` for patterns).

### Phase 3 — Create `LlmUsagePricingPage.tsx`

**Rename strategy: copy-then-delete, not `git mv`.** Rationale: the page is being reorganized under a new section and will be touched anyway (import updates). A clean copy keeps the diff grep-friendly.

1. Create `apps/web/src/pages/LlmUsagePricingPage.tsx` as a copy of `LlmPricingPage.tsx` with these changes:
   - Rename the exported function: `LlmPricingPage` → `LlmUsagePricingPage`.
   - Change import: `import { getLlmPricing } from '@/services/settingsApi';` → `import { getLlmPricing } from '@/services/llmUsageApi';`.
   - **Everything else identical.** Same `<Layout>`, same `<ProviderBlock>` grid, same heading "LLM Pricing", same description, same loading spinner, same error banner, same empty state. This is a visual-parity move.
2. Update `apps/web/src/pages/index.ts`:
   - Remove: `export { LlmPricingPage } from './LlmPricingPage.js';`
   - Add: `export { LlmUsagePricingPage } from './LlmUsagePricingPage.js';`
3. Delete `apps/web/src/pages/LlmPricingPage.tsx`.
4. Grep for any other imports of `LlmPricingPage`: `rg "LlmPricingPage" apps/web`. If any remain (besides the ones updated in Phase 4/5), update them.

### Phase 4 — Update `App.tsx` routing

1. Import change (line 52):
   - Remove `LlmPricingPage` from the import list.
   - Add `LlmUsagePricingPage` in its place.
2. Route changes (around lines 223–230):
   - Keep the `/settings/llm-pricing` Route but replace its element with `<Navigate to="/llm-usage/pricing" replace />` (inside a `ProtectedRoute` still so unauth users go through login first). **Placement:** move it down into the "Redirects for old URLs (backward compatibility)" block around line 589, matching the pattern used by `/notion`, `/whatsapp`, etc. The `ProtectedRoute` wrapper is optional for redirects — the existing backward-compat redirects don't use it. Match the existing pattern: `<Route path="/settings/llm-pricing" element={<Navigate to="/llm-usage/pricing" replace />} />`.
3. Add the new route in the `/* LLM Usage routes */` block Track 1 created:
   ```tsx
   <Route
     path="/llm-usage/pricing"
     element={
       <ProtectedRoute>
         <LlmUsagePricingPage />
       </ProtectedRoute>
     }
   />
   ```
   If Track 1 didn't add a comment block yet, add `{/* LLM Usage routes */}` above the block.

### Phase 5 — Update `Sidebar.tsx`

1. Line 62: Remove `{ to: '/settings/llm-pricing', label: 'LLM Pricing', icon: DollarSign },` from `settingsItems`.
2. Check if `DollarSign` is still imported/used elsewhere in `Sidebar.tsx`. If only the deleted line used it, remove the `DollarSign` entry from the `lucide-react` import block (line 19). `rg "DollarSign" apps/web/src/components/Sidebar.tsx` after the edit to confirm.
3. In the `llmUsageItems` array that Track 1 created, add:
   ```ts
   { to: '/llm-usage/pricing', label: 'LLM Pricing', icon: DollarSign },
   ```
   Position: after whatever Track 1 put first (likely the list/summary page). Re-add `DollarSign` to the `lucide-react` import if Phase 5 step 2 removed it.

### Phase 6 — Delete `getLlmPricing` from `settingsApi.ts`

1. Remove the `getLlmPricing` export (lines 5–11).
2. Remove the now-unused `AllProvidersPricing` import if this was its only user (check: `getUsageCosts` imports `AggregatedCosts`, not `AllProvidersPricing`, so the type import for `AllProvidersPricing` can drop).
3. `rg "getLlmPricing" apps/web` — should only hit `llmUsageApi.ts` and the new page after this phase.
4. Do NOT delete `settingsApi.ts` itself — `getUsageCosts` still lives there.

### Phase 7 — Config/env cleanup review

No env-var changes needed in this track if Track 1 already added `INTEXURAOS_LLM_USAGE_SERVICE_URL` to all three required locations (index.ts REQUIRED_ENV on the service, terraform dev env, ecosystem.config.cjs).

**Verify, don't assume:**
- `apps/web/src/config.ts` has `llmUsageServiceUrl: getServiceUrl('INTEXURAOS_LLM_USAGE_SERVICE_URL', '/api/llm-usage'),`
- `apps/web/src/types/index.ts` `AppConfig` has `llmUsageServiceUrl: string;`
- `apps/web/vite.config.ts` has `/api/llm-usage` in the `apiProxy` object
- `apps/web/cloudbuild.yaml` (or wherever web env is injected in prod) has the new `INTEXURAOS_LLM_USAGE_SERVICE_URL` secret/var wired in

If any of the above are missing, file a blocker comment on Track 1 — do not silently add them in this track.

**`appSettingsServiceUrl` retention:** `config.appSettingsServiceUrl` is still used by `getUsageCosts` (`LlmCostsPage` at `/settings/usage-costs`). Do NOT remove it.

### Phase 8 — Playwright visual parity smoke test

Login per CLAUDE.md Playwright credentials. Run against dev environment or a local `pnpm dev` build.

Script (add under `apps/web/e2e/` following the existing Playwright layout; if the repo doesn't have one, run manually with the Playwright MCP):

1. Navigate to `/#/llm-usage/pricing`.
2. Assert `h2` text is `"LLM Pricing"`.
3. Assert four provider cards render: `"Google"`, `"OpenAI"`, `"Anthropic"`, `"Perplexity"` (exact header match).
4. Assert at least one model row is visible per provider card.
5. Intercept network: assert a GET went to a URL matching `/api/llm-usage/pricing` (dev) or `llmUsageServiceUrl` prefix (prod).
6. Assert NO GET went to `/api/settings/pricing` or the `appSettingsServiceUrl` pricing path.
7. Screenshot and diff against the baseline from Pre-flight #6. Diff threshold: pixel-perfect (we did not change layout).
8. Navigate to `/#/settings/llm-pricing` and assert the URL resolves to `/#/llm-usage/pricing` (redirect worked).

If a layout difference shows up in step 7, stop and investigate — it means Phase 3's copy introduced an unintended diff.

### Phase 9 — Final cleanup + verification

1. `rg "/settings/llm-pricing" apps/web` — expect exactly one hit (the `<Navigate>` redirect in `App.tsx`).
2. `rg "LlmPricingPage" apps/web` — expect zero hits.
3. `rg "getLlmPricing" apps/web` — expect exactly two hits: the export in `llmUsageApi.ts` and the import in `LlmUsagePricingPage.tsx` (plus any test file).
4. `pnpm run verify:workspace:tracked -- web` — must pass.
5. `pnpm run ci:tracked` — must pass completely (Commit Gate).
6. Manual smoke: `pnpm dev` + open `http://localhost:3000/#/llm-usage/pricing` + confirm data loads + click the redirect URL in the address bar for `/#/settings/llm-pricing` and confirm it redirects.

### Phase 10 — Followup ticket (not part of this PR)

File a followup Linear issue: **"Remove `/settings/llm-pricing` redirect shim"**. Title references INT-1343 in the body ("Followup to INT-1343"). Schedule: one release after INT-1343 ships. The followup deletes the `<Route path="/settings/llm-pricing" element={<Navigate .../>} />` line from `App.tsx`.

Don't create the followup in this PR — create it separately once this PR is merged. User controls; Claude does not auto-file.

## Test plan

**Unit tests (required by web-app exception for `services/`):**
- `apps/web/src/services/__tests__/llmUsageApi.test.ts`
  - `getLlmPricing()` GETs the right URL with the right auth header
  - Returns success payload
  - Throws `ApiError` on 401 and 5xx
  - (If adapter exists) `adaptPricingResponse()` handles all documented shape variations

**Service tests (only if Phase 1 runs):**
- `apps/llm-usage-service/src/__tests__/routes/publicRoutes.test.ts`
  - Auth required (401 without bearer)
  - Happy path returns all 4 providers
  - Missing provider returns 500 with correct error code (4 variants)
  - 100% branch coverage

**E2E / Playwright smoke (Phase 8):**
- `/#/llm-usage/pricing` renders 4 provider cards, hits `llm-usage-service`, screenshot matches baseline
- `/#/settings/llm-pricing` redirects to `/#/llm-usage/pricing`

**NOT required (web app coverage exception):**
- Unit tests for `LlmUsagePricingPage.tsx` itself

## Rollout plan

1. Merge INT-1340 (Track 1) and INT-1339 (Track 4) first. Hard dependency; do not start this track until both are on `development`.
2. Open PR for INT-1343 targeting `development`. PR title contains `INT-1343`. PR body: `Fixes INT-1343`.
3. No feature flag needed. It's a UI move; worst case is a redirect hiccup which is reversible by revert.
4. After PR merges and deploys to dev:
   - Check dev analytics/logs for any 404s on `/settings/llm-pricing` (should be rare — redirect handles them).
   - Check logs on `app-settings-service` for `GET /settings/pricing` hits. Should drop to zero within a few minutes of deploy (web-app cache). If any persist >1 hour, investigate stale tabs.
5. After prod deploy, monitor Sentry for new errors tagged `LlmUsagePricingPage` for 24 hours.
6. After one release cycle (~1 week), file/execute the Phase 10 followup to remove the redirect shim.
7. Track 4's server-side deletion of `GET /settings/pricing` on `app-settings-service` happens in INT-1339's own rollout, not this track.

## Acceptance criteria

- [ ] `/#/llm-usage/pricing` renders the LLM Pricing page with data from `llm-usage-service`
- [ ] `/#/settings/llm-pricing` redirects to `/#/llm-usage/pricing`
- [ ] Sidebar has an "LLM Pricing" entry under the LLM Usage section
- [ ] Sidebar no longer has an "LLM Pricing" entry under Settings
- [ ] `apps/web/src/services/settingsApi.ts` no longer exports `getLlmPricing`
- [ ] `apps/web/src/services/llmUsageApi.ts` exports a tested `getLlmPricing`
- [ ] `apps/web/src/pages/LlmPricingPage.tsx` is deleted; `LlmUsagePricingPage.tsx` exists
- [ ] `pnpm run ci:tracked` passes
- [ ] Visual parity confirmed via Phase 8 Playwright smoke
- [ ] Phase 10 followup issue filed (after merge, not before)

## Risks

- **Response-shape drift** — Track 4's `/internal/pricing` returns a different shape than `app-settings-service`'s `/settings/pricing`. Mitigation: Pre-flight #4 verifies shape; Phase 2 table compares explicitly; if drift exists, add an adapter or (preferred) escalate to Track 4 to align.
- **Track 1 didn't deliver `llmUsageApi.ts`** — blocker on Pre-flight #1. If Track 1 shipped differently-named helpers, this track extends Track 1 rather than creating a new file. Do not silently create a parallel `pricingApi.ts` — one source of truth per service.
- **User has old URL bookmarked** — redirect shim handles one release cycle. Phase 10 followup removes it after that.
- **Visual regression from copy-paste** — Phase 3 is intentionally a byte-identical copy except for the import line + function name. Phase 8 Playwright diff catches any accidental drift.
- **`zai` / `openrouter` provider mismatch** — flagged in Phase 2 ⚠. If Track 4 returns fewer or more providers, the page either breaks at runtime (undefined access on `pricing.google` etc.) or renders stale data. Mitigation: lock down the Track 4 contract before starting this track.
- **Deploy ordering** — if the web-app deploys before `llm-usage-service` has the public endpoint live, the page 500s. Mitigation: deploy `llm-usage-service` first, verify, then deploy web.
- **Dead `appSettingsServiceUrl` — NOT a risk.** It's still used by `getUsageCosts`. Don't remove it.

## Out of scope

- **`/#/settings/usage-costs` (`LlmCostsPage`)** — different feature (user cost totals aggregated from events). Stays in `app-settings-service` for now. Any future migration to the LLM Usage section is a separate issue.
- **Editing pricing values from the UI** — page is read-only today, stays read-only. Pricing is seeded/updated via migrations.
- **Changing the layout, copy, colors, or card structure of the pricing page** — pure move, zero design changes. If the user wants a redesign, separate ticket.
- **Removing `GET /settings/pricing` from `app-settings-service`** — owned by Track 4 (INT-1339).
- **Deprecating the whole Settings section** — unrelated.
- **Backfilling `zai` or `openrouter` pricing data** — if they're missing from seeds, that's a data issue, not a UI issue.
- **Adding new providers to the page** — the current page hardcodes 4 providers; adding more is a feature, not part of this move.

## ⚠ Decision summary (collected from above)

1. **Old URL handling** — keep a `<Navigate>` redirect for one release, then delete via followup. **Recommended: redirect.** (Phase 4, Phase 10)
2. **Public endpoint on `llm-usage-service`** — confirm Track 4 adds it; if not, Phase 1 of this track adds it. **Recommended: Track 4 owns it.** (Pre-flight #5, Phase 1)
3. **New endpoint path name** — `/pricing` vs `/settings/pricing` on the new service. **Recommended: `/pricing`.** (Phase 1)
4. **Response shape for `zai`/`openrouter`** — align Track 4 to return exactly the 4 providers the current UI renders, OR update the page to render dynamically. **Recommended: align Track 4.** (Phase 2)

All four decisions are cheap to flip if the user disagrees. None block plan approval.
