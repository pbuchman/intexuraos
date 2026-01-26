# Orchestrator

Local worker orchestration service for code task execution.

## Overview

The orchestrator runs on local machines (Mac or VM) behind Cloudflare Tunnel. It receives task dispatch requests from `code-agent`, spawns Claude Code sessions in isolated git worktrees, and reports results via webhooks.

## Architecture

```
code-agent (Cloud Run)
    │
    ▼ POST /tasks (HMAC signed)
orchestrator (local)
    │
    ├─ TaskDispatcher: manages Claude Code sessions via tmux
    ├─ WorktreeManager: creates isolated git worktrees
    ├─ GitHubTokenService: manages GitHub App installation tokens
    ├─ WebhookClient: reports status to code-agent
    └─ StatePersistence: survives restarts
```

## Endpoints

| Method | Path                   | Auth | Description                            |
| ------ | ---------------------- | ---- | -------------------------------------- |
| POST   | `/tasks`               | HMAC | Submit new task                        |
| GET    | `/tasks/:id`           | None | Get task status                        |
| DELETE | `/tasks/:id`           | None | Cancel task                            |
| GET    | `/health`              | None | Health check (capacity, running count) |
| POST   | `/admin/refresh-token` | None | Force GitHub token refresh             |
| POST   | `/admin/shutdown`      | None | Graceful shutdown                      |

## Configuration

Environment variables:

- `PORT` - HTTP server port (default: 8080)
- `DISPATCH_SECRET` - HMAC secret for verifying code-agent requests
- `GH_APP_ID` - GitHub App ID
- `GH_INSTALLATION_ID` - GitHub App installation ID
- `GH_PRIVATE_KEY` - GitHub App private key (PEM)
- `WORKER_CAPACITY` - Max concurrent tasks (default: 1)

## Development

```bash
pnpm dev      # Watch mode with experimental-strip-types
pnpm test     # Run tests
pnpm build    # Build for production
```

## Deployment

The orchestrator runs as a systemd service behind Cloudflare Tunnel:

- Mac: `cc-mac.intexuraos.cloud`
- VM: `cc-vm.intexuraos.cloud`

See `scripts/start.sh` for the startup script.
