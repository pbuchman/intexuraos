# Private WhatsApp Matrix Sync

This is the canonical IntexuraOS reference for connecting an external Matrix/mautrix-whatsapp bridge to the private WhatsApp ingest API.

## Endpoint Changes

Created: none in this documentation/tooling PR.

Modified: none.

Removed: none.

Unchanged: the private WhatsApp internal endpoints are consumed as documented below.

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
- `userId`
- `deliveryMode`
- `events`

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

## Message Flow

1. mautrix-whatsapp receives incoming private WhatsApp messages and mirrors them into Matrix rooms.
2. The sync adapter polls Matrix `/sync`.
3. On a first run, it stores the Matrix `next_batch` token and skips historical messages.
4. On later runs, it maps incoming Matrix message events into private WhatsApp ingest events.
5. It posts batches to IntexuraOS with OIDC internal auth.
6. IntexuraOS stores immutable message docs and updates sender/sender-day read models.

Backfills should use the same endpoint with `deliveryMode: "backfill"` and deterministic Matrix event ids so duplicate ingest does not double-count aggregates.
