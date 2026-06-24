# Remove Duplicated Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation. Steps use checkbox (`- [ ]`) syntax for tracking. Every child issue below is a direct child of INT-1683 and is intended for an independent subagent.

**Goal:** Remove the duplicated command/action agent services and make `intex-agent` the only runtime, infrastructure, documentation, and user-facing identity for that work.

**Architecture:** `intex-agent` becomes the owner of command/action runtime behavior, historical command/action read APIs, action approval handling, and code-task status callbacks. Caller services consume Intex-namespaced internal routes and the web app consumes only `INTEXURAOS_INTEX_AGENT_URL`. Infrastructure removes the old app services, service accounts, PM2 entries, nginx routes, OpenAPI env vars, and Pub/Sub push targets.

**Tech Stack:** TypeScript, Fastify, Vitest, React/Vite, Firestore, Pub/Sub HTTP push, Terraform, PM2, Hetzner nginx, `pnpm run ci:tracked`.

## Global Constraints

- No implementation subissue may depend on another subissue finishing first; all subissues consume the contracts in this plan.
- Do not create more than one subissue for the same service, worker, or agent boundary.
- After implementation, the removed agent package names must not appear in runtime code, tests, generated config, Terraform, README, or user-facing docs.
- `intex-agent` remains the canonical service name, `INTEX_AGENT` remains the canonical env suffix, `/api/intex-agent` remains the canonical public path, and `/internal/intex-agent` remains the canonical internal path.
- Retain existing Firestore data in place. Reassign collection ownership to `intex-agent`; do not rename collections unless a separate migration issue is created.
- Keep endpoint behavior compatible for existing web workflows by moving it under Intex routes, not by preserving `/api/commands` or `/api/actions`.
- Every HTTP endpoint added or moved must call `logIncomingRequest()`.
- Before final implementation commit, run `pnpm run ci:tracked`.

---

## Current Reference Inventory

Initial scan found references across these boundaries:

- Runtime services: `apps/commands-agent/**`, `apps/actions-agent/**`, and existing `apps/intex-agent/**`.
- Callers: `apps/code-agent/**` and `apps/whatsapp-service/**`.
- Frontend: `apps/web/src/config.ts`, generated web config, `apps/web/service-manifest.json`, and command/action API consumers.
- Worker vocabulary: `workers/transcription/src/providers/speechmatics/vocabulary.ts`.
- Runtime infrastructure: `ecosystem.config.cjs`, `ecosystem.config.prod.cjs`, `terraform/environments/dev/main.tf`, `terraform/hetzner-prod/**`, `terraform/modules/iam/**`, `scripts/hetzner/**`, and Pub/Sub tooling.
- Shared metadata: `firestore-collections.json`, `eslint.config.js`, `packages/http-contracts/**`, `packages/internal-clients/**`, `packages/service-catalog/**`, verification scripts, lockfile metadata.
- User-facing docs: `README.md`, `docs/overview.md`, `docs/services/commands-agent/**`, `docs/services/actions-agent/**`, package docs, runbooks, validation docs, and architecture docs.

## Canonical Contracts

### Runtime Identity

| Item | Canonical value |
| --- | --- |
| Service name | `intex-agent` |
| Package | `@intexuraos/intex-agent` |
| Env suffix | `INTEX_AGENT` |
| Service URL env var | `INTEXURAOS_INTEX_AGENT_URL` |
| OpenAPI URL env var | `INTEXURAOS_INTEX_AGENT_OPENAPI_URL` |
| Dev/prod port | `8134` unless the implementation discovers a real port conflict |
| Public API base | `/api/intex-agent` |
| Internal API prefix | `/internal/intex-agent` |

### Data Ownership

These Firestore collections remain in place and are re-owned by `intex-agent` in `firestore-collections.json`:

| Collection | New owner | Notes |
| --- | --- | --- |
| `commands` | `intex-agent` | Retained for command history and any legacy command metadata still shown in web workflows. |
| `actions` | `intex-agent` | Retained for action history, approval state, resource status, and result metadata. |
| `actions_transitions` | `intex-agent` | Retained for correction/training history. |
| `approval_messages` | `intex-agent` | Retained for WhatsApp approval reply matching. |
| `intex_agent_sessions` | `intex-agent` | Existing session collection. |
| `intex_agent_session_events` | `intex-agent` | Existing session timeline collection. |

## Endpoint Changes

### Created

Create or move these endpoints into `apps/intex-agent`:

- `GET /intex-agent/commands`
- `POST /intex-agent/commands`
- `PATCH /intex-agent/commands/:commandId`
- `DELETE /intex-agent/commands/:commandId`
- `GET /intex-agent/actions`
- `PATCH /intex-agent/actions/:actionId`
- `DELETE /intex-agent/actions/:actionId`
- `POST /intex-agent/actions/batch`
- `POST /intex-agent/actions/:actionId/execute`
- `GET /intex-agent/actions/:actionId/preview`
- `POST /intex-agent/actions/:actionId/resolve-duplicate`
- `POST /internal/intex-agent/actions`
- `POST /internal/intex-agent/actions/:actionType`
- `POST /internal/intex-agent/actions/process`
- `POST /internal/intex-agent/actions/retry-pending`
- `POST /internal/intex-agent/actions/approval-reply`
- `PATCH /internal/intex-agent/actions/:actionId/status`
- `POST /internal/intex-agent/commands`
- `POST /internal/intex-agent/commands/retry-pending`
- `GET /internal/intex-agent/commands/:commandId`

### Modified

- `POST /internal/intex-agent/messages` remains the inbound assistant route and continues to accept `intex.message.ingest`.
- `/api/intex-agent` expands to include command/action history and approval workflows.
- Code-task status mirroring calls `PATCH /internal/intex-agent/actions/:actionId/status`.
- WhatsApp Assistant text and voice transcript events publish `intex.message.ingest`.
- WhatsApp approval replies push to an Intex-owned internal approval route.
- Web command/action history calls `config.intexAgentUrl` and Intex route paths only.

### Removed

Remove these public/runtime routes from infrastructure and generated web config:

- `/api/commands`
- `/api/actions`

Remove these old internal service routes from infrastructure, docs, and service catalogs:

- `POST /internal/commands`
- `POST /internal/retry-pending`
- `GET /internal/commands/:commandId`
- `POST /internal/actions`
- `POST /internal/actions/:actionType`
- `POST /internal/actions/process`
- `POST /internal/actions/retry-pending`
- `POST /internal/actions/approval-reply`
- `PATCH /internal/actions/:actionId/status`

### Unchanged

- `GET /intex-agent/sessions`
- `GET /intex-agent/sessions/:sessionId`
- `GET /intex-agent/sessions/:sessionId/events`
- WhatsApp outbound send topic and payload shape.
- Existing downstream service APIs for notes, calendar, research, linear, bookmarks, and code tasks unless the Intex implementation already has a direct replacement path.

## Parallel Subissues

| Issue | Boundary | Contract |
| --- | --- | --- |
| [INT-1684](https://linear.app/pbuchman/issue/INT-1684/move-deprecated-commandaction-runtime-into-intex-agent) | `apps/intex-agent/**`, deleting old command/action app packages | Owns the moved backend routes, domain behavior, repositories, and Intex tests. Exposes the Intex endpoint list above. |
| [INT-1685](https://linear.app/pbuchman/issue/INT-1685/rewire-code-agent-action-status-callbacks-to-intex-agent) | `apps/code-agent/**` | Consumes `PATCH /internal/intex-agent/actions/:actionId/status` and `INTEXURAOS_INTEX_AGENT_URL`. |
| [INT-1686](https://linear.app/pbuchman/issue/INT-1686/route-whatsapp-ingress-and-approval-replies-to-intex-agent) | `apps/whatsapp-service/**` | Produces `intex.message.ingest` and approval reply payloads for Intex push routes. |
| [INT-1687](https://linear.app/pbuchman/issue/INT-1687/move-web-commandaction-consumers-onto-intex-agent-apis) | `apps/web/**` | Consumes only `config.intexAgentUrl` and Intex public endpoints. |
| [INT-1688](https://linear.app/pbuchman/issue/INT-1688/remove-deprecated-agent-infrastructure-and-route-runtime-to-intex) | Terraform, PM2, Hetzner nginx, Pub/Sub tooling, generated service wiring | Provides only `intex-agent` runtime target, public `/api/intex-agent`, internal `/internal/intex-agent`, and generated `INTEXURAOS_INTEX_AGENT_URL`. |
| [INT-1689](https://linear.app/pbuchman/issue/INT-1689/remove-deprecated-agent-vocabulary-from-transcription-worker) | `workers/transcription/**` | Removes old agent vocabulary hints and keeps Intex Assistant terminology. |
| [INT-1690](https://linear.app/pbuchman/issue/INT-1690/sweep-docs-shared-contracts-and-repo-metadata-for-removed-agent) | README, docs, packages, Firestore registry, lint/verification metadata, lockfile metadata | Removes user-facing and shared metadata references, updates ownership to Intex, and validates the final repo-wide sweep. |

## Task 1: Intex Agent Runtime Consolidation

**Child issue:** [INT-1684](https://linear.app/pbuchman/issue/INT-1684/move-deprecated-commandaction-runtime-into-intex-agent)

**Files:**

- Modify: `apps/intex-agent/src/routes/internalRoutes.ts`
- Modify: `apps/intex-agent/src/routes/sessionRoutes.ts` or create focused route modules under `apps/intex-agent/src/routes/`
- Modify: `apps/intex-agent/src/services.ts`
- Modify: `apps/intex-agent/src/domain/**`
- Modify: `apps/intex-agent/src/infra/**`
- Modify: `apps/intex-agent/src/__tests__/**`
- Delete: `apps/commands-agent/**`
- Delete: `apps/actions-agent/**`

**Interfaces:**

- Consumes: existing Intex session repository and runner contracts.
- Produces: all Intex public/internal command/action routes listed in Endpoint Changes.
- Produces: Intex-named domain ports and fakes; no `commandsAgent` or `actionsAgent` type names remain.

- [ ] **Step 1: Write failing route parity tests**

  Add Intex route tests that cover command list/create/update/delete, action list/update/delete/batch/execute/preview/resolve, internal action create/process/retry/approval-reply/status, and internal command ingest/retry/get.

  Run: `pnpm --filter @intexuraos/intex-agent test`

  Expected before porting: FAIL for missing Intex route handlers.

- [ ] **Step 2: Port runtime behavior into Intex agent**

  Move required domain models, repositories, use cases, route handlers, internal clients, Pub/Sub decoders, and fakes into Intex-named modules. Keep Firestore collection names stable.

- [ ] **Step 3: Delete old app packages**

  Remove `apps/commands-agent/**` and `apps/actions-agent/**` after the Intex test suite covers retained behavior.

- [ ] **Step 4: Verify the service boundary**

  Run: `pnpm --filter @intexuraos/intex-agent test`

  Run: `pnpm run verify:workspace:tracked -- intex-agent`

  Run: `rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commandsAgent|actionsAgent" apps/intex-agent apps/commands-agent apps/actions-agent`

  Expected after implementation: no matches, with deleted directories absent.

## Task 2: Code-Agent Callback Rewire

**Child issue:** [INT-1685](https://linear.app/pbuchman/issue/INT-1685/rewire-code-agent-action-status-callbacks-to-intex-agent)

**Files:**

- Rename/modify: `apps/code-agent/src/infra/clients/actionsAgentClient.ts`
- Modify: `apps/code-agent/src/services/factories/clientFactory.ts`
- Modify: `apps/code-agent/src/services/factories/e2eMocks.ts`
- Modify: `apps/code-agent/src/services/types.ts`
- Modify: `apps/code-agent/src/config.ts`
- Modify: code-agent tests that reference the removed action runtime client.

**Interfaces:**

- Consumes: `PATCH /internal/intex-agent/actions/:actionId/status`.
- Produces: Intex-named client and config property using `INTEXURAOS_INTEX_AGENT_URL`.

- [ ] **Step 1: Write failing client/factory/config tests**

  Tests must prove the client calls `/internal/intex-agent/actions/:actionId/status`, config reads `INTEXURAOS_INTEX_AGENT_URL`, and E2E mode injects an Intex-named fake.

  Run: `pnpm --filter @intexuraos/code-agent test`

  Expected before implementation: FAIL because the client/config still use the removed action runtime name.

- [ ] **Step 2: Rename and rewire the client**

  Rename the type/factory/fake to Intex names and update the endpoint path. Preserve request body compatibility.

- [ ] **Step 3: Verify code-agent**

  Run: `pnpm --filter @intexuraos/code-agent test`

  Run: `pnpm run verify:workspace:tracked -- code-agent`

  Run: `rg -n "actions-agent|ACTIONS_AGENT|actionsAgent|ActionsAgent" apps/code-agent`

  Expected after implementation: no matches.

## Task 3: WhatsApp Service Rewire

**Child issue:** [INT-1686](https://linear.app/pbuchman/issue/INT-1686/route-whatsapp-ingress-and-approval-replies-to-intex-agent)

**Files:**

- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.ts`
- Modify: `apps/whatsapp-service/src/infra/pubsub/publisher.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: WhatsApp use-case tests and Pub/Sub publisher/config tests.

**Interfaces:**

- Produces: `intex.message.ingest` for assistant text/voice.
- Produces: approval reply payloads for Intex push routes.
- Consumes: runtime topic names from INT-1688.

- [ ] **Step 1: Write failing event/config tests**

  Tests must prove assistant messages publish only `intex.message.ingest`, approval reply comments/name strings do not target the removed runtime, and no removed env suffix is required.

  Run: `pnpm --filter @intexuraos/whatsapp-service test`

  Expected before implementation: FAIL where command ingest or removed runtime names remain.

- [ ] **Step 2: Update event publishing**

  Remove command-ingest publisher usage for assistant flows and ensure approval replies are described and configured as Intex-owned.

- [ ] **Step 3: Verify WhatsApp service**

  Run: `pnpm --filter @intexuraos/whatsapp-service test`

  Run: `pnpm run verify:workspace:tracked -- whatsapp-service`

  Run: `rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commandsAgent|actionsAgent" apps/whatsapp-service`

  Expected after implementation: no matches.

## Task 4: Web App Consumer Rewire

**Child issue:** [INT-1687](https://linear.app/pbuchman/issue/INT-1687/move-web-commandaction-consumers-onto-intex-agent-apis)

**Files:**

- Modify: `apps/web/src/config.ts`
- Modify: `apps/web/src/types/index.ts`
- Rename/modify: `apps/web/src/services/commandsApi.ts`
- Modify: web service tests and UI consumers that display command/action history.
- Do not modify generated config files in this subissue; INT-1688 owns generated service wiring.

**Interfaces:**

- Consumes: `config.intexAgentUrl`.
- Consumes: Intex public route paths listed in Endpoint Changes.
- Produces: Intex-named frontend API client and user-facing copy.

- [ ] **Step 1: Write failing web config/API tests**

  Tests must prove no web config type exposes `commandsAgentServiceUrl` or `actionsAgentUrl`, and command/action history calls use `config.intexAgentUrl`.

  Run: `pnpm --filter @intexuraos/web test`

  Expected before implementation: FAIL for old config/client names.

- [ ] **Step 2: Rename and rewire frontend clients**

  Replace removed agent names in service modules, hooks, pages, types, and user-facing labels with Intex terminology.

- [ ] **Step 3: Verify web**

  Run: `pnpm --filter @intexuraos/web test`

  Run: `pnpm run verify:workspace:tracked -- web`

  Run: `rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commandsAgent|actionsAgent|Commands Agent|Actions Agent" apps/web`

  Expected after implementation: no matches.

## Task 5: Infrastructure And Runtime Removal

**Child issue:** [INT-1688](https://linear.app/pbuchman/issue/INT-1688/remove-deprecated-agent-infrastructure-and-route-runtime-to-intex)

**Files:**

- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/hetzner-prod/main.tf`
- Modify: `terraform/hetzner-prod/pubsub.tf`
- Modify: `terraform/hetzner-prod/retained-gcp.tf`
- Modify: `terraform/modules/iam/main.tf`
- Modify: `terraform/modules/iam/outputs.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `ecosystem.config.prod.cjs`
- Modify: `apps/web/service-manifest.json`
- Regenerate: `apps/web/src/config.generated.ts`
- Regenerate: `ecosystem.generated.cjs`
- Regenerate: `terraform/environments/dev/service-urls.auto.tfvars.json`
- Modify: `scripts/hetzner/nginx/intexuraos.conf`
- Modify: `scripts/hetzner/cutover-gcp-edge.sh`
- Modify: `scripts/hetzner/nginx/jwt-verify.lua`
- Modify: `tools/pubsub-ui/server.mjs`
- Modify: `tools/pubsub-ui/index.html`
- Modify: `tools/pubsub-ui/README.md`
- Modify: `scripts/pubsub-publish-test.mjs`
- Modify: relevant `scripts/__tests__/**` infrastructure tests.

**Interfaces:**

- Produces: only `intex-agent` runtime wiring for this replacement surface.
- Consumes: Intex endpoint paths from Endpoint Changes.
- Produces: generated web service URL data with `INTEXURAOS_INTEX_AGENT_URL` only.

- [ ] **Step 1: Write failing infrastructure tests**

  Update tests to expect the removed runtime services, old service-account keys, old OpenAPI URLs, old nginx upstreams, and old web service URLs to be absent.

  Run: `pnpm vitest run scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts`

  Expected before implementation: FAIL because old runtime wiring still exists.

- [ ] **Step 2: Remove old runtime resources**

  Remove PM2/prod service entries, Terraform service definitions, IAM/service-account resources, Pub/Sub push subscriptions, nginx upstreams/routes, and OpenAPI hub env vars for the removed services. Point retained command/action/approval push flows to Intex internal routes.

- [ ] **Step 3: Regenerate service wiring**

  Run: `pnpm run generate:service-wiring`

  Expected: generated web/Terraform/PM2 files remove old service URL env vars and retain `INTEXURAOS_INTEX_AGENT_URL`.

- [ ] **Step 4: Verify infrastructure**

  Run: `pnpm run verify:service-wiring`

  Run: `pnpm run verify:pubsub`

  Run: `pnpm vitest run scripts/__tests__/ecosystem.config.test.ts scripts/__tests__/ecosystem.prod.config.test.ts scripts/__tests__/hetzner-runtime.test.ts`

  Run: `rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commands_agent|actions_agent" terraform ecosystem.config.cjs ecosystem.config.prod.cjs ecosystem.generated.cjs scripts/hetzner tools/pubsub-ui apps/web/service-manifest.json apps/web/src/config.generated.ts terraform/environments/dev/service-urls.auto.tfvars.json scripts/__tests__`

  Expected after implementation: no matches.

## Task 6: Transcription Worker Vocabulary

**Child issue:** [INT-1689](https://linear.app/pbuchman/issue/INT-1689/remove-deprecated-agent-vocabulary-from-transcription-worker)

**Files:**

- Modify: `workers/transcription/src/providers/speechmatics/vocabulary.ts`
- Modify: transcription worker vocabulary tests if present.

**Interfaces:**

- Produces: vocabulary hints for Intex Assistant terminology only.
- Does not consume service/runtime contracts.

- [ ] **Step 1: Write or update failing vocabulary tests**

  Add assertions that removed agent names are not present and Intex terminology remains.

  Run: `pnpm --filter @intexuraos/transcription test`

  Expected before implementation: FAIL while old vocabulary hints remain.

- [ ] **Step 2: Remove old vocabulary hints**

  Remove old agent vocabulary entries and keep current Intex Assistant terms.

- [ ] **Step 3: Verify transcription worker**

  Run: `pnpm --filter @intexuraos/transcription test`

  Run: `pnpm run verify:workspace:tracked -- transcription`

  Run: `rg -n "commands-agent|actions-agent|commands agent|actions agent" workers/transcription`

  Expected after implementation: no matches.

## Task 7: Documentation, Shared Contracts, And Metadata

**Child issue:** [INT-1690](https://linear.app/pbuchman/issue/INT-1690/sweep-docs-shared-contracts-and-repo-metadata-for-removed-agent)

**Files:**

- Modify: `README.md`
- Modify/delete: `docs/services/commands-agent/**`
- Modify/delete: `docs/services/actions-agent/**`
- Modify: user-facing docs under `docs/**` that mention the removed services.
- Modify: `docs/superpowers/specs/2026-06-24-intex-agent-whatsapp-sessions-design.md`
- Modify: `docs/superpowers/plans/2026-06-24-intex-agent-whatsapp-sessions.md`
- Modify/delete: `packages/http-contracts/src/zod/commands-agent.ts`
- Modify/delete: `packages/internal-clients/src/commands-agent/**`
- Modify/delete: `packages/internal-clients/src/actions-agent/**`
- Modify: `packages/internal-clients/src/index.ts`
- Modify: `packages/service-catalog/src/internalServiceCatalog.ts`
- Modify: `firestore-collections.json`
- Modify: `eslint.config.js`
- Modify: `scripts/verify-env-vars.mjs`
- Modify: `scripts/verify-common.mjs`
- Modify: `scripts/log-viewer.mjs`
- Modify: `scripts/dev-setup.mjs`
- Modify: `pnpm-lock.yaml` after deleted app packages and removed internal clients are reflected.

**Interfaces:**

- Consumes: canonical runtime identity and route list from this plan.
- Produces: docs and shared metadata with Intex as the only named owner of the replaced runtime.

- [ ] **Step 1: Write or update failing metadata tests**

  Update package/service-catalog/firestore/boundary tests so they fail while old service names remain.

  Run: `pnpm run verify:boundaries`

  Run: `pnpm run verify:firestore`

  Expected before implementation: FAIL for stale ownership or removed package references.

- [ ] **Step 2: Update user-facing docs and shared packages**

  Replace README and docs narrative with Intex agent. Delete the old service documentation directories or turn them into non-user-facing migration notes only if product docs policy requires keeping historical files. Update existing Intex agent spec/plan docs that currently say the old services remain available.

- [ ] **Step 3: Update shared metadata and package exports**

  Remove old package exports/clients/contracts/catalog entries or rename retained types to Intex-owned paths. Update Firestore owners for retained collections.

- [ ] **Step 4: Verify shared cleanup**

  Run: `pnpm run verify:package-exports`

  Run: `pnpm run verify:boundaries`

  Run: `pnpm run verify:firestore`

  Run: `pnpm run verify:dead-code`

  Run: `rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commands_agent|actions_agent|commandsAgent|actionsAgent|Commands Agent|Actions Agent|commands agent|actions agent" README.md docs packages firestore-collections.json eslint.config.js scripts/verify-*.mjs scripts/log-viewer.mjs scripts/dev-setup.mjs pnpm-lock.yaml`

  Expected after implementation: no user-facing or runtime metadata matches. The INT-1683 planning artifact is the only allowed non-user-facing exception unless the implementation PR deliberately redacts this file too.

## Final Integration Verification

- [ ] Merge or stack the child-issue branches with conflict resolution limited to overlapping generated files and shared metadata.
- [ ] Run `pnpm run generate:service-wiring`.
- [ ] Run `pnpm run verify:service-wiring`.
- [ ] Run `pnpm run verify:package-exports`.
- [ ] Run `pnpm run verify:boundaries`.
- [ ] Run `pnpm run verify:firestore`.
- [ ] Run `pnpm run verify:pubsub`.
- [ ] Run `pnpm run verify:dead-code`.
- [ ] Run `pnpm run ci:tracked`.
- [ ] Run the final repo-wide reference sweep:

```bash
rg -n "commands-agent|actions-agent|COMMANDS_AGENT|ACTIONS_AGENT|commands_agent|actions_agent|commandsAgent|actionsAgent|Commands Agent|Actions Agent|commands agent|actions agent" .
```

Expected: no matches outside INT-1683 planning artifacts and archived planning context. If the implementation verifier treats `docs/plans/` as user-facing docs, redact this plan after execution and keep the Linear issue link to the implementation PR as the durable record.

## Parallel Breakdown Proof

The subissues are independent because each owns a different service, worker, infrastructure, or shared-metadata boundary:

- INT-1684 owns the Intex agent service implementation and exposes stable HTTP contracts.
- INT-1685 owns code-agent and consumes only the Intex status callback contract.
- INT-1686 owns WhatsApp service and produces only Pub/Sub payloads for the Intex contracts.
- INT-1687 owns web app consumers and consumes only generated Intex service URL config plus Intex public routes.
- INT-1688 owns runtime infrastructure and generated service URL files, consuming only the canonical route names.
- INT-1689 owns transcription worker vocabulary and has no code dependency on the app or infrastructure changes.
- INT-1690 owns docs, shared package metadata, and verification registries, consuming only the canonical runtime identity and route list.

No subissue is blocked by another subissue because every cross-boundary assumption is captured in the Canonical Contracts and Endpoint Changes sections.
