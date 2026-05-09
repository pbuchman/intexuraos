# INT-1473 Implementation Progress Audit

> **For agentic workers:** This document is a progress audit, not an execution plan. If any follow-up implementation is approved, create a separate implementation plan and use `superpowers:subagent-driven-development` or `superpowers:executing-plans` for that follow-up.

**Goal:** Determine what was implemented, what remains, what should be rejected as stale, and what is still worth implementing from INT-1473 and its child issues.

**Architecture:** Evidence-first audit across Linear issue descriptions/comments, referenced plan docs, merged GitHub PRs, and the current repository state. Direct INT-1473 children are the main reporting units; descendant subtasks are included only where they prove implementation progress.

**Tech Stack:** Linear, GitHub PR history, TypeScript monorepo, Cloud Run apps, Cloud Functions workers, VM-hosted orchestrator, Terraform.

---

## Evidence Sources

- Parent issue: INT-1473, "Identify and document system refactoring areas for microservices migration".
- Current planning issue: INT-1623, "Evaluate implementation progress for INT-1473 and child issues".
- Source report: `docs/reviews/2026-04-24-refactoring-analysis.md`.
- Evidence note: `docs/evidence/INT-1473-already-completed.md`.
- Plan docs:
  - `docs/plans/INT-1529-backend-apps-refactor.md`
  - `docs/plans/2026-04-24-workers-layer-refactor.md`
  - `docs/plans/2026-04-24-int-1531-s2s-communication.md`
  - `docs/plans/2026-04-24-int-1532-firestore-data-layer-refactor.md`
  - `docs/plans/INT-1533-llm-stack-refactor.md`
  - `docs/plans/2026-04-24-int-1534-web-frontend-refactor.md`
  - `docs/plans/2026-04-24-int-1535-testing-coverage-refactor.md`
  - `docs/plans/INT-1536-infra-env-var-refactor.md`
  - `docs/plans/INT-1537-shared-packages-leaf-contract.md`
  - `docs/plans/2026-04-24-INT-1538-observability-unification.md`
- GitHub PR history, especially #1949, #1950, #1951-#1960, #1969, #1973-#1983, #1986-#1999, #2002-#2005, #2018, #2025-#2029, #2031.

## Executive Summary

INT-1473 itself is complete as an architectural analysis deliverable: PR #1949 produced the refactoring report and ten direct child issues, and PR #1950 recorded duplicate-dispatch evidence. The implementation work that followed is substantial but uneven.

None of the ten direct child issues INT-1529 through INT-1538 should be marked "fully implemented end-to-end" against their own acceptance criteria. Several are mostly implemented through descendant PRs, but each still has explicit gaps in the current tree.

The most valuable remaining work is narrow and evidence-backed: finish Firestore tooling/repository ownership gaps, reconcile worker `common-worker` shims, decide the stale `log-cleanup` scope, finish service-to-service raw-fetch/envelope guardrails, and revive the useful env-var drift checks from the closed INT-1545 PR in a smaller form.

Large fan-out refactors that chase uniformity for its own sake should not be restarted now. The current codebase already absorbed the highest-value parts of many plans.

## Fully Implemented Issues

### Direct INT-1473 Scope

| Issue | Status | Evidence |
| --- | --- | --- |
| INT-1473 | Complete for original requested deliverable | PR #1949 merged the system refactoring analysis and created the ten refactor child issues; PR #1950 documents duplicate-dispatch evidence. |

### Descendant Issues With Strong Completion Evidence

These are implementation subtasks under the direct child issues. They should be treated as implemented unless a later review finds regressions.

| Issue | Parent | Evidence |
| --- | --- | --- |
| INT-1547 | INT-1530 | `packages/common-worker` exists; PR #2029 merged the frozen API package. |
| INT-1549 | INT-1530 | `workers/transcription/src/publishers/transcription-dlq-publisher.ts` exists; parse/schema failures return `DeadLetter`; PR #2026 merged. |
| INT-1550 | INT-1530 | `workers/vm-lifecycle` auth/env fixes merged in PR #1987. |
| INT-1552 | INT-1530 | `docker/code-worker` exists and `workers/code-worker` is gone; PR #1999 merged. |
| INT-1553 | INT-1530 | Terraform DLQ topic/dead-letter policy artifacts exist; PR #2000 merged. |
| INT-1554 | INT-1530 | Pub/Sub consumer contract and three deployment modes are documented; PR #2002 merged. |
| INT-1540 | INT-1532 | Firestore ownership verifier now emits `ORPHAN_INDEX`/`UNDECLARED`; migration 098 exists; PR #1986 merged. |
| INT-1542 | INT-1532 | `whatsapp_notification_preferences` repo, registry entry, and migration 099 exist; PR #2025 merged. |
| INT-1543 | INT-1532 | `packages/infra-firestore/src/schemaVersion.ts` and tests exist; PR #1997 merged. |
| INT-1544 | INT-1536 | `apps/web/service-manifest.json` and `scripts/verify-web-service-manifest.mjs` exist; PR #2004 merged. |
| INT-1546 | INT-1536 | `api-docs-hub` has `validateRequiredEnv` and ecosystem registration; PR #1995 merged. |
| INT-1574 | INT-1536 | Docs now reflect the single-project dev/prod reality; PR #1996 merged. |
| INT-1556 | INT-1537 | `infra-pubsub` slimmed and typed publisher packages exist; PR #1988 merged. |
| INT-1557 | INT-1537 | `http-server`/`common-http` slimming and redaction move landed; PR #1991 merged. |
| INT-1558 | INT-1537 | pnpm catalog, peer dependency work, and dead-code gate exist; PR #1989 merged. |
| INT-1559 | INT-1537 | package docs/build-output policy and `verify-package-exports` exist; PR #1990 merged. |
| INT-1561 | INT-1538 | `packages/infra-sentry/src/initWorker.ts` exists; PR #1973 merged. |
| INT-1562 | INT-1538 | `packages/common-core/src/tracing/requestContext.ts` exists and internal client propagation work landed; PR #1974 merged. |
| INT-1563 | INT-1538 | `packages/infra-pubsub/src/extractCorrelation.ts` exists; PR #1977 merged. |
| INT-1564 | INT-1538 | `packages/llm-utils/src/withLlmSpan.ts` exists and provider duration evidence exists; PR #1981 plus fixes #2010/#2020/#2023 merged. |
| INT-1565 | INT-1538 | Orchestrator `initWorker`/metrics landed; PR #1978 plus fixes #2022 merged. |
| INT-1566 | INT-1538 | vm-lifecycle `initWorker`/silent-catch/typed-error work landed; PR #1979 merged. |
| INT-1567 | INT-1538 | transcription worker init/flush work landed; PR #1980 merged. |
| INT-1568 | INT-1538 | `packages/common-metrics`, monitoring alerts, and incoming-request logging verifier exist; PR #1983 merged. |

## Partially Implemented Direct Children

| Issue | Current State | What Is Left |
| --- | --- | --- |
| INT-1529 Backend apps | Partial. PR #1969 merged shared primitives and a `user-service` pilot. Only `apps/user-service` uses `createFastifyApp`, `startFastifyService`, and `createServiceContainer`. | Remaining apps still use bespoke bootstraps; `apps/code-agent/src/routes/code/task-routes.ts` is still 3,151 LOC; `apps/research-agent/src/routes/researchRoutes.ts` is still 1,692 LOC; total `apps/*/src/server.ts` LOC is 8,682, far above the plan's 1,500 target. |
| INT-1530 Workers layer | Mostly partial. Many descendant subtasks merged, but the work was never reconciled into one clean worker contract. | `workers/transcription` and `workers/vm-lifecycle` still import temporary `__shims__/common-worker`; `workers/log-cleanup` does not exist in the current tree, making INT-1548 stale; `workers/orchestrator/src/services/task-dispatcher.ts` is 611 LOC, above the <400 acceptance target. |
| INT-1531 Service-to-service communication | Partial. `createInternalHttpClient`, request context, and OIDC verifier exist; PR #2005 merged phase-one primitives/OIDC wiring. | `scripts/verify-no-raw-fetch.mjs` and `scripts/verify-envelope.mjs` are missing; raw `fetch(` remains in many `apps/*/src/infra/**` clients; app-level HTTP clients still exist. |
| INT-1532 Firestore data layer | Partial. Registry/index cleanup, WhatsApp preference split, and `withSchemaVersion` landed. | Migration immutability manifest and `no-unbounded-firestore-get` ESLint rule are missing; `apps/code-agent/src/infra/repositories` still exists; `workers/orchestrator/src/scripts/view-metrics.ts` still exists and no code-agent equivalent exists. |
| INT-1533 LLM/AI stack | Partial. Current code has factory support for Google/OpenRouter/Anthropic/OpenAI/Perplexity, `withRetry`, `generateStructured`, prompt-version verification, `researchId` cost attribution, Claude 4.7 pricing, and batched usage sinks. | No implementation PR is linked to INT-1533 beyond the plan; research-agent provider adapters still exist; `docs/patterns/prompt-caching.md` is missing; no pricing-diff job was found. |
| INT-1534 Web frontend | Mostly implemented. PR #1993 merged route lazy loading, manual chunks, SRP splits, env lockstep, apiClient retry/request-id, Modal primitive, dependency/action-config fixes. | One residual `role="dialog"` literal remains in `apps/web/src/components/llm-usage/FilterSheet.tsx`, so the modal guard acceptance is not fully satisfied. |
| INT-1535 Testing and coverage | Partial. PR #1998 merged phase-one pieces: `vitest.shared.ts`, duplicate v8-ignore checks, fake-timer log-forwarder, and fake relocation. | `packages/test-utils` is missing; `balance-set-services` ESLint rule is missing; v8 `ts-type` blocker allowlist still includes `spread`, `conditional`, and `ternary`; the broader E2E/test-utils plan remains open. |
| INT-1536 Infrastructure/env vars | Partial with rejected descendants. Web service manifest, api-docs-hub env validation, and prod docs reconciliation landed. | PR #1992 for Terraform/code/ecosystem/Secret Manager parity was closed unmerged; `verify-terraform-env-consumers`, `verify-ecosystem-coverage`, and `verify-terraform-secret-mounts` are missing; `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` still appears in Terraform; `terraform/environments/dev/main.tf` is still 3,067 LOC. |
| INT-1537 Shared packages | Mostly implemented. Domain packages, publisher packages, redaction move, catalog/peer deps, knip, docs, and package-export gate landed across PRs #1988-#1991 and #2003. | `packages/common-core/src/index.ts` still exports `ServiceFeedback`, which was explicitly named as a dead/common-core residue in the plan. |
| INT-1538 Observability/error handling | Mostly implemented. The major observability packages, request context, Pub/Sub correlation, LLM spans, common metrics, worker init, monitoring alerts, and incoming-request logging verifier landed. | Plain `throw new Error(` remains in target production paths: `packages/http-server/src/health.ts` and `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts`; worker shims also show incomplete reconciliation with `common-worker`. |

## Rejected Or Obsolete Items

No direct INT-1473 child issue is formally rejected in Linear. The following descendant issues or PR attempts should be treated as rejected, obsolete, or not worth implementing as written:

| Item | Reason |
| --- | --- |
| INT-1548, migrate `workers/log-cleanup` | Obsolete target. `workers/log-cleanup` is absent from the current tree, and tests now assert stale log-cleanup references are removed from worker build config. Replace with documentation cleanup if needed. |
| INT-1571, shared Dockerfile/deploy script consolidation | Archived, no PR artifacts, and current tree still has per-service Dockerfiles. Do not restart as a broad consolidation unless deploy maintenance becomes an active pain point. |
| INT-1572, Terraform `dev/main.tf` split | Archived, no PR artifacts, and `main.tf` remains large. Reject as churn-heavy for now; only split when making related Terraform changes. |
| INT-1573, orphan secrets/dead env var cleanup | Archived and no PR artifacts. The original broad issue should stay rejected, but the specific dead `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC` cleanup is still worth a small follow-up. |
| PR #1992 / INT-1545 parity verifier implementation | Closed unmerged; current verifier files are missing. The idea is still useful, but the rejected PR should not be revived wholesale. |

## Worth Implementing Now

1. **INT-1532 S1/S3 cleanup:** add migration immutability manifest/checks and the `no-unbounded-firestore-get` guard; finish code-agent repository relocation and move or remove `workers/orchestrator/src/scripts/view-metrics.ts`.
2. **INT-1530 reconciliation:** replace worker-local `__shims__/common-worker` imports with `@intexuraos/common-worker`; close or rewrite INT-1548 because `log-cleanup` is gone; optionally trim `task-dispatcher.ts` below 400 LOC only if active changes are planned there.
3. **INT-1531 guardrails:** finish migration away from raw internal `fetch(` calls, then add a narrower `verify-no-raw-fetch`/envelope gate that accounts for legitimate third-party HTTP clients.
4. **INT-1536 small env-drift pass:** revive only the useful parts of INT-1545 as smaller scripts and remove the dead `INTEXURAOS_PUBSUB_LLM_ANALYTICS_TOPIC`; do not restart shared Dockerfile or full Terraform split work.
5. **INT-1533 research-agent adapter retirement:** delete or convert the remaining `apps/research-agent/src/infra/llm/*Adapter.ts` path if the unified factory is ready for all active research flows.
6. **Small acceptance fixes:** remove the `role="dialog"` literal in `FilterSheet`, remove `ServiceFeedback` from `common-core` if truly unused, and convert the remaining production `throw new Error(` cases in INT-1538 target paths.

## Not Worth Implementing Now

- All-app bootstrap fan-out from INT-1529 as a standalone project. Keep the shared helpers, but migrate apps opportunistically.
- Terraform `main.tf` splitting for line count alone.
- Shared Dockerfile/deploy-script consolidation across every service unless deploy scripts are actively breaking.
- Prompt-caching docs/nightly pricing-diff automation unless pricing drift or cache-cost optimization is an active operational concern.
- Pure LOC reduction of `task-dispatcher.ts` without a functional reason.

## Endpoint Changes

- Modified: none.
- Created: none.
- Removed: none.
- Unchanged: all runtime endpoints. This audit produces documentation only.

## Verification Performed

- Read INT-1623 and comments, then INT-1473 and all visible comments.
- Read direct child issues INT-1529 through INT-1538 and their comments.
- Read descendant issue listings for complex children INT-1530, INT-1532, INT-1536, INT-1537, and INT-1538.
- Checked GitHub PR state for referenced planning and implementation PRs.
- Checked current repository state with targeted evidence commands:
  - `rg --files docs/plans docs/reviews docs/evidence`
  - `gh pr view <number> --json ...`
  - `rg -l "createFastifyApp" apps/*/src/server.ts packages/http-server/src`
  - `wc -l apps/*/src/server.ts apps/code-agent/src/routes/code/task-routes.ts apps/research-agent/src/routes/researchRoutes.ts`
  - `rg -n "fetch\\(" apps/*/src/infra`
  - `rg -n "__shims__/common-worker|@intexuraos/common-worker" workers packages/common-worker`
  - `node scripts/verify-prompt-versions.mjs`

## Acceptance Criteria For This Audit

- INT-1473 and child issue progress is summarized against current code, not only Linear status.
- Fully implemented, partially implemented, and rejected/obsolete issues are listed.
- Remaining high-value work is separated from broad refactors that should not be resumed now.
- Evidence references include plan docs, issue/PR history, and current-tree checks.
