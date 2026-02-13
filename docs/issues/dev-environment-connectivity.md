# Issue: Dev Environment Connectivity (dev.intexuraos.cloud)

## Status: Open

## Problem Summary

Two related issues prevent the local dev environment (`dev.intexuraos.cloud`) from working end-to-end:

1. **Web app API URLs point to `localhost`** — the frontend bundle has `localhost:8110`, `localhost:8127`, etc. baked in. When accessed from a Mac browser via `dev.intexuraos.cloud`, these resolve to the Mac, not home-dev where services actually run.

2. **GitHub webhook not configured** — the webhook handler (`webhook-handler.mjs`) is running on home-dev:9000 and exposed via CF tunnel, but no webhook is registered in the GitHub repo settings. PM2 services don't auto-refresh on push.

## Architecture Context

```
Mac browser
    │
    ▼
dev.intexuraos.cloud (CF tunnel → home-dev Caddy)
    │
    ▼
Caddy serves web frontend (port 3000)
    │
    ▼
Frontend JS tries to call http://localhost:8110, :8112, :8113, etc.
    │
    ✗ FAILS — localhost = Mac, not home-dev
```

### Current service URL configuration

The web app (PM2 process #18) has env vars like:
```
INTEXURAOS_USER_SERVICE_URL=http://localhost:8110
INTEXURAOS_NOTION_SERVICE_URL=http://localhost:8112
INTEXURAOS_WHATSAPP_SERVICE_URL=http://localhost:8113
INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL=http://localhost:8114
INTEXURAOS_RESEARCH_AGENT_URL=http://localhost:8116
INTEXURAOS_COMMANDS_AGENT_URL=http://localhost:8117
INTEXURAOS_ACTIONS_AGENT_URL=http://localhost:8118
INTEXURAOS_DATA_INSIGHTS_AGENT_URL=http://localhost:8119
INTEXURAOS_IMAGE_SERVICE_URL=http://localhost:8120
INTEXURAOS_NOTES_AGENT_URL=http://localhost:8121
INTEXURAOS_APP_SETTINGS_SERVICE_URL=http://localhost:8122
INTEXURAOS_TODOS_AGENT_URL=http://localhost:8123
INTEXURAOS_BOOKMARKS_AGENT_URL=http://localhost:8124
INTEXURAOS_CALENDAR_AGENT_URL=http://localhost:8125
INTEXURAOS_LINEAR_AGENT_URL=http://localhost:8126
INTEXURAOS_CODE_AGENT_URL=http://localhost:8128
INTEXURAOS_CHAT_AGENT_URL=http://localhost:8129
```

These are baked into the Vite build at compile time via `import.meta.env`.

### Predev mode exists but is not the answer

`apps/web/src/config.ts` has a `INTEXURAOS_PREDEV_MODE` flag. When `true`, service URLs become relative paths (`/api/user`, `/api/whatsapp`, etc.) instead of absolute localhost URLs. This is designed for when a reverse proxy (Caddy) routes `/api/*` to the correct backend. This could be one solution path.

### Services are running and healthy on home-dev

All 20 services run via PM2 on ports 8110-8129. They work fine when accessed directly from home-dev (e.g., `curl localhost:8110/health` returns OK).

## Possible Solutions to Brainstorm

### Option A: Predev mode + Caddy proxy routes
- Set `INTEXURAOS_PREDEV_MODE=true` when building the frontend
- Configure Caddy to proxy `/api/user/*` → `localhost:8110`, `/api/whatsapp/*` → `localhost:8113`, etc.
- Frontend uses relative paths, Caddy handles routing
- Pro: Clean, no CORS issues, works from any browser
- Con: Caddy config gets complex with 20 proxy routes

### Option B: Build with home-dev IP/hostname URLs
- Set `INTEXURAOS_USER_SERVICE_URL=http://home-dev:8110` (Tailscale hostname)
- Or use `http://192.168.0.98:8110` (LAN IP)
- Pro: Simple, no proxy needed
- Con: Only works on same network/Tailscale, CORS headers needed, IP may change

### Option C: CF tunnel per-service subdomains
- Create CF tunnel routes like `user-service.dev.intexuraos.cloud` → `localhost:8110`
- Pro: Works from anywhere, HTTPS
- Con: 20 tunnel routes, complex CF config

### Option D: Single CF tunnel + Caddy path-based routing
- `dev.intexuraos.cloud/api/*` → Caddy → backend services
- Same as Option A but emphasizing the CF tunnel path
- Pro: Single entry point, works from anywhere
- Con: Same Caddy complexity as Option A

## Webhook Issue

### What exists
- `webhook-handler.mjs` running on home-dev:9000 via PM2
- Listens for GitHub push webhooks on `/webhook`
- Verifies HMAC signature, detects affected services, runs `git pull` + `pnpm install` + `pm2 restart`
- Has a `/health` endpoint
- Exposed via CF tunnel (needs verification of which hostname)

### What's missing
- No webhook configured in GitHub repo settings (Settings → Webhooks)
- Need: `WEBHOOK_SECRET` env var on home-dev matching the GitHub webhook secret
- Need: CF tunnel route for the webhook endpoint (verify current state)

### To configure
1. Check which CF tunnel hostname routes to port 9000
2. Create webhook in GitHub repo: `https://<hostname>/webhook`
3. Set content type: `application/json`
4. Set secret matching `WEBHOOK_SECRET` env var
5. Select events: Just `push`
6. Verify with a test push

## Session Context (2026-02-13)

This session completed the self-hosted runner deploy pipeline (Phase 5):
- deploy.yml rewritten with check-runner → local/cloud split
- All 20 Docker images built in parallel on home-dev (i5-14500, 20 threads)
- Performance: 16m36s → 3m23s (monolith), 2m08s (individual service)
- Cloud Build fallback verified (LAN disconnect test)
- Netdata claimed to cloud, PM2 logs bridged to journald
- Woodpecker CI fully removed

The dev environment connectivity issue was discovered at the end of the session when testing `dev.intexuraos.cloud`.
