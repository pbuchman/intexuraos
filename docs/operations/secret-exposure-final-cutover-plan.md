# Secret Exposure Final Cutover Plan

Status: approved destructive production implementation plan.

This is the only execution authority for this cutover. It supersedes every
rollback, compatibility, soak, Phase A/B, and delayed-cleanup instruction in
the migration report and package runbook.

## Autonomous Agent Goal

After this plan is approved, create one goal from the template below. Replace
`<APPROVED_PLAN_URL>` with the immutable GitHub blob URL pinned to the exact
reviewed commit. Never use a branch, pull-request, or mutable `development` URL.

> Execute the complete IntexuraOS production security cutover defined in
> `<APPROVED_PLAN_URL>`. Read that plan in full before taking any action and
> treat it as the sole execution authority for scope, order, safety gates, and
> definition of done. Deliver the implementation end to end: code and data
> migrations, provider/Cloudflare/GCP changes, credential rotation and
> revocation, Terraform plans and applies, the same reviewed SHA deployed to
> Home Dev and production, live verification, support-case handling, and final
> documentation. Accept downtime. Preserve no rollback, backwards
> compatibility, dual-read path, old key, old version, or soak period. Ask no
> routine questions and do not stop at analysis, a pull request, or a partial
> deployment. If a gate fails, leave the affected service stopped, fix forward,
> and repeat the gate. Finish only when every production completion gate in the
> linked plan passes and the migration report is `COMPLETE`.

Execution authority:

- Use clean clones and descriptive feature branches; never use Git worktrees.
- Stop services and automations whenever required. Downtime is accepted.
- Do not preserve rollback, backwards compatibility, dual-read, old packages,
  old keys, old readers, or re-enable procedures.
- Owner exception for this cutover: do not run the usual local pre-commit full
  repository gate. The one push-triggered GitHub CI run on the final candidate
  is the only full-repository gate.
- Use external Chrome profile `kontakt@pbuchman.com` and Google SSO for provider
  consoles. Do not use a browser extension and do not ask for login approval.
- If an integration cannot be accessed, remove it and its credential.
- Never print, hash into Git, or store a credential payload in evidence.
- A failed gate leaves the affected service stopped; investigate and fix
  forward without asking the user.
- The goal is incomplete until the reviewed solution is healthy on Home Dev
  and production.

## Fixed Starting State

- DEV and PROD use secret package version `2`; do not repeat that migration.
- Legacy readers and their IAM are gone; 34 obsolete containers remain.
- The direct Gemini key is deleted and Generative Language API is disabled.
- Public `https://dev.intexuraos.cloud/src/config.ts` still exposes the broad
  `INTEXURAOS_*` Vite environment and must be contained first.

## Required Execution

### 1. Contain

1. Stop, disable, and mask the Home Dev webhook deployer.
2. Disable `.github/workflows/deploy.yml` and require zero queued/running deploys.
3. Stop public Home Dev web and block the entire DEV hostname with `503` or
   Cloudflare. Do not block only `/src/config.ts`.
4. Prove anonymously that `/`, `/src/*`, `/@vite/*`, `/@fs/*`, `/.env*`, and
   source maps return no Vite content.
5. Preserve only redacted metadata evidence. Do not create replacement
   credentials until containment passes.

### 2. Remove The Leak And Lock The Edge

1. Add regression tests proving every policy secret and a synthetic sentinel
   are absent from transformed modules, source maps, `dist/`, and HTTP output.
2. Replace broad Vite loading with one typed public allowlist. The web process
   must not inherit `PM2_BASE_ENV`, `COMMON_SERVICE_ENV`, or unknown
   `INTEXURAOS_*` values.
3. Serve a static Home Dev build through Caddy. Vite may listen only on
   localhost/Tailscale.
4. Protect browser routes with Cloudflare Access for `kontakt@pbuchman.com`.
   Generate Caddy and Cloudflare rules from one tracked manifest containing
   exact `method`, `path`, and application guard. No wildcard bypass.
5. Put these seven non-secret IDs in versioned config, not secret packages:
   `INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID`,
   `INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING`,
   `INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING`,
   `INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING`,
   `INTEXURAOS_SENTRY_AUTOMATION_USER_ID`,
   `INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID`, and
   `INTEXURAOS_WHATSAPP_WABA_ID`.
6. Add redacted Caddy origin logs. Cloudflare logging is additional, not the
   only evidence for provider bypass paths.

The exact unconditional machine-path manifest is:

| Method and path | Existing mandatory guard |
| --- | --- |
| `POST /api/code/internal/webhooks/task-complete` | Per-task HMAC + timestamp |
| `POST /api/code/internal/logs` | Per-task HMAC + timestamp |
| `POST /api/code/internal/turn-metrics` | Per-task HMAC + timestamp |
| `POST /api/code/internal/webhooks/task-event` | Per-task HMAC + timestamp |
| `POST /api/code/internal/webhooks/compliance-report` | Per-task HMAC + timestamp + internal auth |
| `PATCH /api/code/internal/code-tasks/status` | Body `taskId` + per-task or orchestrator HMAC |
| `POST /api/linear/webhooks` | `Linear-Signature` |
| `POST /api/notifications/webhooks` | Per-user mobile signature |
| `POST /api/code/webhooks/sentry` | `Sentry-Hook-Signature` |

- Replace the old dynamic task-status path with the fixed path above; update
  all senders and keep no alias.
- Add GitHub and WhatsApp webhook paths only if provider metadata names the
  exact DEV URL and their raw-body signatures remain mandatory.
- Keep OAuth callbacks and unauthenticated Notion webhooks behind Access.
- Route orchestrator heartbeat and usage events locally; never expose the
  direct LLM-usage legacy webhook.
- Keep `/webhook` permanently disabled. Use Service Auth for every other
  machine client.
- Make the IntexuraOS edge manifest canonical. In a separate clean clone/PR,
  update `/Users/p.buchman/personal/pbuchman-dev/machine-setup/config/` so a
  machine-setup run cannot restore public Vite or the webhook deployer.

### 3. Remove Or Rotate Exposed Credentials

Stop all DEV and PROD writers. Independent providers may be handled in parallel.

| Action | Scope |
| --- | --- |
| Remove without replacement | OpenAI, MiniMax, Mimo, Dashscope, Kimi, unused webhook verification secret, and their workers/configuration |
| Rotate at provider | OpenRouter, Speechmatics, Cloudflare, Linear, Grafana/Loki, Google OAuth, GitHub OAuth/webhook, Sentry webhook, WhatsApp |
| Replace atomically | Internal auth, orchestrator auth, Matrix adapter auth, Matrix HMAC/signing |
| Replace through offline migration | Application, token, and Matrix context encryption keys |

OpenRouter is the only provider API for application inference and provider-key
workers. Subscription-authenticated Claude/Codex CLI runners are the only
exception. Retain worker types `auto`, `opus`, `sonnet`, `codex`,
`codex-xhigh`, `openrouter-free`; remove `minimax`, `mimo-pro`, `glm`, `qwen`,
`kimi` from code, API, UI, defaults, persisted settings, and docs. Require
`retired_values_remaining=0` in `code_tasks`, `code_worker_settings`, and
`code_task_system_statuses` before deployment.

The one-time migrator may hold old and new keys; runtime may hold only new keys:

- `INTEXURAOS_ENCRYPTION_KEY`: migrate retained OpenRouter values in
  `user_settings.llmApiKeys`; delete other provider keys and test results.
- `INTEXURAOS_TOKEN_ENCRYPTION_KEY`: migrate encrypted fields in `auth_tokens`,
  `oauth_connections`, and `code_worker_settings.workers`.
- `INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY`: migrate run/scenario
  contexts and test-confirmation tool arguments; delete expired/orphaned
  records and fail on a live identity mismatch.

For each domain require: all candidates accounted for; old/new decrypt counts
match; plaintext matches after re-encryption; malformed/write failures are
zero; retained document counts match; every retained value decrypts with the
new key; the old key decrypts zero migrated values. Then delete old keys and
the migrator. No dual-read runtime is allowed.

### 4. Publish, Merge, And Deploy Once

1. Create complete new numeric DEV and PROD package versions and new pinned
   versions for both native runtime secrets.
2. Update manifests and deployment inputs to those exact versions.
3. Change production deployment to `workflow_dispatch` only and add a
   deterministic manual Home Dev exact-SHA deployment.
4. Keep implementation commits local. Run only focused tests, package
   typechecks/lints, Terraform validation, exact-plan verifiers, and local
   agent review for the changed area.
5. When implementation is complete, rebase once onto the final `development`
   head, repeat the focused checks, and push the branch once. Open a draft PR.
   Do not wait for or invent a Linear ID.
6. Treat the push-triggered GitHub CI run as the only full-repository gate; do
   not also run `pnpm run ci:tracked` locally. If it fails, fix all known
   failures with focused checks before one replacement push. Make no change
   after the successful run.
7. Mark the PR ready, complete review, and merge while both deployment
   automations remain disabled. Prove the merge
   triggered no deployment and freeze the 40-character merge SHA.
8. Require `refs/heads/development` to equal that SHA immediately before manual
   dispatch and require the created workflow run `headSha` to match it.
9. Deploy that same SHA to Home Dev, static DEV web, orchestrator, Alloy,
   transcription, and Hetzner production. Start services only after package
   projection validation.
10. Run direct-origin, public, Auth0, Firebase, OAuth, WhatsApp, Matrix,
   transcription, OpenRouter, orchestrator, observability, and browser smokes.
   Keep both deployment mechanisms manual-only after completion.

### 5. Delete Obsolete State Immediately

Before deletion, commit a metadata-only
`config/environments/final-secret-cutover.json` plus an exact-set plan verifier.
The manifest freezes:

- 34 names derived from `secret-package-sources.json` minus the two native
  names, their 34 module addresses, and the empty DNS-token address;
- old Firebase key `d8251549-1bde-49c0-82a7-b0525a2fe688`;
- old runtime key `ecd947dfc08351f186efc8f23c04c10b2d3c482a`;
- every old package/native version, Cloud Build IAM address, expected action,
  state lineage/serial, plan checksum, retained denylist, and two excluded App
  Check delete addresses.

Retain only the DEV/PROD packages, internal-auth and Speechmatics native
secrets, replacement Firebase resource, active runtime key
`4bf7371e272b2c67b6d0bd59cd52cae7daf18efc`, and Google-managed connection
token. Keep security tombstones but no legacy resource or reader.

Execute this serial loop: plan N → exact JSON comparison → record
checksum/lineage/serial → apply the saved plan → confirm the new serial → create
plan N+1. After each apply, an untargeted plan may contain only remaining frozen
actions and the two excluded App Check deletes.

1. Create/import the exact Cloud Build connection-secret accessor.
2. Define/import both live project Secret Manager admin bindings, require a
   no-change adoption plan and `fetchGitRefs`, then apply exactly two deletes.
   Require another canary, connection `COMPLETE`, one accessor, zero admins.
3. Delete exactly 35 obsolete containers plus old Firebase: exactly 36 deletes,
   zero create/update/replace/output changes. The DNS container must have zero
   versions by metadata before planning.
4. Delete `terraform_data.legacy_runtime_sa_bootstrap[0]` and only frozen legacy
   outputs from the Hetzner root; no cloud resource may change.
5. Delete every old package/native version and the old runtime key.

Also remove `legacy_secret_readers_enabled`,
`legacy_secret_containers_enabled`, `legacy_runtime_sa_bootstrap_enabled`,
`runtime_sa_key_path`, `legacy-pre-packages`, legacy-source package building,
rollback docs, loaders, and temporary artifacts. Never apply App Check drift.

### 6. Verify And Close

1. Prove only new package/native versions and four application secret
   containers remain; all 35 obsolete containers and old keys are absent.
2. Prove zero legacy readers/accessors, zero project Secret Manager admin, one
   exact connection-secret accessor, and no post-cutover old-secret access.
3. Prove DEV/PROD health, exact SHA attestations, integrations, browser flows,
   static-bundle scans, the single final full-repository gate, Terraform
   validation, and scoped clean plans. Do not repeat the full gate after merge.
4. Keep Gemini API disabled, add enablement/key alerts and the lowest available
   spend cap.
5. Reopen Google case `#74312245`, request correction of `237.691246 PLN`, and
   send no key value.
6. Set the migration report to `COMPLETE` with metadata-only evidence.

Wait only for unavoidable provider or audit-log propagation. No multi-day soak.

## Parallelism

After containment, run concurrently:

- code, tests, static frontend, Caddy, Cloudflare, and `pbuchman-dev` changes;
- independent provider revocations/rotations;
- Terraform-plan preparation, evidence, Google guardrails, and support draft.

The final sequence is always: stop writers → migrate → publish packages → merge
→ exact-SHA Home Dev and production deployment → smoke → delete old state →
verify → close. Terraform plans and applies are always serial.

## Completion Gates

- No public Vite module or source map. Static artifacts contain only the
  versioned public allowlist, including the restricted Firebase browser key
  and public DSNs/identifiers; secret-policy names and every non-allowlisted
  credential pattern are absent.
- All exposed old credentials revoked/deleted; OpenRouter is the only
  application inference provider.
- Exactly one DEV package, one PROD package, and one version of each native
  runtime secret; zero legacy container/reader/compatibility path.
- Cloud Build has one exact accessor and zero project Secret Manager admin.
- Home Dev and production run the same reviewed SHA and pass every smoke.
- The single final full-repository gate and scoped Terraform plans pass;
  support request is sent; report is `COMPLETE`.

## Endpoint Changes

- **Modified:** DEV browser routes become static and Access-protected;
  `PATCH /api/code/internal/code-tasks/{taskId}/status` becomes
  `PATCH /api/code/internal/code-tasks/status` with `taskId` in the body.
- **Created:** none.
- **Removed:** public Vite routes/maps and worker types `minimax`, `mimo-pro`,
  `glm`, `qwen`, `kimi`.
- **Unchanged:** production routes, all other API contracts, Claude/Codex
  runners, and exact authenticated provider callbacks.
