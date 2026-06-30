# 05 - Local Development with GCP Dependencies

This is the canonical guide for running IntexuraOS locally from the current checkout.

Local is a first-class runtime environment with the same data and async pattern as dev: services run on `localhost` with PM2 watch/Vite, use shared GCP/Auth0 resources for data and secrets, and use their own host-local Pub/Sub emulator.

The only practical difference from dev is where the process tree runs. Local runs from the current checkout on the developer host; dev runs from the deployed checkout on `home-dev`.

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

## 3. Sync Secrets

Pull retained dev/prod secrets from GCP Secret Manager into `.envrc`:

```bash
./scripts/sync-secrets.sh --project-id intexuraos-dev-pbuchman
direnv allow
```

Expected result:

- Terraform-defined secrets are listed and fetched from `intexuraos-dev-pbuchman`.
- Exportable values are written to `.envrc`.
- `.envrc.local` remains the place for local overrides.

Common sync issues:

| Issue                                 | Fix                                                              |
| ------------------------------------- | ---------------------------------------------------------------- |
| "Could not resolve project ID"        | Pass `--project-id intexuraos-dev-pbuchman`                      |
| "Permission denied" on secrets        | Ensure the service account has `roles/secretmanager.secretAccessor` |
| "Missing secret values (no versions)" | Run `./scripts/sync-secrets.sh --add-new` only when intentionally populating new secrets |

## 4. Start Local Stack

Simple all-in-one path:

```bash
pnpm run dev
```

This runs `scripts/dev-setup.mjs`, starts PM2 from `ecosystem.config.cjs` with `--update-env`, then tails logs.

For verification or scripted startup, run the steps separately:

```bash
node scripts/dev-setup.mjs
pnpm run services:start
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
| Firestore             | Real retained GCP project              |
| Cloud Storage         | Real retained GCP project              |
| Secret Manager        | Synced from real retained GCP project  |
| Auth0                 | Shared Auth0 tenant                    |

Local PM2 intentionally clears inherited `FIRESTORE_EMULATOR_HOST` and `STORAGE_EMULATOR_HOST`; localhost services must use real GCP Firestore/Storage. PM2 pins `PUBSUB_EMULATOR_HOST=localhost:8102`, matching the dev pattern of using a per-host Pub/Sub emulator.

`scripts/dev-setup.mjs` also handles Docker Desktop configs that use `"credsStore": "desktop"` by creating a temporary Docker config for compose startup. It does not modify `~/.docker/config.json`.

## 5. Automated Login Credentials

Automated test credentials are stored outside the repo:

```bash
ls -l ~/.intexuraos/logins.md
```

Rules:

- The file must be mode `0600`; `~/.intexuraos` must be mode `0700`.
- It must contain at least two Auth0 accounts using `kontakt+...@pbuchman.com`.
- The same credentials are intended to work on local, dev, and prod because all three use the shared Auth0 tenant/configuration.
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
- Service processes, except the Vite web process, have PM2 watch enabled.
- Pub/Sub emulator and UI containers are running.
- Health endpoints use real GCP Firestore/Storage and do not try `localhost:8101` Firestore.

To verify auto-reload, touch a service source file and check that PM2 restarts that service:

```bash
pnpm exec pm2 jlist > /tmp/pm2-before.json
touch apps/intex-agent/src/index.ts
sleep 3
pnpm exec pm2 jlist > /tmp/pm2-after.json
```

## 7. Stop Or Restart

```bash
pnpm run services:restart
pnpm run services:stop
pnpm run services:delete
pnpm run emulators:stop
```

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
./scripts/sync-secrets.sh --project-id intexuraos-dev-pbuchman
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
