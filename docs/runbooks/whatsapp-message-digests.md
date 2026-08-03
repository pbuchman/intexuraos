# WhatsApp Message Digests — Production Migration and Cutover

This runbook covers the one-shot release that introduces Message Digest Service, migrates the existing Fishing group continuity, removes digest execution from Mobile Notifications Service, and admits the new web and API surface. There is no feature flag and no split deployment.

## Safety contract

- Deploy only the exact merge commit whose pull request has a successful full CI run and a `Tested-Tree:` trailer matching its Git tree.
- Use the immutable release directory and release manifest verified by `github-actions-deploy.sh`.
- Keep public Message Digest ingress closed until candidate checks, data verification, runtime switch, and atomic activation complete.
- Candidate execution must prove zero outbound WhatsApp effects.
- Store migration evidence as counts, hashes, and opaque evidence references only. Never store prompts, summaries, phone numbers, chat identifiers, or message bodies in logs or reports.
- The cutover has one durable bounded window ending at the earlier of two hours after cutover start
  and 30 minutes before the next legacy run. An expired window fails closed.

## Automated entry point

The production deployment invokes:

```bash
scripts/hetzner/cutover-message-digests.sh
```

The wrapper owns durable checkpoints, candidate services, Terraform plans, migration 128, migration phases, runtime switching, public admission, verification, and pre-admission compensation. Do not run individual mutation commands while an active cutover state exists.

## Preconditions

1. The feature branch was rebased on the latest `origin/development` before final acceptance.
2. Focused service, migration, Terraform, deploy-script, and documentation checks passed.
3. Exactly one final `pnpm run ci:tracked` passed on the tested tree.
4. The merged pull request exposes the exact merge SHA, successful check suite, and matching `Tested-Tree:` trailer.
5. The previous immutable release, production env file, and GCP credentials are readable. The closed
   Message Digest Terraform targets are GCP-only and explicitly strip any ambient `HCLOUD_TOKEN`.
6. Migration `128_message-digest-service-indexes` is the only pending Firestore migration.
7. A read-only Meta Graph preflight confirms that `intexuraos_message_digest_v4` is the exact
   Polish, `APPROVED`, `UTILITY` template expected by the frozen six-body-parameter and dynamic
   `Otwórz podsumowanie` URL contract. This runs before any production mutation and again immediately before
   migration activation; failure is content-free and stops the cutover.
8. No other production deploy or infrastructure change is running.

The fixed body copy is exactly:

```text
📌 {{1}}
Zaplanowane podsumowanie rozmów jest gotowe.
Okres: {{2}}

*{{3}}*

🔴 *NAJWAŻNIEJSZE*
{{4}}

✅ *USTALENIA I FAKTY*
{{5}}

➡️ *CO DALEJ*
{{6}}

Pełne szczegóły poniżej ↓
```

Parameters are, in order: configured Digest name, localized source window, concrete headline, and
three bounded scan-friendly section lines. All visual line breaks belong to the approved template;
runtime parameters are compact single-line text because Meta rejects newlines inside template
parameters. The only button is `Otwórz podsumowanie`, with dynamic URL base `https://intexuraos.cloud/{{1}}`; the runtime
parameter is the canonical `#/whatsapp/message-digests/.../history/...` suffix. Do not create a
second name, language variant, fallback, footer, header, or additional button.

## Cutover order

The orchestrator executes these checkpoints in order:

1. Verify the tested immutable release and release manifest.
2. Start candidate WhatsApp, Mobile Notifications, Fishing Assistant, Message Digest, web, and hidden nginx routes.
3. Run the Fishing migration `--dry-run` and estimate the bounded cutover duration.
4. Apply the development Terraform root, run migration 128, and wait until every composite index is ready.
5. Apply the production Terraform root. The intentional infrastructure order is production root first for rollback, and development root second; forward application is development first so indexes exist before production scheduling is admitted.
6. Run migration `--apply` to stage canonical definition, run, state, archive, and continuity data without making it visible or deliverable.
7. Run migration `--verify` and the `candidate-zero-send-proof` checkpoint.
8. Hold public ingress, switch the four affected services and web build, then run migration `--activate` atomically.
9. Admit `/api/message-digests`, verify production health and data again, and mark the durable cutover complete.

The inverse Terraform rollback is deliberately production root first and development root second.

## Migration phase contract

The protected binding is resolved by the cutover wrapper and passed through environment variables. Operators must not paste protected values into a terminal transcript or ticket.

For diagnosis only, the phase shape is:

```bash
node scripts/message-digests/migrate-fishing-group.mjs --dry-run --migration-id <migration-id>
node scripts/message-digests/migrate-fishing-group.mjs --apply --migration-id <migration-id>
node scripts/message-digests/migrate-fishing-group.mjs --verify --migration-id <migration-id>
node scripts/message-digests/migrate-fishing-group.mjs --activate --migration-id <migration-id> --cutover-deadline <iso-time>
node scripts/message-digests/migrate-fishing-group.mjs --compensate --migration-id <migration-id>
```

Only `--apply` calls the LLM to reconstruct a missing canonical summary. `--dry-run`, `--verify`, and `--activate` must report `outboundEffects: 0`; `--compensate` hides staged data before admission. Every stdout report is content-free and restricted to mode, status, dates, counts, and hashes.

## Candidate verification

Before the runtime switch, verify:

- candidate health on the four isolated loopback ports;
- the candidate web build exists;
- the public Message Digest route is still unavailable;
- unauthorized scheduler and Pub/Sub calls are rejected;
- dry-run, apply, and verify reports all contain zero outbound effects;
- migrated counts and hashes agree with the protected source snapshot;
- the Mobile Notifications candidate remains healthy without digest routes;
- `candidate-zero-send-proof` is checkpointed durably.

Do not send a real WhatsApp message from the candidate stack.

## Admission verification

Immediately after admission:

```bash
curl --fail --silent --show-error https://intexuraos.cloud/api/message-digests/health
curl --fail --silent --show-error https://intexuraos.cloud/api/fishing-assistant/health
curl --fail --silent --show-error https://intexuraos.cloud/api/notifications/health
```

Then confirm:

1. The migration `--verify` report is still exact and content-free.
2. The migrated Fishing definition appears in Message Digests with prior history and continuity.
3. Mobile Notifications has no digest navigation, public route, internal route, scheduler, or LLM configuration.
4. Fishing Assistant compatibility views read the canonical Message Digest history and WhatsApp source evidence.
5. A new direct-chat definition can be previewed without delivery.
6. One explicit production run reaches the user's first mapped WhatsApp phone and its deep link opens the exact run.
7. An eligible failure can be retried, while an ambiguous send cannot be blindly retried.

Use only the already running system Google Chrome with the user's existing profile for UI acceptance
and WhatsApp Web receipt verification. Do not launch another browser or Chrome profile.

## Pre-admission rollback

Any failure before public admission triggers automatic fail-closed rollback:

1. Keep Message Digest public ingress hidden.
2. Restore the previous immutable PM2 and web release.
3. Run migration `--compensate` when staging began.
4. Restore Terraform in inverse order: production root first, development root second.
5. Prove the restored Mobile Notifications release still exposes its legacy scheduler surface by checking that `/internal/notifications/digest/run-yesterday` is not a missing route.

If any rollback action fails, keep affected ingress closed and require manual recovery. Do not discard the durable state directory or rerun with another deployment identity.

## Post-admission failure

After public admission, automatic compensation is forbidden because users may already have observed the new state. Hold Message Digest ingress closed, preserve all evidence, and repair forward from the admitted immutable release. Never reactivate the legacy Mobile digest scheduler after new outbound delivery may have occurred.

## Evidence to retain

- merge SHA, tested tree, workflow run, and deployment identity;
- immutable release-manifest hash;
- durable checkpoint state and cutover window;
- Terraform plan validation summaries;
- migration counts and hashes;
- health status and content-free delivery-state transitions;
- Chrome UI acceptance checklist and opaque screenshot references;
- opaque WhatsApp send and receipt evidence references.

Redact or reject any artifact containing a phone number, private source identifier, message text, prompt, or generated summary.
