# Dev VM Startup & Local Dev Simplification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify local dev to Pub/Sub emulator only, remove all other emulators, auto-start on boot via systemd.

**Architecture:** Docker Compose runs standalone Pub/Sub emulator + pubsub-ui. All other GCP services (Firestore, GCS, Firebase Auth) use real GCP via ADC. Systemd orchestrates boot order: Docker → emulators → PM2 (with direnv).

**Tech Stack:** Docker Compose, systemd, direnv, PM2, gcloud Pub/Sub emulator

**Design doc:** `docs/plans/2026-02-14-dev-vm-startup-design.md`

---

### Task 1: Replace Docker Compose with lightweight Pub/Sub setup

**Files:**

- Modify: `docker/docker-compose.local.yaml`
- Remove: `firebase.json` (emulator config only — check it's not used for Firestore rules deployment)

**Step 1: Verify firebase.json usage**

Check `cloudbuild/scripts/deploy-firestore.sh:27-28` — it references firebase.json for rules deployment. Read the file to determine if the `emulators` section can be removed while keeping `firestore` section, or if the file should be split.

**Step 2: Rewrite docker-compose.local.yaml**

Replace entire contents with:

```yaml
services:
  pubsub-emulator:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators
    ports:
      - '8102:8102'
    command: gcloud beta emulators pubsub start --host-port=0.0.0.0:8102 --project=demo-intexuraos
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8102']
      interval: 5s
      timeout: 3s
      start_period: 10s
      retries: 5

  pubsub-ui:
    build:
      context: ../tools/pubsub-ui
      dockerfile: Dockerfile
    ports:
      - '8105:8105'
    environment:
      - PUBSUB_EMULATOR_HOST=pubsub-emulator:8102
      - PUBSUB_PROJECT_ID=${INTEXURAOS_GCP_PROJECT_ID:-demo-intexuraos}
      - PORT=8105
      - INTEXURAOS_INTERNAL_AUTH_TOKEN=${INTEXURAOS_INTERNAL_AUTH_TOKEN}
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    depends_on:
      pubsub-emulator:
        condition: service_healthy
```

**Step 3: Clean up firebase.json**

If used by deploy-firestore.sh for rules/indexes, keep only the `firestore` section (remove `emulators` block). If not used at all, delete the file.

**Step 4: Remove Docker volumes**

Remove `firebase-cache` and `gcs-data` volume definitions (no longer needed).

**Step 5: Commit**

```
feat: replace Docker emulators with standalone Pub/Sub

Remove firebase-emulator (Firestore/Auth/Pub/Sub bundle) and fake-gcs.
Replace with lightweight gcloud Pub/Sub emulator. All other GCP services
use real GCP via ADC.
```

---

### Task 2: Remove FIREBASE_AUTH_EMULATOR_HOST from ecosystem config

**Files:**

- Modify: `ecosystem.config.cjs:24-26`

**Step 1: Remove the FIREBASE_AUTH_EMULATOR_HOST block**

In `ecosystem.config.cjs`, remove lines 24-26:

```javascript
// REMOVE THIS BLOCK:
...(process.env.PREDEV_ENVIRONMENT !== 'true' && {
  FIREBASE_AUTH_EMULATOR_HOST: 'localhost:8104',
}),
```

**Step 2: Commit**

```
chore: remove FIREBASE_AUTH_EMULATOR_HOST from ecosystem config
```

---

### Task 3: Clean up .envrc.local on dev VM

**Files:**

- Modify: `.envrc.local` (on dev VM at `~/deploy/intexuraos/.envrc.local` — coordinate with user since it's read-only)

**Step 1: Document changes needed**

The following changes are needed in `.envrc.local`:

- Line 60: Change `INTEXURAOS_WHATSAPP_MEDIA_BUCKET=intexuraos-whatsapp-media-local` → use real bucket name
- Line 61: Change `INTEXURAOS_IMAGE_BUCKET=intexuraos-images-local` → use real bucket name

Note: `.envrc.local` is in `~/deploy/intexuraos/` which is read-only. User will need to apply these changes manually or we update the deploy checkout.

**Step 2: No commit** (not in repo)

---

### Task 4: Clean up .envrc.local.example

**Files:**

- Modify: `.envrc.local.example`

**Step 1: Remove emulator sections**

Remove the following sections:

- Lines 25-32: EMULATORS section (FIRESTORE_EMULATOR_HOST, PUBSUB_EMULATOR_HOST, STORAGE_EMULATOR_HOST)
- Lines 56-68: GCS BUCKETS and PUB/SUB sections with `-local` suffixed values
- Lines 84-91: GCP PROJECT section (emulator-specific comments)

**Step 2: Replace with simplified Pub/Sub section**

Add a single section explaining the local Pub/Sub setup:

```bash
# =============================================================================
# PUB/SUB (local emulator — required for local dev)
# =============================================================================
# Pub/Sub uses a local emulator to avoid topic conflicts between environments.
# Start with: pnpm run emulators:start
# The pubsub-ui container bridges emulator messages to local service endpoints.

export INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC=media-cleanup
export INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION=media-cleanup-sub
export INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC=whatsapp-send-message
export INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION=whatsapp-send-message-sub
export INTEXURAOS_TODOS_PROCESSING_TOPIC=todos-processing
```

**Step 3: Update GCS bucket names**

Replace `-local` bucket names with real bucket names:

```bash
# =============================================================================
# GCS BUCKETS
# =============================================================================
export INTEXURAOS_WHATSAPP_MEDIA_BUCKET=intexuraos-whatsapp-media
export INTEXURAOS_IMAGE_BUCKET=intexuraos-images
```

Note: Verify actual real bucket names from Terraform before writing.

**Step 4: Update GCP PROJECT section**

Keep `GOOGLE_CLOUD_PROJECT` and `INTEXURAOS_GCP_PROJECT_ID` but remove emulator-specific comments.

**Step 5: Commit**

```
chore: simplify .envrc.local.example to single canonical setup
```

---

### Task 5: Remove sync-firestore.sh and related scripts

**Files:**

- Remove: `scripts/sync-firestore.sh`
- Modify: `package.json:12-16,25` — remove emulator sync scripts
- Remove: `data/` directory (contains only `.gitkeep` for firestore-export)
- Modify: `.gitignore:61` — remove `data/firestore-export/` entry

**Step 1: Update package.json scripts**

Remove these scripts:

- `"dev:sync"` (line 12) — references sync-firestore.sh
- `"emulators:sync"` (line 14) — references sync-firestore.sh
- `"firestore:sync"` (line 25) — references sync-firestore.sh

Keep these scripts (update if paths changed):

- `"emulators:start"` (line 13) — still valid
- `"emulators:stop"` (line 15) — still valid
- `"emulators:logs"` (line 16) — still valid

**Step 2: Delete sync-firestore.sh**

```bash
rm scripts/sync-firestore.sh
```

**Step 3: Clean up data directory**

```bash
rm -rf data/
```

Remove `data/firestore-export/` from `.gitignore`.

**Step 4: Commit**

```
chore: remove Firestore sync scripts and data directory
```

---

### Task 6: Update dev-setup.mjs

**Files:**

- Modify: `scripts/dev-setup.mjs`

**Step 1: Read the file and understand the full setup flow**

Read `scripts/dev-setup.mjs` completely. It orchestrates Docker emulator startup and health checks.

**Step 2: Remove Firestore/GCS/Auth emulator references**

- Remove `firebase-emulator` and `fake-gcs` from `requiredServices` list (~line 223)
- Remove Firestore, GCS, Firebase Auth, Firebase UI from health check ports (~lines 133-138)
- Keep Pub/Sub UI port (8105) in health checks
- Remove `FIRESTORE_EMULATOR_HOST` from required env vars (~line 69)
- Update console output (port table at ~line 322) to only show Pub/Sub ports

**Step 3: Commit**

```
chore: update dev-setup.mjs for Pub/Sub-only emulator setup
```

---

### Task 7: Project-wide FIREBASE_AUTH_EMULATOR_HOST cleanup

**Files to check/modify:**

- `apps/user-service/src/infra/firebase/admin.ts:15` — remove comment
- `scripts/verify-env-vars.mjs:301` — remove from allowlist
- `docker/README.md:101` — remove port documentation

**Step 1: Remove each reference**

For each file, remove the `FIREBASE_AUTH_EMULATOR_HOST` reference. These are comments, allowlist entries, and documentation — no logic changes.

**Step 2: Commit**

```
chore: remove FIREBASE_AUTH_EMULATOR_HOST references project-wide
```

---

### Task 8: Project-wide FIRESTORE_EMULATOR_HOST and STORAGE_EMULATOR_HOST doc cleanup

**Files to modify (docs/configs/examples only — keep terraform hooks and app code that legitimately checks these):**

Docs and configs to update:

- `docker/README.md` — remove Firestore/GCS emulator rows from tables, update port list
- `docs/packages/infra-firestore/README.md:14,88` — update to note real GCP usage, remove emulator setup
- `docs/packages/infra-firestore/agent.md:98` — remove optional emulator env var
- `docs/services/web/tutorial.md:80` — remove emulator row from table
- `docs/setup/05-local-dev-with-gcp-deps.md` — will be fully rewritten in Task 10

Keep as-is (legitimate runtime checks):

- `packages/infra-firestore/src/firestore.ts:17` — comment explaining SDK behavior (keep)
- `scripts/backfill-research-favourite.mjs` — script checks emulator host at runtime (keep)
- `scripts/reset-actions-status.mjs` — script checks emulator host at runtime (keep)
- `scripts/embed-docs.ts` — script checks emulator host at runtime (keep)
- `.claude/hooks/validate-terraform.sh` — legitimately clears emulator vars for terraform (keep)
- `.claude/CLAUDE.md` — terraform examples clearing emulator vars (keep)
- `.claude/reference/infrastructure.md` — terraform clearing patterns (keep)
- `.claude/commands/create-service.md` — terraform clearing patterns (keep)
- `.claude/agents/service-creator.md` — terraform clearing patterns (keep)
- `.github/workflows/e2e.yml` — CI uses its own emulators independently (keep)

**Step 1: Update each doc file**

Remove emulator-specific content from docs. Update tables and examples.

**Step 2: Commit**

```
docs: remove Firestore/GCS emulator references from documentation
```

---

### Task 9: Update docker/README.md

**Files:**

- Modify: `docker/README.md`

**Step 1: Read current content**

Read the full file to understand structure.

**Step 2: Rewrite to reflect Pub/Sub-only setup**

- Update service table: only pubsub-emulator and pubsub-ui
- Remove firebase-emulator and fake-gcs references
- Update port table
- Update quick start commands
- Remove Firestore sync section

**Step 3: Commit**

```
docs: update docker/README.md for Pub/Sub-only setup
```

---

### Task 10: Rewrite local dev setup guide

**Files:**

- Rewrite: `docs/setup/05-local-dev-with-gcp-deps.md`

**Step 1: Read current content**

Read the full file.

**Step 2: Rewrite as canonical local dev guide**

Structure:

1. **Prerequisites** — Docker, Node.js, pnpm, direnv, GCP SA key
2. **Initial setup** — Clone, install, build, sync secrets
3. **Sync secrets** — `./scripts/sync-secrets.sh` flow, `.envrc` + `.envrc.local`
4. **Start local stack** — `pnpm run emulators:start` then `pm2 start ecosystem.config.cjs`
5. **What runs locally vs real GCP** — Table: Pub/Sub = local emulator, everything else = real GCP
6. **Auto-start on persistent dev VM** — systemd setup instructions
7. **Troubleshooting** — Common issues (remove Terraform emulator var section since it's still in CLAUDE.md)

**Step 3: Commit**

```
docs: rewrite local dev setup guide for simplified emulator setup
```

---

### Task 11: Update statusline.sh

**Files:**

- Modify: `.claude/statusline.sh:355`

**Step 1: Read the relevant section**

Check what `DOCKER_PORTS` is used for and update to only check ports 8102 and 8105.

**Step 2: Update port list**

Change from `DOCKER_PORTS="8100 8101 8102 8103 8104 8105"` to `DOCKER_PORTS="8102 8105"`.

**Step 3: Commit**

```
chore: update statusline Docker port checks for Pub/Sub-only setup
```

---

### Task 12: Create systemd services (dev VM only)

**Files:**

- Create: `/etc/systemd/system/intexuraos-emulators.service` (VM only, not in repo)
- Modify: `/etc/systemd/system/pm2-pbuchman.service` (VM only)

**Step 1: Create intexuraos-emulators.service**

```ini
[Unit]
Description=IntexuraOS Pub/Sub emulator
Documentation=https://github.com/pbuchman/intexuraos
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=pbuchman
WorkingDirectory=/home/pbuchman/deploy/intexuraos
ExecStart=/usr/bin/direnv exec . docker compose -f docker/docker-compose.local.yaml up -d --wait
ExecStop=/usr/bin/direnv exec . docker compose -f docker/docker-compose.local.yaml down

[Install]
WantedBy=multi-user.target
```

**Step 2: Update pm2-pbuchman.service**

Add `After=intexuraos-emulators.service` to `[Unit]` section.
Change ExecStart to: `/usr/bin/direnv exec /home/pbuchman/deploy/intexuraos pm2 resurrect`

**Step 3: Enable and test**

```bash
sudo systemctl daemon-reload
sudo systemctl enable intexuraos-emulators.service
sudo systemctl start intexuraos-emulators.service
sudo systemctl restart pm2-pbuchman.service
```

**Step 4: Verify**

```bash
docker ps  # Should show pubsub-emulator + pubsub-ui
pm2 list   # Should show all services online
```

**Step 5: No commit** (VM-specific, not in repo)

---

### Task 13: Verify and final CI

**Step 1: Start emulators with new Docker Compose**

```bash
pnpm run emulators:start
```

Verify only 2 containers running: `pubsub-emulator` and `pubsub-ui`.

**Step 2: Restart PM2 services**

```bash
cd ~/deploy/intexuraos && direnv exec . pm2 delete all && direnv exec . pm2 start ecosystem.config.cjs
```

Verify all 21 services come online.

**Step 3: Run CI**

```bash
pnpm run ci:tracked
```

Must pass completely.

**Step 4: Final commit and PR**

Create PR against development branch with all changes.
