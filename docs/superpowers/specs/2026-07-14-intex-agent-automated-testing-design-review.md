# Intex Agent Automated Testing Program — Completeness Review

**Date:** 2026-07-14
**Review status:** Corrected design ready for user approval
**Reviewed artifacts:**

1. [Evaluation foundation](./2026-07-14-intex-agent-evaluation-foundation-design.md)
2. [Per-user model selection](./2026-07-14-intex-agent-user-model-selection-design.md)
3. [Session debug-to-regression skills](./2026-07-14-intex-session-regression-skills-design.md)
4. [Dedicated-account WhatsApp live canary](./2026-07-14-intex-agent-whatsapp-live-canary-design.md)

## Review Method

The review used four passes:

1. repository audit of the current Intex test endpoint, user settings, Auth0 conventions, WhatsApp/Matrix adapter, Meta webhook handling, LLM usage ownership, Nginx/OIDC policy, Terraform, and CI;
2. independent architecture review of the evaluation/model pipeline;
3. independent security/privacy review of Auth0, credentials, browser automation, and regression authoring;
4. independent transport review of the real Matrix → WhatsApp → Intex → Graph → Matrix round trip, followed by a second residual-gap review after corrections.

The review treats a signed webhook, HTTP `200`, Matrix event ID, Graph WAMID, or LLM-generated reply alone as insufficient evidence. A requirement is complete only when its owner, contract, trust boundary, failure state, test, retention behavior, and acceptance evidence are named.

## Requirement Coverage Verdict

| Requirement | Verdict | Design evidence |
| --- | --- | --- |
| Explain and remove the five-turn limitation | complete | It is identified as a route/body guard, not a domain limit; contracts accept 1–20 turns while the separate five-iteration tool loop remains unchanged. |
| Test exact 20-turn scenarios | complete | Endpoint boundaries, emulator scenarios, long-context cases, and a weekly real WhatsApp DeepSeek scenario are specified. |
| Real LLM with mocked downstream tools | complete | A data-driven evaluator calls the real classifier/runner through the existing internal endpoint with emulator state and bounded tool mocks. |
| Compare DeepSeek V4 Flash, MiniMax M3, and Gemini 3 Flash Preview | complete | One shared exact allowlist, tool conformance, per-model diagnostics, matrix runs, and release gates are specified. |
| Per-user Intex Agent model setting with existing settings UX | complete | Independent persistence, public read/update/reset contracts, revision-safe saves, internal resolution, runtime application, and browser verification are specified. |
| Session debug automatically becomes a test scenario | complete with authorization gate | Every investigation creates an in-memory/response synthetic draft; an explicitly change-authorized task may persist, execute, and register it automatically. Diagnosis-only work performs no write. |
| Add new regressions without editing workflow code | complete | Strict inert scenario discovery and candidate/blocking lifecycle replace per-case workflow edits. |
| Dedicated Auth0 and WhatsApp test identity | conditionally complete | Full lifecycle and code contracts are specified; tenant, mailbox, phone/SIM, bridge, and Meta state remain hard external prerequisites. |
| Automatic real-browser validation | conditionally complete | Protected Playwright Universal Login/settings/session tests are specified; execution requires an automation-safe Auth0 policy and provisioned secret. |
| No user-specific repository data | complete | Only synthetic JSON and aggregate metadata may be tracked; concrete identity/transport values remain in Secret Manager or private external state. |

## Findings and Corrections

| Severity | Finding | Resolution in corrected design |
| --- | --- | --- |
| Critical | Executable TypeScript scenarios could run arbitrary code in a secret-bearing job. | Scenarios are strict inert `.scenario.json`; authoring code runs secret-free and emits validated canonical JSON. Secret jobs run only immutable protected `development` commits. |
| Critical | The evaluation service could receive and exfiltrate the production OpenRouter key, and post-response accounting could overshoot a promised hard budget. | A dedicated provider-capped evaluation key is held only by an egress-restricted gateway. Test code receives a short-lived run credential; the gateway enforces model/token caps and atomically reserves conservative worst-case cost before each attempt. |
| Critical | A wrapper around aggregate LLM calls could not stop hidden retries, repairs, or tool-loop provider attempts. | Budget/deadline context and `beforeProviderAttempt` are propagated through every generate, retry, repair, judge, and tool-loop attempt with a remaining-budget `AbortSignal`. |
| Critical | A diagnosis-only session request was specified to write draft files and mutate the repository. | The mandatory automatic output is in-memory/in-response. Any private/tracked write or live execution requires original authority or separate approval; tracking additionally requires human synthetic-privacy approval. |
| Critical | WIF, Nginx, and app responsibilities were conflated, and one identity could read account/browser/transport secrets. | WIF enforces GitHub claims; Nginx verifies Google identity/routes; apps reverify. Four separate account, browser, transport, and finalizer/recovery identities have negative cross-role access, and direct backend access is blocked. |
| Critical | The live canary had no production-compatible, crash-safe way to select and restore a model. | User Service owns a fixture-bound model lease with field-presence/value/revision snapshot, server-side generation, per-turn verification, finalizer restore at a new revision, expired-lease janitor, and retained manual-recovery state. |
| Critical | Aggregate counts could not prove which Matrix/Meta reply belonged to each turn. | Every turn has an active nonce, reply token, preferred remote-WAMID join, exact stage chain, opaque correlation, and owned-ID cleanup manifest; the runner is sequential per turn. |
| Critical | Matrix membership did not prove that the room was the intended WhatsApp portal. | Active readiness validates bridge runtime/checkpoint/heartbeat and remote portal identity; unsupported bridge metadata requires a signed, configuration-bound bootstrap attestation. |
| Critical | LLM usage/cost and cleanup crossed service ownership without a contract. | Correlation reaches every provider attempt; persistence is awaitable; LLM Usage Service exposes sanitized run status, excludes canary data from user aggregates, and owns its 30-day TTL. |
| Important | Auth0 bootstrap, verification, blocked-state handling, rotation, and decommission were ambiguous. | Separate `bootstrap`, `ensure`, `rotate-password`, `unblock`, and `decommission` state transitions fail closed and define recoverable Secret Manager/Auth0 rotation. |
| Important | Auth0 Management scopes were described as connection-scoped although they are tenant-wide. | Tenant-wide blast radius is explicit; exact secret-supplied identity/connection/metadata constraints, duplicate-marker detection, audit, and M2M rotation are mandatory. |
| Important | The dedicated password had two possible sources of truth. | Secret Manager's `active` version is authoritative; any local `~/.intexuraos/logins.md` entry is an explicitly generated versioned cache only. |
| Important | The internal settings read exposed a broad settings envelope and could mask storage errors as defaults. | A narrow generic-path resolution endpoint returns only model/null and preserves missing-setting versus repository-failure semantics without putting UID in access-log paths. |
| Important | Rapid saves could persist an older user intent last, while legacy documents had no defined first revision. | Missing revision is `0`; public updates/reset require CAS and advance monotonically; the client serializes/collapses requests and retries only the newest intent after `409`. |
| Important | Raw session IDs, truncated content hashes, exact lengths, and workspace artifacts were privacy/linkability risks. | Per-turn model events use non-lookup correlations; hashes/lengths are removed; private artifacts live outside workspaces with `0700/0600` and automatic seven-day sweeps. |
| Important | Static privacy lint was overclaimed as proof that text was not copied from production. | Mechanical lint is separate from `unreviewed`/`approved_synthetic`; a human privacy review is required before tracking. |
| Important | Meta status-before-send, nonlinear status ordering, and best-effort outbound persistence could lose or misreduce evidence. | Durable pre-send control, transactional merges, deduplicated timestamped history, and a deterministic `pending/success/terminal_failure/conflict` reducer are required. |
| Important | Graph acceptance followed by process death could lose WAMID and a retry could send a duplicate. | A durable `graph_send_in_flight` attempt precedes Graph; unknown outcomes are never auto-resent and fail WAMID/delivery proof, with crash injection at the exact boundary. |
| Important | Cleanup could leave/corrupt aggregates, delete the only restore snapshot, or miss late events after runner loss. | Logical `leaseExpiresAt` is separate from TTL; owner recovery claims expired controls, restores/rebuilds exact manifests, retains unresolved obligations, then writes an immutable seven-day tombstone. |
| Important | Browser evidence could be cleaned before inspection or leak credentials through artifacts/assertions. | The job graph orders browser preflight → transport → browser evidence → report → cleanup; origins are pinned, contexts are ephemeral, assertions are secret-safe, and artifacts are denylist-scanned. |
| Important | One session/request-level model was ambiguous when settings can change between messages. | `model_resolved` and evaluation resolution diagnostics are per LLM-backed product turn; session metadata is explicitly only latest; regressions use the failing turn and canaries assert every turn. |
| Important | Canary APIs lacked a multi-turn state cycle, phase authorization, exact schemas, recovery, and stable errors. | Versioned strict envelopes, an exact N-turn cycle, server-owned generation, four phase identities, idempotent replay, only cleanup terminals, `409/429/503`, and immutable tombstone semantics are defined. |
| Important | Long-call and scenario deadlines could overrun each other. | Every provider attempt uses the smaller of stage and remaining scenario budget; HTTP/workflow timeouts reserve reporting/cleanup margin and P95 gates require measured approval. |
| Important | Candidate aging, `not_reproduced`, and pre-baseline UX semantics could block or pass incorrectly. | Scheduled age governance does not break unrelated PRs; `not_reproduced` blocks promotion but not authoring; a verdict matrix separates safety, absolute UX, baseline delta, and infrastructure. |
| Important | Firestore TTL/index/registry and technical-documentation surfaces were not enumerated. | Required implementation surfaces now include collection ownership, Timestamp TTL/indexes, env/startup/Terraform/Nginx, API docs, service technical docs, workflow tests, and redaction scans. |

## Hard External Blockers

These are intentionally not replaced by mocks. They must be satisfied before any live-pass claim:

1. Select the concrete `kontakt+<dedicated-alias>@pbuchman.com` address and prove mailbox deliverability. The base already matches the repository convention; the concrete alias/value remains outside Git.
2. Create and approve the Auth0 Management M2M application, database connection access, tenant login policy, verification-mail flow, and an automation-safe Universal Login path without mandatory interactive MFA/CAPTCHA/passkey/bot challenge.
3. Provision the dedicated SIM/consumer WhatsApp identity, complete the one-time Intex phone verification, and establish the private account/source mapping.
4. Pair that identity to the dedicated Matrix user through mautrix, configure the exact `intex_agent` portal, and make its remote identity/checkpoint/heartbeat machine-verifiable.
5. Verify the Meta app/WABA subscription for inbound messages and delivery-status webhooks and the deployed Graph sender/24-hour service path.
6. Provision the dedicated evaluation OpenRouter key with provider-side limits and the protected evaluation gateway/WIF identities.
7. Run preflight and three consecutive protected manual passes before enabling schedules. Any failed prerequisite returns `blocked`; no webhook injection is substituted.

## Completeness Conclusion

The corrected design is complete enough to proceed to a test-first implementation plan: it names the components, contracts, data ownership, trust boundaries, lifecycle states, cleanup, CI tiers, rollout order, and acceptance evidence for all requested capabilities.

It is not yet evidence that the external live environment works. That claim is deliberately gated on the seven blockers above, followed by a two-turn real round trip, protected browser evidence, exact 20-turn DeepSeek run, and cleanup/aggregate verification. No implementation plan should silently collapse those stages into a synthetic substitute.

Per the design workflow, implementation planning starts only after the user approves the corrected architecture and the selected canonical real-WhatsApp actuator: the existing Matrix/mautrix portal path.
