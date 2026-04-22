# App Settings Service — Tutorial

> **Time:** 5 minutes
> **Prerequisites:** IntexuraOS dev environment running
> **You will learn:** How the service fits into the platform startup chain

---

## What You Will Build

An understanding of:

- How the health check endpoint works
- How downstream services depend on app-settings-service at startup
- How to verify the service is operational

---

## Prerequisites

Before starting, ensure you have:

- [ ] IntexuraOS dev environment configured
- [ ] PM2 running via `ecosystem.config.cjs`

---

## Part 1: Health Check (2 minutes)

### Step 1.1: Verify Service Health

```bash
curl -s http://localhost:8122/health | jq .
```

**Expected response:**

```json
{
  "status": "ok",
  "serviceName": "app-settings-service",
  "version": "0.0.4",
  "timestamp": "2026-04-22T12:00:00.000Z",
  "checks": [
    { "name": "secrets", "status": "ok", "latencyMs": 0 },
    { "name": "firestore", "status": "ok", "latencyMs": 15 }
  ]
}
```

### What Just Happened?

The health endpoint verifies two things: that required secrets (`INTEXURAOS_INTERNAL_AUTH_TOKEN`) are present, and that Firestore is reachable. Both must pass for the service to report `"ok"`.

---

## Part 2: OpenAPI Specification (2 minutes)

### Step 2.1: View the OpenAPI Spec

```bash
curl -s http://localhost:8122/openapi.json | jq .info
```

**Expected response:**

```json
{
  "title": "app-settings-service",
  "description": "IntexuraOS App Settings Service - Centralized configuration management",
  "version": "0.0.4"
}
```

### Step 2.2: Browse Swagger UI

Open `http://localhost:8122/docs` in your browser to see the interactive API documentation.

---

## Part 3: Startup Dependencies (1 minute)

Five services wait for app-settings-service to be healthy before starting:

```
user-service       --> polls http://localhost:8122/health
commands-agent     --> polls http://localhost:8122/health
actions-agent      --> polls http://localhost:8122/health
research-agent     --> polls http://localhost:8122/health
todos-agent        --> polls http://localhost:8122/health
```

If app-settings-service is down, these services will not start (30-second timeout).

---

## Troubleshooting

| Problem                    | Cause                                | Solution                                        |
| -------------------------- | ------------------------------------ | ----------------------------------------------- |
| Health returns "degraded"  | Firestore connectivity issue         | Check GCP credentials and project configuration |
| Health returns "down"      | Missing required secrets             | Verify `INTEXURAOS_INTERNAL_AUTH_TOKEN` is set  |
| Downstream services stuck  | app-settings-service not running     | Start the service or check PM2 status           |

---

## Note on Current State

As of v3.6.0, this service has no business endpoints. All LLM pricing and usage cost functionality was migrated to `llm-usage-service`. The service's primary role is as a startup health anchor for downstream services. See the [Technical Reference](technical.md) for details.

---

## Next Steps

1. Read the [Technical Reference](technical.md) for architecture details
2. Review the [Technical Debt](technical-debt.md) for consolidation considerations
3. See the `llm-usage-service` documentation for LLM pricing and usage cost APIs
