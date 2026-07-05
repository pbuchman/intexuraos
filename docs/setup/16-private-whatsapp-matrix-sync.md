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
to `POST /internal/whatsapp/private/events`. Both endpoints require the same
private-sync service account OIDC identity.

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

`MATRIX_OUTBOUND_AUTH_TOKEN_FILE` contains an adapter-local bearer token used by trusted internal callers on the Matrix host. `MATRIX_OUTBOUND_TARGETS_FILE` contains source-account to target-room mappings, for example:

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
7. Store `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` in Secret Manager for Hetzner production. The value must be a base URL that `whatsapp-service` on the Hetzner host can reach, such as an HTTPS endpoint on the Matrix host or an explicitly provisioned tunnel endpoint.
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

For new `m.image`, `m.audio`, and `m.video` events, the adapter downloads the Matrix media bytes with its Matrix access token, uploads the bytes to `POST /internal/whatsapp/private/media`, receives GCS metadata, and includes that metadata in the private event sent to `POST /internal/whatsapp/private/events`. Existing media messages without stored media metadata remain placeholders in the private log.

Backfills should use the same endpoint with `deliveryMode: "backfill"` and deterministic Matrix event ids so duplicate ingest does not double-count aggregates.

Deployment order: stop the Matrix sync adapter, deploy `whatsapp-service`, deploy the updated `tools/whatsapp-private-matrix-sync` container/configuration with `INTEXURAOS_WHATSAPP_PRIVATE_MEDIA_URL`, then restart the adapter. This prevents the old adapter from advancing the Matrix `next_batch` token while image bytes are not yet being copied into IntexuraOS.

## Outbound Adapter API

The adapter also exposes adapter-local outbound routes for scheduled delivery:

- `GET /internal/matrix/outbound/readiness/:sourceAccountId/:target`
- `POST /internal/matrix/outbound/messages`

Both require `Authorization: Bearer <token-from-MATRIX_OUTBOUND_AUTH_TOKEN_FILE>`.

Hetzner production reads `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL` from Secret Manager when `scripts/hetzner/load-secrets.sh` writes `/etc/intexuraos/.env.prod`. Do not point this value at `localhost` unless an operator has explicitly provisioned a localhost tunnel on the Hetzner host that forwards to the Matrix machine. Without a reachable base URL from Hetzner to the Matrix host, readiness remains blocked and scheduled notifications cannot deliver.

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

## Troubleshooting

- `401 unauthorized`: the adapter-local bearer token is missing, empty, or does not match the caller token.
- `setup_required` with `missing_matrix_outbound_targets`: the targets file is absent or not mounted where configured.
- `setup_required` with `missing_matrix_outbound_source_account`: the requested `sourceAccountId` is not present in the targets file.
- `setup_required` with `missing_matrix_outbound_target`: the source account exists, but the requested logical target such as `intex_agent` has no room mapping.
- `setup_required` with `missing_matrix_access_token` or `missing_matrix_homeserver_url`: the adapter cannot initialize an outbound Matrix client.

## Scheduled Notification Caveat

Daily calendar notifications depend on this outbound setup on the Matrix host and on a reachable Hetzner-to-Matrix adapter base URL. Backend schedule configuration can be enabled before the Matrix host is ready, so delivery remains blocked until the host has a valid Matrix access token, outbound auth token file, outbound targets mapping file for the user source account, and Secret Manager value for `INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_URL`.
