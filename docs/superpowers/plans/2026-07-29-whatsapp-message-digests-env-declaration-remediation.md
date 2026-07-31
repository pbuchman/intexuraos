# WhatsApp Message Digests Environment Declaration Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the environment-variable gate accurately model the required Message Digest service
URL and the optional previous internal-auth token used during rotation.

**Architecture:** Declare `INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL` at WhatsApp Service startup because
its schema already requires it. Keep `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` optional by adding the
platform-wide rotation key to the verifier's common optional set; requiring it would incorrectly
prevent normal single-token startup outside a rotation window.

**Tech Stack:** TypeScript service bootstrap, Node.js static verifier, Vitest, PM2/generated service
wiring.

## Global Constraints

- Work sequentially in the primary session; subagents are review-only.
- Do not weaken the required Message Digest URL schema or give it a fallback.
- Do not make `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` required and do not change token validation,
  rotation, or authorization behavior.
- Do not edit generated service URLs: `ecosystem.generated.cjs` and
  `terraform/environments/dev/service-urls.auto.tfvars.json` already contain the URL.
- Do not run another full `pnpm run ci:tracked` until focused env validation, service/config tests,
  static checks, and review are green.
- Preserve the five user-owned untracked files under `docs/superpowers/specs/`.

## Endpoint Changes

- Modified: none.
- Created: none.
- Removed: none.
- Unchanged: all public and internal WhatsApp and Message Digest routes.

---

### Task 1: Align bootstrap and verifier declarations

**Files:**
- Modify: `apps/whatsapp-service/src/index.ts`
- Modify: `scripts/verify-env-vars.mjs`
- Verify: `apps/whatsapp-service/src/config.ts`
- Verify: `ecosystem.generated.cjs`
- Verify: `terraform/environments/dev/service-urls.auto.tfvars.json`

**Interfaces:**
- Consumes: `validateRequiredEnv(REQUIRED_ENV)`, `COMMON_OPTIONAL_ENV`, and the existing generated
  `INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL` wiring.
- Produces: a startup declaration for the required URL and a static-verifier exemption only for the
  optional previous-token rotation key.

- [x] **Step 1: Capture the focused RED environment gate**

  Run:

  ```bash
  node scripts/verify-env-vars.mjs
  ```

  Expected: three findings representing two unique keys: one use of
  `INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL` and two uses of
  `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` in WhatsApp Service.

- [x] **Step 2: Prove the required/optional semantics and existing wiring**

  Confirm `configSchema` and `validateConfigEnv()` already require the Message Digest URL, while
  `buildServer()` conditionally includes the previous token only when it exists. Confirm the URL is
  already present in generated local and Terraform service URL maps, and the verifier treats
  generated `INTEXURAOS_*_URL` values as common service variables.

- [x] **Step 3: Declare the required Message Digest URL at startup**

  Add this exact entry to the base `REQUIRED_ENV` array in
  `apps/whatsapp-service/src/index.ts`, adjacent to service dependencies:

  ```ts
  'INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL',
  ```

  Do not make it conditional; WhatsApp Service always composes Message Digest authorization and
  outbound-delivery routes in this revision.

- [x] **Step 4: Register the previous token as optional rotation input**

  Add this exact entry to `COMMON_OPTIONAL_ENV` in `scripts/verify-env-vars.mjs`, next to the current
  internal-auth/service configuration entries:

  ```js
  'INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS',
  ```

  Do not add it to `REQUIRED_ENV` or give it an ecosystem fallback.

- [x] **Step 5: Run focused GREEN verification**

  Run:

  ```bash
  node scripts/verify-env-vars.mjs
  pnpm exec vitest run apps/whatsapp-service/src/__tests__/config.test.ts scripts/__tests__/verify-web-service-manifest.test.ts scripts/__tests__/ecosystem.config.test.ts
  pnpm --filter @intexuraos/whatsapp-service typecheck
  pnpm run typecheck:tests
  pnpm exec eslint apps/whatsapp-service/src/index.ts
  pnpm exec prettier --check apps/whatsapp-service/src/index.ts scripts/verify-env-vars.mjs docs/superpowers/plans/2026-07-29-whatsapp-message-digests-env-declaration-remediation.md
  git diff --check
  ```

  Expected: env verification reports no errors, all affected tests and typechecks pass, and no full
  CI run occurs.

- [ ] **Step 6: Review, resync, and run the final full gate**

  Ask one review-only subagent to verify the required/optional split and existing deployment wiring.
  Fix any accepted Critical or Important finding through a focused RED/GREEN cycle. Fetch
  `origin/development`, prove the branch base is still exact and current, then run
  `pnpm run ci:tracked` once more as the final full gate.

## Self-Review

- Spec coverage: both unique env findings map to one exact declaration each, and production startup
  semantics remain strict for the URL and rotation-safe for the previous token.
- Placeholder scan: all files, keys, commands, and outcomes are explicit; no deferred marker remains.
- Type consistency: the URL remains a required string in `Config`; the previous token remains an
  optional string in `ServiceConfig` and is never synthesized.

## Execution Choice

The user selected inline, sequential execution with review-only subagents. Continue in the current
session with `superpowers:executing-plans`; do not ask to switch execution modes.
