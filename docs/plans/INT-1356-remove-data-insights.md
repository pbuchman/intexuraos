# Remove Data Insights Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Data Insights feature completely from IntexuraOS, including the dedicated backend service, web UI, infrastructure wiring, and shared package code that exists only to support this feature.

**Architecture:** The cleanup is a controlled feature excision, not a simple folder deletion. The work must remove the `data-insights-agent` service and every web route/API client that targets it, then collapse shared catalogs, usage-event enums, prompts, env vars, deployment wiring, and Firestore ownership that were introduced solely for Data Insights. The implementation should preserve unrelated services such as `mobile-notifications-service`, `llm-usage-service`, `api-docs-hub`, and the rest of the web shell by removing only Data Insights-specific registrations and contracts.

**Tech Stack:** TypeScript, Fastify, React, Vitest, pnpm workspaces, Terraform, Cloud Build, Firestore

---

## Investigation Findings

### Finding 1: The backend is self-contained but wired into platform infrastructure

The core backend feature lives in `apps/data-insights-agent/`, with its own routes, Firestore repositories, Gemini prompt flow, Dockerfile, Cloud Build trigger, and Terraform service definition. That service owns four Firestore collections recorded in `firestore-collections.json`: `custom_data_sources`, `composite_feeds`, `composite_feed_snapshots`, and `visualizations`.

This means removal is feasible as a full service deletion, but only if the same change also removes:
- service URLs and OpenAPI URLs from `terraform/environments/dev/main.tf`
- dev process wiring from `ecosystem.config.cjs`
- Cloud Build and deploy scripts under `cloudbuild/` and `.github/workflows/`
- service catalog entries consumed by shared packages and internal tooling

### Finding 2: The frontend footprint is large and route-driven

The web app has a dedicated feature slice under `apps/web/src/`:
- Pages: `DataInsightsPage.tsx`, `CompositeFeedsListPage.tsx`, `CompositeFeedFormPage.tsx`, `DataSourcesListPage.tsx`, `DataSourceFormPage.tsx`, `VisualizationsListPage.tsx`
- Hooks: `useDataInsights.ts`, `useCreateVisualization.ts`, `useVisualizations.ts`
- API clients: `compositeFeedApi.ts`, `dataInsightsApi.ts`, `visualizationsApi.ts`
- Feature navigation: `DataInsightsTabs.tsx`, `Sidebar.tsx`, `App.tsx`
- Shared web types and tests tied to feed/data source/visualization models

This is not a hidden feature flag. The cleanup must remove explicit routes, navigation items, API clients, config wiring, and any now-unused types.

### Finding 3: Shared package cleanup is narrow but mandatory

The repo contains several common-package references that exist because Data Insights was registered as a first-class service:
- `packages/common-core/src/internalServiceCatalog.ts`
- `apps/api-docs-hub/src/config.ts`
- `apps/cron-agent/src/config.ts`
- `packages/llm-pricing/src/usageLogger.ts`
- `packages/internal-clients/src/usage-service/types.ts`
- `apps/llm-usage-service/src/domain/models/usageEvent.ts`
- `packages/llm-prompts/src/dataInsights/dataAnalysisPrompt.ts`

Some shared code is definitely Data Insights-only and should be deleted outright, especially the `packages/llm-prompts/src/dataInsights/` subtree. Some shared code is partially shared and must be edited rather than deleted. Example: `packages/llm-prompts/src/generation/titlePrompt.ts` is shared between research and Data Insights, so it must stay but lose Data Insights wording if present.

### Finding 4: Cross-service references are mostly documentation and catalogs, not runtime dependencies

The strongest runtime dependency observed outside the dedicated service is `mobile-notifications-service`, but its internal query endpoint is generic and should remain. Most other references are catalogs, docs, environment declarations, or usage enum values rather than hard execution dependencies.

This lowers execution risk, but it raises cleanup risk: the implementation must aggressively remove stale registrations so the platform does not keep advertising or requiring a service that no longer exists.

---

## File Structure

### Delete Entire Feature Areas

- Delete: `apps/data-insights-agent/`
- Delete: `docs/services/data-insights-agent/`
- Delete: `packages/llm-prompts/src/dataInsights/`

### Modify Backend / Shared Platform Files

- Modify: `packages/common-core/src/internalServiceCatalog.ts`
- Modify: `apps/api-docs-hub/src/config.ts`
- Modify: `apps/cron-agent/src/config.ts`
- Modify: `packages/llm-pricing/src/usageLogger.ts`
- Modify: `packages/internal-clients/src/usage-service/types.ts`
- Modify: `apps/llm-usage-service/src/domain/models/usageEvent.ts`
- Modify: `apps/code-agent/src/routes/internalUsageWebhookRoute.ts`
- Modify: `packages/llm-prompts/src/generation/titlePrompt.ts`
- Modify: `firestore-collections.json`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/modules/iam/main.tf`
- Modify: `terraform/modules/iam/outputs.tf`
- Modify: `terraform/modules/cloud-build/main.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `cloudbuild/cloudbuild.yaml`
- Modify: `.github/workflows/deploy.yml`
- Delete: `cloudbuild/scripts/deploy-data-insights-agent.sh`
- Delete: `apps/data-insights-agent/cloudbuild.yaml`

### Modify Web App Files

- Modify: `apps/web/src/config.ts`
- Modify: `apps/web/cloudbuild.yaml`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Delete: `apps/web/src/components/DataInsightsTabs.tsx`
- Modify: `apps/web/src/components/index.ts`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/components/home/HeroShowcase.tsx`
- Modify: `apps/web/src/components/__tests__/Chat/Chat.test.tsx`
- Delete: Data Insights pages under `apps/web/src/pages/`
- Delete: `apps/web/src/hooks/useDataSources.ts`
- Delete: `apps/web/src/hooks/useCompositeFeeds.ts`
- Delete: `apps/web/src/hooks/useChartDefinition.ts`
- Delete: `apps/web/src/hooks/useChartPreview.ts`
- Delete: `apps/web/src/services/dataSourceApi.ts`
- Delete: Data Insights services under `apps/web/src/services/`
- Modify: `apps/web/src/pages/index.ts`
- Modify: `apps/web/src/hooks/index.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify or delete corresponding web tests under `apps/web/src/**/__tests__/`
- Modify: `apps/web/vitest.config.ts`

### Modify Documentation / Setup References

- Modify: `docs/services/index.md`
- Modify: `docs/services/web/*.md` where Data Insights routes/features are described
- Modify: `docs/services/mobile-notifications-service/*.md` to remove obsolete Data Insights examples
- Modify: `docs/services/api-docs-hub/*.md`
- Modify: `docs/setup/04-cloud-run-services.md`
- Modify: `docs/documentation-runs.md` and validation docs only if CI/static checks require those generated references to stay synchronized

---

## Endpoint Changes

### Removed

- `POST /data-sources`
- `GET /data-sources`
- `GET /data-sources/:id`
- `PUT /data-sources/:id`
- `DELETE /data-sources/:id`
- `POST /data-sources/generate-title`
- `POST /composite-feeds`
- `GET /composite-feeds`
- `GET /composite-feeds/:id`
- `PUT /composite-feeds/:id`
- `DELETE /composite-feeds/:id`
- `GET /composite-feeds/:id/schema`
- `GET /composite-feeds/:id/data`
- `GET /composite-feeds/:id/snapshot`
- `POST /composite-feeds/:feedId/analyze`
- `POST /composite-feeds/:feedId/insights/:insightId/chart-definition`
- `POST /composite-feeds/:feedId/preview`
- `POST /visualizations`
- `GET /visualizations`
- `GET /visualizations/:id`
- `DELETE /visualizations/:id`
- `POST /visualizations/:id/refresh`
- `POST /internal/visualizations/compute`

### Created

- None.

### Modified

- None at the HTTP contract level outside removal of Data Insights registrations from shared catalogs and docs.

### Unchanged

- `mobile-notifications-service` internal query endpoint remains; only Data Insights-specific references/examples should be removed.
- `llm-usage-service` ingestion/query endpoints remain; only operation enums and tests tied to visualization operations may change.

---

## Task Breakdown

### Task 1: Remove backend service code and its dedicated prompt package code

**Files:**
- Delete: `apps/data-insights-agent/`
- Delete: `packages/llm-prompts/src/dataInsights/`
- Modify: `packages/llm-prompts/src/generation/titlePrompt.ts`
- Modify: package barrel exports / index files inside `packages/llm-prompts/src/` if they reference deleted prompt modules
- Test: affected prompt package tests and workspace verification for `packages/llm-prompts`

- [ ] Delete the `apps/data-insights-agent/` workspace and confirm no workspace manifest, build script, or export path still points at it.
- [ ] Delete Data Insights-only prompt builders from `packages/llm-prompts/src/dataInsights/` and clean up any re-export files that reference those modules.
- [ ] Keep `packages/llm-prompts/src/generation/titlePrompt.ts`, but remove wording that implies Data Insights ownership if that wording is now inaccurate.
- [ ] Run targeted search: `rg -n "data-insights-agent|Data Insights|composite-feeds|visualizations" packages apps --glob '!**/dist/**'` and use the output to identify remaining backend compile-time references.
- [ ] Verify package/workspace build integrity with:
  `pnpm run verify:workspace:tracked -- llm-prompts`

**Implementation notes:**
- Do not preserve stubs for deleted service types or prompt interfaces unless another active service imports them.
- If package index files export deleted modules, remove those exports in the same step to avoid TypeScript/module-resolution failures.

### Task 2: Remove the web feature slice and all user-facing navigation/routes

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Delete: `apps/web/src/components/DataInsightsTabs.tsx`
- Modify: `apps/web/src/components/index.ts`
- Modify: `apps/web/src/pages/HomePage.tsx` (remove Data Insights card/copy)
- Modify: `apps/web/src/components/home/HeroShowcase.tsx` (remove Data Insights showcase item)
- Modify: `apps/web/src/components/__tests__/Chat/Chat.test.tsx` (remove `INTEXURAOS_DATA_INSIGHTS_AGENT_URL` from test env seed)
- Delete: `apps/web/src/pages/DataInsightsPage.tsx`
- Delete: `apps/web/src/pages/CompositeFeedsListPage.tsx`
- Delete: `apps/web/src/pages/CompositeFeedFormPage.tsx`
- Delete: `apps/web/src/pages/DataSourcesListPage.tsx`
- Delete: `apps/web/src/pages/DataSourceFormPage.tsx`
- Delete: `apps/web/src/pages/VisualizationsListPage.tsx`
- Modify: `apps/web/src/pages/index.ts`
- Delete: `apps/web/src/hooks/useDataInsights.ts`
- Delete: `apps/web/src/hooks/useCreateVisualization.ts`
- Delete: `apps/web/src/hooks/useVisualizations.ts`
- Delete: `apps/web/src/hooks/useDataSources.ts`
- Delete: `apps/web/src/hooks/useCompositeFeeds.ts`
- Delete: `apps/web/src/hooks/useChartDefinition.ts`
- Delete: `apps/web/src/hooks/useChartPreview.ts`
- Modify: `apps/web/src/hooks/index.ts`
- Delete: `apps/web/src/services/compositeFeedApi.ts`
- Delete: `apps/web/src/services/dataInsightsApi.ts`
- Delete: `apps/web/src/services/visualizationsApi.ts`
- Delete: `apps/web/src/services/dataSourceApi.ts`
- Modify: `apps/web/src/types/index.ts`
- Test: web tests covering routing, hooks, services, and sidebar behavior

- [ ] Remove all `/#/data-insights...` routes from `apps/web/src/App.tsx`.
- [ ] Remove Data Insights entries and expansion state from `apps/web/src/components/Sidebar.tsx`.
- [ ] Delete `DataInsightsTabs.tsx` and clean up its export from `apps/web/src/components/index.ts`.
- [ ] Delete all Data Insights pages, hooks, and service clients.
- [ ] Delete or narrow all web types that model `CustomDataSource`, `CompositeFeed`, `DataInsight`, and `Visualization` if they are no longer used anywhere else.
- [ ] Remove Data Insights references outside the dedicated feature slice:
  - `apps/web/src/pages/HomePage.tsx`: remove Data Insights card and any copy/descriptions referencing the feature.
  - `apps/web/src/components/home/HeroShowcase.tsx`: remove the Data Insights showcase/sidebar item.
  - `apps/web/src/components/__tests__/Chat/Chat.test.tsx`: remove `INTEXURAOS_DATA_INSIGHTS_AGENT_URL` from the test environment seed.
- [ ] Remove or rewrite tests that import deleted pages/hooks/services so the web workspace compiles cleanly.
- [ ] Verify the web workspace with:
  `pnpm run verify:workspace:tracked -- web`

**Implementation notes:**
- Expect follow-on type cleanup in `apps/web/src/types/index.ts`; route/component deletion alone will leave unused or broken exports.
- `apps/web/vitest.config.ts` currently seeds `INTEXURAOS_DATA_INSIGHTS_AGENT_URL`; remove that seed once the config field is removed.

### Task 3: Remove shared service registrations, env vars, and usage-event enums

**Files:**
- Modify: `packages/common-core/src/internalServiceCatalog.ts`
- Modify: `apps/api-docs-hub/src/config.ts`
- Modify: `apps/cron-agent/src/config.ts`
- Modify: `apps/llm-usage-service/src/domain/models/usageEvent.ts`
- Modify: `packages/internal-clients/src/usage-service/types.ts`
- Modify: `packages/llm-pricing/src/usageLogger.ts`
- Modify: `apps/code-agent/src/routes/internalUsageWebhookRoute.ts`
- Modify: any related tests in those workspaces

- [ ] Remove `visualization_insights` and `visualization_vegalite` operation names from `apps/code-agent/src/routes/internalUsageWebhookRoute.ts`, which still enumerates them in its route schema.
- [ ] Remove `data-insights-agent` from service catalogs and OpenAPI source catalogs so internal tooling no longer advertises it.
- [ ] Remove `INTEXURAOS_DATA_INSIGHTS_AGENT_URL` and `INTEXURAOS_DATA_INSIGHTS_AGENT_OPENAPI_URL` expectations from shared configuration code.
- [ ] Decide whether `visualization_insights` and `visualization_vegalite` should be deleted or migrated to a generic surviving concept. Current evidence suggests they were introduced specifically for Data Insights and should be removed from usage-event models and logger types.
- [ ] Update tests and fixtures that still expect Data Insights service definitions or visualization usage enums.
- [ ] Verify affected workspaces:
  `pnpm run verify:workspace:tracked -- common-core`
  `pnpm run verify:workspace:tracked -- api-docs-hub`
  `pnpm run verify:workspace:tracked -- cron-agent`
  `pnpm run verify:workspace:tracked -- llm-usage-service`

**Implementation notes:**
- `cron-agent` only appears to reference Data Insights through a catalog entry for `computeVisualization`; removing that entry should be mechanical.
- `api-docs-hub` currently fails fast if all listed OpenAPI env vars are not present, so removing Data Insights there is mandatory once Terraform/web envs stop producing that URL.

### Task 4: Remove infrastructure, deployment, and Firestore ownership for the retired service

**Files:**
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/modules/iam/main.tf`
- Modify: `terraform/modules/iam/outputs.tf`
- Modify: `terraform/modules/cloud-build/main.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `cloudbuild/cloudbuild.yaml`
- Modify: `.github/workflows/deploy.yml`
- Delete: `cloudbuild/scripts/deploy-data-insights-agent.sh`
- Delete: `apps/data-insights-agent/cloudbuild.yaml`
- Modify: `apps/web/cloudbuild.yaml`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/config.ts`
- Modify: `firestore-collections.json`
- Modify: `firestore.indexes.json`

- [ ] Remove the Cloud Run service definition, related env vars, OpenAPI URL outputs, image references, and IAM bindings for `data-insights-agent` from Terraform.
- [ ] Remove the service from Cloud Build and GitHub deploy workflow fan-out lists.
- [ ] Remove the service from `ecosystem.config.cjs` and any dev proxy wiring in `apps/web/vite.config.ts`.
- [ ] Remove `INTEXURAOS_DATA_INSIGHTS_AGENT_URL` consumption from `apps/web/src/config.ts` and from web build-time injection in `apps/web/cloudbuild.yaml`.
- [ ] Remove the four Data Insights-owned collections from `firestore-collections.json`.
- [ ] Remove the 7 composite index definitions for Data Insights collections (`custom_data_sources`, `composite_feeds`, `composite_feed_snapshots`, `visualizations`) from `firestore.indexes.json`. These indexes incur ongoing Firestore write amplification and storage cost for collections that will no longer receive writes.
- [ ] Decide and document migration handling for existing production/dev Firestore data in:
  `custom_data_sources`, `composite_feeds`, `composite_feed_snapshots`, `visualizations`.
  Because the issue asks for complete module removal rather than data retention, the plan should assume those collections become orphaned unless a follow-up migration/deletion task is scheduled.
- [ ] Verify infra-facing code and web config with targeted checks, then full CI:
  `pnpm run verify:workspace:tracked -- web`
  `pnpm run ci:tracked`

**Implementation notes:**
- The code removal can ship before Firestore data deletion, but the implementation must make an explicit decision. Silent abandonment of the collections is operational debt.
- If Terraform module removal affects required env var declarations for other apps, update those declarations in the same change.

### Task 5: Remove stale docs and validate there are no remaining references

**Files:**
- Delete: `docs/services/data-insights-agent/`
- Modify: `docs/services/index.md`
- Modify: `docs/services/web/*.md`
- Modify: `docs/services/api-docs-hub/*.md`
- Modify: `docs/services/mobile-notifications-service/*.md`
- Modify: `docs/setup/04-cloud-run-services.md`
- Modify: `README.md` (remove architecture diagram node `DATA[Data Insights Agent]` and service table entry)
- Modify: `.envrc.local.example` (remove `INTEXURAOS_DATA_INSIGHTS_AGENT_URL`)
- Modify: validation or generated docs if repo checks require synchronization

- [ ] Delete the dedicated Data Insights service docs.
- [ ] Remove Data Insights from service indexes, architecture diagrams, setup docs, and feature descriptions.
- [ ] Remove the `DATA[Data Insights Agent]` node from the mermaid architecture diagram in `README.md` and delete the service table entry.
- [ ] Remove `INTEXURAOS_DATA_INSIGHTS_AGENT_URL=http://localhost:8119` from `.envrc.local.example`.
- [ ] Update web documentation so sidebar/routes/features no longer mention Data Insights pages or service URLs.
- [ ] Remove examples in `mobile-notifications-service` docs that present Data Insights as the consumer.
- [ ] Run a final repository-wide reference scan (note: scans from repo root `.` with exclusions to ensure root-level files like `README.md`, `.envrc.local.example`, and `firestore.indexes.json` are not missed):
  `rg -n "data-insights-agent|Data Insights|/data-insights|composite-feeds|visualizations|custom_data_sources|composite_feed_snapshots" apps packages terraform docs ecosystem.config.cjs cloudbuild .github firestore-collections.json firestore.indexes.json README.md .envrc.local.example --glob '!**/dist/**'`
- [ ] Resolve every remaining hit that is not intentionally historical evidence in an immutable plan or changelog file.

---

## Verification Plan

Run from `/repo` after the implementation branch contains the cleanup:

1. `pnpm run verify:workspace:tracked -- web`
2. `pnpm run verify:workspace:tracked -- common-core`
3. `pnpm run verify:workspace:tracked -- api-docs-hub`
4. `pnpm run verify:workspace:tracked -- cron-agent`
5. `pnpm run verify:workspace:tracked -- llm-usage-service`
6. `pnpm run ci:tracked`
7. `rg -n "INTEXURAOS_DATA_INSIGHTS_AGENT|data-insights-agent|/data-insights|composite_feeds|custom_data_sources|composite_feed_snapshots|visualization_insights|visualization_vegalite" apps packages terraform docs ecosystem.config.cjs cloudbuild .github firestore-collections.json firestore.indexes.json README.md .envrc.local.example --glob '!**/dist/**'`

Expected outcome:
- no build/runtime references to the deleted service remain
- web app compiles without Data Insights routes or config
- shared catalogs and env var validation no longer require Data Insights URLs
- infra/deploy config no longer tries to build or deploy the retired service

---

## Risks And Decisions

- **Firestore data handling is the only non-mechanical decision.** Code and infra can be removed without deleting existing documents, but that leaves dead data in shared Firestore. Execution should explicitly choose one of:
  - leave collections in place temporarily and file a follow-up data-deletion task
  - add a one-time deletion/migration script in the same implementation
- **Usage-event enum removal may touch stored analytics assumptions.** If dashboards or historical queries rely on `visualization_insights` / `visualization_vegalite`, removing those enums may require compatibility handling at read time.
- **Migration files are IMMUTABLE and excluded from cleanup.** Five migration files (`008`, `019`, `020`, `022`, `047`) create Firestore indexes for Data Insights collections. Per CLAUDE.md, migrations must never be deleted or modified. These will appear as hits in the reference sweep and should be explicitly ignored as intentionally historical artifacts.
- **Documentation and generated validation reports may create noisy residual references.** Immutable historical records (including migration files) can stay if repo validation does not require scrubbing them, but active service/setup docs must be updated.

## Recommended Execution Order

1. Backend + prompt deletion
2. Web slice removal
3. Shared catalog / enum cleanup
4. Infra/env/deploy cleanup
5. Docs + final reference scan
6. Full CI
