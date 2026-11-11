# Private WhatsApp Matrix Sync

Operational adapter for synchronizing incoming private WhatsApp messages from an external Matrix homeserver into the IntexuraOS WhatsApp service.

This tool is deployed independently of the IntexuraOS services and Matrix core. IntexuraOS owns its canonical source, image, deployment and supervisor under [`deploy/home-dev/`](deploy/home-dev/README.md). `pbuchman-dev` owns the standalone homeserver, WhatsApp bridge and host ingress.

## Runtime

- Matrix/Synapse and mautrix-whatsapp produce Matrix rooms and `m.room.message` events.
- This adapter runs a Matrix `/sync` loop with a stored `next_batch` token.
- On the first successful sync it stores the batch token and skips historical events.
- Later sync batches are mapped to the private WhatsApp ingest payload and posted to IntexuraOS.
- Valid unstable Matrix poll responses are preserved in `rawMatrixEvent` and ingested as unknown messages without inventing text or reaction content.
- For new Matrix image, audio, and video events, the adapter ingests message metadata first and durably queues media before advancing the checkpoint. It then downloads media through the authenticated Matrix media API, uploads bytes to IntexuraOS, and attaches the stored media to the existing message. Pending media stays queued for retry and keeps synchronization health degraded.
- Live synchronization consumes Matrix events and posts ingest batches. Eligible WhatsApp portal invites may be joined. The separately authorized outbound API sends Matrix messages to configured targets.

## IntexuraOS Contract

The adapter posts to:

```text
https://intexuraos.cloud/internal/whatsapp/private/events
```

Authentication uses Google OIDC ID tokens:

- Audience: `https://intexuraos.cloud`
- Impersonated service account: `intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`

Required ingest payload fields:

- `sourceAccountId`
- `deliveryMode`
- `events`

`sourceAccountId` is copied from `Settings > WhatsApp > Private WhatsApp Mirror`. The adapter may still include `userId` for compatibility, but the IntexuraOS API ignores it and resolves the canonical owner from `sourceAccountId`.

Supported delivery modes:

- `live` for this sync adapter
- `backfill` for separate deterministic replay tooling

## Configuration

Copy `.env.example` into the deployment environment and provide secrets through files or the container secret mechanism. Do not commit:

- Matrix access tokens
- WhatsApp bridge/session state
- `.env`
- Google credential JSON
- generated `data/` directories

The adapter requires:

- `MATRIX_HOMESERVER_URL`
- `MATRIX_USER_ID`
- `MATRIX_ACCESS_TOKEN_FILE`
- `MATRIX_OUTBOUND_AUTH_TOKEN_FILE`
- `MATRIX_OUTBOUND_TARGETS_FILE`
- `INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL`
- `INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_URL`
- `INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_BACKFILL_URL` (optional, defaults from the events URL)
- `INTEXURAOS_GOOGLE_APPLICATION_CREDENTIALS_FILE` or `GOOGLE_APPLICATION_CREDENTIALS`
- `INTEXURAOS_OIDC_AUDIENCE`
- `INTEXURAOS_OIDC_IMPERSONATE_SERVICE_ACCOUNT`
- `INTEXURAOS_SOURCE_ACCOUNT_ID`
- `SOURCE_WHATSAPP_PHONE_NUMBER`
- `MATRIX_BRIDGE_BOT_USERS` (comma-separated Matrix user IDs to ignore)
- `WHATSAPP_SYNC_STATE_FILE`

`MATRIX_OUTBOUND_AUTH_TOKEN_FILE` is an adapter-local bearer token used by trusted callers on the Matrix host for health, outbound readiness, and send requests. It must be distinct from the Matrix homeserver access token. The adapter fails closed before sync and rejects HTTP authorization when the two paths or their trimmed token values are equal. `MATRIX_OUTBOUND_TARGETS_FILE` points to a JSON mapping from `sourceAccountId` and logical target name to a Matrix room id, for example:

```json
{
  "pbuchman-private-whatsapp": {
    "intex_agent": "!roomid:home-dev"
  }
}
```

## Health And Outbound Matrix Delivery

The adapter exposes these protected adapter-local endpoints:

- `GET /health`
- `GET /internal/matrix/outbound/readiness/:sourceAccountId/:target`
- `POST /internal/matrix/outbound/messages`

All three endpoints require the exact
`Authorization: Bearer <token-from-MATRIX_OUTBOUND_AUTH_TOKEN_FILE>` header. Missing, empty,
unreadable, whitespace-only, or non-matching token material fails closed with `401`.

`/health` returns `200` only while `state` is `running` and a complete successful sync iteration finished less than 120 seconds ago. A quiet channel stays healthy after successful polling. Starting, credential waits, errors, recovery fences, pending media and stale progress return `503` with `ok: false`. A retry keeps its previous failure visible until it completes. The response includes `lastSuccessfulPollAt`, `lastCheckpointAt`, `lastIngestAt` and `lastSuccessfulIterationAt` when observed in the current process; no event content or credentials are returned. Poll and checkpoint timestamps can advance while media is pending; only completion clears degraded health.

The image checks authenticated health every 30 seconds with a 120-second start period. Unhealthy health alone does not restart the container. The separate supervisor restarts failed processes with bounded attempts, and recovery remains manual.

Readiness returns only configuration state:

- `{ "status": "ready" }`
- `{ "status": "setup_required", "reason": "..." }`

Send expects:

```json
{
  "sourceAccountId": "pbuchman-private-whatsapp",
  "target": "intex_agent",
  "text": "new session: Send me events that they have in the calendar in the next 24 hours.",
  "idempotencyKey": "calendar-daily-lookahead-2026-07-04"
}
```

`text` is the raw Matrix message body. Calendar schedules keep the user prompt as
`Send me events that they have in the calendar in the next 24 hours.` and
`whatsapp-service` applies the `new session:` command prefix when
`startNewSession` is requested.

On success it sends a Matrix `m.room.message` with `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` and returns `{ "status": "sent", "matrixEventId": "$..." }`.

## Troubleshooting

- `401 unauthorized`: the caller token does not match `MATRIX_OUTBOUND_AUTH_TOKEN_FILE`, or the file is missing/empty.
- `setup_required` with `missing_matrix_outbound_targets`: `MATRIX_OUTBOUND_TARGETS_FILE` is unset, unreadable, or missing on disk.
- `setup_required` with `missing_matrix_outbound_source_account`: the file does not contain the requested `sourceAccountId`.
- `setup_required` with `missing_matrix_outbound_target`: the source account exists, but the requested logical target such as `intex_agent` is not mapped.
- `setup_required` with `missing_matrix_access_token` or `missing_matrix_homeserver_url`: the adapter cannot initialize a sendable Matrix client for outbound delivery.

## Scheduled Delivery Caveat

Scheduled calendar notifications depend on the outbound adapter setup above. The IntexuraOS UI can only report delivery as ready after the Matrix host has all three pieces in place: the Matrix access token, the outbound auth token file, and the outbound targets mapping file. Without that host-side setup, scheduled notification saves can succeed while delivery remains `setup_required`.

## Development

```bash
pnpm --filter whatsapp-private-matrix-sync test
```

Docker image build:

```bash
# From the exact reviewed commit, with clean canonical tool source:
bash tools/whatsapp-private-matrix-sync/deploy/home-dev/build.sh "$(git rev-parse HEAD)"
```

The image uses `npm ci` with the canonical lockfile, `google-auth-library` 10.9.1 and a digest-pinned Node 22.23.3 base. Real builds carry the exact source revision label. Run the isolated image/TLS/lifecycle rehearsal with `pnpm --filter whatsapp-private-matrix-sync test:image`; it builds a separate fixture-labeled image with a sentinel revision and never mounts live state or credentials.

Stored media backfill for a message ingested before media upload metadata existed:

```bash
pnpm --filter whatsapp-private-matrix-sync backfill:media -- \
  --message-id 'message:pbuchman-private-whatsapp:$event-id' \
  --mxc-uri 'mxc://home-dev/media-id' \
  --mime-type 'audio/ogg' \
  --file-name 'Voice message.ogg'
```

## Relationship To Home Dev

The integration has its own Compose project `intexuraos-matrix-sync`, unit `intexuraos-matrix-sync.service` and deployment directory `/home/pbuchman/services/intexuraos-matrix-sync`. Its installer only prepares files and never starts a consumer. It connects to `https://home-dev` through the host gateway with the active Caddy public root CA; it does not join the Matrix core network. See the [deployment and rollback procedure](deploy/home-dev/README.md) and [controlled two-segment recovery](../../docs/setup/16-private-whatsapp-matrix-sync.md#controlled-history-recovery).
