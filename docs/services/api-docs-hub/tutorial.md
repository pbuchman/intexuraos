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

## Available Services (15)

The hub currently aggregates specs from: User Service, Notion Service, WhatsApp Service, Mobile Notifications Service, Research Agent, Commands Agent, Actions Agent, Data Insights Agent, Image Service, Notes Agent, Todos Agent, Application Settings, Bookmarks Agent, Calendar Agent, and Chat Agent.

## Troubleshooting

| Issue            | Cause                 | Solution                  |
| ---------------- | --------------------- | ------------------------- |
| Spec not loading | Service down          | Check service status      |
| CORS error       | Service blocks origin | Configure CORS on service |
