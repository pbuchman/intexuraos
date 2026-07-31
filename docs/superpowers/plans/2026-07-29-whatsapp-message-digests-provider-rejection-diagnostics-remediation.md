# WhatsApp Message Digest Provider Rejection Diagnostics Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify the Meta HTTP 400 rejection without exposing provider-controlled or private data,
then make exactly one tracked retry of the definitively failed local run.

**Architecture:** Keep the existing fail-closed delivery semantics and add only bounded numeric Meta
error metadata to the WhatsApp sender log. The application continues to discard provider-controlled
text, return the same public error, and retry only through the existing run/outbox lifecycle. A
successful retry proves that the approved template has propagated; another definitive rejection
ends this plan with the numeric code as input to a separate, evidence-specific remediation.

**Tech Stack:** TypeScript, Vitest, Fastify service logging, WhatsApp Cloud API v22.0, PM2, system
Google Chrome through the existing Message Digests tab.

## Global Constraints

- Work sequentially in the primary session; use subagents only for review.
- Do not run `pnpm run ci:tracked`, create a commit, push, deploy, or mutate production.
- Do not submit, edit, delete, or replace another Meta template.
- Do not log or return provider messages, error details, recipient numbers or recipient-derived
  hints, template parameters, source content, account IDs, tokens, WAMIDs, or response bodies.
- Preserve the current `PROVIDER_REJECTED` terminal state for HTTP 4xx and the existing ambiguity
  fences for timeouts/network failures.
- Use only the already-running system Chrome and only the pre-existing Message Digests tab. Preserve
  all SentryBox/Cloudflare tabs named in `/tmp/codex-sync`.
- The failed group run is safe to retry once because Meta returned HTTP 400 and the application
  persisted `PROVIDER_REJECTED` before an external effect. Do not retry any ambiguous outcome.
- No interim commit: the parent execution goal requires one final implementation commit after the
  single full-CI gate.

---

### Task 1: RED test for content-free provider metadata

**Files:**
- Modify: `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`
- Modify: `apps/whatsapp-service/src/infra/whatsapp/sender.ts`

**Interfaces:**
- Consumes: `WhatsAppCloudApiSender.sendMessageDigestTemplate(phoneNumber, template)` and the
  existing `whatsapp-sender` error logger.
- Produces: error log fields `providerCode?: number` and `providerSubcode?: number`; no public return
  contract changes.

- [x] **Step 1: Write the failing privacy-preserving test**

  Replace the synthetic response in `does not expose provider-controlled response text in logs or
  returned errors` with JSON whose `error.message` and `error.error_data.details` contain the
  private sentinels and whose only safe fields are integer `code: 132000` and
  `error_subcode: 2494010`:

  ```ts
  const providerText = JSON.stringify({
    error: {
      message: `Rejected ${recipient} ${normalizedRecipient}`,
      code: 132000,
      error_subcode: 2494010,
      error_data: { details: templateSentinel },
    },
  });
  ```

  Assert that the logger metadata contains:

  ```ts
  expect.objectContaining({
    status: 400,
    providerCode: 132000,
    providerSubcode: 2494010,
    errorClass: 'provider_response',
  })
  ```

  Explicitly assert that `recipientHint` and the suffix marker are absent. Keep the existing
  serialized-output assertions proving that neither phone representation nor any provider/template
  sentinel appears in logs or returned errors. Add a case where code fields are strings or unsafe
  numbers:

  ```ts
  const unsafeProviderText = JSON.stringify({
    error: {
      code: '132000',
      error_subcode: Number.MAX_SAFE_INTEGER + 1,
    },
  });
  ```

  Assert that neither `providerCode` nor `providerSubcode` is present in the logged metadata.

- [x] **Step 2: Run the exact RED test**

  Run:

  ```bash
  pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/infra/sender.test.ts -t "provider-controlled response text"
  ```

  Expected: FAIL because the current logger records status/byte count/class only.

- [x] **Step 3: Implement the minimal parser**

  Add a private helper in `sender.ts`:

  ```ts
  interface ProviderErrorMetadata {
    providerCode?: number;
    providerSubcode?: number;
  }

  function extractProviderErrorMetadata(responseText: string): ProviderErrorMetadata {
    try {
      const payload: unknown = JSON.parse(responseText);
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
      const error = (payload as Record<string, unknown>)['error'];
      if (typeof error !== 'object' || error === null || Array.isArray(error)) return {};
      const record = error as Record<string, unknown>;
      const code = record['code'];
      const subcode = record['error_subcode'];
      return {
        ...(isSafeProviderCode(code) ? { providerCode: code } : {}),
        ...(isSafeProviderCode(subcode) ? { providerSubcode: subcode } : {}),
      };
    } catch {
      return {};
    }
  }

  function isSafeProviderCode(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }
  ```

  Spread this object into the existing non-OK logger metadata after `response.text()` is read. Do not
  alter the returned `WhatsAppError`, provider response handling, timeout, or retry behavior.

- [x] **Step 4: Run GREEN and privacy coverage**

  Run:

  ```bash
  pnpm --filter @intexuraos/whatsapp-service exec vitest run src/__tests__/infra/sender.test.ts
  pnpm --filter @intexuraos/whatsapp-service typecheck
  pnpm exec eslint apps/whatsapp-service/src/infra/whatsapp/sender.ts apps/whatsapp-service/src/__tests__/infra/sender.test.ts
  pnpm exec prettier --check apps/whatsapp-service/src/infra/whatsapp/sender.ts apps/whatsapp-service/src/__tests__/infra/sender.test.ts docs/superpowers/plans/2026-07-29-whatsapp-message-digests-provider-rejection-diagnostics-remediation.md
  git diff --check
  ```

  Expected: all commands pass; no full workspace CI runs.

### Task 2: One tracked retry and evidence split

**Files:**
- Verify only: `scripts/hetzner/verify-whatsapp-message-digest-template.mjs`
- Runtime only: existing PM2 `whatsapp-service` process
- UI only: existing failed run
  `mdr_805cfb877bcb8608512d6d2d6df852c22678543e67150901`

**Interfaces:**
- Consumes: exact approved template preflight, correct WABA/phone binding evidence, existing
  `Retry delivery` action, and the durable run/outbox state.
- Produces: either one confirmed WhatsApp delivery with a WAMID retained only in application state,
  or one safe numeric provider code/subcode and no external message.

- [x] **Step 1: Restart only the local sender and recheck readiness**

  Restart `whatsapp-service` through its existing PM2 entry, confirm `/health` returns 200, and run
  the exact template verifier. Do not restart or change another agent's environment.

- [x] **Step 2: Retry exactly once through the same run page**

  In the already-running system Chrome, use the current run page. Click `Retry delivery`, inspect
  the confirmation dialog, then click its confirmation action once. Do not create another group run
  and do not call Meta directly.

- [x] **Step 3: Branch on persisted evidence**

  - If the run reaches `WhatsApp: Sent`, record the canonical run URL, verify exactly one received
    template message and its `View digest` CTA, and continue the parent goal's direct-digest check.
  - If the run again reaches definitive `Failed`, inspect only `providerCode` and
    `providerSubcode` from the newest sender log line, do not retry again, and create a new
    evidence-specific plan before changing the template or payload.
  - If the run becomes `ambiguous`, do not retry; verify the physical WhatsApp inbox and reconcile
    the existing outbox according to the parent recovery contract.

- [x] **Step 4: Keep coordination truthful**

  Update `/tmp/codex-sync` under its atomic lock with the safe result and whether shared Chrome is
  still in use. Keep the local validation lease until both temporary definitions are erased and the
  owned services are stopped.

## Self-Review

- Spec coverage: the plan diagnoses the observed provider-only failure, preserves privacy and
  exactly-once behavior, and does not broaden Meta or production mutation authority.
- Placeholder scan: every code and verification step is concrete; no deferred implementation marker
  remains.
- Type consistency: `providerCode` and `providerSubcode` are optional safe integers in both the
  test expectation and implementation interface; provider rejection metadata contains no
  recipient-derived field; public sender/result types remain unchanged.

## Execution Choice

The user already selected inline, sequential execution with review-only subagents. Execute this plan
in the current session using `superpowers:executing-plans`; do not ask to switch execution modes.
