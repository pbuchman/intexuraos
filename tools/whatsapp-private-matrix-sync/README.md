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
