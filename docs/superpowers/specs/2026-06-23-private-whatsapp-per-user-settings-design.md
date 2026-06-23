# Private WhatsApp Per-User Settings Design

## Summary

Private WhatsApp sync must be modeled as one read-only private mirror per authenticated IntexuraOS user. It must be configured from `Settings > WhatsApp`, not from app-wide owner/source-account secrets.

The external Matrix/Home Dev adapter may still send a `sourceAccountId`, but IntexuraOS owns the mapping from `sourceAccountId` to the canonical Auth0 `userId`. The adapter must not decide which user owns incoming private WhatsApp messages.

## Product Direction

`Settings > WhatsApp` becomes the single place where a user understands and configures WhatsApp-related behavior.

The page should separate two modes:

- `Assistant`: the existing WhatsApp Business/mobile assistant connection. This is the current verified phone-number flow that saves phone mappings for notes, commands, and mobile assistant behavior.
- `Private mirror`: the new read-only private WhatsApp sync. This mirrors incoming private WhatsApp messages from the external Matrix bridge into IntexuraOS.

The private mirror is one per user. A user can enable or disable their private mirror, but v1 does not support multiple private WhatsApp accounts for the same user.

## Existing Behavior

The current `Settings > WhatsApp` page already stores phone numbers per authenticated user:

- Web page: `apps/web/src/pages/WhatsAppConnectionPage.tsx`
- Web API client: `apps/web/src/services/whatsappApi.ts`
- Backend routes:
  - `POST /whatsapp/verify/send`
  - `POST /whatsapp/verify/confirm`
  - `GET /whatsapp/verify/status/:phone`
  - `POST /whatsapp/connect`
  - `GET /whatsapp/status`
  - `DELETE /whatsapp/disconnect`
- Firestore mapping: `whatsapp_user_mappings/{userId}`

Phone numbers are normalized to digits only, without `+`.

The new private mirror should build on this existing verified phone-number concept rather than introducing separate app-wide ownership secrets.

## Data Model

Add a new collection:

```text
whatsapp_private_accounts
```

Use one document per user:

```text
whatsapp_private_accounts/{userId}
```

Document shape:

```ts
interface PrivateWhatsAppAccount {
  id: string; // same as userId
  userId: string; // canonical Auth0 user id
  sourceAccountId: string; // stable account id used by the external adapter
  phoneNumberNormalized: string; // selected verified phone, digits only
  displayName: string; // default "Private WhatsApp"
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  lastIngestAt?: string;
  lastEventAt?: string;
  messageCount?: number;
  senderCount?: number;
  schemaVersion: 1;
}
```

`sourceAccountId` should be generated server-side and remain stable. For new accounts, use a deterministic, non-secret value derived from the canonical user id, for example:

```text
private-wa_<hash(userId)>
```

For the current existing account, preserve:

```text
sourceAccountId = pbuchman-private-whatsapp
userId = google-oauth2|113131655542389277022
```

## Endpoint Changes

### Created

```text
GET /private/account
```

Returns the authenticated user’s private WhatsApp account, or `null` if not enabled.

```text
PUT /private/account
```

Creates or updates the authenticated user’s private WhatsApp account. Request includes the selected verified phone number. The server verifies that the phone number belongs to the authenticated user through the existing `whatsapp_user_mappings` / verification flow.

```text
DELETE /private/account
```

Disables the authenticated user’s private mirror by setting `status = "disabled"`. It must not delete historical messages in v1.

### Modified

```text
GET /private/senders
GET /private/messages
GET /private/sender-days
```

These routes must:

1. Authenticate with `requireAuth()`.
2. Resolve `whatsapp_private_accounts/{user.userId}`.
3. Require `status = "active"`.
4. Query private read models by the resolved `sourceAccountId`.
5. Never accept `sourceAccountId` from the browser.

```text
POST /internal/whatsapp/private/events
```

This route must:

1. Accept `sourceAccountId` from the external adapter.
2. Resolve `sourceAccountId` to a single active private account.
3. Stamp the canonical account `userId` on chats, messages, senders, and sender-day docs.
4. Reject unknown or disabled `sourceAccountId`.

### Removed

Remove these app-wide secrets from the design and from the service config:

```text
INTEXURAOS_PRIVATE_WHATSAPP_OWNER_USER_ID
INTEXURAOS_PRIVATE_WHATSAPP_SOURCE_ACCOUNT_ID
```

### Unchanged

Existing WhatsApp Business/mobile assistant routes remain in place:

```text
POST /whatsapp/verify/send
POST /whatsapp/verify/confirm
GET /whatsapp/verify/status/:phone
POST /whatsapp/connect
GET /whatsapp/status
DELETE /whatsapp/disconnect
GET /whatsapp/preferences
PUT /whatsapp/preferences
```

Existing internal agent read APIs may remain, but they should use canonical account ownership when appropriate:

```text
GET /internal/whatsapp/private/messages
GET /internal/whatsapp/private/sender-days
POST /internal/whatsapp/private/aggregates/rebuild
```

## Settings UI

`Settings > WhatsApp` should show two clearly labeled sections.

### Assistant Section

Keep the current behavior:

- Enter phone numbers.
- Send verification code.
- Confirm verification code.
- Connect/update/disconnect the assistant WhatsApp mapping.
- Configure notification preferences.

The copy should make clear that this section controls the assistant/mobile workflow.

### Private Mirror Section

Add a new card below or beside the assistant connection card.

When no verified assistant phone number exists:

- Show that private mirror setup requires a verified WhatsApp phone number first.
- Do not show advanced adapter details yet.

When verified phone numbers exist and no private mirror is enabled:

- Let the user pick one verified phone number.
- Button: `Enable private mirror`.
- Explain that this is read-only and mirrors incoming private WhatsApp messages into IntexuraOS.

When private mirror is active:

- Show status: `Active`.
- Show selected phone number.
- Show `sourceAccountId`.
- Show last ingest time, last event time, message count, and sender count when available.
- Show a concise adapter configuration block for Home Dev:

```text
INTEXURAOS_SOURCE_ACCOUNT_ID=<sourceAccountId>
INTEXURAOS_WHATSAPP_PRIVATE_EVENTS_URL=https://intexuraos.cloud/internal/whatsapp/private/events
INTEXURAOS_OIDC_AUDIENCE=https://intexuraos.cloud
INTEXURAOS_OIDC_IMPERSONATE_SERVICE_ACCOUNT=intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com
```

- Button: `Disable private mirror`.
- No delete-history action in v1.

## Ingest Ownership Rule

The adapter sends:

```ts
{
  sourceAccountId: string;
  deliveryMode: "live" | "backfill";
  events: PrivateWhatsAppEvent[];
}
```

The adapter may include `userId` temporarily for backwards compatibility, but IntexuraOS must ignore it for ownership. Ownership is resolved only from `sourceAccountId`.

Canonical rule:

```text
sourceAccountId -> whatsapp_private_accounts -> userId
```

This rule prevents a misconfigured external adapter from writing private messages into the wrong user’s account.

## Existing Data Repair

Current Firestore state has private WhatsApp docs with:

```text
sourceAccountId = pbuchman-private-whatsapp
userId = pbuchman
```

Repair path:

1. Create `whatsapp_private_accounts/google-oauth2|113131655542389277022`.
2. Set `sourceAccountId = pbuchman-private-whatsapp`.
3. Set `status = "active"`.
4. Set `phoneNumberNormalized` to the already verified WhatsApp phone number from `whatsapp_user_mappings/google-oauth2|113131655542389277022`.
5. Backfill `userId = google-oauth2|113131655542389277022` across:
   - `whatsapp_private_chats`
   - `whatsapp_private_messages`
   - `whatsapp_private_senders`
   - `whatsapp_private_sender_days`
6. Rebuild sender and sender-day aggregates if needed.

This repair should be implemented as an idempotent migration or internal repair command, not a manual Firestore edit.

## Documentation Requirements

Update:

- `docs/setup/16-private-whatsapp-matrix-sync.md`
- `tools/whatsapp-private-matrix-sync/README.md`
- WhatsApp service docs/API reference if present in generated docs
- Settings page copy/tests

Docs must say:

1. First configure `Settings > WhatsApp > Private mirror`.
2. Copy the generated `sourceAccountId` into the Home Dev adapter configuration.
3. The adapter does not own `userId`.
4. IntexuraOS resolves account ownership from `sourceAccountId`.
5. No Matrix tokens, WhatsApp session state, `.env`, service account JSON, or generated bridge data should be committed.

## Security And Privacy

- Browser routes never accept `sourceAccountId`.
- Browser routes never return `sourceAccountId` except from `GET /private/account`, where it is shown only to the owner as adapter configuration.
- Message read APIs return sanitized message documents only.
- Logs must not include message text, phone numbers, sender names, or sender keys.
- Adapter-provided `userId` must not determine ownership.
- Disabling the private mirror stops future ingest for that `sourceAccountId` but keeps historical messages.

## Acceptance Criteria

- A user can configure exactly one private WhatsApp mirror from `Settings > WhatsApp`.
- The private mirror uses an existing verified phone number.
- Public private read endpoints resolve the authenticated user’s account server-side.
- Internal ingest resolves `sourceAccountId` to the canonical user id.
- Existing data for `pbuchman-private-whatsapp` is linked to `google-oauth2|113131655542389277022`.
- Existing private docs no longer rely on `userId = pbuchman`.
- No app-wide owner/source-account secrets are required.
- Home Dev adapter documentation points users to the generated per-user `sourceAccountId`.
- PR #2144 is amended before merge to follow this per-user design.

## Deferred

- Multiple private mirrors per user.
- Realtime streaming in the web UI.
- Reply/send/delete controls for private messages.
- Matrix bridge management inside IntexuraOS.
- Deleting historical private WhatsApp messages from the settings UI.
