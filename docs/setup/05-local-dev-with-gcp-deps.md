# 05 - Local Development with GCP Dependencies

This is the canonical guide for running IntexuraOS locally from the current checkout.

Local is a first-class active developer runtime: services run on `localhost` with PM2 watch/Vite,
use shared GCP/Auth0 resources for data and actual secrets, read non-secret configuration from the
repository, and use a host-local Pub/Sub emulator.

Home Dev retains the production-serving workers and orchestrator. The application
stack is available only as a manual localhost process; there is no hosted DEV
application, public DEV hostname, or application autostart. Commands below start
the local stack on the current machine.

## 1. Prerequisites

| Tool                    | Purpose                               |
| ----------------------- | ------------------------------------- |
| Docker Desktop          | Pub/Sub emulator and Pub/Sub UI       |
| Node.js 22+             | Runtime for services                  |
| pnpm                    | Package manager                       |
| direnv                  | Environment variable loader           |
| GCP service account key | Firestore, GCS, Secret Manager access |

Verify:

```bash
docker --version
node --version
pnpm --version
direnv --version
ls ~/.config/gcloud/sa-key.json
```

If several pnpm versions are installed on macOS, prefer `/opt/homebrew/bin/pnpm` for this repo.

## 2. Install And Load Env

```bash
pnpm install
cp .envrc.local.example .envrc.local
direnv allow
```

Edit `.envrc.local` only for developer-local overrides such as personal identifiers. Do not commit `.envrc` or `.envrc.local`.

## 3. Render Configuration And Sync Secrets

Generate the merged local environment. The script renders `local` configuration from
`config/environments/` and loads the existing secret package historically named `dev`
from GCP Secret Manager. Keep its version and credentials unchanged:

```bash
./scripts/sync-secrets.sh --project-id intexuraos-dev-pbuchman \
  --version "$(node -p "require('./config/environments/secret-packages.json').packages.dev.stableVersion")"
direnv allow
```

Expected result:

- Repository-backed runtime configuration is rendered and validated first.
- Only real secret material is fetched from `intexuraos-dev-pbuchman`.
- `.envrc` is replaced atomically with mode `0600`.
- `.envrc.local` is sourced last and remains the place for local overrides.

Secret Manager is only for values that cannot be stored in repository-backed
configuration: tokens, passwords, client secrets, private keys, HMAC material,
and encryption keys. Identifiers, URLs, DSNs, and public keys must be changed
in `config/environments/`, not added as Secret Manager versions. See the
[runtime configuration policy](../operations/runtime-configuration.md).

Common sync issues:

| Issue                                 | Fix                                                              |
| ------------------------------------- | ---------------------------------------------------------------- |
| "Could not resolve project ID"        | Pass `--project-id intexuraos-dev-pbuchman`                      |
| "Permission denied" on secrets        | Ensure the service account has `roles/secretmanager.secretAccessor` |
| "Missing secret values (no versions)" | Run `./scripts/sync-secrets.sh --add-new` only when intentionally populating new secrets |

## 4. Start Local Stack

These commands start ordinary manual development with real shared GCP data and
external integrations. They are not an isolated test: startup migrations, queued
events, and background work can modify data or send messages.

Before using a shared host, set `PM2_HOME` to a dedicated local application directory
and `COMPOSE_PROJECT_NAME` to the intended local Compose project in `.envrc.local`.
Use the same values in every terminal, including stop/restart commands. Keep the
existing Compose project name when reusing its Message Digest volume; changing the
name creates a different volume and does not import the old data automatically.
The historical default Compose project is `docker`, even in a separate checkout.
Never run these commands from the production-serving orchestrator checkout.

For an automated health-only smoke, first establish a separately reviewed setup with
a task-specific PM2 home, an explicitly isolated and empty Pub/Sub Compose project,
the intended persistent Message Digest volume, and
`INTEXURAOS_MATRIX_CORPUS_ENABLED=false`. A read-only scan must prove the Code Agent
`code_tasks` startup migration is a no-op before starting services. Do not use the
ordinary development commands below as an automated smoke recipe.

Start the backend services and emulators:

```bash
export PM2_HOME="${PM2_HOME:?Set a dedicated local PM2 directory in .envrc.local}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:?Set the intended local Compose project in .envrc.local}"
pnpm run dev
```

This runs `scripts/dev-setup.mjs`, starts PM2 from `ecosystem.config.cjs` with `--update-env`, then tails logs.
The PM2 ecosystem contains 19 backend services. Start Vite separately from the same
checkout in a second terminal with the same loaded environment:

```bash
pnpm --dir apps/web dev
```

For verification or scripted startup, run the steps separately:

```bash
node scripts/dev-setup.mjs
pnpm run services:start
# In a separate terminal:
pnpm --dir apps/web dev
```

What starts locally:

| Component             | Local runtime                          |
| --------------------- | -------------------------------------- |
| Web app               | Vite on `http://localhost:3000`        |
| App services          | PM2 + `tsx` from `apps/*/src`          |
| API Docs Hub          | `http://localhost:8133/docs`           |
| Auto-reload           | PM2 watches service `src/` directories |
| Pub/Sub               | Docker emulator on `localhost:8102`    |
| Pub/Sub UI            | `http://localhost:8105`                |
| Firestore             | Real retained GCP project, except Message Digest |
| Message Digest Firestore | Isolated emulator on `127.0.0.1:8101`, persistent Compose volume |
| Cloud Storage         | Real retained GCP project              |
| Runtime configuration | Versioned `config/environments/` files |
| Secret Manager        | Actual secrets from retained GCP project |
| Auth0                 | Shared Auth0 tenant                    |

Local PM2 intentionally clears inherited `FIRESTORE_EMULATOR_HOST` and `STORAGE_EMULATOR_HOST`;
ordinary services use real GCP Firestore/Storage. Message Digest alone sets
`FIRESTORE_EMULATOR_HOST=localhost:8101` and uses the isolated project
`intexuraos-message-digest-mvp-local`. PM2 pins
`PUBSUB_EMULATOR_HOST=localhost:8102` to the local-only Pub/Sub emulator.

Message Digest imports its saved Firestore snapshot on startup and exports it during
graceful shutdown. Keep the Compose volume and allow shutdown to finish; never add
`-v` to the stop command when preserving local data.

`scripts/dev-setup.mjs` also handles Docker Desktop configs that use `"credsStore": "desktop"` by creating a temporary Docker config for compose startup. It does not modify `~/.docker/config.json`.

## 5. Automated Login Credentials

Automated test credentials are stored outside the repo:

```bash
ls -l ~/.intexuraos/logins.md
```

Rules:

- The file must be mode `0600`; `~/.intexuraos` must be mode `0700`.
- It must contain at least two Auth0 accounts using `kontakt+...@pbuchman.com`.
- The same credentials are intended to work on local and production because they use the shared
  Auth0 tenant/configuration.
- Never commit the file or paste passwords into logs/chats.

The browser/e2e login path uses the SPA Auth0 client and Universal Login. Do not use Resource Owner Password Grant as the required verification path for the SPA client; Auth0 blocks that grant for the browser client.

Use `http://localhost:3000/#/login` for local browser login tests. `http://127.0.0.1:3000` is not an Auth0 callback URL for the SPA client.

## 6. Verify Runtime

After startup:

```bash
pnpm exec pm2 status
docker compose -f docker/docker-compose.local.yaml ps
curl -fsS http://localhost:8105/health | jq '.status'
curl -fsS http://localhost:3000 >/dev/null
curl -fsS http://localhost:8110/health | jq '.status'
curl -fsS http://localhost:8133/health | jq '.status'
```

Expected:

- PM2 services are `online`.
- Backend service processes have PM2 watch enabled; Vite runs separately.
- Pub/Sub emulator, Pub/Sub UI, and Message Digest Firestore containers are running.
- Message Digest uses the isolated Firestore emulator; other services use retained GCP data.

Google/GitHub account-connection OAuth is a separate check from Auth0 login. Vite
forwards `/oauth/connections/` to User Service without rewriting the callback path.
Use these routing-only probes before a browser authorization:

```bash
curl -sS -D - -o /dev/null \
  'http://localhost:3000/oauth/connections/google/callback?error=access_denied'
curl -sS -D - -o /dev/null \
  'http://localhost:3000/oauth/connections/github/callback?error=access_denied'
```

Both responses must be `302`. Their `Location` headers must point to the matching
localhost settings page with `oauth_error=access_denied`. These probes do not exchange
tokens or write an OAuth connection.

To verify auto-reload, touch a service source file and check that PM2 restarts that service:

```bash
pnpm exec pm2 jlist | jq 'map({name, restarts: .pm2_env.restart_time})' > /tmp/pm2-before.json
touch apps/intex-agent/src/index.ts
sleep 3
pnpm exec pm2 jlist | jq 'map({name, restarts: .pm2_env.restart_time})' > /tmp/pm2-after.json
```

## 7. Stop Or Restart

```bash
pnpm run services:restart
pnpm run services:stop
pnpm run services:delete
pnpm run emulators:stop
```

Stop the separate Vite terminal with Ctrl-C. On a shared host, run PM2 commands only
with the `PM2_HOME` belonging to this local session; do not change other applications'
PM2 state or use the production-serving orchestrator checkout for a smoke test.

Use `services:restart` after changing `.envrc`, `.envrc.local`, or `ecosystem.config.cjs`; it deletes the local PM2 process list and starts from `ecosystem.config.cjs` with `--update-env`.

## 8. Troubleshooting

### Port Conflicts

`scripts/dev-setup.mjs` checks service, web, and emulator ports before startup. Stop old PM2/Docker processes if it reports conflicts:

```bash
pnpm run services:delete
pnpm run emulators:stop
```

### Missing Env Vars

```bash
./scripts/sync-secrets.sh --project-id intexuraos-dev-pbuchman \
  --version "$(node -p "require('./config/environments/secret-packages.json').packages.dev.stableVersion")"
direnv allow
pnpm run services:restart
```

### Terraform Fails With Emulator Vars

Terraform must not inherit emulator env vars:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform plan
```

### Pub/Sub Messages Not Processed

```bash
docker compose -f docker/docker-compose.local.yaml ps
curl -fsS http://localhost:8105/health | jq '.topics | length'
docker compose -f docker/docker-compose.local.yaml logs pubsub-ui --tail 20
pnpm run services:restart
```

### Package Module Errors

```bash
pnpm install
pnpm build
pnpm run services:restart
```

## Summary

After this setup, local development supports editing service code, automatic PM2 reload, local Pub/Sub message flow, shared GCP/Auth0 dependencies, and reusable login credentials for automated tests.
