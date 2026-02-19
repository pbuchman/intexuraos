# API Docs Hub

OpenAPI documentation aggregator - unified Swagger UI for all IntexuraOS services.

## The Problem

API documentation is scattered:

1. **Multiple service docs** - Each service has its own Swagger UI
2. **Inconsistent URLs** - Different endpoints for documentation
3. **Hard to discover** - Developers must know each service URL

## How It Helps

API-docs-hub provides centralized documentation:

1. **Single URL** - One Swagger UI for all services
2. **Service selector** - Dropdown to switch between services
3. **Multi-spec aggregation** - Loads OpenAPI specs from all services
4. **Health check** - Config validation endpoint

## Key Features

**Aggregated Specs:**

- Fetches OpenAPI from configured services
- Displays in unified Swagger UI
- Service dropdown for navigation

**Health Endpoint:**

- `/health` - Checks configuration validity
- Returns source count

## Use Cases

### API exploration

1. Developer visits `/docs`
2. Selects service from dropdown
3. Explores endpoints and schemas
4. Tests API directly from Swagger UI

## Key Benefits

**Single source of truth** - All API docs in one place

**Always current** - Fetches live specs from services

**Discoverable** - Easy to find all available APIs

## Limitations

**Read-only** - No API testing capabilities beyond standard Swagger

**Service availability** - If service is down, its spec won't load

**No versioning** - Shows latest docs only

**No auth helper** - Must manually provide tokens

## Recent Changes

- **Dash0 OpenTelemetry integration** - Log pipeline now forwards to Dash0 via OTLP when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is configured, enabling centralized observability across all services
- **Dev-mode log formatting** - PM2 local runs now display human-readable log output instead of raw JSON, improving debugging experience
- **PromptVault removed** - PromptVault Service spec removed from aggregated sources following the feature removal (INT-319)
- **Chat Agent added** - New Chat Agent API spec added to the aggregated documentation hub
- **15 service specs** - Now aggregates OpenAPI specs from 15 services (was 16, minus PromptVault, plus Chat Agent)
