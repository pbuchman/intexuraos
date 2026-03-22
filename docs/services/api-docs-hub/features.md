# API Docs Hub

The single front door to every API in IntexuraOS — twenty services, one search bar, one URL.

## The Problem

You are building against a platform with twenty services. The research agent has an API. So does the calendar agent, the WhatsApp service, the code agent, and sixteen others. Each publishes its own OpenAPI specification at its own URL. To find the endpoint you need, you have to remember which service owns it, recall or look up that service's documentation URL, navigate there, and search. Multiply that by the number of times a day you check a request schema or verify a response shape, and scattered documentation slows you down every single day.

The issue is not that the documentation does not exist. Every service already publishes a complete spec. The issue is that it exists in twenty different places, and no one can hold twenty URLs in their head.

## Use Case: Finding What You Need

Built for any developer integrating with IntexuraOS — whether building a new feature, debugging a request, or onboarding to the platform for the first time.

You need to check the shape of a calendar event payload. Instead of hunting for the calendar agent's documentation URL, you open one bookmark: the docs hub. A dropdown at the top lists every service in the system. You select Calendar Agent API, and the full spec loads — endpoints, schemas, example payloads, all of it. You find what you need, then switch to the Research Agent API from the same dropdown to check a second endpoint. Two services, one tab, no context switch.

## How It Helps

### One URL, Every Service

Twenty services publish their API specifications independently. The docs hub collects all twenty into a single interactive documentation interface — Swagger UI — with a dropdown selector at the top. Pick a service, and its complete OpenAPI spec loads in the same interface. No bookmarks to maintain, no URLs to remember, no tabs to juggle.

### Always Current

The hub does not store copies of each specification. When you select a service, your browser fetches the live spec directly from that service. If an endpoint was added five minutes ago, it appears in the docs hub now. Documentation stays in sync with the running system without any manual refresh or redeployment step.

### Instant Discoverability

A developer's first visit to the docs hub reveals the full surface area of IntexuraOS in one glance. The dropdown lists every service by name — User Service, Research Agent, Code Agent, Cron Agent, Hellscript Agent, and fifteen more. For someone new to the platform, this is the fastest way to understand what exists and where to start.

### Shared Service Catalog

The hub's configuration now draws from a shared internal API catalog defined in `@intexuraos/common-core`. When a new service is added to the catalog, every consumer — including the docs hub — picks it up automatically. This replaced 70+ lines of hardcoded environment variable mappings with a single import, eliminating the risk of the docs hub falling out of sync when services are added or removed.

## Key Benefits

- **Single bookmark** — One URL replaces twenty, and the dropdown puts every service within two clicks
- **Live specifications** — Fetched directly from running services, so docs are never stale
- **Full platform map** — The dropdown doubles as a directory of every API in the system
- **Zero learning curve** — Built on Swagger UI, so any developer who has used API documentation before already knows how to navigate, test requests, and inspect schemas
- **Catalog-driven** — Service list is maintained in one shared catalog, keeping the hub in sync with the rest of the platform

## Limitations

- **Service must be running** — If a service is down, its specification will not load in the dropdown
- **No version history** — The hub always shows the current spec; there is no way to view a previous version
- **No built-in authentication** — To test authenticated endpoints through Swagger UI, you must manually provide a token
- **Static configuration** — Adding or removing a service from the hub requires a redeployment (though adding to the shared catalog is the only code change needed)

---

_Part of [IntexuraOS](../overview.md) — One interface for every API in the system._
