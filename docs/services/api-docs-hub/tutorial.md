# API Docs Hub - Tutorial

Centralized API documentation for IntexuraOS.

## Access

Visit: `https://api-docs-hub.intexuraos.com/docs`

## Using the Docs

1. Select service from dropdown (top-left)
2. Browse endpoints and schemas
3. Click "Try it out" to test endpoints
4. Enter bearer token in "Authorize" button

## Health Check

```bash
curl https://api-docs-hub.intexuraos.com/health
```

Expected response:

```json
{
  "status": "healthy",
  "serviceName": "api-docs-hub",
  "version": "0.0.4",
  "checks": [
    {
      "name": "config",
      "status": "ok",
      "latencyMs": 0,
      "details": { "sourceCount": 15 }
    }
  ]
}
```

## Available Services (15)

The hub currently aggregates specs from: User Service, Notion Service, WhatsApp Service, Mobile Notifications Service, Research Agent, Commands Agent, Actions Agent, Data Insights Agent, Image Service, Notes Agent, Todos Agent, Application Settings, Bookmarks Agent, Calendar Agent, and Chat Agent.

## Local Development

Run locally with PM2 (watch mode auto-reloads on code changes):

```bash
pm2 status          # Verify api-docs-hub is running
pm2 logs api-docs-hub --lines 50   # Human-readable logs (dev-mode formatting)
```

Or run directly:

```bash
pnpm --filter api-docs-hub start:local
```

The service starts on port 8080 by default. Visit `http://localhost:8080/docs`.

## Troubleshooting

| Issue            | Cause                              | Solution                            |
| ---------------- | ---------------------------------- | ----------------------------------- |
| Spec not loading | Service down                       | Check service status                |
| CORS error       | Service blocks origin              | Configure CORS on service           |
| Health "down"    | Missing env vars at startup        | Check all 15 `*_OPENAPI_URL` vars   |
| Startup crash    | Any required env var missing       | Run `direnv allow`, check ecosystem.config.cjs |
