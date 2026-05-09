# INT-1622: INT-1473 Refactoring Progress Audit

> **For agentic workers:** This document is an audit artifact, not an implementation plan. If any follow-up work is opened from the "Worth Implementing Now" section, create a fresh implementation plan for that narrower issue before changing production code.

## Goal

Evaluate INT-1473 and its descendant issues against the current repository state. The audit uses Linear issue descriptions and comments, referred plan documents, GitHub PR history, and targeted code searches to separate completed work from partial, obsolete, or still-valuable work.

## Evidence Sources

- Linear: INT-1473, INT-1529 through INT-1538, and descendant issues INT-1539 through INT-1574.
- Planning artifacts: `docs/reviews/2026-04-24-refactoring-analysis.md`, `docs/evidence/INT-1473-already-completed.md`, and the referenced `docs/plans/*` files for INT-1529 through INT-1538.
- GitHub PR and commit history: especially PR #1949, #1950, #1969, #1993, #1998, #1992, #2003, #2004, #2005, #2019, #2025, #2029, #2030, and #2032.
- Current repo checks:
  - `wc -l apps/code-agent/src/routes/code/task-routes.ts apps/research-agent/src/routes/researchRoutes.ts workers/orchestrator/src/services/task-dispatcher.ts terraform/environments/dev/main.tf`
  - `rg` checks for parity scripts, Firestore migration gates, common-worker shims, raw internal `fetch` calls, LLM prompt caching and pricing-diff artifacts, and log-cleanup deletion history.

## Executive Summary

INT-1473 itself is complete as a refactoring analysis and dispatch artifact: PR #1949 produced the review document and the ten child issues, and PR #1950 recorded evidence that duplicate dispatch had already completed. The implementation follow-through is mixed. Two top-level areas are effectively complete for the current live codebase, while eight top-level areas remain partial because their own PRs explicitly landed only phase slices or because follow-up scripts/refactors are absent from the current tree.

The most valuable remaining work is not another broad "finish INT-1473" sweep. The current codebase would benefit most from a few focused follow-ups: env/secret parity gates, Firestore migration and ownership gates, internal-client/raw-fetch enforcement, the largest backend route splits, and selected test infrastructure needed to make those refactors cheaper.

## Top-Level Rollup

| Issue | Current classification | Evidence | What is left |
| --- | --- | --- | --- |
| INT-1473 | Fully implemented | PR #1949 merged the refactoring analysis and created the ten child issues; PR #1950 recorded duplicate-dispatch evidence. | No INT-1473 planning deliverable remains. Follow-up work belongs to child issues or new focused issues. |
| INT-1529 | Partially implemented | PR #1969 landed only Phase 1 shared primitives and Phase 2 `user-service` pilot. Current repo has `loadEnv`, `createServiceContainer`, `createFastifyApp`, `startFastifyService`, and `createFirestoreCrudRepository`. | Phases 3-7 remain: port remaining apps, cleanup local service boilerplate, split the large routes, migrate CRUD repos, and final verification. |
| INT-1530 | Partially implemented | Most worker subtasks have merged PRs; `packages/common-worker` exists; code-worker is under `docker/code-worker`; DLQ and auth/env work landed. | `workers/transcription` and `workers/vm-lifecycle` still import local `__shims__/common-worker`; `task-dispatcher.ts` is still 611 lines versus the plan target under 400; log-cleanup work is obsolete after PR #2019 removed that worker. |
| INT-1531 | Partially implemented | PR #2005 landed Phase 1 primitives: internal HTTP client package, OIDC verifier wiring, request context, prior-token support, and internal auth runbooks. | Many service callers still use raw `fetch`; raw-fetch and envelope gates are not present; service wiring generation and full facade migration remain incomplete. |
| INT-1532 | Partially implemented | PR #1986, #1997, and #2025 landed registry/index cleanup, `withSchemaVersion`, and WhatsApp notification preference split. | S1 migration immutability/artifact/no-unbounded-get gates are not complete; S3 code-agent repository consolidation and `view-metrics` relocation are not complete. |
| INT-1533 | Partially implemented | PR #2030 landed 8 of 13 tasks; PR #2032 migrated prompt builders. Current repo has `withRetry`, `generateStructured`, `createLlmClient`, `llm-pricing`, and prompt-version verification. | Prompt caching and nightly pricing-diff remain useful. Retiring research-agent provider adapters is not worth doing as originally scoped because the adapters still expose provider-native research/web-search behavior. |
| INT-1534 | Partially implemented | PR #1993 merged the web refactor and claims the main R1-R8 work. | The PR explicitly deferred hook tests for four hooks, dynamic import/bundle work, `FilterSheet` migration, and manual smoke coverage. |
| INT-1535 | Partially implemented | PR #1998 landed Phase 1: shared Vitest config, v8-ignore duplicate gate, fake-timer log-forwarder tests, fake relocations, and several config migrations. | Deferred tasks remain: type-ignore tightening, `packages/test-utils`, orchestrator scriptable fake, fake file system, E2E expansion, and balance-set-services rule. |
| INT-1536 | Partially implemented | PR #2004, #1995, and #1996 landed web service manifest, api-docs-hub env ecosystem cleanup, and production env docs. | INT-1545 parity gates were closed unmerged; Docker/deploy consolidation and Terraform split issues were archived; orphan secret cleanup was archived. |
| INT-1537 | Fully implemented | PRs #2003, #1988, #1991, #1989, and #1990 merged; current repo has the domain packages, Pub/Sub client packages, common HTTP/redaction package surfaces, package export/dead-code verification, and package build docs. | No material follow-up from the INT-1537 plan is apparent. |
| INT-1538 | Fully implemented for current live services | All child PRs #1973, #1974, #1977, #1978, #1979, #1980, #1981, #1982, and #1983 merged, with follow-up fixes #2010, #2020, #2022, and #2023. Current repo has `common-metrics`, request context, Pub/Sub correlation helpers, worker init patterns, and incoming request logging verification. | Log-cleanup-specific work is obsolete because PR #2019 removed `workers/log-cleanup`. A future typed-error strictness pass could review the few remaining `throw new Error` sites, but that is not a blocker for the original INT-1538 child set. |

## Fully Implemented Issues

These issues are implemented enough that no immediate follow-up is recommended from the current codebase state.

| Issue | Evidence |
| --- | --- |
| INT-1473 | PR #1949 and #1950 completed the analysis and dispatch deliverable. |
| INT-1537 | All five shared-package subtasks merged; package surfaces and verification scripts exist in the current repo. |
| INT-1538 | All observability/error subtasks merged; follow-up fixes landed; log-cleanup-specific scope is obsolete because the worker was removed. |
| INT-1540 | Firestore registry/index cleanup merged in PR #1986. |
| INT-1542 | WhatsApp notification preferences split merged in PR #2025; `whatsapp_notification_preferences` exists in code and registry. |
| INT-1543 | `withSchemaVersion` merged in PR #1997; `packages/infra-firestore/src/schemaVersion.ts` exists. |
| INT-1544 | Web service manifest merged in PR #2004; `apps/web/service-manifest.json` exists and is used by deployment checks. |
| INT-1546 | api-docs-hub env/ecosystem cleanup merged in PR #1995. |
| INT-1547 | `packages/common-worker` merged in PR #2029. |
| INT-1549 | Transcription DLQ semantics merged in PR #2026. |
| INT-1550 | vm-lifecycle auth/env hardening merged in PR #1987. |
| INT-1551 | Orchestrator decomposition merged in PR #2018. |
| INT-1552 | Code-worker relocation merged in PR #1999; current repo has `docker/code-worker` and no `workers/code-worker`. |
| INT-1553 | Terraform DLQ wiring merged in PR #2000. |
| INT-1554 | Pub/Sub and deployment-mode docs merged in PR #2002. |
| INT-1555 through INT-1559 | Domain extraction, slim Pub/Sub packages, common HTTP/redaction, dependency catalog, and build policy merged via PRs #2003, #1988, #1991, #1989, and #1990. |
| INT-1561 through INT-1569 | Observability/error subtasks merged via PRs #1973, #1974, #1977, #1978, #1979, #1980, #1981, #1982, and #1983, with targeted follow-up fixes. |
| INT-1574 | Production env documentation merged in PR #1996. |

## Partially Implemented Issues

These issues have some delivered work, but the original plan still has valuable incomplete slices.

| Issue | Implemented | Remaining |
| --- | --- | --- |
| INT-1529 | Shared app/server primitives and user-service pilot. | Remaining service ports, boilerplate cleanup, route splits, CRUD repository migration, final verification. |
| INT-1530 | Common-worker package, worker auth/env/DLQ/decomposition/docs, code-worker relocation. | Remove local common-worker shims from transcription/vm-lifecycle; decide whether the `task-dispatcher.ts` size target still matters; ignore removed log-cleanup worker. |
| INT-1531 | Internal HTTP client primitives, request context, OIDC verifier, dual-token support, internal auth docs. | Migrate service clients off raw internal `fetch`, add enforcement scripts, complete facade/schema generator work if still desired. |
| INT-1532 | Registry/index cleanup, schema-version helper, WhatsApp preference split. | Migration immutability/artifact gate; `no-unbounded-firestore-get`; code-agent repo relocation; paginated backfills; `view-metrics` relocation. |
| INT-1533 | Prompt-version verifier, prompt builders, correlation, retry, structured generation, missing pricing source, client factory, batched sinks. | Prompt caching and nightly pricing-diff. Adapter retirement should be rejected as originally framed. |
| INT-1534 | Main web refactor merged. | Hook tests, dynamic import/bundle work, `FilterSheet`, manual smoke. |
| INT-1535 | Phase 1 test infrastructure landed. | Test-utils package, scriptable orchestrator fake, fake filesystem, E2E expansion, stricter v8-ignore/type guard work, balance-set-services rule. |
| INT-1536 | Web manifest, api-docs-hub env cleanup, prod env docs. | Env/secret parity gates, Terraform split, Docker/deploy consolidation, orphan secret cleanup. |
| INT-1539 | No current merged implementation found for the S1 tooling contract. | Still worth doing with a narrower scope. |
| INT-1541 | No current merged implementation found for the S3 code-agent repository relocation contract. | Still worth doing with a narrower scope. |
| INT-1545 | PR #1992 was closed, not merged; current repo lacks the verifier scripts. | Resurrect or re-plan the parity-gate work. |

## Rejected, Obsolete, Or Not Worth Implementing As Scoped

| Issue or scope | Recommendation | Reason |
| --- | --- | --- |
| INT-1548 | Reject as obsolete. | PR #2019 removed `workers/log-cleanup` and replaced the cron worker with native Firestore TTL retention. |
| Log-cleanup portions of INT-1530 and INT-1538 | Reject as obsolete. | The service no longer exists in the current tree. |
| INT-1533 Task 10, retire research-agent provider adapters | Reject as originally scoped. | PR #2030 records that adapters still expose provider-native research/web-search features not represented by `LlmGenerateClient`. Keep adapters until the shared client contract supports those capabilities. |
| INT-1571 | Keep archived unless Dockerfile/deploy drift becomes a measured problem. | The issue was archived and no current evidence shows this should outrank parity gates or Firestore ownership gates. |
| INT-1573 | Keep archived until parity gates exist. | One-time orphan cleanup without the INT-1545 gates is likely to regress. |
| INT-1572 | Do not revive blindly; re-plan only after parity gates. | `terraform/environments/dev/main.tf` is still 3067 lines, so the idea has value, but it should come after env/secret parity enforcement. |

## Worth Implementing Now

1. **INT-1545 env/secret parity gates.** This is the highest-value infra follow-up because PR #1992 closed unmerged and the current repo lacks `verify-terraform-env-consumers`, `verify-ecosystem-coverage`, and `verify-terraform-secret-mounts` scripts. Add the gates before doing more env or Terraform cleanup.
2. **INT-1532 S1 and INT-1539 Firestore migration tooling.** Complete migration immutability, artifact verification, and `no-unbounded-firestore-get` enforcement. This reduces risk before more data-layer moves.
3. **INT-1532 S3 and INT-1541 code-agent repository consolidation.** Current `firestore-collections.json` still scans `apps/code-agent/src/infra/repositories`, and `workers/orchestrator/src/scripts/view-metrics.ts` still exists. This is concrete unfinished work with a clear target state.
4. **INT-1531 internal-client migration and raw-fetch enforcement.** The primitives exist, but current code still contains many raw `fetch` calls in app and worker clients. Start with internal service-to-service clients, then add narrowly scoped enforcement.
5. **INT-1529 route splits for the largest backend files.** `apps/code-agent/src/routes/code/task-routes.ts` is 3151 lines and `apps/research-agent/src/routes/researchRoutes.ts` is 1692 lines. Split these before broad remaining app ports.
6. **INT-1535 test-utils and orchestrator fake infrastructure.** Implement the testing pieces that directly lower risk for the route, Firestore, and internal-client work above.
7. **INT-1533 prompt caching and pricing drift monitoring.** These remain independently valuable. Keep adapter retirement out of scope until the shared LLM client can model provider-native research features.
8. **INT-1534 web follow-ups.** Add the deferred hook tests and dynamic import work when touching the web surface again; they are useful but lower priority than backend/data safety gates.
9. **INT-1572 Terraform split, re-planned later.** The monolithic file remains large, but splitting Terraform should follow parity verification so refactors are protected by gates.

## Acceptance Criteria For This Audit

- The report lists fully implemented issues, partially implemented issues, rejected/obsolete work, and changes worth implementing now.
- Claims about missing functionality are scoped to searched artifacts and current file paths rather than broad "no support exists" statements.
- The highest-priority recommendations are tied to current repository evidence, not only stale plan text.
- The Linear issue INT-1622 links this document as `Plan document: docs/plans/INT-1622-int-1473-progress-audit.md`.

## Verification Notes

- PR history confirms several direct child issues were intentionally phased rather than fully completed. PR #1969 says INT-1529 landed Phases 1-2 only. PR #1998 says INT-1535 landed Phase 1 and deferred multiple tasks. PR #2030 says INT-1533 landed 8 of 13 tasks, with later prompt-builder work in PR #2032.
- Current size checks show the largest remaining route/surface targets still exist: `task-routes.ts` at 3151 lines, `researchRoutes.ts` at 1692 lines, `task-dispatcher.ts` at 611 lines, and `terraform/environments/dev/main.tf` at 3067 lines.
- Current search confirms `workers/transcription` and `workers/vm-lifecycle` still use local common-worker shims, while `packages/common-worker` exists.
- Current search confirms `workers/log-cleanup` was deleted by commit `2084b1aa8` from PR #2019, making log-cleanup-specific follow-up obsolete.
- Current search confirms the internal auth rotation and OIDC phase-two docs exist, but raw service-to-service `fetch` calls still exist and raw-fetch/envelope enforcement scripts were not found.
- Current search confirms Firestore WhatsApp preference split and `withSchemaVersion` exist, while the `apps/code-agent/src/infra/repositories` scan paths and `workers/orchestrator/src/scripts/view-metrics.ts` remain.
