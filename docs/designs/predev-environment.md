# Pre-Dev Environment: Scale-to-Zero Cloud Development

Run the full IntexuraOS development stack in GCP with automatic branch switching, scale-to-zero idle shutdown, and on-demand startup.

**Status:** Design Complete
**Last Updated:** 2026-01-29

---

## Overview

A cloud-based development environment that mirrors local `pnpm run dev` but runs on a GCP Spot VM. The environment automatically:

- **Follows active development** - switches branches on any push
- **Scales to zero** - shuts down after 30 minutes of inactivity
- **Starts on demand** - boots when a user accesses the URL
- **Hot reloads** - same-branch commits trigger hot reload (no restart)

### Key Behaviors

| Event                            | Action                                |
| -------------------------------- | ------------------------------------- |
| Commit on branch X, VM running X | Do nothing (hot reload via tsx watch) |
| Commit on branch X, VM running Y | `git checkout X` + restart services   |
| Commit on branch X, VM stopped   | Start VM on branch X                  |
| Request arrives, VM running      | Proxy to VM                           |
| Request arrives, VM stopped      | Show "Starting..." page, boot VM      |
| 30 min no requests               | Shutdown VM                           |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              GCP Project (intexuraos-dev)                       │
│                                                                                 │
│  ┌─────────────────┐                                                            │
│  │    Firestore    │  predev-state/current                                      │
│  │    (metadata)   │  { branch, lastActivity, vmStatus, vmIp }                  │
│  └────────┬────────┘                                                            │
│           │                                                                     │
│           ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Cloud Functions (Gen2)                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │   gateway   │  │   webhook   │  │ idle-check  │  │ switch-branch│    │   │
│  │  │ (entry pt)  │  │ (GitHub)    │  │ (scheduler) │  │ (internal)   │    │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │   │
│  └─────────┼────────────────┼────────────────┼────────────────┼───────────┘   │
│            │                │                │                │               │
│            ▼                ▼                ▼                ▼               │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      Spot VM (e2-medium, 4GB)                           │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Docker Compose (emulators)                                       │ │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │ │   │
│  │  │  │  Firestore  │  │    GCS      │  │  Pub/Sub    │               │ │   │
│  │  │  │  Emulator   │  │  Emulator   │  │  Emulator   │               │ │   │
│  │  │  │  :8101      │  │  :8103      │  │  :8102      │               │ │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘               │ │   │
│  │  └───────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                         │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │   │
│  │  │  pnpm run dev:services (17 apps + workers)                        │ │   │
│  │  │  Port range: 8110-8128, 3000 (web)                                │ │   │
│  │  │  Hot reload via tsx watch                                         │ │   │
│  │  └───────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                         │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐ │   │
│  │  │  Caddy (reverse proxy + TLS)                                      │ │   │
│  │  │  predev.intexura.com → localhost:3000 (web)                       │ │   │
│  │  │  predev.intexura.com/api/* → localhost:{service-port}             │ │   │
│  │  └───────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────┐                                                            │
│  │ Cloud Scheduler │  Every 5 min → idle-check function                         │
│  └─────────────────┘                                                            │
│                                                                                 │
│  ┌─────────────────┐                                                            │
│  │  Secret Manager │  Real API keys (WhatsApp, Notion, etc.)                    │
│  └─────────────────┘                                                            │
│                                                                                 │
│  ┌─────────────────┐                                                            │
│  │  Static IP      │  Reserved for VM (survives restarts)                       │
│  └─────────────────┘                                                            │
└─────────────────────────────────────────────────────────────────────────────────┘

External:
┌─────────────┐        ┌─────────────────────────────────────────┐
│   GitHub    │───────▶│  Webhook: push to any branch            │
│             │        │  POST https://.../predev-webhook        │
└─────────────┘        └─────────────────────────────────────────┘

┌─────────────┐        ┌─────────────────────────────────────────┐
│    User     │───────▶│  predev.intexura.com                    │
│  (browser)  │◀───────│  → gateway function → VM or "Starting"  │
└─────────────┘        └─────────────────────────────────────────┘
```

---

## Components

### 1. Gateway Function (Entry Point)

**Purpose:** Route all HTTP traffic, handle cold starts.

**Endpoint:** `predev.intexura.com` (custom domain via Cloud Functions)

**Logic:**

```
request arrives
    │
    ▼
read Firestore predev-state/current
    │
    ├─ vmStatus == "running" && vmIp exists
    │      │
    │      ▼
    │   update lastActivity timestamp
    │      │
    │      ▼
    │   proxy request to http://{vmIp}:{port}
    │
    └─ vmStatus != "running"
           │
           ▼
       trigger VM start (async)
           │
           ▼
       return HTML "Starting..." page
       (auto-refresh every 5 seconds)
```

**"Starting..." Page:**

```html
<!DOCTYPE html>
<html>
  <head>
    <title>IntexuraOS Pre-Dev</title>
    <meta http-equiv="refresh" content="5" />
    <style>
      body {
        font-family: system-ui;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: #1a1a2e;
        color: #eee;
      }
      .loader {
        border: 4px solid #333;
        border-top: 4px solid #6366f1;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <div style="text-align: center">
      <div class="loader"></div>
      <h2>Starting Pre-Dev Environment...</h2>
      <p>Branch: <code>{{branch}}</code></p>
      <p>This page will refresh automatically.</p>
    </div>
  </body>
</html>
```

### 2. Webhook Function (GitHub Push Handler)

**Purpose:** React to pushes on any branch.

**Endpoint:** `https://REGION-PROJECT.cloudfunctions.net/predev-webhook`

**GitHub Webhook Config:**

- Events: `push`
- Content type: `application/json`
- Secret: Shared secret for HMAC validation

**Logic:**

```
POST /predev-webhook
    │
    ▼
validate HMAC signature (X-Hub-Signature-256)
    │
    ▼
extract branch from refs/heads/{branch}
    │
    ▼
read Firestore predev-state/current
    │
    ├─ vmStatus != "running"
    │      │
    │      ▼
    │   start VM with branch
    │   update Firestore: { branch, vmStatus: "starting" }
    │
    └─ vmStatus == "running"
           │
           ├─ current.branch == pushed branch
           │      │
           │      ▼
           │   do nothing (hot reload handles it)
           │   return { action: "hot-reload" }
           │
           └─ current.branch != pushed branch
                  │
                  ▼
              call switch-branch function
              update Firestore: { branch, vmStatus: "switching" }
              return { action: "switch-branch" }
```

### 3. Idle-Check Function (Scheduler Triggered)

**Purpose:** Shutdown VM after 30 minutes of inactivity.

**Trigger:** Cloud Scheduler, every 5 minutes

**Logic:**

```
scheduler triggers
    │
    ▼
read Firestore predev-state/current
    │
    ├─ vmStatus != "running"
    │      │
    │      ▼
    │   return (nothing to do)
    │
    └─ vmStatus == "running"
           │
           ▼
       check lastActivity timestamp
           │
           ├─ now - lastActivity < 30 minutes
           │      │
           │      ▼
           │   return (still active)
           │
           └─ now - lastActivity >= 30 minutes
                  │
                  ▼
              stop VM via Compute API
              update Firestore: { vmStatus: "stopped" }
              return { action: "shutdown-idle" }
```

### 4. Switch-Branch Function (Internal)

**Purpose:** SSH into running VM to switch branches.

**Trigger:** Called by webhook function when branch changes

**Logic:**

```
switch-branch(targetBranch)
    │
    ▼
read Firestore for vmIp
    │
    ▼
SSH to VM (using service account key or OS Login)
    │
    ▼
execute on VM:
    cd /app/intexuraos
    git fetch origin
    git checkout {targetBranch}
    git pull origin {targetBranch}
    pkill -f "pnpm run dev" || true
    nohup pnpm run dev:services &
    │
    ▼
update Firestore: { branch: targetBranch, vmStatus: "running" }
```

### 5. Spot VM (e2-medium)

**Purpose:** Run the full dev stack.

**Specs:**

- Machine type: `e2-medium` (1-2 vCPU, 4GB RAM)
- Disk: 50GB SSD (for node_modules, Docker images)
- OS: Ubuntu 24.04 LTS
- Provisioning: Spot (preemptible)
- Network: Static external IP

**Startup Script:**

```bash
#!/bin/bash
set -e

# Install dependencies (first boot only)
if [ ! -f /root/.predev-initialized ]; then
    apt-get update
    apt-get install -y docker.io docker-compose nodejs npm git
    npm install -g pnpm

    # Clone repo
    git clone https://github.com/pbuchman/intexuraos.git /app/intexuraos
    cd /app/intexuraos
    pnpm install

    # Install Caddy
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install caddy

    touch /root/.predev-initialized
fi

# Fetch secrets from Secret Manager and write .envrc.local
gcloud secrets versions access latest --secret=predev-env-vars > /app/intexuraos/.envrc.local

# Checkout target branch (from instance metadata)
BRANCH=$(curl -s "http://metadata.google.internal/computeMetadata/v1/instance/attributes/target-branch" -H "Metadata-Flavor: Google")
cd /app/intexuraos
git fetch origin
git checkout ${BRANCH:-development}
git pull origin ${BRANCH:-development}

# Start emulators
cd /app/intexuraos
docker-compose -f docker/docker-compose.local.yaml up -d

# Wait for emulators
sleep 30

# Start services
export $(cat .envrc.local | xargs)
nohup pnpm run dev:services > /var/log/predev-services.log 2>&1 &

# Start Caddy
systemctl start caddy

# Report ready to Firestore (via function call or direct API)
curl -X POST "https://REGION-PROJECT.cloudfunctions.net/predev-report-ready" \
    -H "Content-Type: application/json" \
    -d "{\"vmIp\": \"$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H 'Metadata-Flavor: Google')\"}"
```

**Caddy Configuration (`/etc/caddy/Caddyfile`):**

```
predev.intexura.com {
    # Web app
    reverse_proxy localhost:3000

    # API routes - route by path prefix
    handle_path /api/user/* {
        reverse_proxy localhost:8110
    }
    handle_path /api/notion/* {
        reverse_proxy localhost:8112
    }
    handle_path /api/whatsapp/* {
        reverse_proxy localhost:8113
    }
    # ... (all 17 services)

    # Catch-all for SPA
    handle {
        reverse_proxy localhost:3000
    }
}
```

---

## Firestore State Document

**Collection:** `predev-state`
**Document:** `current`

```typescript
interface PredevState {
  branch: string; // Current branch (e.g., "feature/xyz")
  vmStatus: 'running' | 'stopped' | 'starting' | 'stopping' | 'switching';
  vmIp: string | null; // External IP when running
  lastActivity: Timestamp; // Last HTTP request time
  lastCommit: string; // SHA of last processed commit
  startedAt: Timestamp | null; // When VM was started
  startedBy: 'webhook' | 'gateway' | 'scheduler'; // Who triggered start
}
```

---

## Cost Analysis

### Assumptions

- Active usage: 4 hours/day on weekdays (80 hours/month)
- VM auto-shutdowns save ~85% compute cost

### Monthly Cost Breakdown

| Resource                      | Unit Cost        | Usage      | Monthly     |
| ----------------------------- | ---------------- | ---------- | ----------- |
| Spot e2-medium VM             | $0.0084/hr       | 80 hrs     | $0.67       |
| 50GB SSD disk                 | $0.08/GB/mo      | Always-on  | $4.00       |
| Static IP (attached)          | $0.00            | Always-on  | $0.00       |
| Static IP (detached)          | $0.01/hr         | ~640 hrs   | $6.40       |
| Cloud Functions (invocations) | $0.40/million    | ~10K       | ~$0.00      |
| Cloud Functions (compute)     | $0.0000025/GB-s  | ~1000 GB-s | ~$0.00      |
| Cloud Scheduler               | $0.10/job/mo     | 1 job      | $0.10       |
| Firestore (reads/writes)      | $0.06/100K reads | ~50K       | ~$0.03      |
| Egress (external)             | $0.12/GB         | ~5 GB      | $0.60       |
| **Total**                     |                  |            | **~$12/mo** |

### Cost Optimization Notes

1. **Static IP when detached costs $7.20/mo** - Consider releasing IP when stopped (requires DNS update on start)
2. **Spot VM risk** - May be preempted with 30s notice; managed instance group auto-recreates
3. **Disk persists** - Even when VM stopped; stores node_modules, Docker images

---

## Implementation Plan

### Phase 1: Core Infrastructure (Terraform)

| Task                                   | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| 1.1 Create predev VM instance template | e2-medium, spot, Ubuntu 24.04, startup script |
| 1.2 Create managed instance group      | Size 0-1, auto-healing, target pool           |
| 1.3 Reserve static IP                  | For consistent DNS                            |
| 1.4 Create Cloud DNS record            | predev.intexura.com → static IP               |
| 1.5 Create predev service account      | Minimal permissions for VM and functions      |
| 1.6 Create predev-env-vars secret      | Aggregated env vars for .envrc.local          |

### Phase 2: Cloud Functions (Workers)

| Task                                  | Description                           |
| ------------------------------------- | ------------------------------------- |
| 2.1 Create predev-gateway worker      | Entry point, proxy or "Starting" page |
| 2.2 Create predev-webhook worker      | GitHub push handler, branch switching |
| 2.3 Create predev-idle-check worker   | Scheduler-triggered idle shutdown     |
| 2.4 Create predev-report-ready worker | Called by VM to report IP after boot  |
| 2.5 Deploy all functions              | Terraform + Cloud Build               |

### Phase 3: VM Configuration

| Task                           | Description                               |
| ------------------------------ | ----------------------------------------- |
| 3.1 Create startup script      | Clone repo, install deps, start services  |
| 3.2 Create Caddyfile template  | Reverse proxy config for all services     |
| 3.3 Create systemd services    | Auto-start emulators and services on boot |
| 3.4 Test VM boot-to-ready time | Target: < 90 seconds                      |

### Phase 4: Integration

| Task                          | Description                                   |
| ----------------------------- | --------------------------------------------- |
| 4.1 Configure GitHub webhook  | Push events to predev-webhook                 |
| 4.2 Configure Cloud Scheduler | Every 5 min → predev-idle-check               |
| 4.3 Configure DNS             | predev.intexura.com CNAME to gateway function |
| 4.4 Test end-to-end flow      | Push → VM start → access → idle shutdown      |

### Phase 5: Testing

| Test Case                    | Expected Result                                       |
| ---------------------------- | ----------------------------------------------------- |
| T1: Cold start from request  | "Starting..." page, VM boots, page refreshes to app   |
| T2: Push to different branch | VM switches branches, services restart                |
| T3: Push to same branch      | No restart, hot reload picks up changes               |
| T4: 30 min idle              | VM automatically stops                                |
| T5: Spot preemption          | Instance group recreates VM within 2 min              |
| T6: Multiple rapid pushes    | Debounce prevents thrashing                           |
| T7: External API calls       | WhatsApp, Notion, Calendar work with real credentials |

---

## File Structure

```
workers/
  predev-lifecycle/           # Cloud Functions for predev management
    src/
      index.ts                # Function exports
      gateway.ts              # HTTP gateway (entry point)
      webhook.ts              # GitHub webhook handler
      idle-check.ts           # Scheduler-triggered idle check
      report-ready.ts         # VM ready callback
      vm-control.ts           # Start/stop VM via Compute API
      state.ts                # Firestore state management
      config.ts               # Environment configuration
      logger.ts               # Pino logger
    package.json
    tsconfig.json

terraform/
  modules/
    predev-environment/       # New module for predev infra
      main.tf                 # VM, instance group, static IP
      functions.tf            # Cloud Functions
      iam.tf                  # Service accounts, permissions
      scheduler.tf            # Idle check scheduler
      variables.tf
      outputs.tf

  environments/dev/
    main.tf                   # Add predev module instantiation

docker/
  predev/
    Caddyfile.template        # Reverse proxy config
    startup.sh                # VM startup script
```

---

## Terraform Module Structure

### Module: `predev-environment`

```hcl
# terraform/modules/predev-environment/main.tf

# -----------------------------------------------------------------------------
# Static IP for consistent DNS
# -----------------------------------------------------------------------------
resource "google_compute_address" "predev" {
  name   = "predev-static-ip-${var.environment}"
  region = var.region
}

# -----------------------------------------------------------------------------
# Instance Template (Spot VM)
# -----------------------------------------------------------------------------
resource "google_compute_instance_template" "predev" {
  name_prefix  = "predev-template-"
  machine_type = "e2-medium"
  region       = var.region

  scheduling {
    preemptible                 = true
    automatic_restart           = false
    on_host_maintenance         = "TERMINATE"
    provisioning_model          = "SPOT"
    instance_termination_action = "STOP"
  }

  disk {
    source_image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
    disk_size_gb = 50
    disk_type    = "pd-ssd"
    auto_delete  = true
    boot         = true
  }

  network_interface {
    network    = "default"
    access_config {
      nat_ip = google_compute_address.predev.address
    }
  }

  metadata = {
    target-branch = "development"
  }

  metadata_startup_script = file("${path.module}/scripts/startup.sh")

  service_account {
    email  = google_service_account.predev_vm.email
    scopes = ["cloud-platform"]
  }

  tags = ["predev", "http-server", "https-server"]

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Managed Instance Group (auto-healing, 0-1 size)
# -----------------------------------------------------------------------------
resource "google_compute_instance_group_manager" "predev" {
  name               = "predev-mig-${var.environment}"
  base_instance_name = "predev"
  zone               = var.zone

  version {
    instance_template = google_compute_instance_template.predev.id
  }

  target_size = 0  # Controlled by functions

  named_port {
    name = "https"
    port = 443
  }
}

# -----------------------------------------------------------------------------
# Firewall Rules
# -----------------------------------------------------------------------------
resource "google_compute_firewall" "predev_allow_http" {
  name    = "predev-allow-http-${var.environment}"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["predev"]
}
```

---

## Environment Variables

### VM `.envrc.local` (from Secret Manager)

```bash
# Core
GOOGLE_CLOUD_PROJECT=intexuraos-dev
INTEXURAOS_GCP_PROJECT_ID=intexuraos-dev
INTEXURAOS_ENVIRONMENT=predev
NODE_ENV=development

# Emulators (local)
FIRESTORE_EMULATOR_HOST=localhost:8101
PUBSUB_EMULATOR_HOST=localhost:8102
STORAGE_EMULATOR_HOST=localhost:8103
FIREBASE_AUTH_EMULATOR_HOST=localhost:8104

# Auth (real - for OAuth flows)
INTEXURAOS_AUTH_JWKS_URL=https://...
INTEXURAOS_AUTH_ISSUER=https://...
INTEXURAOS_AUTH_AUDIENCE=...
INTEXURAOS_AUTH0_DOMAIN=...
INTEXURAOS_AUTH0_CLIENT_ID=...

# Internal Auth
INTEXURAOS_INTERNAL_AUTH_TOKEN=<from-secret-manager>

# Encryption
INTEXURAOS_ENCRYPTION_KEY=<from-secret-manager>

# External APIs (real)
INTEXURAOS_WHATSAPP_VERIFY_TOKEN=<real>
INTEXURAOS_WHATSAPP_ACCESS_TOKEN=<real>
INTEXURAOS_SPEECHMATICS_API_KEY=<real>
INTEXURAOS_NOTION_INTEGRATION_TOKEN=<real>
# ... (all real API keys)

# Service URLs (local)
INTEXURAOS_USER_SERVICE_URL=http://localhost:8110
INTEXURAOS_NOTION_SERVICE_URL=http://localhost:8112
# ... (all services)
INTEXURAOS_WEB_APP_URL=https://predev.intexura.com
```

---

## Differences from Local Dev

| Aspect             | Local (`pnpm run dev`)  | Pre-Dev (GCP VM)                     |
| ------------------ | ----------------------- | ------------------------------------ |
| Entry point        | `scripts/dev.mjs`       | `systemd` + startup script           |
| URL                | `http://localhost:3000` | `https://predev.intexura.com`        |
| TLS                | None                    | Caddy auto-TLS                       |
| External APIs      | Often stubbed           | Real credentials from Secret Manager |
| Data persistence   | Local Docker volumes    | Docker volumes on VM disk            |
| Process management | Node.js child processes | systemd + Docker Compose             |
| Hot reload         | tsx watch               | tsx watch (same)                     |
| Branch switching   | Manual `git checkout`   | Automatic on push                    |
| Idle shutdown      | Manual Ctrl+C           | Automatic after 30 min               |

---

## Security Considerations

1. **Gateway authentication** - App's Auth0 handles user auth (no infra-level auth needed)
2. **GitHub webhook secret** - HMAC validation prevents spoofed pushes
3. **VM service account** - Minimal permissions (Secret Manager read, Compute self-manage)
4. **Function service account** - Compute admin for VM lifecycle only
5. **Network** - Default VPC with firewall rules for 80/443 only

---

## Monitoring & Alerts

| Metric                     | Threshold       | Alert                    |
| -------------------------- | --------------- | ------------------------ |
| VM startup time            | > 120 seconds   | Slack notification       |
| Gateway function errors    | > 5/min         | PagerDuty                |
| VM preemption rate         | > 3/day         | Review spot availability |
| Idle-check function errors | > 3 consecutive | Manual investigation     |

---

## Future Enhancements

1. **Multiple environments** - Support `predev.intexura.com?branch=feature/x` for parallel branches
2. **Seed data** - Export/import Firestore data from dev on startup
3. **Cost dashboard** - Track actual spend vs estimates
4. **Branch protection** - Only allow pushes from specific users to trigger switches
5. **Preview comments** - Post preview URL as GitHub PR comment
