# API Docs Hub

The single front door to the configured IntexuraOS APIs — up to seventeen services, one service selector, one URL.

## The Problem

You are building against a platform with seventeen services. The research agent has an API. So does the calendar agent, the WhatsApp service, the code agent, and thirteen others. Each publishes its own OpenAPI specification at its own URL. To find the endpoint you need, you have to remember which service owns it, recall or look up that service's documentation URL, navigate there, and search. Multiply that by the number of times a day you check a request schema or verify a response shape, and scattered documentation slows you down every single day.

The issue is not that the documentation does not exist. Every service already publishes a complete spec. The issue is that it exists in seventeen different places, and no one can hold seventeen URLs in their head.

## Use Case: Finding What You Need

Built for any developer integrating with IntexuraOS — whether building a new feature, debugging a request, or onboarding to the platform for the first time.

You need to check the shape of a calendar event payload. Instead of hunting for the calendar agent's documentation URL, you open one bookmark: the docs hub. A dropdown at the top lists the configured services. You select Calendar Agent API, and the full spec loads — endpoints, schemas, example payloads, all of it. You find what you need, then switch to the Research Agent API from the same dropdown to check a second endpoint. Two services, one tab, no context switch.

## How It Helps

### One URL, Every Service

The default catalog covers seventeen services that publish their API specifications independently. The docs hub collects their specifications into a single interactive documentation interface — Swagger UI — with a dropdown selector at the top. Pick a service, and its complete OpenAPI spec loads in the same interface. No bookmarks to maintain, no URLs to remember, no tabs to juggle.

### Always Current

The hub does not store copies of each specification. When you select a service, your browser fetches the live spec directly from that service. If an endpoint was added five minutes ago, it appears in the docs hub now. Documentation stays in sync with the running system without any manual refresh or redeployment step.

### Instant Discoverability

A developer's first visit to the docs hub reveals the full surface area of IntexuraOS in one glance. The dropdown lists each configured service by name — User Service, Research Agent, Code Agent, Hellscript Agent, and the rest of the active API surface. For someone new to the platform, this is the fastest way to understand what exists and where to start.

### Self-Contained Configuration

The hub maintains its own service catalog directly in `config.ts` via the `OPEN_API_SOURCE_CATALOG` constant. Each entry maps a display name to its environment variable, making it straightforward to add, remove, or reorder services without touching shared packages or coordinating cross-service changes.

### Profile-Aware Catalog

A reduced profile can list only its enabled services without requiring documentation URLs for excluded services. The default catalog still includes all seventeen. Invalid selections or missing required URLs stop startup, so the selected catalog remains explicit.

## Key Benefits

- **Single bookmark** — One URL replaces seventeen, and the dropdown puts every service within two clicks
- **Live specifications** — Fetched directly from running services, so docs are never stale
- **Configured API map** — The dropdown doubles as a directory of the selected service APIs
- **Zero learning curve** — Built on Swagger UI, so any developer who has used API documentation before already knows how to navigate, test requests, and inspect schemas
- **Self-contained** — Service catalog is defined locally, so changes to the hub's configuration do not require cross-package coordination

## Limitations

- **Service must be running** — If a service is down, its specification will not load in the dropdown
- **No version history** — The hub always shows the current spec; there is no way to view a previous version
- **No built-in authentication** — To test authenticated endpoints through Swagger UI, you must manually provide a token
- **Static configuration** — Adding or removing a service from the hub requires a redeployment with the new environment variable

---

_Part of [IntexuraOS](../overview.md) — One interface for every API in the system._
