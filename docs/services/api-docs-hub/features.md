# API Docs Hub

Unified Swagger UI for all IntexuraOS service APIs -- one URL to explore every endpoint.

## The Problem

API documentation is scattered across 15 separate microservices. Each service hosts its own OpenAPI spec at its own URL. Developers must know every service URL, navigate to each individually, and mentally stitch together how APIs relate. Discovering available endpoints requires tribal knowledge or digging through code.

## How It Helps

### Single-URL Documentation Portal

Access all 15 service APIs from one browser tab. No bookmarks, no URL hunting, no guessing which service handles what.

**Example:** A developer building a new integration visits `/docs`, selects "Research Agent API" from the dropdown, and immediately sees every endpoint with request/response schemas.

### Service Selector Dropdown

Switch between service specs instantly using the built-in Swagger UI dropdown. Each service appears by its display name, making discovery intuitive.

**Example:** While testing the Actions Agent API, you realize you need the User Service endpoint format. Switch services in the dropdown without opening a new tab.

### Live Spec Fetching

Swagger UI fetches OpenAPI specs directly from each running service. Documentation always reflects the currently deployed API, not a stale snapshot.

**Example:** After deploying a new endpoint to commands-agent, the documentation in the hub updates automatically -- no rebuild or redeployment of the hub required.

### Health Monitoring

The `/health` endpoint validates that all 15 service sources are configured, providing a quick check that the documentation hub is operational.

**Example:** Infrastructure monitoring hits `/health` and confirms `sourceCount: 15` with status `ok`, ensuring no service was accidentally dropped from the configuration.

## Use Case

A new developer joins the team and needs to understand the IntexuraOS API surface. They visit `https://api-docs-hub.intexuraos.com/docs`, see a dropdown listing all 15 services, and systematically explore each one. They find the endpoint they need, use "Try it out" to send a test request, and verify the response format -- all without leaving the browser.

## Key Benefits

- All API documentation accessible from a single URL
- Always up-to-date with currently deployed services
- Zero maintenance for documentation content -- specs are fetched live
- Fail-fast startup prevents silent misconfiguration

## Limitations

- Read-only documentation -- no API testing capabilities beyond standard Swagger "Try it out"
- If a service is down, its spec will not load in the UI
- Shows only the latest API version -- no historical version support
- No built-in authentication helper -- tokens must be entered manually
- Static configuration -- adding or removing a service requires redeployment

## Recent Changes

- **v3.1.0** (2026-02-22) -- Release version bump
- **v3.0.0** (2026-02-19) -- Release version bump
- **Dash0 OpenTelemetry integration** -- Log pipeline forwards to Dash0 via OTLP when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is configured
- **Dev-mode log formatting** -- PM2 local runs display human-readable log output instead of raw JSON
- **PromptVault removed** -- PromptVault Service spec removed following feature removal (INT-319)
- **Chat Agent added** -- Chat Agent API spec added to the aggregated documentation hub
- **15 service specs** -- Aggregates OpenAPI specs from 15 services

---

_Part of [IntexuraOS](../overview.md) -- All your APIs, one place._
