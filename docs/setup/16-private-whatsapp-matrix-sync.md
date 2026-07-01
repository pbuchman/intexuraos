# Private WhatsApp Matrix Sync

This is the canonical IntexuraOS reference for connecting an external Matrix/mautrix-whatsapp bridge to the private WhatsApp ingest API.

## Endpoint Changes

Created:

- `GET /whatsapp/private/account`
- `PUT /whatsapp/private/account`
- `DELETE /whatsapp/private/account`
- `POST /internal/whatsapp/private/media`
- `POST /internal/whatsapp/private/media/backfill`
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

The Matrix bridge runs outside IntexuraOS, currently on Home Dev. It should be Dockerized together with:

- Synapse
- mautrix-whatsapp
- Element Web for login/bridge administration
- `tools/whatsapp-private-matrix-sync`

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

Stored media backfill URL:

```text
https://intexuraos.cloud/internal/whatsapp/private/media/backfill
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

Image, audio, and video events upload media bytes to
`POST /internal/whatsapp/private/media` before the adapter posts the event batch
to `POST /internal/whatsapp/private/events`. Existing media placeholders can be
repaired by posting stored media metadata to
`POST /internal/whatsapp/private/media/backfill`. All three endpoints require
the same private-sync service account OIDC identity.

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

## User Configuration

1. Open `Settings > WhatsApp`.
2. Connect and verify the assistant WhatsApp phone number.
3. Enable `Private WhatsApp Mirror`.
4. Copy the displayed `sourceAccountId` into the Home Dev adapter configuration as `INTEXURAOS_SOURCE_ACCOUNT_ID`.
5. Keep Matrix tokens, WhatsApp bridge state, `.env`, and Google credential JSON out of Git.

## Message Flow

1. mautrix-whatsapp receives incoming private WhatsApp messages and mirrors them into Matrix rooms.
2. The sync adapter polls Matrix `/sync`.
3. On a first run, it stores the Matrix `next_batch` token and skips historical messages.
4. On later runs, it maps incoming Matrix message events into private WhatsApp ingest events.
5. It posts batches to IntexuraOS with OIDC internal auth and the per-user `sourceAccountId`.
6. IntexuraOS resolves `sourceAccountId` to the canonical user id.
7. IntexuraOS stores immutable message docs and updates sender/sender-day read models.

For new `m.image`, `m.audio`, and `m.video` events, the adapter downloads the Matrix media bytes with its Matrix access token, uploads the bytes to `POST /internal/whatsapp/private/media`, receives GCS metadata, and includes that metadata in the private event sent to `POST /internal/whatsapp/private/events`. Existing media messages without stored media metadata can be repaired by uploading the Matrix bytes and posting the resulting stored metadata to `POST /internal/whatsapp/private/media/backfill`.

Message backfills should use the ingest endpoint with `deliveryMode: "backfill"` and deterministic Matrix event ids so duplicate ingest does not double-count aggregates. Media placeholder backfills should use `POST /internal/whatsapp/private/media/backfill` for messages that already exist in IntexuraOS.

Deployment order: stop the Matrix sync adapter, deploy `whatsapp-service`, deploy the updated `tools/whatsapp-private-matrix-sync` container/configuration with `INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_URL`, then restart the adapter. This prevents the old adapter from advancing the Matrix `next_batch` token while image bytes are not yet being copied into IntexuraOS.
