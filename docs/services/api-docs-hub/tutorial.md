# API Docs Hub — Tutorial

> **Time:** 10 minutes
> **Prerequisites:** Running IntexuraOS services (local or dev environment)
> **You will learn:** How to access and navigate unified API documentation for all IntexuraOS services

---

## What You Will Build

A working understanding of:

- Accessing the centralized API documentation portal
- Navigating between service specs using the dropdown
- Testing API endpoints from the Swagger UI
- Verifying the hub's health status

---

## Prerequisites

Before starting, ensure you have:

- [ ] At least one IntexuraOS service running (for live spec fetching)
- [ ] Browser access to the hub URL (local or deployed)

---

## Part 1: Access the Documentation (2 minutes)

### Step 1.1: Open the Hub

**Production:**

```
https://api-docs-hub.intexuraos.com/docs
```

**Local development:**

```bash
pnpm --filter api-docs-hub start:local
```

Then visit `http://localhost:8080/docs`.

### What You Should See

Swagger UI loads with a dropdown in the top-left corner listing all 18 configured services. The first service in the list is selected by default.

---

## Part 2: Navigate Between Services (3 minutes)

### Step 2.1: Use the Service Dropdown

Click the dropdown at the top of the Swagger UI page. You will see entries such as:

- User Service API
- Research Agent API
- Commands Agent API
- Chat Agent API
- Code Agent API
- Linear Agent API
- Web Agent API
- ... and 11 more

### Step 2.2: Select a Service

Choose "Research Agent API" from the dropdown. The UI reloads with that service's full OpenAPI spec, showing all endpoints grouped by tags.

### Step 2.3: Browse Endpoints

Expand an endpoint group (e.g., "research") to see individual operations. Click on an endpoint to view:

- Request parameters and body schema
- Response schema with example values
- Required authentication headers

**Checkpoint:** You should see endpoint details with request/response schemas rendered inline.

---

## Part 3: Test an Endpoint (3 minutes)

### Step 3.1: Try the Health Check

Switch to any service (or stay on the hub itself) and find the `GET /health` endpoint.

Alternatively, test the hub's own health check directly:

```bash
curl https://api-docs-hub.intexuraos.com/health
```

**Expected response:**

```json
{
  "status": "healthy",
  "serviceName": "api-docs-hub",
  "version": "0.0.5",
  "checks": [
    {
      "name": "config",
      "status": "ok",
      "latencyMs": 0,
      "details": {
        "sourceCount": 18
      }
    }
  ]
}
```

### Step 3.2: Use "Try it out" on a Service Endpoint

1. Select a service with public endpoints (e.g., User Service API)
2. Find a `GET` endpoint
3. Click "Try it out"
4. Click "Authorize" and enter your Bearer token
5. Click "Execute"

**Checkpoint:** You should see a live response from the service.

---

## Part 4: Run Locally (2 minutes)

### Step 4.1: Set Environment Variables

All 18 `*_OPENAPI_URL` environment variables must be set. If using `direnv`, these are loaded from `.envrc`. Verify:

```bash
env | grep OPENAPI_URL | wc -l
```

Expected output: `18`

### Step 4.2: Start the Service

```bash
pnpm --filter api-docs-hub start:local
```

The service starts on port 8080 by default. Logs display in human-readable format when running locally.

### Step 4.3: Verify

```bash
curl http://localhost:8080/health | jq .
```

---

## Troubleshooting

| Issue                 | Cause                          | Solution                                                  |
| --------------------- | ------------------------------ | --------------------------------------------------------- |
| Spec not loading      | Target service is down         | Check target service status and network accessibility     |
| CORS error            | Service blocks browser origin  | Configure CORS headers on the target service              |
| Health returns "down" | Missing env vars at startup    | Ensure all 18 `*_OPENAPI_URL` vars are set                |
| Startup crash         | Any required env var missing   | Run `direnv allow` and verify with `env                   | grep OPENAPI` |
| Blank Swagger UI      | All services unreachable       | Verify at least one service URL is reachable from browser |
| Port conflict         | Port 8080 already in use       | Set `PORT=8081` or stop the conflicting process           |

---

## Next Steps

1. Explore each of the 18 service APIs to understand the full IntexuraOS surface
2. Read the [Technical Reference](technical.md) for architecture details
3. Check individual service documentation for endpoint-specific tutorials

---

## Exercises

Test your understanding:

1. **Easy:** Find which service provides the `/internal/messages/send` endpoint
2. **Medium:** Count the total number of endpoints across all 18 services
3. **Hard:** Identify which services have internal-only endpoints (no public routes)

<details>
<summary>Solutions</summary>

### Exercise 1: Find the Send Message Endpoint

Select "WhatsApp Service API" from the dropdown and look under the internal endpoints section.

### Exercise 2: Count Total Endpoints

Switch through each of the 18 services in the dropdown and tally the endpoint count shown at the top of each spec. The total varies as services evolve.

### Exercise 3: Internal-Only Services

Review each service spec. Services like actions-agent and commands-agent have a mix of public and internal endpoints. The api-docs-hub itself has only public endpoints (`/docs` and `/health`).

</details>
