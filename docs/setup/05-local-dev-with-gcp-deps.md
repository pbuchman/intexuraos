# 05 - Local Development with GCP Dependencies

This is the canonical guide for running IntexuraOS services locally.

## 1. Prerequisites

Before you begin, ensure you have the following installed:

| Tool                    | Purpose                               | Installation                              |
| ----------------------- | ------------------------------------- | ----------------------------------------- |
| Docker                  | Pub/Sub emulator                      | [docker.com](https://www.docker.com)      |
| Node.js 22+             | Runtime for all services              | Use [fnm](https://github.com/Schniz/fnm)  |
| pnpm 9+                 | Package manager                       | `npm install -g pnpm`                     |
| direnv                  | Automatic environment variable loader | [direnv.net](https://direnv.net)          |
| GCP service account key | Firestore, GCS, Secret Manager access | Located at `~/.config/gcloud/sa-key.json` |

**Verify Prerequisites:**

```bash
docker --version       # Should show Docker version
node --version         # Should show v22.x or higher
pnpm --version         # Should show 9.x or higher
direnv --version       # Should show direnv version
ls ~/.config/gcloud/sa-key.json   # Should exist
```

## 2. Initial Setup

Clone the repository and set up your local environment:

```bash
# 1. Clone repository
git clone https://github.com/pbuchman/intexuraos.git
cd intexuraos

# 2. Copy environment template
cp .envrc.local.example .envrc.local

# 3. Edit .envrc.local with your settings
# At minimum, verify/update:
#   - GOOGLE_CLOUD_PROJECT
#   - INTEXURAOS_GCP_PROJECT_ID
#   - Personal identifiers (INTEXURAOS_MY_PHONE_NUMBER, INTEXURAOS_USER_ID)
nano .envrc.local

# 4. Allow direnv to load environment
direnv allow

# 5. Install dependencies
pnpm install

# 6. Build all packages (required before running services)
pnpm build
```

**Why build first?** Apps depend on `packages/*/dist/` directories. Without built packages, apps fail typecheck and throw module errors.

## 3. Sync Secrets

Pull secrets from GCP Secret Manager into `.envrc`:

```bash
./scripts/sync-secrets.sh
```

**What this does:**

- Reads Terraform-defined secrets from `terraform/environments/dev/main.tf`
- Fetches secret values from GCP Secret Manager
- Writes them to `.envrc` as `export` statements
- `.envrc` is automatically loaded by `direnv` whenever you `cd` into the project

**Common sync issues:**

| Issue                                 | Fix                                                              |
| ------------------------------------- | ---------------------------------------------------------------- |
| "Could not resolve project ID"        | Set `PROJECT_ID` env var or run sync-secrets with `--project-id` |
| "Permission denied" on secrets        | Ensure service account has `roles/secretmanager.secretAccessor`  |
| "Missing secret values (no versions)" | Run `./scripts/sync-secrets.sh --add-new` to populate            |

After sync completes, run `direnv allow` to reload environment with new secrets.

## 4. Start the Stack

IntexuraOS local development uses a **hybrid architecture**:

1. **Pub/Sub emulator** runs in Docker (avoids topic conflicts between environments)
2. **All services** run via PM2 (process manager)
3. **Real GCP services** (Firestore, Cloud Storage, Firebase Auth) via service account

### Start Pub/Sub Emulator

```bash
pnpm run emulators:start
```

This starts the `pubsub-ui` container that:

- Runs Pub/Sub emulator on `localhost:8085`
- Creates all topics defined in `docker/docker-compose.local.yaml`
- Forwards messages to local service HTTP endpoints

**Verify emulator is running:**

```bash
docker ps | grep pubsub-ui
# Should show container running
```

### Start All Services

```bash
pnpm run services:start
```

This starts all IntexuraOS services via PM2. You'll see output showing each service starting.

**View logs:**

```bash
pnpm run services:logs
```

Press `Ctrl+C` to stop tailing logs (services continue running).

**Check service status:**

```bash
pnpm run services:status
```

You should see all services in "online" status.

## 5. What Runs Locally vs Real GCP

| Service       | Location       | Notes                                                     |
| ------------- | -------------- | --------------------------------------------------------- |
| Pub/Sub       | Local emulator | Avoids topic conflicts between environments               |
| Firestore     | Real GCP       | Via service account key at `~/.config/gcloud/sa-key.json` |
| Cloud Storage | Real GCP       | Via service account key at `~/.config/gcloud/sa-key.json` |
| Firebase Auth | Real GCP       | Via Auth0 JWT validation (JWKS URL from secrets)          |

**Why Pub/Sub local, but Firestore/GCS real?**

- **Pub/Sub:** Topic names are global. Local emulator prevents collisions with dev/prod.
- **Firestore/GCS:** Collections/buckets are namespaced by environment. Safe to share across local devs.

## 6. Auto-Start on Persistent Dev VM (Optional)

If you have a persistent development VM that should auto-start services after reboot, set up systemd services.

### Create Emulator Service

```bash
sudo tee /etc/systemd/system/intexuraos-emulators.service << 'EOF'
[Unit]
Description=IntexuraOS Pub/Sub emulator
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=YOUR_USER
WorkingDirectory=/path/to/intexuraos
ExecStart=/usr/bin/direnv exec . docker compose -f docker/docker-compose.local.yaml up -d --wait
ExecStop=/usr/bin/direnv exec . docker compose -f docker/docker-compose.local.yaml down

[Install]
WantedBy=multi-user.target
EOF
```

**Replace:**

- `YOUR_USER` with your username
- `/path/to/intexuraos` with absolute path to repository

### Update PM2 Service

The `pm2 startup` command creates a systemd service. Update it to depend on emulators and use direnv:

```bash
# 1. Generate PM2 startup script
pm2 startup

# 2. Save current PM2 process list
pm2 save

# 3. Edit the generated systemd service
sudo systemctl edit --full pm2-YOUR_USER.service
```

**Modify the `[Unit]` section:**

```ini
[Unit]
Description=PM2 process manager
After=network.target intexuraos-emulators.service
```

**Modify the `[Service]` section:**

```ini
[Service]
Type=forking
User=YOUR_USER
WorkingDirectory=/path/to/intexuraos
ExecStart=/usr/bin/direnv exec /path/to/intexuraos pm2 resurrect
ExecReload=/usr/bin/pm2 reload all
ExecStop=/usr/bin/pm2 kill
Restart=on-failure
RestartSec=10
```

### Enable and Start

```bash
# Enable emulator service
sudo systemctl daemon-reload
sudo systemctl enable intexuraos-emulators.service

# Restart PM2 service
sudo systemctl restart pm2-YOUR_USER.service

# Verify both are running
sudo systemctl status intexuraos-emulators.service
sudo systemctl status pm2-YOUR_USER.service
```

## 7. Troubleshooting

### Services crash on startup

**Symptom:** `pnpm run services:status` shows "errored" or "stopped" status.

**Cause:** Pub/Sub emulator not running.

**Fix:**

```bash
# Check emulator is running
docker ps | grep pubsub-ui

# If not running, start it
pnpm run emulators:start

# Restart services
pnpm run services:restart
```

### Missing env vars

**Symptom:** Service logs show "Missing required environment variable: INTEXURAOS\_..."

**Cause:** `direnv` not loaded or `.envrc` missing secrets.

**Fix:**

```bash
# Reload direnv
direnv allow

# Re-sync secrets if needed
./scripts/sync-secrets.sh
direnv allow

# Restart services
pnpm run services:restart
```

### Terraform fails with emulator vars

**Symptom:** `terraform init` or `terraform plan` hangs or fails with emulator errors.

**Cause:** `PUBSUB_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, or `STORAGE_EMULATOR_HOST` env vars redirect Terraform to non-existent local emulators.

**Fix:**

Use the `tf` alias that clears emulator env vars:

```bash
# Add to ~/.zshrc or ~/.bashrc
alias tf='STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform'
```

Then use `tf init`, `tf plan`, `tf apply` instead of `terraform`.

### "Topic not found" errors

**Symptom:** Service logs show `5 NOT_FOUND: Topic not found` when publishing to Pub/Sub.

**Cause:** `pubsub-ui` creates topics on startup. If PM2 services started before `pubsub-ui` was ready, topics don't exist.

**Fix:**

```bash
# Restart services after pubsub-ui is fully running
pnpm run services:restart
```

### Pub/Sub messages not being processed

**Symptom:** Actions stay in `pending` status, commands don't trigger processing.

**Cause:** `pubsub-ui` container isn't running or not forwarding messages.

**Verify:**

```bash
# Check all containers are running
docker compose -f docker/docker-compose.local.yaml ps

# Verify pubsub-ui is healthy
curl http://localhost:8105/health | jq '.topics | length'
# Should return 14
```

**Fix:**

```bash
# Restart Docker containers
pnpm run emulators:stop
pnpm run emulators:start

# Verify pubsub-ui is forwarding messages
docker compose -f docker/docker-compose.local.yaml logs pubsub-ui --tail 10
```

### "Cannot find module '@intexuraos/...'"

**Symptom:** Service fails with module not found errors for `@intexuraos/*` packages.

**Cause:** Packages not built (missing `dist/` directories).

**Fix:**

```bash
pnpm build
pnpm run services:restart
```

### "Could not load the default credentials"

**Symptom:** Services fail with GCP authentication errors.

**Cause:** Service account key missing or `GOOGLE_APPLICATION_CREDENTIALS` not set.

**Fix:**

```bash
# Verify service account key exists
ls ~/.config/gcloud/sa-key.json

# Check .envrc.local exports it
grep GOOGLE_APPLICATION_CREDENTIALS .envrc.local
# Should see: export GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json

# Reload environment
direnv allow

# Restart services
pnpm run services:restart
```

## 8. Useful Commands

| Command                     | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `pnpm run emulators:start`  | Start Pub/Sub emulator                              |
| `pnpm run emulators:stop`   | Stop Pub/Sub emulator                               |
| `pnpm run emulators:logs`   | View emulator logs (live tail)                      |
| `pnpm run services:start`   | Start all PM2 services                              |
| `pnpm run services:stop`    | Stop all PM2 services                               |
| `pnpm run services:logs`    | View service logs (live tail)                       |
| `pnpm run services:status`  | PM2 status dashboard                                |
| `pnpm run services:monit`   | Interactive TUI (CPU/memory/logs)                   |
| `pnpm run services:restart` | Restart all services                                |
| `pnpm run services:delete`  | Delete all PM2 processes                            |
| `pnpm run dev`              | Start emulators + services + tail logs (all-in-one) |

**Individual service development:**

```bash
# Run a single service with watch mode
cd apps/user-service
pnpm run dev
```

## Quick Verification

After running `pnpm run services:start`, verify everything is working:

```bash
# 1. Check service status
pnpm run services:status
# Should show all services "online"

# 2. Check web app is running
curl -s http://localhost:3000 | grep -q "IntexuraOS" && echo "✓ Web app OK"

# 3. Check a service health endpoint
curl http://localhost:8110/health | jq
# Should return: {"success":true,"data":{"status":"healthy"}}

# 4. Verify Pub/Sub emulator
curl http://localhost:8105/health | jq '.topics | length'
# Should return: 14
```

## Summary

After completing these steps, you can:

- [x] Run all services locally with `pnpm run services:start`
- [x] Connect to dev Firestore database via service account
- [x] Access secrets synced from GCP Secret Manager
- [x] Test API endpoints locally on `localhost:PORT`
- [x] Use local Pub/Sub emulator to avoid topic conflicts

## Next Steps

- [Testing](../patterns/testing.md) - Run tests with `pnpm run test`
- [CI Validation](../patterns/verification.md) - Validate changes with `pnpm run ci`
- [Claude Code MCP Setup](./11-claude-code-mcp-setup.md) - Configure Linear and Sentry integration
