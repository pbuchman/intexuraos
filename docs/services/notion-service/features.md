# Notion Service

Connect your Notion workspace to IntexuraOS -- manage integration lifecycle and validate page access from a single service.

## The Problem

Integrating with Notion requires secure token handling, connection state tracking, and reliable page access validation. Without a dedicated service, each consuming service (like research-agent) would independently manage Notion credentials, duplicate validation logic, and risk inconsistent connection state. Users need a single, trusted gateway that validates tokens before storing them, tracks connection lifecycle, and exposes internal APIs for downstream services to verify page access.

## How It Helps

### Secure Token Connection

Validate Notion integration tokens against the Notion API before storing them. Invalid or expired tokens are rejected immediately with clear error messages.

**Example:** A user pastes their Notion integration token into the settings page. The service calls Notion's API to confirm the token works, then stores it in Firestore. If the token is invalid, the user sees "Invalid Notion token. Please check your integration token." -- no bad credentials are ever persisted.

### Connection Status at a Glance

Check whether a user's Notion integration is configured, connected, and when it was last updated -- all in a single API call.

**Example:** The web dashboard calls `GET /notion/status` on page load. If `configured: true` and `connected: true`, the Notion settings panel shows a green "Connected" badge with the connection timestamp. If `configured: true` but `connected: false`, it shows "Disconnected" with a reconnect prompt.

### Page Access Validation for Downstream Services

Internal services verify that a user's Notion token can access a specific page before attempting exports or reads. Returns page title and URL for display.

**Example:** When research-agent prepares to export research results to Notion, it calls the internal page preview endpoint. If the page is accessible, the export proceeds with the confirmed page title. If not, the user sees "Page not found or not accessible" -- preventing silent export failures.

### Clean Disconnection

Remove Notion integration in one step. The connection is marked inactive immediately, and the stored token becomes inaccessible.

**Example:** A user clicks "Disconnect Notion" in settings. The service marks the connection as inactive and returns confirmation. Any subsequent internal API calls for that user's Notion context return `connected: false`.

## Use Case

A user wants to export research results to a specific Notion page:

1. User generates a Notion integration token at notion.so/my-integrations
2. User submits the token via `POST /notion/connect` -- the service validates it with Notion's API and stores it
3. The web dashboard shows "Connected" status via `GET /notion/status`
4. When the user initiates a research export, research-agent calls `GET /internal/notion/users/:userId/pages/:pageId/preview` to verify access
5. The page title and URL are confirmed -- export proceeds
6. Later, the user disconnects via `DELETE /notion/disconnect` -- the integration is cleanly removed

## Key Benefits

- Tokens validated before storage -- no silent credential failures
- Single source of truth for Notion connection state across all services
- Internal page preview API prevents export failures before they happen
- Clean disconnect removes credentials and marks connection inactive immediately

## Limitations

- **Single workspace per user** -- reconnecting replaces the existing connection
- **Manual token generation** -- users must create integration tokens in Notion's settings
- **No real-time sync** -- manages connection lifecycle and page access only, not content synchronization
- **No automatic retry** -- connection failures require the user to reconnect manually
- **Webhook stub** -- webhook events at `POST /notion-webhooks` are accepted and logged but not yet processed

---

_Part of [IntexuraOS](../overview.md) -- Connect your Notion workspace, validate page access, and let your agents export with confidence._
