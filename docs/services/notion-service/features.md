# Notion Service

Notion integration management - connect, disconnect, and sync Notion workspaces.

## The Problem

Users want Notion integration:

1. **Connection** - Secure Notion API token storage
2. **Status** - Check integration health
3. **Disconnection** - Remove integration
4. **Page access validation** - Verify pages are accessible before export

## How It Helps

Notion-service provides Notion integration lifecycle:

1. **Connect** - Validate and store Notion tokens
2. **Status** - Check connection health
3. **Disconnect** - Remove integration data
4. **Page preview** - Validate export targets for research-agent

## Key Features

**Connection flow:**

- User provides Notion token
- Service validates with Notion API
- Token stored securely
- Connection timestamps tracked

**Status endpoint:**

- Connection state (configured/connected)
- Connection timestamps (createdAt/updatedAt)

**Page preview:**

- Validates user has access to a specific Notion page
- Returns page title and URL
- Used by research-agent to validate export targets

**Webhook receiver:**

- Accepts Notion webhook events at `POST /notion-webhooks`
- Logs payloads for debugging and future processing
- No authentication required (Notion-signed events)

**Disconnection:**

- Removes stored token
- Clears cached data

## Use Cases

### Connect Notion

1. User generates integration token in Notion
2. POST to `/notion/connect` with token
3. Service validates and stores
4. Returns workspace info

### Check status

1. GET `/notion/status`
2. Returns connection state

### Disconnect

1. DELETE `/notion/disconnect`
2. Token removed, data cleared

## Key Benefits

**Secure storage** - Tokens encrypted at rest

**Validation** - Tokens validated before storage

**Clean disconnect** - Full data cleanup

**Observability** - Sentry error tracking + Dash0 OpenTelemetry tracing

## Limitations

**Notion-only** - No other integrations

**No sync** - Only manages connection lifecycle and page access

**Token required** - User must generate token manually

**No retry** - Connection failures require manual reconnect

**Webhook stub** - Webhook events are accepted and logged but not yet processed
