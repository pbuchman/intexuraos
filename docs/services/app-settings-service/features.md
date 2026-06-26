# App Settings Service

Centralized configuration hub for IntexuraOS platform settings.

## The Problem

A distributed microservices platform needs a single source of truth for shared configuration. Without a dedicated settings service, each service manages its own configuration in isolation, leading to inconsistencies, stale values, and no centralized place to query or update platform-wide settings.

## Current State (v3.6.0)

In v3.6.0, LLM pricing and usage cost analytics were migrated to the dedicated `llm-usage-service` (INT-1387, INT-1342). The service currently operates as a minimal configuration scaffold with health check infrastructure. Other services in the platform still depend on it at startup via health check polling, and the service remains registered in the internal service catalog, Terraform, and PM2 ecosystem.

## How It Helps

### Platform Health Anchor

Multiple services poll the app-settings-service health endpoint before starting. This dependency chain ensures that shared infrastructure (Firestore, secrets) is verified before downstream services begin accepting traffic.

**Example:** When the dev environment starts, user-service, intex-agent, and research-agent all wait for app-settings-service to report healthy before booting.

### OpenAPI Service Catalog Participant

The service exposes its OpenAPI specification at `/openapi.json` and Swagger UI at `/docs`, making it discoverable by the api-docs-hub aggregator.

## Key Benefits

- **Startup dependency anchor** for four downstream services that poll its health endpoint
- **OpenAPI-compliant** with auto-generated Swagger documentation
- **Infrastructure-ready** with Sentry error tracking, CORS, and standardized health checks

## Limitations

- **No business endpoints** since v3.6.0 — all LLM pricing and usage cost routes were removed
- **No domain logic** — domain ports and Firestore infra layers are empty scaffolds
- **No test files** — all tests were removed alongside the pricing functionality
- **Candidate for consolidation** — the service's remaining responsibilities (health anchor, OpenAPI spec) could be absorbed by another service

---

_Part of [IntexuraOS](../overview.md) — Platform configuration and service health orchestration._
