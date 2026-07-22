# Intex Agent Production Matrix Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The primary agent performs implementation; subagents are used only for final review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canonical 20-scenario Matrix/WhatsApp corpus run entirely against the Hetzner production IntexuraOS runtime and iterate through deployment and live verification until it passes or exposes a concrete external blocker.

**Architecture:** The evaluator and Matrix credentials remain on Home Dev. Google-OIDC-protected, corpus-only Nginx routes connect that runner to production WhatsApp Service and Intex Agent control planes; Meta webhooks, sessions, DeepSeek calls, strict tool mocks, and Test Runs execute on Hetzner with runtime audience `hetzner-prod`.

**Tech Stack:** TypeScript, Fastify, Zod, Firestore, PM2, Nginx/OpenResty Lua, Google OIDC, GCP Secret Manager/Terraform, Vitest, Bash, Matrix, WhatsApp Cloud API, OpenRouter DeepSeek V4 Flash and MiniMax M3.

## Global Constraints

- Runner host is `home-dev`; system-under-test environment is `prod`; runtime audience and trusted runtime are `hetzner-prod`.
- Agent model is exactly `or:deepseek/deepseek-v4-flash`; semantic evaluator is exactly `or:minimax/minimax-m3`.
- A complete pass contains 20 scenarios, 59 turns/replies, 17 confirmation decisions, 19 strict-mock tool executions, and 20 distinct sessions.
- Production product-tool executor admission must remain zero; any missing mock evidence fails closed.
- No operator identity, phone, Matrix identifier/token, capability, HMAC/signing/encryption key, prompt, reply, or raw tool arguments enter Git or safe reports.
- The Home Dev Matrix token and targets remain on Home Dev.
- `pnpm run ci:tracked` runs once before commit and is repeated only when its own failure requires an integrated recheck.
- Each live command performs at most one corpus run; ambiguous delivery is reconciled and never blindly resent.
- After each completed plan task, send the operator `Krok N/15 wykonany — <wynik>; kolejny: <opis>` through the established Matrix/WhatsApp-visible channel when that channel is available; never label a partial task complete.

---

### Task 1: Introduce the closed production runtime-audience contract

**Files:**
- Modify: `packages/http-contracts/src/matrixCorpus.ts`
- Modify: `packages/http-contracts/src/index.ts`
- Test: `packages/http-contracts/src/__tests__/matrixCorpus.test.ts`

**Interfaces:**
- Produces `MATRIX_CORPUS_PRODUCTION_RUNTIME_AUDIENCE`, `MatrixCorpusRuntimeAudience`, and `matrixCorpusRuntimeAudienceSchema` with closed values `home-dev | hetzner-prod`.
- Production creation/execution code consumes the production constant; legacy decoding may consume the union schema.

- [ ] Add failing contract tests for accepting `hetzner-prod`, decoding legacy `home-dev`, and rejecting arbitrary strings.
- [ ] Run `pnpm --filter @intexuraos/http-contracts test -- matrixCorpus` and confirm the new production assertion fails.
- [ ] Add the constants/type/schema and export them without changing unrelated HTTP contracts.
- [ ] Re-run the targeted contract tests and typecheck until they pass.

### Task 2: Enable production WhatsApp corpus configuration safely

**Files:**
- Modify: `apps/whatsapp-service/src/config.ts`
- Test: `apps/whatsapp-service/src/__tests__/config.test.ts`

**Interfaces:**
- Consumes the shared production audience constant.
- Produces `WhatsAppMatrixCorpusConfig` that enables only `(dev, home-dev, home-dev)` or `(prod, hetzner-prod, hetzner-prod)` and otherwise fails startup.

- [ ] Add failing tests for the valid production tuple and invalid mixed environment/runtime tuples.
- [ ] Run the config test file and verify the production case fails under the current Home-Dev-only parser.
- [ ] Implement exact tuple validation while preserving secret-shape validation and disabled behavior.
- [ ] Run the config tests and `pnpm --filter @intexuraos/whatsapp-service typecheck`.

### Task 3: Carry `hetzner-prod` through WhatsApp capability, ingress, and recovery

**Files:**
- Modify: `apps/whatsapp-service/src/domain/matrixCorpus/types.ts`
- Modify: `apps/whatsapp-service/src/domain/matrixCorpus/{attestation.ts,controlAuthorization.ts}`
- Modify: `apps/whatsapp-service/src/domain/matrixCorpus/ports/{intexAgentMatrixCorpusClient.ts,matrixCorpusRouteControlPlane.ts,signedEnvelopeStore.ts}`
- Modify: `apps/whatsapp-service/src/infra/firestore/{matrixCorpusIngress.ts,matrixCorpusRecoveryScanner.ts,matrixCorpusRepository.ts}`
- Modify: `apps/whatsapp-service/src/infra/http/intexAgentMatrixCorpusClient.ts`
- Modify: `apps/whatsapp-service/src/infra/pubsub/matrixCorpusOutboxDrainer.ts`
- Modify: `apps/whatsapp-service/src/routes/matrixCorpusRoutes.ts`
- Modify: `apps/whatsapp-service/src/services.ts`
- Test: corresponding files under `apps/whatsapp-service/src/__tests__/domain/matrixCorpus`, `infra`, `routes`, and `integration`

**Interfaces:**
- Produces records, signatures, route schemas, and downstream headers bound to the configured runtime audience rather than a literal.
- Legacy `home-dev` records remain readable/cleanable but are never admitted by a `hetzner-prod` runtime.

- [ ] Add/convert tests so the production fixture uses `hetzner-prod` and add an explicit legacy-audience non-execution test.
- [ ] Run only the affected WhatsApp Matrix-corpus tests and observe the literal-audience failures.
- [ ] Thread the configured production audience through issuance, consumption, outboxes, recovery, signed control, route control, and the Intex client.
- [ ] Re-run affected tests plus WhatsApp typecheck; verify replay/mismatch traffic still fails closed.

### Task 4: Enable production Intex Agent corpus configuration and strict-mock session types

**Files:**
- Modify: `apps/intex-agent/src/config.ts`
- Modify: `apps/intex-agent/src/domain/matrixCorpus/{contextCrypto.ts,contextService.ts,matrixCorpusMessageHandler.ts}`
- Modify: `apps/intex-agent/src/domain/matrixCorpus/ports/{matrixCorpusContextRepository.ts,matrixCorpusManifestRepository.ts,testConfirmationRepository.ts}`
- Modify: `apps/intex-agent/src/domain/sessions/types.ts`
- Modify: `apps/intex-agent/src/infra/firestore/{matrixCorpusContextRepository.ts,matrixCorpusManifestRepository.ts,sessionRepository.ts,testConfirmationRepository.ts}`
- Test: corresponding Intex Agent config, domain, repository, route, services, and integration tests

**Interfaces:**
- Produces production-enabled config and immutable `hetzner-prod` test-session profiles.
- Strict executor resolution continues to depend only on accepted/decrypted server context.

- [ ] Add failing production config, context, confirmation-continuation, and legacy-audience rejection tests.
- [ ] Run the selected tests and verify they fail on current literals.
- [ ] Generalize types/schemas to the shared closed audience and pass the configured audience through composition.
- [ ] Run affected tests and Intex Agent typecheck; prove all 11 real tool clients remain uncalled in strict-mock tests.

### Task 5: Generalize Intex control routes, evidence, and Test Runs owner gate

**Files:**
- Modify: `apps/intex-agent/src/routes/{matrixCorpusRoutes.ts,testRunRoutes.ts}`
- Modify: `apps/intex-agent/src/domain/testRuns/types.ts`
- Modify: `apps/intex-agent/src/infra/firestore/testRunRepository.ts`
- Modify: `apps/user-service/src/config.ts`
- Modify: `apps/user-service/src/routes/settingsRoutes.ts`
- Test: Intex route/Test Runs tests and User Service config/settings/OpenAPI tests

**Interfaces:**
- Produces owner-only production Test Runs under `hetzner-prod` and production availability metadata for the existing model-selector UX.
- The evaluator UID is read from protected configuration; no email or UID is tracked.

- [ ] Add failing tests for production owner access, non-owner denial, disabled behavior, and `hetzner-prod` settings metadata.
- [ ] Run targeted tests and confirm the old Home-Dev-only checks fail.
- [ ] Implement the production audience path without weakening exact-user authorization.
- [ ] Run targeted tests and typechecks for Intex Agent and User Service.

### Task 6: Add an OIDC-authenticated, prefixed evaluator HTTP transport

**Files:**
- Create: `tools/intex-agent-evals/src/matrixCorpus/productionControlTransport.ts`
- Modify: `tools/intex-agent-evals/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/internal-clients/src/{intex-agent/types.ts,intex-agent/client.ts,whatsapp-service/types.ts,whatsapp-service/client.ts}`
- Test: `tools/intex-agent-evals/src/__tests__/productionControlTransport.test.ts`
- Test: internal-client tests for both services

**Interfaces:**
- Produces a Google identity-token provider for audience `https://intexuraos.cloud` and service prefixes `/internal/evals/whatsapp` and `/internal/evals/intex-agent`.
- Internal clients accept optional closed request-header/path adapters without changing default service-to-service behavior.

- [ ] Add failing tests for prefix construction, token caching/refresh, Authorization redaction, timeout, and token-provider failure.
- [ ] Add failing internal-client tests proving default URLs remain unchanged and evaluator prefixes are exact.
- [ ] Add direct `google-auth-library` dependency and minimal transport/client extension.
- [ ] Run evaluator transport tests, both internal-client suites, and their typechecks.

### Task 7: Expose only the corpus control plane through Hetzner Nginx

**Files:**
- Modify: `scripts/hetzner/nginx/intexuraos.conf`
- Modify: `scripts/hetzner/nginx/jwt-verify.lua`
- Test: `scripts/__tests__/hetzner-runtime.test.ts`

**Interfaces:**
- Produces OIDC-protected rewrites from `/internal/evals/{whatsapp|intex-agent}/matrix-corpus/*` to each service's existing `/internal/matrix-corpus/*` routes.
- Assigns caller role `matrix_corpus_runner` only to the existing Home Dev `claude-code-dev` identity.

- [ ] Add failing static/runtime tests for exact route allowlisting, caller role, rewrite targets, header clearing, and non-corpus denial.
- [ ] Run the targeted Hetzner runtime tests and confirm failure.
- [ ] Implement the two exact locations and route-pattern authorization without altering broader internal routing.
- [ ] Run the tests and Nginx configuration validation fixture.

### Task 8: Declare and load production corpus secrets

**Files:**
- Modify: `terraform/environments/dev/main.tf`
- Modify: `scripts/hetzner/load-secrets.sh`
- Test: `scripts/__tests__/hetzner-runtime.test.ts`

**Interfaces:**
- Produces ten Secret Manager containers and makes them available to the existing protected Hetzner environment loader.
- Does not place secret values in Terraform, shell defaults, tests, or Git.

- [ ] Add failing tests for the exact ten-name inventory, loader coverage, and absence of literal values.
- [ ] Run the targeted tests and confirm the inventory fails.
- [ ] Add secret descriptions, Hetzner runtime inventory, and loader names; remove the obsolete Home-Dev-only inventory comment.
- [ ] Run targeted tests and `terraform fmt -check` for the environment.

### Task 9: Wire production PM2 services and deployment readiness

**Files:**
- Modify: `ecosystem.config.prod.cjs`
- Modify: `scripts/hetzner/github-actions-deploy.sh`
- Test: `scripts/__tests__/ecosystem.prod.config.test.ts`
- Test: `scripts/__tests__/hetzner-runtime.test.ts`

**Interfaces:**
- WhatsApp receives bindings/HMAC/private signing key; Intex receives public signing/context keys; User Service receives owner UID and model/Test Runs flags.
- Fixed production flags are `enabled=true`, `trustedRuntime=hetzner-prod`, `runtimeAudience=hetzner-prod`.

- [ ] Replace forced-disable tests with failing exact per-service enablement/secret-isolation tests.
- [ ] Add failing deployment readiness checks for production corpus endpoints without issuing a run.
- [ ] Implement PM2 mappings and post-restart readiness verification.
- [ ] Run production ecosystem and Hetzner deployment tests.

### Task 10: Make preflight attest production while running on Home Dev

**Files:**
- Modify: `tools/intex-agent-evals/src/matrixCorpus/liveRuntime.ts`
- Modify: `tools/intex-agent-evals/src/matrixCorpus/preflight.ts`
- Modify: `tools/intex-agent-evals/src/preflight.ts`
- Test: `tools/intex-agent-evals/src/__tests__/{matrixCorpusLiveRuntime.test.ts,matrixCorpusPreflight.test.ts}`

**Interfaces:**
- Produces a snapshot with `runnerHost=home-dev`, `environmentAlias=prod`, `runtimeAudience=hetzner-prod`, and a production deployment SHA equal to the requested SHA.
- Production readiness endpoints replace local signing/context-secret inspection; Matrix protected files remain local checks.

- [ ] Add failing tests for exact production attestation, OIDC readiness, no local-service fallback, and zero-write preflight.
- [ ] Run the two test files and observe current local-port/dev assertions fail.
- [ ] Replace loopback SUT clients with production OIDC clients and read `https://intexuraos.cloud/deployment.json` under bounded schemas/timeouts.
- [ ] Run targeted tests and evaluator typecheck.

### Task 11: Bind execution, reports, and retention to `hetzner-prod`

**Files:**
- Modify: `tools/intex-agent-evals/src/matrixCorpus/{liveExecution.ts,reportSchema.ts,retentionExecution.ts}`
- Modify: `tools/intex-agent-evals/src/reportWriter.ts`
- Modify: `packages/internal-clients/src/intex-agent/{types.ts,client.ts}`
- Test: evaluator control-plane, report, retention, runner, and composition tests

**Interfaces:**
- Produces only production-audience context registration, projections, evidence queries, cleanup digests, and safe reports.
- Reports retain `runnerHost=home-dev` separately from `environmentAlias=prod`.

- [ ] Add failing report/cardinality and legacy-retention isolation tests.
- [ ] Run the selected evaluator suites and verify literal `home-dev` failures.
- [ ] Thread the production audience through the execution state and clients; keep legacy cleanup audience-explicit.
- [ ] Run all evaluator Matrix-corpus tests and typecheck.

### Task 12: Replace the unsafe live command with the production command

**Files:**
- Create: `scripts/run-intex-agent-evals-prod.sh`
- Modify: `scripts/run-intex-agent-evals-home-dev.sh`
- Modify: `package.json`
- Test: `scripts/__tests__/run-intex-agent-evals-prod.test.ts`
- Modify/Test: `scripts/__tests__/run-intex-agent-evals-home-dev.test.ts`

**Interfaces:**
- Produces canonical command `scripts/run-intex-agent-evals-prod.sh matrix-corpus` and package alias `eval:intex-agent:matrix-corpus`.
- Legacy Home Dev `matrix-corpus` exits `2` with `PRODUCTION_MATRIX_CORPUS_REQUIRED` before SSH/send.

- [ ] Add failing wrapper tests for argument framing, revision proof, safe output, signals, production target, and legacy rejection.
- [ ] Run both wrapper test files and confirm failure.
- [ ] Implement the production wrapper and remove live corpus dispatch from the legacy wrapper while preserving non-corpus diagnostics.
- [ ] Run both wrapper suites until they pass.

### Task 13: Update operator runbooks and perform three-axis review

**Files:**
- Modify: `docs/testing/intex-agent-evals.md`
- Modify: `docs/testing/intex-agent-matrix-whatsapp-live-procedure.md`
- Modify: `docs/superpowers/specs/2026-07-19-intex-agent-matrix-corpus-live-acceptance-design.md`
- Test: `tools/intex-agent-evals/src/__tests__/documentation.test.ts`

**Interfaces:**
- Produces one unambiguous meaning for “odpal testy”: the production wrapper exactly once.
- Records deferred dedicated-account/portable-runner hardening without implementing it now.

- [ ] Update the documentation test first with the production command, Hetzner boundary, exact cardinalities, and legacy prohibition.
- [ ] Update the runbooks/spec annotations and run the documentation test.
- [ ] Dispatch three read-only subagent reviews: security/correctness, test completeness, and operator/Test Runs UX.
- [ ] Resolve every actionable review finding locally and rerun its targeted tests.

### Task 14: Verify, commit, push, and open the pull request

**Files:** all files changed by Tasks 1–13.

**Interfaces:**
- Produces a reviewed branch and ready pull request with no secret material.

- [ ] Run focused suites for HTTP contracts, WhatsApp, Intex Agent, User Service, evaluator, wrappers, Nginx/Hetzner, and production ecosystem.
- [ ] Scan tracked diff for credentials, operator PII, capability values, private paths, placeholders, debug output, and unrelated changes.
- [ ] Run `pnpm run ci:tracked` once; fix failures with targeted tests and repeat the full gate only if the integrated fix requires it.
- [ ] Use the project `commit-push` procedure to commit, push `codex/matrix-whatsapp-live-procedure`, open a ready PR, wait for checks, address failures, and merge to `development`.

### Task 15: Provision, deploy, run 20 scenarios, and close the loop

**Files/state:** GCP Secret Manager/Terraform state, GitHub deployment, Hetzner PM2/Nginx, Home Dev runner checkout, production Test Runs, Home Dev private artifacts.

**Interfaces:**
- Produces a deployed production revision and final PASS/FAIL evidence.

- [ ] Before merge/deploy enablement, inspect the Terraform plan; apply only the ten secret containers and required access when no unrelated mutation is present, then stream validated Home Dev values directly into secret versions without printing them.
- [ ] After merge, wait for the Hetzner deployment workflow and require public `deployment.json` to equal the merge SHA; verify public health and protected corpus readiness.
- [ ] Fast-forward the clean Home Dev runner checkout to that SHA without restarting Home Dev product services, then invoke `scripts/run-intex-agent-evals-prod.sh matrix-corpus` exactly once.
- [ ] Validate the report for 20/59/17/19 cardinalities, 20 distinct sessions, all deterministic/MiniMax verdicts, and zero real executor admissions; verify the same run in the authenticated production Test Runs browser view.
- [ ] If the run fails, preserve evidence, diagnose and fix the exact boundary through a new reviewed revision, redeploy, and repeat this task without blind message retries; stop only for a concrete external intervention that cannot be performed with available access.
