# Intex Agent Dedicated-Account WhatsApp Live Canary Design

**Date:** 2026-07-14
**Status:** Proposed for user review
**Program order:** 4 of 4

## Purpose

Create one long-lived, isolated integration identity and an automatic live canary that proves the real round trip:

```text
trusted runner
  -> WhatsApp Service canary route
  -> Matrix adapter and Synapse portal room
  -> mautrix-whatsapp and dedicated consumer WhatsApp account
  -> Meta/WhatsApp and the Intex business webhook
  -> WhatsApp Service and Intex Agent
  -> selected real LLM
  -> WhatsApp Cloud API reply
  -> dedicated consumer WhatsApp account
  -> mautrix-whatsapp, Matrix, and the private mirror
```

The same dedicated Auth0 account is used for automated Universal Login and browser verification. This live canary complements, but does not replace, the emulator-backed [evaluation foundation](./2026-07-14-intex-agent-evaluation-foundation-design.md), [per-user model selection](./2026-07-14-intex-agent-user-model-selection-design.md), and [session-regression workflow](./2026-07-14-intex-session-regression-skills-design.md).

## Current State

The repository already contains most of the transport path:

- `POST /internal/whatsapp/private/outbound-matrix-messages` resolves an Auth0 user to an active private WhatsApp account and sends a Matrix text event to the fixed `intex_agent` target.
- `startNewSession: true` adds the production `new session:` command.
- `idempotencyKey` becomes the Matrix transaction ID.
- `tools/whatsapp-private-matrix-sync` resolves `sourceAccountId -> intex_agent -> Matrix room`, posts the Matrix event, and relies on Synapse/mautrix-whatsapp to deliver it through the real consumer WhatsApp account.
- The normal Meta webhook, phone-to-user mapping, Pub/Sub ingest, Intex session path, OpenRouter call, Pub/Sub reply, and Graph API sender then run.
- The returning WhatsApp reply is mirrored by mautrix into Matrix and ingested into the user's private WhatsApp mirror.

This is a real WhatsApp actuator only when the mapped room is the mautrix portal for the Intex business phone and the Matrix access token belongs to the Matrix user paired to the same dedicated consumer WhatsApp account. An arbitrary Matrix room proves Matrix delivery only.

The existing readiness route checks configuration and target mapping but does not contact Synapse, verify the room, check mautrix login, check the normal assistant phone mapping, or prove Meta delivery. Its `ready` result is therefore insufficient as a canary verdict.

Status webhooks from Meta are accepted by the webhook schema but currently take the `no_sender` path and are marked ignored. A returned Graph `wamid` proves acceptance, not delivery.

## Goals

1. Provision and retain exactly one dedicated Auth0 database user for integration tests.
2. Permanently map that user to exactly one dedicated consumer WhatsApp phone.
3. Permanently pair the same WhatsApp identity through mautrix to a dedicated Matrix user and `intex_agent` portal.
4. Send real user-authored messages through the existing Matrix-to-WhatsApp path without browser/device automation per run.
5. Verify the returning assistant message in the private mirror, proving the full Meta round trip.
6. Correlate Intex session state, resolved model, Graph submission, and Meta delivery status for stage-specific diagnosis.
7. Support both a two-turn transport smoke and an exact 20-turn long-context scenario.
8. Run the 20-turn scheduled canary on DeepSeek V4 Flash, with all three models covered by emulator-backed conformance and a release-time two-turn live matrix.
9. Log in through Auth0 Universal Login and verify settings/session state in a real browser automatically.
10. Keep credentials and account-specific identifiers out of the repository.

## Non-Goals

- A signed synthetic webhook is not considered a full live pass.
- A Matrix `event_id`, Intex assistant event, or Graph `wamid` alone is not considered a full live pass.
- The canary does not test a physical handset UI or WhatsApp Web UI.
- The canary does not create notes, calendar events, bookmarks, research drafts, code tasks, or prompt preferences.
- The account is not created and deleted per test.
- The canary is not available to pull-request code from forks or other untrusted refs.
- Account bootstrap is not claimed automatic until the external Auth0 and WhatsApp prerequisites below exist.

## Considered Inbound Actuators

### A. Existing Matrix/mautrix outbound endpoint — selected

This is already implemented, accepts an idempotency key, and can send as a paired consumer account into the real WhatsApp portal. It avoids automating a phone on every run and opens the real 24-hour customer-service window.

Trade-offs:

- Synapse, mautrix, and bridge state live outside this repository;
- the bridge must remain paired and reachable;
- it proves a real WhatsApp round trip but not handset UI behavior;
- mautrix is an operational dependency whose session can be revoked.

### B. Signed Meta-shaped webhook injection

This tests HMAC verification, persistence, mapping, Pub/Sub, Intex, and Graph submission, but bypasses Meta inbound transport and does not open the actual 24-hour window.

Decision: keep as a lower-level integration test, never label it live end to end.

### C. Dedicated device or WhatsApp Web automation

This would exercise a client UI but adds device-farm state, QR/session management, UI selectors, and a brittle automation surface already avoided by the available Matrix bridge.

Decision: defer unless handset UI itself becomes a product requirement.

### D. A second Cloud API business sender

This is an official programmatic sender but requires another WABA/phone/token and validation that business-to-business delivery behaves as the consumer mapping expects.

Decision: defer. It remains the replacement if the existing mautrix bridge is not accepted operationally.

## Hard External Prerequisites

Implementation can prepare code and infrastructure containers, but a live pass is blocked until all of these are true:

1. One concrete `kontakt+<dedicated-alias>@pbuchman.com` address is selected and proven able to receive account/security mail. The base matches the repository convention; only the concrete plus alias and deliverability remain external bootstrap inputs and are never committed.
2. An Auth0 tenant administrator creates a confidential Management API application with only `read:users`, `create:users`, and `update:users`. These Management API scopes are tenant-wide, not database-connection-scoped, so the provisioner must hard-code and fail closed around the one secret-supplied e-mail, expected connection, Auth0 subject, and metadata markers. `delete:users` is not granted to routine automation.
3. Auth0 enables the database connection for the SPA and the test account can log in without an interactive MFA, CAPTCHA, passkey, or bot-protection step that a protected browser job cannot complete.
4. A dedicated SIM/phone number and consumer WhatsApp account exist. The phone cannot be shared with a personal user because mappings are globally unique.
5. The dedicated phone completes the one-time IntexuraOS six-digit WhatsApp verification and remains connected to the Auth0 user.
6. A private WhatsApp mirror account exists for that user and resolves to its own `sourceAccountId`.
7. A dedicated Matrix user is paired through mautrix to that same consumer WhatsApp account.
8. The `intex_agent` target maps to the mautrix portal for the configured Intex business number.
9. The Matrix adapter is reachable from the deployed WhatsApp Service and has a valid homeserver URL, Matrix access token, adapter auth token, target file, and bridge state.
10. The Meta app/WABA is subscribed to message and delivery-status webhooks for the configured business number.
11. Each protected workflow identity can read only its role-specific secrets and call only its role-specific routes.

There is no safe code-only substitute for the phone/SIM, WhatsApp pairing, Meta state, Auth0 tenant administration, or automation-safe login policy. If any preflight fails, the result is `blocked` with the failed prerequisite; no synthetic request is substituted.

## Dedicated Auth0 Account Lifecycle

### Identity

Use one deterministic plus-address supplied at bootstrap. The concrete e-mail, Auth0 subject, and password are secret values and never appear in source, Terraform variables committed with values, reports, screenshots, or logs.

Tag the Auth0 record:

```json
{
  "app_metadata": {
    "managedBy": "intexuraos-integration-tests",
    "purpose": "intex-agent-whatsapp-canary",
    "lifecycle": "long-lived"
  }
}
```

### Provisioner states and commands

The account tool exposes separate protected operations; `ensure` never creates, rotates, verifies, unblocks, or deletes implicitly:

- `account bootstrap` — resumable one-time create with a generated policy-compliant password, `email_verified = false`, exact database connection, and exact metadata; trigger the tenant's verification-mail job and stop as `pending_email_verification` until the mailbox link is completed;
- `account ensure` — idempotent verification plus only the explicitly approved metadata repair; fail closed on missing account, blocked state, unverified e-mail, wrong connection/subject, password-policy drift that requires rotation, or marker mismatch;
- `account rotate-password` — recoverable Secret Manager/Auth0 transaction described below;
- `account unblock` — separately approved tenant-owner action that records an audit reason; routine reconciliation never reopens a security-blocked account;
- `account decommission` — disable first, revoke sessions/credentials, remove mappings through their owners, then use a separately privileged administrator for deletion.

The idempotent, manual/protected implementation:

1. obtains an Auth0 Management token through client credentials;
2. looks up the exact e-mail;
3. searches tenant-wide for the unique `managedBy`/`purpose` markers and rejects zero/multiple or a marker/e-mail mismatch as appropriate for the operation;
4. creates a `Username-Password-Authentication` user only in `bootstrap`;
5. rejects an existing user without the exact `managedBy` and `purpose` markers;
6. reconciles only approved metadata and never changes blocked state in `ensure`;
7. verifies the resulting connection, subject, and email-verification state;
8. requires a completed mailbox verification before readiness; an exceptional tenant-owner verified-import decision is a separate audited action and is never silently inferred;
9. writes no secret value to stdout, stderr, test artifacts, or Git.

Bootstrap creates a candidate Secret Manager version and moves only a `bootstrap-pending` alias before calling Auth0. The Auth0 record carries a non-secret provisioning ID. If Auth0 creation fails definitively, the candidate is destroyed; if creation succeeds or its response is ambiguous, a rerun finds the exact marked account plus the same pending alias and resumes verification/login instead of generating another password. After mailbox verification, a protected Universal Login proves the candidate, `active` is moved atomically, and `bootstrap-pending` is removed. Any mismatch between account marker/provisioning ID and pending secret fails closed for tenant-owner recovery.

Password creation/rotation is not part of every canary. Rotation creates a candidate Secret Manager version without moving the `active` alias, updates Auth0, proves a fresh Universal Login with that candidate, atomically moves the alias, and only then disables the old version after a rollback window. A failed Auth0 update destroys the candidate; a post-update failure keeps the candidate addressable for retry instead of losing the only valid password. Password-policy, verification-mail, login, and secret-version failures have distinct blocker codes. Rotation is quarterly and on suspected compromise.

Management M2M credentials have their own rotation, audit, and decommission procedure. The account is disabled, then deleted only through `decommission`; routine tests never delete it.

### Why not browser-driven signup

Universal Login signup remains a one-time manual fallback. It is not the primary provisioner because duplicate detection, email verification, bot protection, password rotation, and partially completed signup are not reliably idempotent. Browser automation is used to test login and product settings after provisioning.

## Secrets and Infrastructure

Terraform creates or imports the authoritative Secret Manager containers and least-privilege access for these categories, without storing values in Git:

- Auth0 Management client ID/secret and audience;
- dedicated account e-mail, password, and Auth0 subject;
- live-canary expected environment and base URL;
- account/browser/transport/finalizer Google service-account identities and audiences;
- Intex/WhatsApp live-canary user subject injected into the two services;
- existing Matrix adapter URL/auth-token references.

Phone number, `sourceAccountId`, Matrix user ID/access token, portal room ID, WhatsApp bridge session, target mapping, and expected remote portal identity remain in Secret Manager or the external Matrix host's mounted secret files. Existing containers are imported into one ownership model rather than duplicated. None is committed.

Create four dedicated Google service accounts with separate WIF providers/bindings, protected environments, IAM, secrets, and route policies:

- account-lifecycle identity — may read the Auth0 Management credentials and create versions/aliases only in the dedicated password secret; it cannot call transport routes;
- browser identity — may read only the dedicated login e-mail/password and browser base/origin configuration, plus submit browser evidence; it cannot read Auth0 M2M, Matrix, Meta, or transport secrets;
- transport identity — may create/poll a run, acquire/read the bounded model lease, and call send/readiness/status routes; it cannot submit browser/report evidence, restore/clean up, or read Auth0/browser credentials;
- finalizer/recovery identity — may submit the sanitized report, restore an existing model lease, invoke owner-service cleanup/recovery, and read sanitized statuses; it cannot create/send a turn or read Auth0/browser credentials. The same identity is used by the scheduled recovery trigger under a separate exact audience.

Account/phone/Matrix identifiers needed by services are injected server-side and are not exposed to any runner.

Every binding is restricted to:

- the exact repository;
- `development` scheduled/manual workflows;
- the protected `intex-agent-live-canary` environment;
- the exact workflow file/ref conditions;
- access to only its role-specific secrets/routes.

Do not reuse the Cloud Build account with project-wide Secret Manager access. Repository, workflow, ref, and protected-environment claims are enforced by each GitHub Workload Identity Federation provider before it permits impersonation of its dedicated Google service account. Nginx can verify only the resulting Google issuer, audience, and dedicated service-account identity; it must deny the `/live-canary/` prefixes before the broad internal allowlist and authorize each identity only for its exact route patterns.

The edge strips any caller-supplied canary-principal header, forwards the verified Google identity token in a dedicated trusted header, and injects the ordinary internal credential separately. Each app verifies the forwarded token's signature, audience, expiry, and exact route-appropriate service-account subject in addition to internal auth. Direct network access to the backend is blocked, so callers cannot bypass the edge or forge that header.

## Narrow Live-Canary APIs

The runner must not receive a generic ability to supply any `userId` to the existing Matrix route or to query raw private messages. Add dedicated routes whose user is resolved from server-side secret configuration.

All routes:

- require internal authentication and the route-specific canary principal at the edge;
- use contract version `2026-07-14`, reject unknown fields, and return stable machine error codes;
- return `404` when the canary user configuration is absent;
- accept `runId` matching `intex-canary-[a-z0-9-]{8,80}` only;
- expose no e-mail, phone, user ID, source account, room ID, message content, WAMID, or provider response;
- are rate limited and serialized for one active run;
- reject production use by any other principal.

Phase authorization is deny-by-default:

| Identity | Allowed live-canary operations |
| --- | --- |
| Browser | submit `browser` evidence only; normal SPA access remains user-authenticated |
| Transport | readiness, create/poll run, acquire/read model lease, send the next valid turn, read Intex/WhatsApp status |
| Finalizer/recovery | submit `report` evidence, read status/usage, restore model lease, invoke cleanup/recovery |
| Account lifecycle | no live-canary application route; Auth0/Secret Manager lifecycle only |

No identity can both initiate new transport traffic and finalize/recover a run.

`409` represents an active-lease/state/idempotency/model conflict, `429` represents the route-specific rate limit, and `503` represents a named failed prerequisite. Poll responses use `Retry-After`; only `cleaned` and `cleanup_failed` are lifecycle-terminal.

### Run lease and state machine

Before selecting a model or sending a message, create a run:

```http
POST /internal/whatsapp/live-canary/runs

{
  "runId": "intex-canary-20260714-ab12cd34",
  "scenarioId": "deepseek-20-turn"
}
```

The transport identity generates a non-guessable run ID with at least 128 random bits. WhatsApp Service transactionally acquires the single active fixture lease and stores mutable control in `whatsapp_live_canary_runs`, an explicitly registered WhatsApp-owned collection. It returns no cross-job capability. Every operation is authorized by its phase-specific Google identity; the service owns an internal monotonically increasing `leaseGeneration`, and every transaction re-reads and validates the active run, generation, state, role, and idempotency record before committing. A transaction that raced a generation/state change revalidates and fails rather than acting as a stale worker.

The multi-turn state machine is:

```text
created -> model_leased
  -> turn_sending(0) -> turn_awaiting_evidence(0) -> turn_complete(0)
  -> turn_sending(N) -> turn_awaiting_evidence(N) -> turn_complete(N)
  -> transport_complete -> browser_evidence_complete -> report_complete
  -> cleanup_pending -> cleaned | cleanup_failed
```

The `N` cycle repeats exactly for the scenario's remaining indexes. A separate `behavioralVerdict = pending | pass | fail | blocked` records test outcome. Failure/cancellation at any phase records the verdict/error and transitions to `cleanup_pending`; it is not lifecycle-terminal. The mutable active record has `leaseExpiresAt` but no Firestore TTL field. The repository-standard `Timestamp expireAt` is assigned only to finalized records, so TTL can never delete the restore snapshot or cleanup manifest.

Before the first send, WhatsApp Service reads the narrow user-service lease status server-to-server and moves the run to `model_leased` only when model/revision/run all match. The browser identity may submit only `{ type: 'browser', digest: 'sha256:<hex>' }`; the finalizer identity may submit only `{ type: 'report', digest: 'sha256:<hex>', verdict: 'pass' | 'fail' | 'blocked' }`. No token passes through GitHub outputs. A passing report requires the complete success-state sequence. A failing/blocked report may close any active phase after job failure/cancellation and moves directly toward cleanup; it cannot claim skipped evidence or alter per-turn results.

After owner-service cleanup/rebuild completes, WhatsApp Service writes an immutable `whatsapp_live_canary_tombstones` record with the verdict, sanitized per-turn outcome, cleanup result, final generation, and `Timestamp expireAt` seven days later. Only then is mutable control removed. Status reads fall back to the tombstone, preserving `cleaned`, late-event fencing, and audit evidence.

The shared contract validates exact response envelopes:

```ts
type LiveCanaryRunState =
  | 'created'
  | 'model_leased'
  | 'turn_sending'
  | 'turn_awaiting_evidence'
  | 'turn_complete'
  | 'transport_complete'
  | 'browser_evidence_complete'
  | 'report_complete'
  | 'cleanup_pending'
  | 'cleaned'
  | 'cleanup_failed';

interface LiveCanaryTurnStatus {
  turnIndex: number;
  correlation: string;
  matrixAcknowledged: boolean;
  outgoingMirrorMatched: boolean;
  metaIngressMatched: boolean;
  intexInputMatched: boolean;
  graphSubmissionOutcome: 'pending' | 'accepted' | 'outcome_unknown' | 'failed';
  delivery: {
    outcome: 'pending' | 'success' | 'terminal_failure' | 'conflict';
    sentAt: string | null;
    deliveredAt: string | null;
    readAt: string | null;
    failures: Array<{ occurredAt: string; code: string }>;
  };
  returnMirrorMatched: boolean;
  model: IntexAgentModel | null;
  modelResolutionSource: 'user_setting' | 'default' | 'fallback' | null;
  duplicateCount: number;
  cleanupManifestComplete: boolean;
  errorCodes: string[];
}

interface LiveCanaryRunStatus {
  contractVersion: '2026-07-14';
  runId: string;
  scenarioId: 'transport-smoke' | 'deepseek-20-turn';
  state: LiveCanaryRunState;
  currentTurnIndex: number | null;
  behavioralVerdict: 'pending' | 'pass' | 'fail' | 'blocked';
  turns: LiveCanaryTurnStatus[];
  cleanupState: 'not_started' | 'running' | 'complete' | 'failed';
}

interface LiveCanaryError {
  contractVersion: '2026-07-14';
  error: { code: string; retryable: boolean };
}
```

Every object schema is strict. `turns` must contain exactly the selected scenario's unique indexes in ascending order.

### WhatsApp readiness

```http
GET /internal/whatsapp/live-canary/readiness
```

Returns separate booleans/codes for:

- normal assistant mapping connected;
- private account active;
- adapter configured/reachable;
- Matrix token accepted;
- target room joined;
- target mapping present;
- bridge runtime running with a persisted non-empty `/sync` checkpoint;
- fresh successful Matrix sync and private-ingest heartbeat;
- portal metadata matches the expected remote Intex business identity;
- normal assistant mapping, private account, bridge login, and expected portal identity normalize to the configured identities.

Add an adapter-local active probe that calls Matrix `/account/whoami`, checks membership/access to the configured target room, reads the bridge/portal room state or provisioning metadata, and compares its remote JID/phone identity with the expected secret value without returning it. If the installed bridge cannot expose portal identity mechanically, bootstrap must create a signed attestation bound to the room/configuration hash and expected remote identity; any room/target/bridge change invalidates it and blocks sends until re-attested. Keep configuration-only readiness distinct. Neither probe claims live Meta readiness; only the completed round trip does.

### Send one turn

```http
POST /internal/whatsapp/live-canary/messages
Content-Type: application/json

{
  "runId": "intex-canary-20260714-ab12cd34",
  "scenarioId": "deepseek-20-turn",
  "turnIndex": 0
}
```

The route accepts only the transport identity. It resolves the configured canary user and uses a shared, deterministic canary contract plus a server-created cryptographically random per-turn nonce to generate the exact bounded synthetic text, `startNewSession`, strict run/turn marker, required assistant reply token, and idempotency key. It accepts only `transport-smoke` and `deepseek-20-turn`; turn indexes are validated against the run's immutable scenario/current state. It creates the per-turn control record before sending, delegates to the existing Matrix gateway with target `intex_agent`, persists the exact resulting document/event IDs, and returns only state plus an opaque HMAC correlation. The canary principal cannot submit arbitrary prompt text or manufacture canary correlation by copying a public marker.

An identical `(runId, turnIndex)` replay under the transport identity returns the existing turn state and never sends twice. The runner sends turn `N + 1` only after every required stage for turn `N` reaches its success state.

### WhatsApp run status

```http
GET /internal/whatsapp/live-canary/runs/:runId
```

Returns the run state and one sanitized entry for every expected turn, not aggregate counts alone. Each entry contains `turnIndex`, an opaque HMAC correlation, exact-stage booleans for Matrix acknowledgement, outgoing mirror, Meta ingress, Intex input, and returning private mirror; explicit Graph/delivery outcomes; duplicate/failure codes; and cleanup-manifest completeness. It returns neither raw IDs nor message text.

The preferred return-bridge join is remote WAMID metadata exposed by mautrix and matched to the stored Graph WAMID. When that metadata is unavailable, the required unique per-turn assistant reply token must be present in the Graph-submitted reply and returning private-mirror message, in the same portal, after the corresponding user ingress and before the next turn. The control record stores HMACs and exact owned document IDs for cleanup. Counts without this per-turn chain cannot pass.

### Intex run status

```http
GET /internal/intex-agent/live-canary/runs/:runId
```

Returns:

- one opaque session correlation;
- resolved model and resolution source for every LLM-backed product turn;
- user/assistant turn counts;
- session transition/status counts;
- fallback, clarification, tool-call, and LLM-failure counts;
- expected-token match booleans;
- duration, tokens, and cost;
- cleanup state.

It resolves the configured canary user server-side and never returns event/message content.

### Canary-only model lease

The live path has no production per-message model override. Add route-scoped user-service operations that resolve only the secret-configured fixture user:

```http
POST /internal/users/live-canary/model-leases
GET /internal/users/live-canary/model-leases/:runId
DELETE /internal/users/live-canary/model-leases/:runId
```

Create accepts only the transport identity and `{ runId, model }`, where `model` is one of the three exact `IntexAgentModel` values. A Firestore transaction acquires an active lease with internal `leaseGeneration`/`leaseExpiresAt`, snapshots the previous field presence/value and revision, writes the requested model at revision `R + 1`, and reads it back. It returns no cross-job token. While the fixture lease is active, ordinary settings mutations for that dedicated account return `409`; other users are unaffected. Get is available to transport/finalizer identities and returns only requested/effective model, revision, expiry, and drift status.

Delete accepts only the finalizer/recovery identity. It restores the prior field presence/value at a new monotonically increasing revision when the current model/revision still match the lease, then writes a finalized lease tombstone. It never rewinds the revision to the snapshot's old number. Drift causes `cleanup_failed`; the snapshot remains encrypted/server-side for manual recovery rather than overwriting a concurrent human change.

The runner acquires and verifies the model lease before the first message and checks the per-turn `model_resolved` event after every turn. Any different/missing model is `model_drift` and stops the next send. The finalizer restores the snapshot; the transport job receives no browser/Auth0 password or restore capability.

An owner-service janitor transactionally claims an expired unfinalized lease by incrementing its generation and runs the same restore rule. Active leases have no TTL `expireAt`. If drift prevents automatic restore, the janitor retains `cleanup_failed`, the encrypted snapshot, and a 30-day manual-recovery deadline; TTL never deletes an unfinalized restore obligation.

### Cleanup

```http
DELETE /internal/whatsapp/live-canary/runs/:runId
DELETE /internal/intex-agent/live-canary/runs/:runId
```

Deletion accepts only the finalizer/recovery identity and is restricted to the exact document-ID cleanup manifest captured by the run. It verifies both the configured canary user and exact `canaryRunId` on every document. It is idempotent, reports counts by owning service, and cannot delete the account, phone verification, normal mapping, private account, Matrix configuration, or prompt/model settings. Mutable control remains until every owner confirms cleanup/rebuild and the immutable seven-day tombstone is written; retries read the control, while completed status reads the tombstone.

## Run Correlation and Status Projection

Use a marker such as:

```text
[INTEX-CANARY:intex-canary-20260714-ab12cd34:T00]
```

Only an active fenced control record created by the server may assign `canaryRunId` and `turnIndex`. A message must belong to the configured user/source account and match its one-time nonce; marker text alone is never trusted. Propagate the guarded fields through WhatsApp message persistence, Intex ingest, per-turn session/events, outbound records, usage correlation, and private-mirror records. Ordinary user messages containing the string receive no canary privileges or cleanup behavior.

Update outbound tracking so Meta status webhooks are no longer ignored:

- status events are handled before sender extraction;
- create a durable run/turn-owned send-attempt record before Graph with state `prepared`, then atomically claim `graph_send_in_flight` before the network call;
- persist the Graph WAMID on the send side with transactional merge/retry and mark `accepted`; a canary Graph send is not complete until this correlation succeeds;
- `whatsapp_outbound_messages/{wamid}` uses merge semantics on both send and webhook paths so a status racing the original save is not lost;
- persist an idempotent timestamped status history, failure code/title when present, and Timestamp TTL; do not force `failed` into a simplistic linear `sent < delivered < read` ordering;
- query all outbound messages by exact per-turn control correlation and canary run;
- retain raw WAMID only in Firestore for correlation and return no raw WAMID in canary artifacts.

WhatsApp Graph does not provide a client idempotency key for this send. If the process loses the outcome after entering `graph_send_in_flight` and before committing the WAMID, redelivery never automatically resends. It marks `graph_send_outcome_unknown`; a returning reply token may diagnose that delivery probably occurred, but the run still fails Graph-WAMID/delivery-status proof. Crash-injection immediately after Graph acceptance is a required test. This guarded behavior applies only to synthetic canary-correlated sends.

Status events are deduplicated by an HMAC fingerprint over WAMID, provider status, provider timestamp, and normalized failure code. The projection retains earliest `sentAt`, `deliveredAt`, and `readAt` plus all sanitized failure evidence. The deterministic reducer is:

- `pending` when there is no delivered/read/failure evidence, including `sent` only;
- `terminal_failure` when failure evidence exists and no delivered/read evidence exists;
- `success` when delivered/read evidence exists and every failure timestamp is strictly earlier than the latest success timestamp;
- `conflict` when failure evidence is simultaneous with/later than success or timestamps cannot establish ordering.

Late/duplicate `sent` never downgrades another outcome. A live pass requires `success`; `conflict`, `terminal_failure`, and `pending` are non-passing. Failure codes returned by the API use a fixed sanitized allowlist and never expose provider titles/details.

Direct non-Intex messages such as phone-verification messages may create status-only TTL records. They are not misclassified as canary traffic.

Extend the LLM usage contract with guarded `canaryRunId`, `turnIndex`, and provider-call correlation for classifier, repairs, and runner iterations. The usage sink exposes an awaitable flush for the live verdict. LLM Usage Service owns status/retention; Intex and WhatsApp do not directly query or delete its collection.

## Automatic Scenarios

### Scheduled two-turn transport smoke

Run at least daily on the configured production target:

1. Turn 1 starts a new session with a unique marker and asks for the exact server-generated turn reply token without calling or writing a tool.
2. Turn 2 asks the agent to identify the exact synthetic marker and emit its new per-turn reply token from the current session without calling or writing a tool.

Pass requirements:

- both Matrix sends acknowledged;
- each user turn has the complete per-turn Matrix → Meta → Intex correlation chain in one Intex session;
- two assistant replies generated with no fallback/LLM failure/tool call;
- turn 2 reply contains the required synthetic marker;
- both Graph sends accepted;
- final Meta status is `delivered` or `read` for both replies;
- both replies return as `incoming` private-mirror messages in the same portal chat and match their unique reply token or verified remote WAMID;
- no duplicate user or assistant turn.

### Weekly exact 20-turn DeepSeek scenario

Run serialized with the dedicated user's model fixed to `or:deepseek/deepseek-v4-flash`.

- Turn 1 starts a new session.
- Turns 1-19 each provide a deterministic synthetic slot/token and ask for an acknowledgement within the current session only, explicitly forbidding persistence or tool use.
- Turn 20 asks for selected earlier tokens in a fixed order.
- Every turn carries its strict run/turn marker.

Pass requirements add:

- exactly 20 user and 20 assistant messages;
- one continuing session unless a domain-defined session transition is expected;
- no tool call, clarification, fallback, or downstream resource;
- effective model is DeepSeek V4 Flash for all LLM-backed turns;
- final answer contains the required long-context tokens;
- every assistant reply completes the real WhatsApp round trip;
- total duration and cost remain within `45 minutes` and `USD 1.00`.

The workflow timeout is 60 minutes so report and cleanup have margin. The 45-minute behavioral gate is provisional: scheduling is not enabled until a manual 20-turn pilot measures end-to-end P95 and three consecutive runs satisfy it. Any later budget change is a reviewed baseline decision, not an automatic timeout increase.

The existing five-iteration limit inside one LLM tool loop remains unchanged.

### Three-model release smoke

Before releasing a model option, acquire the model lease, run the two-turn live scenario once for that selected model, verify every turn's `model_resolved` event, and restore the exact previous setting snapshot in `finally`. The emulator-backed evaluation matrix remains the primary behavioral comparison across all three models; the live release smoke proves that per-user resolution reaches the deployed WhatsApp path.

## Browser Automation

Add a protected Playwright suite. It is the authoritative automatic browser gate. A final in-app-browser inspection during implementation handoff is supplementary and occurs only after a human authenticates the dedicated account or provides an already authenticated browser session; the agent never extracts or reuses the password outside the protected runner.

Automated browser flow:

1. Open the real SPA login route.
2. Complete Auth0 Universal Login with the dedicated secret credentials.
3. Verify the expected test account is authenticated without displaying its e-mail in artifacts.
4. Open LLM settings.
5. Select DeepSeek V4 Flash, wait for save, refresh, and verify persistence.
6. Verify WhatsApp Assistant mapping and Private WhatsApp Mirror report connected/active.
7. Release the ephemeral preflight browser context, then let the credential-separated transport job run the canary.
8. Start a new ephemeral browser context, complete Universal Login again, and open the matching WhatsApp Assistant session.
9. Verify the displayed effective model, turn count, event outcome, and absence of fallback.
10. For the long scenario, verify the session shows all 20 user turns and replies.
11. Verify the approved steady model after the transport's exact-snapshot restore.

Session detail UI must display the latest model plus each LLM-backed turn's effective model from `model_resolved` events so the browser test does not infer it from configuration alone.

Browser controls:

- no trace, video, storage-state, console body, or screenshot containing credentials/account e-mail is uploaded;
- screenshots used as evidence must exclude or mask identity UI;
- password is read only from the protected secret at runtime;
- before entering a password, assert an exact allowlist of SPA and Auth0 scheme/host/origin values; redirects outside it fail closed;
- use a new ephemeral browser context for each login and destroy it without writing cookies, local storage, HAR, trace, video, or DOM dumps;
- use secret-safe custom assertions whose failure messages cannot serialize input/DOM values, followed by a denylist scan of every retained artifact;
- no ROPG shortcut or mocked token is accepted;
- Auth0 MFA/CAPTCHA/bot challenge is a named external blocker, not bypassed.

Account bootstrap, password rotation, browser login/settings mutation, model leases, and transport runs share one external concurrency lock for the fixture. Browser credentials remain available only to protected browser jobs; transport and finalizer/report jobs cannot read them.

## Runner and Workflow

Create `@intexuraos/intex-agent-canary-contract` as a small private shared package containing the two scenario IDs, exact turn counts, deterministic synthetic text builder, run/turn marker parser, and request/response types. WhatsApp Service and the runner import this package so the server-side prompt allowlist cannot drift from the client's expectations. The package has no credentials, network code, or account identifiers.

Create a private workspace package:

```text
tools/intex-agent-live-canary/
  src/
    cli.ts
    auth0Provisioner.ts
    readiness.ts
    scenarios.ts
    matrixSender.ts
    pollIntexStatus.ts
    pollWhatsAppStatus.ts
    verdict.ts
    cleanup.ts
    redactReport.ts
  __tests__/
```

Commands:

- `account bootstrap` — protected/manual one-time creation and verification-mail start;
- `account ensure` — protected/manual fail-closed reconciliation;
- `account rotate-password` — protected/manual rotation;
- `account unblock` — separately approved unblock;
- `account decommission` — separately privileged teardown;
- `preflight` — no message send;
- `run --scenario transport-smoke --model <model>`;
- `run --scenario deepseek-20-turn`;
- `cleanup --run-id <id>`;
- `browser-smoke` — Playwright Universal Login/settings/session check.

Workflows:

- static unit/schema/workflow tests run on ordinary PRs without live secrets;
- `intex-agent-live-canary.yml` runs on protected `workflow_dispatch` and schedule only;
- all account lifecycle operations are separate manual protected jobs;
- `concurrency.group` serializes the dedicated account;
- the explicit dependency graph is `browser preflight -> model lease/transport -> browser session evidence -> sanitized report -> cleanup (always)`; `runId` is a non-secret job output and no browser secret crosses jobs;
- cleanup runs under `if: always()` only after every evidence-producing dependency reaches success, failure, or cancellation;
- finalization attempts exact model-snapshot restore first, then Intex cleanup, then WhatsApp/private cleanup, and records every independent failure before retaining the run tombstone for retry;
- reports are sanitized and retained for 14 days;
- no `pull_request_target`, fork, arbitrary ref, or unreviewed SHA receives credentials.

Every stage has an explicit deadline. Polling uses condition-based waits, not fixed sleeps. Failure categories distinguish account/login, Matrix configuration, Synapse, outbound mirror, Meta inbound webhook, Intex/LLM, Graph send, Meta delivery, return bridge, browser UI, and cleanup.

## Data Retention and Cleanup

Persistent fixture state retained across runs:

- Auth0 account and metadata;
- model setting;
- phone verification and user mapping;
- private account/source mapping;
- Matrix/mautrix pairing and portal target.

Per-run application data is correlated by `canaryRunId` and removed automatically after report/browser verification:

- WhatsApp webhook/message/outbound records created by the run;
- outbound status metadata;
- private-mirror message projections created by the run;
- Intex sessions/events created by the run;
- canary control records.

Cleanup is performed through narrow owner-service operations. WhatsApp Service removes its exact manifest and rebuilds any touched private account/chat/sender/day aggregate, unless canary projections were excluded from that aggregate at ingest. Intex Agent removes its exact session/event manifest. LLM Usage Service retains canary-tagged raw/aggregate cost evidence for 30 days under Timestamp TTL, excludes it from normal user billing/product aggregates, and exposes only sanitized run status plus an awaitable flush; other services never delete its collection directly.

Crash and late-event recovery separates lease expiry from deletion and uses owner-service janitors:

- active fixture/model controls: `leaseExpiresAt` two hours after acquisition, renewed only through a valid role/state transaction, with no TTL deletion field;
- run-owned application messages/sessions after completion: `Timestamp expireAt` at maximum 24 hours as a fallback to explicit cleanup;
- immutable completed run tombstone and sanitized per-turn outcome: `Timestamp expireAt` seven days later;
- outbound status history, redacted usage evidence, and resolved failed-cleanup audits: `Timestamp expireAt` 30 days later; an unresolved restore/cleanup obligation has no TTL until recovered.

The finalizer/recovery identity periodically finds expired unfinalized controls, transactionally claims recovery by incrementing `leaseGeneration`, and invokes each owner idempotently: User Service restores the model at a new revision, Intex removes its exact manifest, WhatsApp removes projections and rebuilds affected aggregates, and LLM Usage confirms flushed retained evidence. Only complete recovery writes the cleaned tombstone and removes mutable control. Partial recovery remains `cleanup_failed`, retains the model snapshot/manifests, and retries without TTL deleting the obligation; model/revision drift requires named manual recovery.

Late Meta/Matrix events match the retained tombstone/WAMID/nonce correlation, remain synthetic/excluded from normal aggregates, and are removed or expired by the next janitor pass. Cleanup sentinel tests assert neighboring documents and aggregate values, not merely document survival.

No downstream tool resources should exist. Their presence is a deterministic failure and cleanup still attempts marker-scoped removal.

The service cannot unsend messages from Meta, the consumer WhatsApp account, Matrix, or the external bridge history. Those external transcripts contain synthetic markers/text only. This limitation is reported, not hidden.

## Repository Data Answer

The repository contains:

- generic secret-container names and least-privilege IAM rules;
- generic account lifecycle code;
- synthetic canary scenario text and marker format;
- model IDs, schemas, tests, and redacted aggregate reports/templates.

The repository does not contain:

- concrete e-mail or password;
- Auth0 subject;
- phone number;
- `sourceAccountId`;
- Matrix user/access token, room ID, adapter token, or bridge state;
- WABA/phone-number IDs or WhatsApp tokens;
- raw WAMIDs or live message/session content.

GCP Secret Manager and its `active` version alias are authoritative for the dedicated account credential. Protected automation reads it directly. An optional local interactive cache may be generated explicitly into the existing `~/.intexuraos/logins.md` convention with directory mode `0700` and file mode `0600`; it records the source secret version, is never edited independently, and must be regenerated or removed on rotation. It is not a second source of truth and is outside the repository.

## Security

- The account, browser, transport, and finalizer/recovery service accounts are distinct; each can act only through its role-specific secrets and routes.
- The generic endpoint that accepts `userId` is not granted to the canary principal.
- WIF validates GitHub repository/workflow/ref/environment claims; edge routing validates the resulting Google issuer, audience, dedicated service-account identity, and exact route pattern.
- App routes independently verify the forwarded Google token, internal auth, route role, canary configuration, strict random run IDs, and server-owned lease state/generation.
- Cleanup requires the finalizer/recovery role, configured user, run ID, server-owned recovery claim, and exact owned-ID manifest.
- Auth0 Management credentials are available only to the account job, not the transport job.
- Browser credentials are available only to the browser job.
- Logs and uploaded reports pass a denylist/redaction scan before upload.

## Endpoint Changes

### Created

- `GET /internal/whatsapp/live-canary/readiness`
- `POST /internal/whatsapp/live-canary/runs`
- `POST /internal/whatsapp/live-canary/messages`
- `POST /internal/whatsapp/live-canary/runs/:runId/evidence`
- `GET /internal/whatsapp/live-canary/runs/:runId`
- `DELETE /internal/whatsapp/live-canary/runs/:runId`
- `GET /internal/intex-agent/live-canary/runs/:runId`
- `DELETE /internal/intex-agent/live-canary/runs/:runId`
- `POST /internal/users/live-canary/model-leases`
- `GET /internal/users/live-canary/model-leases/:runId`
- `DELETE /internal/users/live-canary/model-leases/:runId`
- `GET /internal/llm-usage/live-canary/runs/:runId` — sanitized persisted call/token/cost totals and completion state owned by LLM Usage Service.
- Adapter-local active Matrix probe route.

### Modified

- Meta status webhook processing persists outbound delivery state instead of treating all status payloads as `no_sender`.
- Intex per-turn events record the effective model and optional canary run correlation; session metadata exposes only the explicitly named latest model.
- WhatsApp/Intex internal event contracts carry optional, guarded `canaryRunId`.
- Generate/tool-calling usage contracts carry guarded `canaryRunId`, `turnIndex`, and provider-attempt correlation; canary persistence is awaited before turn completion.
- The session detail read model/UI displays effective model.
- Firestore collection registry, Timestamp TTL policies, and composite indexes cover run controls, model leases, per-turn correlation, outbound-status history, and run queries.
- WIF and Nginx/Lua policies recognize the dedicated identity only for deny-by-default canary route patterns, including parameterized run suffixes.

### Unchanged

- `POST /internal/whatsapp/private/outbound-matrix-messages` remains available to its existing trusted callers and is not exposed to the canary identity.
- Public Meta webhook and production WhatsApp message paths remain the tested transport.
- Normal users cannot invoke or observe live-canary routes.

### Removed

- None.

## Testing Strategy

Implementation is test-first. Minimum groups:

1. Auth0 lifecycle tests for tenant-wide marker duplicate detection, exact create payload/connection, resumable bootstrap at every Secret Manager/Auth0/verification/login/alias failure point, pending and completed e-mail verification, password-policy errors, fail-closed ensure, separately approved unblock/decommission, recoverable rotation steps, M2M rotation, collision/marker mismatch, token errors, and redaction.
2. Canary route auth/principal/config/run-ID/user-isolation/rate-limit tests, including prefix/suffix/path-encoding bypass attempts and direct-backend rejection.
3. Matrix active-probe tests for token, network, membership, portal remote identity, attestation invalidation, persisted sync checkpoint, heartbeat, target, and response sanitization.
4. Run-state/server-fencing tests for transactional acquisition, generation races, exact N-turn cycles, phase-role transitions, failure-to-cleanup, renewal, expiry, stale workers, exact replay, `409`, `429`, only two lifecycle terminals, and immutable tombstone reads.
5. Runner tests for idempotent per-turn sends, sequential evidence gating, condition polling, deadlines, job dependencies, stage errors, and `finally` cleanup.
6. Meta/Graph tests for the exact delivery reducer, sent/delivered/read/failed history, duplicate/out-of-order/conflicting events, status-before-send race, send-side merge failure/retry, crash immediately after Graph acceptance, no resend of unknown outcome, non-Intex messages, and TTL.
7. Correlation tests for every per-turn join, preferred remote WAMID, reply-token fallback, nonce forgery, adjacent/late replies, exact-ID manifest, and awaited usage persistence.
8. Model-lease tests for snapshot/set/readback, per-turn verification, UI lock, revision drift, restore at a new revision, internal generation races, expired-lease janitor claim, retained recovery snapshot, and failure without clobbering another write.
9. Cleanup/TTL/janitor tests with neighboring-user/run sentinels and private/usage aggregate values that must remain correct.
10. Two-turn and exact-20 scenario contract tests, including rejection of turn 21.
11. Tests proving no tool/downstream side effect is tolerated.
12. Playwright tests for actual Auth0 login, allowed-origin pinning, secret-safe assertion failures, selector persistence, WhatsApp readiness, session per-turn model, 20-turn rendering, and artifact denylist.
13. Workflow tests for protected triggers, shared concurrency, four route-specific WIF identities/claims, no cross-job capability transfer, cancellation/job-loss recovery, negative cross-role secret/route access, edge/app identity separation, job graph, budgets, report scan, and always-cleanup.
14. Include all Matrix adapter `.mjs` tests in tracked CI and document outbound auth-token/targets placeholders plus startup validation; they are currently package-specific and outside the normal Vitest workflow.
15. One manual protected live run must prove every real stage before schedule enablement.

## Acceptance Criteria

- The dedicated account can log in through real Auth0 Universal Login.
- Its phone mapping, private account, Matrix user, and portal target all pass preflight.
- A two-turn run is observed outgoing and returning incoming in the same private portal chat.
- The same run is visible as one Intex session with the selected effective model on every LLM-backed turn and no fallback.
- Meta reports both assistant replies delivered or read.
- An exact 20-turn DeepSeek run completes in one session within budget and every reply returns through WhatsApp.
- The settings/session browser flow passes with the dedicated account and shows DeepSeek as effective.
- A signed synthetic webhook cannot satisfy the live verdict.
- A Matrix event without a returning private-mirror reply cannot satisfy the live verdict.
- The scheduled job is serialized, protected, redacted, and always invokes cleanup.
- Neighboring user/run data survives cleanup tests and private/usage aggregate values remain correct.
- No concrete account, phone, Matrix, Meta, Auth0, WAMID, or credential value enters Git.

## Rollout

1. Create Terraform secret containers, route-specific canary identity, and protected environment without secret values.
2. Complete Auth0 administrator bootstrap and provision the long-lived account.
3. Complete phone verification, mapping, private account, Matrix pairing, and portal target outside Git.
4. Add status projection, correlation, narrow APIs, active Matrix probe, and runner with unit/integration tests.
5. Run preflight; stop on any external prerequisite failure.
6. Run the automated browser login/settings preflight.
7. Run the protected two-turn live canary and inspect every per-turn stage.
8. Run the automated browser session-evidence check before cleanup.
9. Run the exact 20-turn DeepSeek canary and verify cleanup, aggregates, and retained tombstone behavior.
10. Enable the daily two-turn and weekly 20-turn schedules only after three consecutive manual passes.
