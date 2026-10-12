# Private WhatsApp Matrix Sync

This is the canonical IntexuraOS reference for connecting an external Matrix/mautrix-whatsapp bridge to the private WhatsApp ingest API.

## Endpoint Changes

Created:

- `GET /whatsapp/private/account`
- `PUT /whatsapp/private/account`
- `DELETE /whatsapp/private/account`
- `POST /internal/whatsapp/private/media`
- `GET /whatsapp/private/messages/:messageId/media`
- `GET /whatsapp/private/messages/:messageId/thumbnail`
- `GET /internal/whatsapp/private/messages/:messageId/media`

Modified:

- `POST /internal/whatsapp/private/events` now resolves ownership from `sourceAccountId` through `whatsapp_private_accounts`; adapter-provided `userId` is ignored.
- Public private read endpoints resolve the authenticated user's private account instead of using app-wide owner/source secrets.

Removed:

- App-wide `INTEXURAOS_PRIVATE_WHATSAPP_OWNER_USER_ID`
- App-wide `INTEXURAOS_PRIVATE_WHATSAPP_SOURCE_ACCOUNT_ID`

Unchanged:

- Internal agent read endpoints for messages, sender-days, and aggregate rebuild.

## Deployment Shape

The Matrix bridge runs outside IntexuraOS, currently on Home Dev. `pbuchman-dev` independently installs:

- Synapse
- mautrix-whatsapp
- Element Web for login/bridge administration

IntexuraOS separately owns `tools/whatsapp-private-matrix-sync` and its [canonical deployment](../../tools/whatsapp-private-matrix-sync/deploy/home-dev/README.md). The integration uses project `intexuraos-matrix-sync`, unit `intexuraos-matrix-sync.service` and `/home/pbuchman/services/intexuraos-matrix-sync`. Its stop and replacement operations control only the adapter. Matrix core installation and health do not require any IntexuraOS checkout, environment or Google identity.

The adapter consumes Matrix events and writes only to the IntexuraOS internal API. It must not connect to WhatsApp directly.

## Ingest API

Ingest URL:

```text
https://intexuraos.cloud/internal/whatsapp/private/events
```

Media upload URL:

```text
https://intexuraos.cloud/internal/whatsapp/private/media
```

OIDC audience:

```text
https://intexuraos.cloud
```

Expected service account email:

```text
intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com
```

The request body must include:

- `sourceAccountId`
- `deliveryMode`
- `events`

Image, audio, and video events first ingest message metadata through
`POST /internal/whatsapp/private/events`. The adapter persists a durable media
queue before advancing the Matrix checkpoint, then downloads and uploads bytes
through `POST /internal/whatsapp/private/media` and attaches the returned storage
metadata to the existing message through the media-backfill API. These writes
require the same private-sync service account OIDC identity. Pending media stays
queued for retry and keeps synchronization health degraded until resolved.

`sourceAccountId` is generated per user in `Settings > WhatsApp > Private WhatsApp Mirror`. The adapter may still send a legacy `userId` field, but IntexuraOS ignores it and resolves ownership from `whatsapp_private_accounts`.

Supported `deliveryMode` values:

- `live` for the Matrix sync adapter
- `backfill` for separate deterministic replay tooling

## Agent Read APIs

Agents should use the internal read APIs instead of reading Firestore directly:

```text
GET /internal/whatsapp/private/messages
GET /internal/whatsapp/private/sender-days
POST /internal/whatsapp/private/aggregates/rebuild
```

`messages` is for raw read-only message ranges. `sender-days` is for future daily summaries by sender. `aggregates/rebuild` is an internal repair/backfill path for recomputing sender and sender-day documents from stored messages.

## Secret Handling

Never commit:

- Matrix access tokens
- WhatsApp session or bridge state
- `.env`
- Google credential JSON
- generated `data/`, `secrets/`, or log directories

The adapter should receive Matrix and Google credentials as mounted secret files. The Home Dev deployment documents the current file paths, but the IntexuraOS API contract does not require those exact host paths.

For outbound Matrix delivery, also mount:

- `MATRIX_OUTBOUND_AUTH_TOKEN_FILE`
- `MATRIX_OUTBOUND_TARGETS_FILE`

`MATRIX_OUTBOUND_AUTH_TOKEN_FILE` contains an adapter-local bearer token used by trusted internal callers on the Matrix host. It must be distinct from `MATRIX_ACCESS_TOKEN_FILE`: the outbound bearer authorizes adapter-local HTTP routes and is never a Matrix homeserver access token. The adapter fails closed before sync and rejects HTTP authorization when the two paths or their trimmed token values are equal. `MATRIX_OUTBOUND_TARGETS_FILE` contains source-account to target-room mappings, for example:

```json
{
  "pbuchman-private-whatsapp": {
    "intex_agent": "!roomid:home-dev"
  }
}
```

## User Configuration

1. Open `Settings > WhatsApp`.
2. Connect and verify the assistant WhatsApp phone number.
3. Enable `Private WhatsApp Mirror`.
4. Copy the displayed `sourceAccountId` into the Home Dev adapter configuration as `INTEXURAOS_SOURCE_ACCOUNT_ID`.
5. Add the same `sourceAccountId` to `MATRIX_OUTBOUND_TARGETS_FILE` with an `intex_agent` room mapping that points at the WhatsApp/Intex Agent portal room.
6. Generate and mount `MATRIX_OUTBOUND_AUTH_TOKEN_FILE` for the trusted backend caller that will use the outbound adapter endpoints.
7. Keep `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` environment-specific. The retained DEV recovery profile uses the loopback adapter on port 8099. Production uses exactly `https://matrix-outbound.intexuraos.cloud/api/matrix-outbound`; it must never fall back to the DEV hostname or an unprovisioned Hetzner-local address.
8. Store `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN` in Secret Manager with the same bearer token mounted in `MATRIX_OUTBOUND_AUTH_TOKEN_FILE`.
9. Keep Matrix tokens, WhatsApp bridge state, `.env`, and Google credential JSON out of Git.

## Message Flow

1. mautrix-whatsapp receives incoming private WhatsApp messages and mirrors them into Matrix rooms.
2. The sync adapter polls Matrix `/sync`.
3. On a first run, it stores the Matrix `next_batch` token and skips historical messages.
4. On later runs, it maps incoming Matrix message events into private WhatsApp ingest events.
5. It posts batches to IntexuraOS with OIDC internal auth and the per-user `sourceAccountId`.
6. IntexuraOS resolves `sourceAccountId` to the canonical user id.
7. IntexuraOS stores immutable message docs and updates sender/sender-day read models.

For new `m.image`, `m.audio`, and `m.video` events, the adapter first posts message metadata to `POST /internal/whatsapp/private/events`, durably queues the media work, and then advances the Matrix checkpoint. It downloads queued media with its Matrix access token, uploads bytes to `POST /internal/whatsapp/private/media`, and attaches the returned GCS metadata to the already ingested message through the media-backfill API. Pending media remains queued for retry and keeps health degraded; checkpoint progress alone does not establish completed media delivery. Existing media messages without stored media metadata remain placeholders until their media is attached.

Backfills should use the same endpoint with `deliveryMode: "backfill"` and deterministic Matrix event ids so duplicate ingest does not double-count aggregates.

Deployment order: stop the Matrix sync adapter, deploy `whatsapp-service`, deploy the updated `tools/whatsapp-private-matrix-sync` container/configuration with `INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_URL`, then restart the adapter. This keeps metadata ingest and queued media delivery on compatible API contracts during the update.

## Outbound Adapter API

The adapter exposes one health route and adapter-local outbound routes for scheduled delivery:

- `GET /health`
- `GET /internal/matrix/outbound/readiness/:sourceAccountId/:target`
- `POST /internal/matrix/outbound/messages`

All three require the exact
`Authorization: Bearer <token-from-MATRIX_OUTBOUND_AUTH_TOKEN_FILE>` header. The health route
returns `401` before evaluating readiness when the bearer is absent or invalid.

Authorized `/health` returns `200` only for `running` with a complete successful sync iteration less than 120 seconds old. Starting, waits for credentials, errors, recovery fences, pending media and stale progress return `503`. Successful polls on an idle channel keep it healthy. `lastSuccessfulPollAt`, `lastCheckpointAt`, `lastIngestAt` and `lastSuccessfulIterationAt` describe progress observed since process startup. A poll/checkpoint alone is insufficient to clear failed media delivery. Outbound readiness continues to describe configuration only.

The image performs an authenticated healthcheck every 30 seconds, allowing a 120-second start period. An unhealthy state does not trigger a restart. Investigate the failure or perform controlled recovery; do not reset the checkpoint to make health green.

Home PROD renders `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` from the
production overlay in versioned configuration when `scripts/home-prod/load-secrets.sh` writes
`/etc/intexuraos/.env.prod`; only the adjacent adapter auth token comes from
Secret Manager. The tracked production value is the production-owned
`https://matrix-outbound.intexuraos.cloud/api/matrix-outbound` route. Do not point
production at `localhost` or `dev.intexuraos.cloud`; without the reviewed route
from Hetzner to the Matrix host, readiness remains blocked and scheduled
notifications cannot deliver.

Readiness returns:

- `{ "status": "ready" }`
- `{ "status": "setup_required", "reason": "..." }`

The send route accepts:

```json
{
  "sourceAccountId": "pbuchman-private-whatsapp",
  "target": "intex_agent",
  "text": "new session: Send me events that they have in the calendar in the next 24 hours.",
  "idempotencyKey": "calendar-daily-lookahead-2026-07-04"
}
```

`text` is the raw Matrix message body. Calendar schedules store the exact user
prompt `Send me events that they have in the calendar in the next 24 hours.`;
`whatsapp-service` adds the `new session:` command prefix when it receives
`startNewSession: true` from Calendar Agent.

It resolves the same target mapping used by readiness and sends a Matrix `m.room.message` into the mapped room.

## Controlled History Recovery

A `matrix_timeline_limited` error is a recovery requirement. Keep live consumers stopped and the mode 600 recovery fence present. Do not reset `nextBatch`, skip malformed events or acknowledge a limited timeline. Recovery is manual and uses the existing `backfill-private-events.mjs` stages. Discovery can join eligible Matrix rooms and therefore changes Matrix membership; apply posts private events/media, and finalize advances durable state. Run them only in the authorized recovery window after backups and image/TLS/identity checks described in the [deployment procedure](../../tools/whatsapp-private-matrix-sync/deploy/home-dev/README.md).

Required evidence before the first discovery:

- A protected byte-for-byte S0 checkpoint copy taken after the old consumer fully stopped, with its original `nextBatch`, room contexts and `updatedAt`. The 2026-10-12 preflight observed `updatedAt: 2026-09-16T14:01:09.437Z`; read the newly preserved S0 rather than assuming that dated observation remains current.
- The exact `INTEXURAOS_SOURCE_ACCOUNT_ID` and canonical `INTEXURAOS_USER_ID`, independently checked against the private account with the authorized reader. Do not copy another user's mapping or leave example values in place.
- Project `intexuraos-dev-pbuchman`, media bucket `intexuraos-whatsapp-media-dev`, and existing reader `wa-private-recovery-reader-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`.
- A private mode 600 JSON array of known deterministic message IDs exported using the existing authorized reader for that exact account/user/project. Verify the export boundary and completeness before using it as anchor evidence. Do not create new IAM permissions or use an admin/service-account identity as a replacement.
- The existing private-sync service-account file, with `INTEXURAOS_EXPECTED_GOOGLE_SERVICE_ACCOUNT` and `INTEXURAOS_OIDC_IMPERSONATE_SERVICE_ACCOUNT` both exactly `intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`. Apply enforces the credential's identity and self-impersonation target.
- Host ADC at `/home/pbuchman/.config/gcloud/application_default_credentials.json` of type `authorized_user`, already authorized to impersonate the pinned recovery reader. Verification rejects service-account/file-backed ADC and emulator contamination. The 2026-10-12 preflight found this ADC absent; an operator must authenticate the authorized user before recovery. Do not bypass that fence or substitute the ingest service account.

Use the pinned canonical checkout and its installed dependencies on the host. The example below assumes preparation has supplied the reviewed integration environment, backups and known-ID export. The state paths remain the explicit legacy adapter paths during the migration. Keep all recovery outputs outside Git with mode 600 and parent directories mode 700.

```bash
integration_dir=/home/pbuchman/services/intexuraos-matrix-sync
legacy_dir=/home/pbuchman/services/whatsapp-matrix
recovery_dir=/home/pbuchman/services/intexuraos-matrix-sync-recovery
set -a
. "$integration_dir/.env"
set +a
export MATRIX_HOMESERVER_URL=https://home-dev
export MATRIX_ACCESS_TOKEN_FILE="$legacy_dir/secrets/matrix-access-token"
export MATRIX_OUTBOUND_AUTH_TOKEN_FILE="$legacy_dir/secrets/matrix-outbound-auth-token"
export MATRIX_OUTBOUND_TARGETS_FILE="$legacy_dir/config/matrix-outbound-targets.json"
export INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE="$legacy_dir/secrets/private-sync-service-account.json"
export NODE_EXTRA_CA_CERTS="$integration_dir/ca/active-caddy-root.crt"
export WHATSAPP_SYNC_STATE_FILE="$legacy_dir/data/whatsapp-sync/state.json"
export WHATSAPP_SYNC_PENDING_MEDIA_FILE="$legacy_dir/data/whatsapp-sync/pending-media.json"
export WHATSAPP_SYNC_MAINTENANCE_FENCE_FILE="$legacy_dir/data/whatsapp-sync/recovery-required"
export WHATSAPP_RECOVERY_PROJECT_ID=intexuraos-dev-pbuchman
export WHATSAPP_RECOVERY_MEDIA_BUCKET=intexuraos-whatsapp-media-dev
export WHATSAPP_RECOVERY_READER_SERVICE_ACCOUNT=wa-private-recovery-reader-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com
test -z "${GOOGLE_APPLICATION_CREDENTIALS:-}"
test -z "${FIRESTORE_EMULATOR_HOST:-}"
test -z "${STORAGE_EMULATOR_HOST:-}"
: "${INTEXURAOS_SOURCE_ACCOUNT_ID:?verified account required}"
: "${INTEXURAOS_USER_ID:?verified canonical user required}"
s0_file="$recovery_dir/state-s0.json"
manifest_file="$recovery_dir/manifest.json"
known_ids_file="$recovery_dir/known-message-ids.json"
anchor_before="$(node --input-type=module -e \
  'import fs from "node:fs"; const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!s.nextBatch || !Number.isFinite(Date.parse(s.updatedAt))) process.exit(1); console.log(s.updatedAt);' \
  "$s0_file")"
```

Pass `--anchor-before "$anchor_before"` on **both** discoveries. The recovery library retains an older historical default (`2026-08-09T22:00:00.000Z`); it is inappropriate for this incident and must not be used accidentally. Keep the known-ID export explicit on both segments. Do not add `--exclude-known-message-ids true` unless a separate review proves that exclusion is correct; normal replay uses deterministic IDs and duplicate-safe ingest.

Run each stage separately and inspect its sanitized summary before proceeding. The first discovery produces S0-S1. Apply and verify it before discovering S1-S2; the manifest refuses the second segment while the first remains unverified.

```bash
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs discover \
  --manifest "$manifest_file" --state-backup "$s0_file" \
  --known-message-ids "$known_ids_file" --anchor-before "$anchor_before"
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs apply \
  --manifest "$manifest_file"
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs verify \
  --manifest "$manifest_file"

# Repeat only after S0-S1 is verified. This discovery produces S1-S2.
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs discover \
  --manifest "$manifest_file" --state-backup "$s0_file" \
  --known-message-ids "$known_ids_file" --anchor-before "$anchor_before"
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs apply \
  --manifest "$manifest_file"
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs verify \
  --manifest "$manifest_file"

# Finalize only after the manifest contains both verified contiguous segments.
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs finalize \
  --manifest "$manifest_file"
```

Stop on discovery classification errors, unresolved relations, missing media or object evidence, unexpected identities/account counters, pending media, or unexpected live state. Preserve the existing allowlists and evidence checks; do not alter them to advance the cursor. Reviewed policy-skip or operation-metadata repair options are separate diagnostic interventions, not normal prerequisites or blanket bypasses.

If a completed full apply leaves relations whose targets were intentionally skipped, keep the consumer fenced and review them explicitly. Wait for any active apply to finish before using a new reviewed source revision. An incomplete full apply must first be retried normally; this repair cannot stand in for it.

```bash
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs verify \
  --manifest "$manifest_file" --review-policy-skipped-relations true
# A newly staged selection exits with recovery_relation_target_repairs_required_<count>.
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs apply \
  --manifest "$manifest_file"
node tools/whatsapp-private-matrix-sync/src/backfill-private-events.mjs verify \
  --manifest "$manifest_file"
```

The review reads every main message document and individually fetches and classifies each missing Matrix target. Only `matrix_notice` and `redacted_reaction_tombstone` are allowed. New reviewed operation hashes become a separate `policyRelationRepairPending` selection, bound by a SHA-256 proof to the account, exact segment/events, original apply/media evidence and reviewed policy evidence. The full segment remains applied, its original events and `lastApply` stay intact, and prior verification is invalidated. Do not edit the selection or combine it with missing-operation-metadata repair.

The next apply posts only those operations in duplicate-safe `backfill` mode, preserving deterministic IDs and draining the existing media queue without re-enqueuing the full history's media. Failures retain the pending selection for retry; it clears only after successful repair and an empty queue. A separate repair outcome appears in the sanitized summary. Pending repair blocks verification, the next discovery and finalization, even if an inconsistent manifest claims it was verified. The final plain `verify` still checks the entire original segment, all relations, media objects/thumbnails, identities and counters. No checkpoint advances during review or repair.

Finalization requires exactly two verified segments with `S0-S1.toToken === S1-S2.fromToken`, an empty media queue, and a live checkpoint equal to preserved S0 or the already-finalized state. It is idempotent and preserves the latest valid state. Only after finalization succeeds may the operator remove the fence and start the separate integration unit. If another limited timeline occurs, keep it fenced and perform another controlled recovery from the latest valid checkpoint. Never restore an older S0 over successful finalization or start the legacy shared consumer in parallel.

## Troubleshooting

- `401 unauthorized`: the adapter-local bearer token is missing, empty, or does not match the caller token.
- `setup_required` with `missing_matrix_outbound_targets`: the targets file is absent or not mounted where configured.
- `setup_required` with `missing_matrix_outbound_source_account`: the requested `sourceAccountId` is not present in the targets file.
- `setup_required` with `missing_matrix_outbound_target`: the source account exists, but the requested logical target such as `intex_agent` has no room mapping.
- `setup_required` with `missing_matrix_access_token` or `missing_matrix_homeserver_url`: the adapter cannot initialize an outbound Matrix client.

## Scheduled Notification Caveat

Daily calendar notifications depend on this outbound setup on the Matrix host
and on a reachable Hetzner-to-Matrix adapter base URL. Backend schedule
configuration can be enabled before the Matrix host is ready, so delivery
remains blocked until the host has a valid Matrix access token, outbound auth
token file, outbound targets mapping file for the user source account, and a
valid versioned `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL`.
