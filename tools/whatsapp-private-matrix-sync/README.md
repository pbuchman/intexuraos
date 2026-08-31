# Private WhatsApp Matrix Sync

Operational adapter for synchronizing incoming private WhatsApp messages from an external Matrix homeserver into the IntexuraOS WhatsApp service.

This tool is intentionally placed under `tools/`, not `apps/`, because it is deployed outside IntexuraOS service infrastructure. The current production-like deployment target is the Home Dev machine setup stack in `pbuchman-dev`.

## Runtime

- Matrix/Synapse and mautrix-whatsapp produce Matrix rooms and `m.room.message` events.
- This adapter runs a Matrix `/sync` loop with a stored `next_batch` token.
- On the first successful sync it stores the batch token and skips historical events.
- Later sync batches are mapped to the private WhatsApp ingest payload and posted to IntexuraOS.
- For new Matrix image, audio, and video events, the adapter downloads media through the authenticated Matrix media API, uploads bytes to IntexuraOS, and only then posts the ingest event.
- The adapter is read-only with respect to WhatsApp. It only observes Matrix events and posts ingest batches.

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
docker build -t whatsapp-private-matrix-sync:local tools/whatsapp-private-matrix-sync
```

Stored media backfill for a message ingested before media upload metadata existed:

```bash
pnpm --filter whatsapp-private-matrix-sync backfill:media -- \
  --message-id 'message:pbuchman-private-whatsapp:$event-id' \
  --mxc-uri 'mxc://home-dev/media-id' \
  --mime-type 'audio/ogg' \
  --file-name 'Voice message.ogg'
```

## Relationship To Home Dev

`pbuchman-dev` owns the Home Dev machine setup and Docker Compose deployment wiring. IntexuraOS owns this adapter source and the API contract reference, so external Matrix deployments can be kept aligned with the production ingest API without copying undocumented code.
