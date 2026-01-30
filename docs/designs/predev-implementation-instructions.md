# Pre-Dev Environment Implementation Instructions

**Issue:** INT-423
**Design Document:** `docs/designs/predev-environment.md`
**Target:** Complete implementation of scale-to-zero cloud development environment

---

## Overview

You are implementing a cloud-based development environment that:

1. Runs on a GCP Spot VM (scale 0-1)
2. Mirrors local `pnpm run dev` using PM2
3. Auto-starts when user accesses gateway URL
4. Auto-stops after 30 minutes of inactivity
5. Switches branches on GitHub push
6. Provides DevBar with logs and Pub/Sub streaming

**Cost target:** ~$3/month

---

## Prerequisites

Before starting, ensure you understand:

1. **Read the design document:** `docs/designs/predev-environment.md`
2. **Read INT-423:** Contains all architectural decisions and specifications
3. **Understand existing patterns:**
   - Cloud Functions: `workers/vm-lifecycle/`, `workers/log-cleanup/`
   - Terraform modules: `terraform/modules/cloud-function/`
   - Cloud Build: `cloudbuild/cloudbuild.yaml`, `cloudbuild/scripts/`

---

## Phase 0: PM2 Migration

**Goal:** Replace `scripts/dev.mjs` with PM2 for local development.

### Step 0.1: Create ecosystem.config.cjs

**File:** `ecosystem.config.cjs`

```javascript
// PM2 ecosystem configuration for IntexuraOS development
// Used by both local development and pre-dev VM

const COMMON_ENV = {
  NODE_ENV: 'development',
  FIRESTORE_EMULATOR_HOST: 'localhost:8200',
  PUBSUB_EMULATOR_HOST: 'localhost:8201',
  STORAGE_EMULATOR_HOST: 'http://localhost:8202',
};

// Service ports - must match existing dev.mjs configuration
const SERVICE_PORTS = {
  'user-service': 8110,
  'notion-service': 8111,
  'whatsapp-service': 8112,
  'api-docs-hub': 8113,
  'mobile-notifications-service': 8114,
  'research-agent': 8115,
  'commands-agent': 8116,
  'actions-agent': 8117,
  'data-insights-agent': 8118,
  'image-service': 8119,
  'notes-agent': 8120,
  'todos-agent': 8121,
  'bookmarks-agent': 8122,
  'app-settings-service': 8123,
  'calendar-agent': 8124,
  'linear-agent': 8125,
  'web-agent': 8126,
  'code-agent': 8127,
  web: 3000,
};

// Build service configuration
const buildServiceConfig = (name, port) => ({
  name,
  script: 'npx',
  args: 'tsx watch --clear-screen=false src/server.ts',
  cwd: `./apps/${name}`,
  env: {
    ...COMMON_ENV,
    PORT: port,
    // Add service-specific env vars from .envrc.local
  },
  watch: false, // tsx watch handles this
  autorestart: true,
  max_restarts: 10,
  restart_delay: 1000,
});

module.exports = {
  apps: [
    // All backend services
    ...Object.entries(SERVICE_PORTS)
      .filter(([name]) => name !== 'web')
      .map(([name, port]) => buildServiceConfig(name, port)),

    // Web frontend (Vite)
    {
      name: 'web',
      script: 'npx',
      args: 'vite --host',
      cwd: './apps/web',
      env: {
        ...COMMON_ENV,
        PORT: 3000,
      },
      autorestart: true,
    },

    // DevBar tools
    {
      name: 'log-server',
      script: 'node',
      args: 'server.mjs',
      cwd: './tools/log-server',
      env: { PORT: 8106 },
      autorestart: true,
    },
    {
      name: 'pubsub-ui',
      script: 'node',
      args: 'server.mjs',
      cwd: './tools/pubsub-ui',
      env: {
        PORT: 8105,
        PUBSUB_EMULATOR_HOST: 'localhost:8201',
      },
      autorestart: true,
    },
  ],
};
```

**Important:** Read `scripts/dev.mjs` to extract all service-specific environment variables and add them to each service's `env` block. Cross-reference with `ecosystem.config.cjs` if it already exists partially.

### Step 0.2: Update dev-setup.mjs

**File:** `scripts/dev-setup.mjs`

This script should ONLY handle:

1. Starting emulators (Firestore, Pub/Sub, Storage)
2. Validating environment (.envrc.local exists)
3. Building packages (`pnpm build`)

Remove all service spawning logic - PM2 handles that now.

```javascript
#!/usr/bin/env node
// Simplified dev setup - emulators and validation only
// Services are managed by PM2 via ecosystem.config.cjs

import { spawn } from 'child_process';
import { existsSync } from 'fs';

// 1. Validate .envrc.local exists
if (!existsSync('.envrc.local')) {
  console.error('ERROR: .envrc.local not found. Copy from .envrc.local.example');
  process.exit(1);
}

// 2. Build packages
console.log('Building packages...');
await execAsync('pnpm build');

// 3. Start emulators
console.log('Starting emulators...');
const emulators = [
  { name: 'firestore', cmd: 'gcloud emulators firestore start --host-port=localhost:8200' },
  { name: 'pubsub', cmd: 'gcloud emulators pubsub start --host-port=localhost:8201' },
  { name: 'storage', cmd: 'docker run -p 8202:8202 ...' }, // existing storage emulator
];

// Start each emulator...
// (Copy existing emulator startup logic from dev.mjs)

console.log('Emulators ready. Run: pm2 start ecosystem.config.cjs');
```

### Step 0.3: Update package.json scripts

**File:** `package.json` (root)

```json
{
  "scripts": {
    "dev:setup": "node scripts/dev-setup.mjs",
    "dev:services": "pm2 start ecosystem.config.cjs",
    "dev:logs": "pm2 logs",
    "dev:status": "pm2 status",
    "dev:stop": "pm2 stop all",
    "dev": "pnpm dev:setup && pnpm dev:services && pnpm dev:logs"
  }
}
```

### Step 0.4: Verification

```bash
# Test PM2 setup
pnpm dev:setup
pm2 start ecosystem.config.cjs
pm2 status  # All services should show 'online'
pm2 logs    # Logs should stream
curl http://localhost:3000  # Web should respond
pm2 stop all
```

---

## Phase 1: Terraform Module

**Goal:** Create infrastructure-as-code for pre-dev environment.

### Step 1.1: Create module directory structure

```bash
mkdir -p terraform/modules/predev-environment/scripts
```

### Step 1.2: Create variables.tf

**File:** `terraform/modules/predev-environment/variables.tf`

```hcl
variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "zone" {
  description = "GCP zone for VM"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "functions_source_bucket" {
  description = "GCS bucket for Cloud Functions source"
  type        = string
}

variable "internal_auth_token_secret_id" {
  description = "Secret Manager ID for internal auth token"
  type        = string
}

variable "github_webhook_secret_id" {
  description = "Secret Manager ID for GitHub webhook secret"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository (owner/repo)"
  type        = string
  default     = "pbuchman/intexuraos"
}
```

### Step 1.3: Create main.tf (Compute Resources)

**File:** `terraform/modules/predev-environment/main.tf`

```hcl
# Pre-Dev Environment - Compute Resources

# VM Instance Template
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
    disk_size_gb = 20
    disk_type    = "pd-ssd"
    auto_delete  = true
    boot         = true
  }

  network_interface {
    network = "default"
    access_config {} # Ephemeral public IP
  }

  metadata = {
    startup-script = file("${path.module}/scripts/startup.sh")
  }

  service_account {
    email  = google_service_account.predev_vm.email
    scopes = ["cloud-platform"]
  }

  tags = ["predev", "http-server"]

  lifecycle {
    create_before_destroy = true
  }
}

# Managed Instance Group (0-1 scaling)
resource "google_compute_instance_group_manager" "predev" {
  name               = "predev-mig-${var.environment}"
  base_instance_name = "predev"
  zone               = var.zone
  target_size        = 0 # Controlled by Cloud Functions

  version {
    instance_template = google_compute_instance_template.predev.id
  }

  named_port {
    name = "http"
    port = 3000
  }
}

# Firewall - Allow traffic to pre-dev VM
resource "google_compute_firewall" "predev_allow_http" {
  name    = "predev-allow-http-${var.environment}"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["3000", "8105", "8106", "8110-8128"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["predev"]
}
```

### Step 1.4: Create iam.tf

**File:** `terraform/modules/predev-environment/iam.tf`

```hcl
# Pre-Dev Environment - IAM Resources

# Service account for pre-dev VM
resource "google_service_account" "predev_vm" {
  account_id   = "predev-vm-${var.environment}"
  display_name = "Pre-Dev VM Service Account (${var.environment})"
}

# Service account for pre-dev Cloud Functions
resource "google_service_account" "predev_functions" {
  account_id   = "predev-functions-${var.environment}"
  display_name = "Pre-Dev Functions Service Account (${var.environment})"
}

# Functions can manage Compute instances
resource "google_project_iam_member" "functions_compute_admin" {
  project = var.project_id
  role    = "roles/compute.instanceAdmin.v1"
  member  = "serviceAccount:${google_service_account.predev_functions.email}"
}

# Functions can read/write Firestore (for state tracking)
resource "google_project_iam_member" "functions_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.predev_functions.email}"
}

# Functions can access secrets
resource "google_project_iam_member" "functions_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.predev_functions.email}"
}

# VM can access secrets (for .envrc.local generation)
resource "google_project_iam_member" "vm_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.predev_vm.email}"
}

# VM can invoke report-ready function
resource "google_cloud_run_service_iam_member" "vm_invokes_report_ready" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.report_ready.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.predev_vm.email}"
}
```

### Step 1.5: Create functions.tf

**File:** `terraform/modules/predev-environment/functions.tf`

Reference the existing `terraform/modules/cloud-function/` module pattern. Create 4 functions:

1. **gateway** - HTTP trigger, public, 60min timeout (for SSE)
2. **webhook** - HTTP trigger, public (GitHub webhooks)
3. **idle-check** - Pub/Sub trigger
4. **report-ready** - HTTP trigger, VM-only invocation

```hcl
# Pre-Dev Environment - Cloud Functions

# Gateway Function
resource "google_cloudfunctions2_function" "gateway" {
  name        = "intexuraos-predev-gateway-${var.environment}"
  location    = var.region
  description = "Pre-dev gateway: proxy requests or show Starting page"

  build_config {
    runtime     = "nodejs22"
    entry_point = "gateway"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory   = "512M"
    timeout_seconds    = 3600 # 60 min for SSE
    service_account_email = google_service_account.predev_functions.email

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
      INTEXURAOS_GCP_ZONE       = var.zone
      INTEXURAOS_MIG_NAME       = google_compute_instance_group_manager.predev.name
    }

    secret_environment_variables {
      key        = "INTEXURAOS_INTERNAL_AUTH_TOKEN"
      project_id = var.project_id
      secret     = var.internal_auth_token_secret_id
      version    = "latest"
    }
  }
}

# Make gateway publicly accessible
resource "google_cloud_run_service_iam_member" "gateway_public" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.gateway.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Webhook Function
resource "google_cloudfunctions2_function" "webhook" {
  name        = "intexuraos-predev-webhook-${var.environment}"
  location    = var.region
  description = "Pre-dev webhook: GitHub push handler"

  build_config {
    runtime     = "nodejs22"
    entry_point = "webhook"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 120
    service_account_email = google_service_account.predev_functions.email

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
    }

    secret_environment_variables {
      key        = "INTEXURAOS_GITHUB_WEBHOOK_SECRET"
      project_id = var.project_id
      secret     = var.github_webhook_secret_id
      version    = "latest"
    }
  }
}

resource "google_cloud_run_service_iam_member" "webhook_public" {
  project  = var.project_id
  location = var.region
  service  = google_cloudfunctions2_function.webhook.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Idle-Check Function (Pub/Sub triggered)
resource "google_cloudfunctions2_function" "idle_check" {
  name        = "intexuraos-predev-idle-check-${var.environment}"
  location    = var.region
  description = "Pre-dev idle check: shutdown after 30min inactive"

  build_config {
    runtime     = "nodejs22"
    entry_point = "idleCheck"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 120
    service_account_email = google_service_account.predev_functions.email

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
      INTEXURAOS_GCP_ZONE       = var.zone
      INTEXURAOS_MIG_NAME       = google_compute_instance_group_manager.predev.name
      IDLE_TIMEOUT_MINUTES      = "30"
    }
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.idle_check.id
  }
}

# Report-Ready Function
resource "google_cloudfunctions2_function" "report_ready" {
  name        = "intexuraos-predev-report-ready-${var.environment}"
  location    = var.region
  description = "Pre-dev report ready: VM callback with ephemeral IP"

  build_config {
    runtime     = "nodejs22"
    entry_point = "reportReady"
    source {
      storage_source {
        bucket = var.functions_source_bucket
        object = "predev-lifecycle/function.zip"
      }
    }
  }

  service_config {
    available_memory   = "256M"
    timeout_seconds    = 30
    service_account_email = google_service_account.predev_functions.email

    environment_variables = {
      INTEXURAOS_ENVIRONMENT    = var.environment
      INTEXURAOS_GCP_PROJECT_ID = var.project_id
    }
  }
}
```

### Step 1.6: Create scheduler.tf

**File:** `terraform/modules/predev-environment/scheduler.tf`

```hcl
# Pre-Dev Environment - Scheduler Resources

# Pub/Sub topic for idle check
resource "google_pubsub_topic" "idle_check" {
  name    = "predev-idle-check-${var.environment}"
  project = var.project_id
}

# Cloud Scheduler - 5 min idle check
resource "google_cloud_scheduler_job" "idle_check" {
  name        = "predev-idle-check-${var.environment}"
  description = "Check pre-dev VM idle status every 5 minutes"
  schedule    = "*/5 * * * *"
  time_zone   = "UTC"
  region      = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.idle_check.id
    data       = base64encode(jsonencode({ trigger = "scheduled" }))
  }
}
```

### Step 1.7: Create outputs.tf

**File:** `terraform/modules/predev-environment/outputs.tf`

```hcl
output "gateway_url" {
  description = "Pre-dev gateway URL (main entry point)"
  value       = google_cloudfunctions2_function.gateway.service_config[0].uri
}

output "webhook_url" {
  description = "Pre-dev webhook URL (for GitHub)"
  value       = google_cloudfunctions2_function.webhook.service_config[0].uri
}

output "vm_service_account" {
  description = "VM service account email"
  value       = google_service_account.predev_vm.email
}

output "functions_service_account" {
  description = "Functions service account email"
  value       = google_service_account.predev_functions.email
}

output "mig_name" {
  description = "Managed Instance Group name"
  value       = google_compute_instance_group_manager.predev.name
}
```

### Step 1.8: Create VM startup script

**File:** `terraform/modules/predev-environment/scripts/startup.sh`

```bash
#!/bin/bash
set -euo pipefail

REPO_DIR="/opt/intexuraos"
LOG_FILE="/var/log/predev-startup.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

log "Starting pre-dev VM setup..."

# Install dependencies
log "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq git curl build-essential

# Install Node.js 22
log "Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

# Install pnpm
log "Installing pnpm..."
corepack enable
corepack prepare pnpm@latest --activate

# Install PM2
log "Installing PM2..."
npm install -g pm2

# Clone repository
log "Cloning repository..."
if [ -d "$REPO_DIR" ]; then
  cd "$REPO_DIR"
  git fetch --all
else
  git clone https://github.com/pbuchman/intexuraos.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# Get target branch from instance metadata
TARGET_BRANCH=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/target-branch" || echo "development")

log "Checking out branch: $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git pull origin "$TARGET_BRANCH"

# Generate .envrc.local from Secret Manager
log "Generating .envrc.local..."
gcloud secrets versions access latest --secret="predev-env-vars" > .envrc.local

# Install dependencies
log "Installing dependencies..."
pnpm install --frozen-lockfile

# Build packages
log "Building packages..."
pnpm build

# Start services with PM2
log "Starting services..."
pm2 start ecosystem.config.cjs
pm2 save

# Get VM's external IP
EXTERNAL_IP=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip")

# Report ready to the report-ready function
REPORT_READY_URL=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/report-ready-url")

log "Reporting ready to: $REPORT_READY_URL"
curl -X POST "$REPORT_READY_URL" \
  -H "Content-Type: application/json" \
  -d "{\"ip\": \"$EXTERNAL_IP\", \"branch\": \"$TARGET_BRANCH\"}"

log "Pre-dev VM ready!"
```

### Step 1.9: Wire into main terraform

**File:** `terraform/environments/dev/main.tf` (add at end)

```hcl
# Pre-Dev Environment
module "predev_environment" {
  source = "../../modules/predev-environment"

  project_id              = var.project_id
  region                  = var.region
  zone                    = "${var.region}-a"
  environment             = var.environment
  functions_source_bucket = google_storage_bucket.cloud_functions_source.name

  internal_auth_token_secret_id = "INTEXURAOS_INTERNAL_AUTH_TOKEN"
  github_webhook_secret_id      = "INTEXURAOS_GITHUB_WEBHOOK_SECRET"

  depends_on = [
    google_project_service.apis,
  ]
}

output "predev_gateway_url" {
  description = "Pre-dev gateway URL"
  value       = module.predev_environment.gateway_url
}

output "predev_webhook_url" {
  description = "Pre-dev webhook URL (configure in GitHub)"
  value       = module.predev_environment.webhook_url
}
```

### Step 1.10: Add secrets to secret-manager

Add these to the secret-manager module or create manually:

- `predev-env-vars` - Aggregated environment variables for VM
- `INTEXURAOS_GITHUB_WEBHOOK_SECRET` - GitHub webhook HMAC secret

---

## Phase 2: Cloud Functions Worker

**Goal:** Create the `predev-lifecycle` worker with 4 Cloud Functions.

### Step 2.1: Create worker directory structure

```bash
mkdir -p workers/predev-lifecycle/src/{functions,lib}
mkdir -p workers/predev-lifecycle/src/__tests__
```

### Step 2.2: Create package.json

**File:** `workers/predev-lifecycle/package.json`

```json
{
  "name": "@intexuraos/predev-lifecycle",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "node ../../scripts/build-worker.mjs predev-lifecycle",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@google-cloud/compute": "^4.0.0",
    "@google-cloud/firestore": "^7.0.0",
    "@google-cloud/functions-framework": "^3.0.0",
    "pino": "^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

### Step 2.3: Create tsconfig.json

**File:** `workers/predev-lifecycle/tsconfig.json`

Copy from `workers/vm-lifecycle/tsconfig.json` and adjust paths.

### Step 2.4: Create index.ts (entry point)

**File:** `workers/predev-lifecycle/src/index.ts`

```typescript
// Cloud Functions entry points for pre-dev lifecycle management
export { gateway } from './functions/gateway.js';
export { webhook } from './functions/webhook.js';
export { idleCheck } from './functions/idle-check.js';
export { reportReady } from './functions/report-ready.js';
```

### Step 2.5: Create shared state management

**File:** `workers/predev-lifecycle/src/lib/state.ts`

```typescript
import { Firestore } from '@google-cloud/firestore';

export interface PredevState {
  status: 'stopped' | 'starting' | 'running' | 'stopping';
  vmIp: string | null;
  branch: string;
  lastActivity: Date;
  startedAt: Date | null;
}

const COLLECTION = 'predev-state';
const DOC_ID = 'current';

export class StateManager {
  private db: Firestore;

  constructor() {
    this.db = new Firestore();
  }

  async getState(): Promise<PredevState | null> {
    const doc = await this.db.collection(COLLECTION).doc(DOC_ID).get();
    if (!doc.exists) return null;
    return doc.data() as PredevState;
  }

  async setState(state: Partial<PredevState>): Promise<void> {
    await this.db.collection(COLLECTION).doc(DOC_ID).set(state, { merge: true });
  }

  async updateActivity(): Promise<void> {
    await this.setState({ lastActivity: new Date() });
  }

  async setRunning(ip: string, branch: string): Promise<void> {
    await this.setState({
      status: 'running',
      vmIp: ip,
      branch,
      lastActivity: new Date(),
      startedAt: new Date(),
    });
  }

  async setStopped(): Promise<void> {
    await this.setState({
      status: 'stopped',
      vmIp: null,
      startedAt: null,
    });
  }
}
```

### Step 2.6: Create VM control

**File:** `workers/predev-lifecycle/src/lib/vm-control.ts`

```typescript
import { InstanceGroupManagersClient } from '@google-cloud/compute';

export class VmControl {
  private client: InstanceGroupManagersClient;
  private project: string;
  private zone: string;
  private migName: string;

  constructor() {
    this.client = new InstanceGroupManagersClient();
    this.project = process.env.INTEXURAOS_GCP_PROJECT_ID!;
    this.zone = process.env.INTEXURAOS_GCP_ZONE!;
    this.migName = process.env.INTEXURAOS_MIG_NAME!;
  }

  async startVm(targetBranch: string): Promise<void> {
    // Set target size to 1
    await this.client.resize({
      project: this.project,
      zone: this.zone,
      instanceGroupManager: this.migName,
      size: 1,
    });
  }

  async stopVm(): Promise<void> {
    // Set target size to 0
    await this.client.resize({
      project: this.project,
      zone: this.zone,
      instanceGroupManager: this.migName,
      size: 0,
    });
  }

  async getVmCount(): Promise<number> {
    const [response] = await this.client.get({
      project: this.project,
      zone: this.zone,
      instanceGroupManager: this.migName,
    });
    return response.targetSize || 0;
  }
}
```

### Step 2.7: Create gateway function

**File:** `workers/predev-lifecycle/src/functions/gateway.ts`

```typescript
import * as functions from '@google-cloud/functions-framework';
import { StateManager } from '../lib/state.js';
import { VmControl } from '../lib/vm-control.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('gateway');
const state = new StateManager();
const vm = new VmControl();

functions.http('gateway', async (req, res) => {
  const currentState = await state.getState();

  // Handle DevBar SSE endpoints
  if (req.path === '/devbar/logs' || req.path === '/devbar/events') {
    if (currentState?.status !== 'running' || !currentState.vmIp) {
      res.status(503).send('VM not running');
      return;
    }

    const port = req.path === '/devbar/logs' ? 8106 : 8105;
    const targetPath = req.path === '/devbar/logs' ? '/logs' : '/events';

    // Proxy SSE connection to VM
    await proxySSE(currentState.vmIp, port, targetPath, res);
    return;
  }

  // Update last activity
  if (currentState?.status === 'running') {
    await state.updateActivity();
  }

  // If running, proxy to VM
  if (currentState?.status === 'running' && currentState.vmIp) {
    await proxyRequest(currentState.vmIp, req, res);
    return;
  }

  // If stopped, start VM and show "Starting" page
  if (!currentState || currentState.status === 'stopped') {
    logger.info('Starting VM...');
    await state.setState({ status: 'starting' });
    await vm.startVm(currentState?.branch || 'development');

    res.status(200).send(getStartingPage());
    return;
  }

  // If starting, show "Starting" page with progress
  if (currentState.status === 'starting') {
    res.status(200).send(getStartingPage());
    return;
  }

  res.status(500).send('Unknown state');
});

function getStartingPage(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Pre-Dev Starting...</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; }
    .spinner { width: 50px; height: 50px; border: 3px solid #333; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Starting Pre-Dev Environment</h1>
    <p>This page will refresh automatically...</p>
  </div>
</body>
</html>
  `;
}

async function proxyRequest(vmIp: string, req: any, res: any): Promise<void> {
  const targetUrl = `http://${vmIp}:3000${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' ? req.body : undefined,
    });

    res.status(response.status);
    for (const [key, value] of response.headers) {
      res.setHeader(key, value);
    }
    const body = await response.text();
    res.send(body);
  } catch (error) {
    logger.error({ error }, 'Proxy error');
    res.status(502).send('Bad Gateway');
  }
}

async function proxySSE(vmIp: string, port: number, path: string, res: any): Promise<void> {
  const targetUrl = `http://${vmIp}:${port}${path}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const response = await fetch(targetUrl);
    const reader = response.body?.getReader();

    if (!reader) {
      res.end();
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (error) {
    logger.error({ error }, 'SSE proxy error');
  } finally {
    res.end();
  }
}
```

### Step 2.8: Create webhook function

**File:** `workers/predev-lifecycle/src/functions/webhook.ts`

```typescript
import * as functions from '@google-cloud/functions-framework';
import * as crypto from 'crypto';
import { StateManager } from '../lib/state.js';
import { VmControl } from '../lib/vm-control.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('webhook');
const state = new StateManager();
const vm = new VmControl();

functions.http('webhook', async (req, res) => {
  // Verify GitHub webhook signature
  const signature = req.headers['x-hub-signature-256'] as string;
  const secret = process.env.INTEXURAOS_GITHUB_WEBHOOK_SECRET!;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(req.body));
  const expectedSignature = `sha256=${hmac.digest('hex')}`;

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    logger.warn('Invalid webhook signature');
    res.status(401).send('Invalid signature');
    return;
  }

  const event = req.headers['x-github-event'];

  if (event !== 'push') {
    res.status(200).send('Ignored event');
    return;
  }

  const { ref } = req.body;
  const branch = ref.replace('refs/heads/', '');

  logger.info({ branch }, 'Push event received');

  const currentState = await state.getState();

  // If VM is running on different branch, trigger branch switch
  if (currentState?.status === 'running' && currentState.branch !== branch) {
    logger.info({ from: currentState.branch, to: branch }, 'Switching branch');
    // TODO: Implement hot branch switch via SSH or Pub/Sub to VM
  }

  // Update state with new branch
  await state.setState({ branch });

  res.status(200).send('OK');
});
```

### Step 2.9: Create idle-check function

**File:** `workers/predev-lifecycle/src/functions/idle-check.ts`

```typescript
import * as functions from '@google-cloud/functions-framework';
import { StateManager } from '../lib/state.js';
import { VmControl } from '../lib/vm-control.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('idle-check');
const state = new StateManager();
const vm = new VmControl();

const IDLE_TIMEOUT_MINUTES = parseInt(process.env.IDLE_TIMEOUT_MINUTES || '30', 10);

functions.cloudEvent('idleCheck', async () => {
  const currentState = await state.getState();

  if (!currentState || currentState.status !== 'running') {
    logger.info('VM not running, skipping idle check');
    return;
  }

  const lastActivity = new Date(currentState.lastActivity);
  const idleMinutes = (Date.now() - lastActivity.getTime()) / 1000 / 60;

  logger.info({ idleMinutes, threshold: IDLE_TIMEOUT_MINUTES }, 'Checking idle status');

  if (idleMinutes >= IDLE_TIMEOUT_MINUTES) {
    logger.info('VM idle, stopping...');
    await state.setState({ status: 'stopping' });
    await vm.stopVm();
    await state.setStopped();
    logger.info('VM stopped');
  }
});
```

### Step 2.10: Create report-ready function

**File:** `workers/predev-lifecycle/src/functions/report-ready.ts`

```typescript
import * as functions from '@google-cloud/functions-framework';
import { StateManager } from '../lib/state.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('report-ready');
const state = new StateManager();

interface ReadyPayload {
  ip: string;
  branch: string;
}

functions.http('reportReady', async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const { ip, branch } = req.body as ReadyPayload;

  if (!ip || !branch) {
    res.status(400).send('Missing ip or branch');
    return;
  }

  logger.info({ ip, branch }, 'VM reported ready');

  await state.setRunning(ip, branch);

  res.status(200).send('OK');
});
```

### Step 2.11: Create logger

**File:** `workers/predev-lifecycle/src/lib/logger.ts`

```typescript
import pino from 'pino';

export function createLogger(name: string) {
  return pino({
    name: `predev-lifecycle:${name}`,
    level: process.env.LOG_LEVEL || 'info',
  });
}
```

### Step 2.12: Create vitest.config.ts

**File:** `workers/predev-lifecycle/vitest.config.ts`

Copy from `workers/vm-lifecycle/vitest.config.ts`.

### Step 2.13: Create tests

Create tests in `workers/predev-lifecycle/src/__tests__/` for:

- `state.test.ts` - StateManager unit tests
- `vm-control.test.ts` - VmControl unit tests (mocked)
- `gateway.test.ts` - Gateway function tests
- `idle-check.test.ts` - Idle check function tests

**Coverage requirement:** 95%

### Step 2.14: Create cloudbuild.yaml for individual deploy

**File:** `workers/predev-lifecycle/cloudbuild.yaml`

```yaml
# Manual trigger: Deploy predev-lifecycle Cloud Function only
steps:
  - name: 'node:22-slim'
    id: 'install'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        corepack enable
        pnpm install --frozen-lockfile

  - name: 'node:22-slim'
    id: 'build'
    waitFor: ['install']
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        corepack enable
        pnpm --filter @intexuraos/predev-lifecycle build

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    id: 'deploy'
    waitFor: ['build']
    entrypoint: 'bash'
    args: ['cloudbuild/scripts/deploy-function.sh', 'predev-lifecycle']
    env:
      - 'REGION=${_REGION}'
      - 'ENVIRONMENT=${_ENVIRONMENT}'
      - 'FUNCTIONS_SOURCE_BUCKET=${_FUNCTIONS_SOURCE_BUCKET}'

options:
  logging: CLOUD_LOGGING_ONLY

timeout: '600s'
```

---

## Phase 2B: Update Cloud Build Scripts

### Step 2B.1: Create build-all-workers.sh

**File:** `cloudbuild/scripts/build-all-workers.sh`

```bash
#!/usr/bin/env bash
# build-all-workers.sh - Build all Cloud Function workers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

WORKERS=(vm-lifecycle log-cleanup predev-lifecycle)

log "Building all Cloud Function workers..."

for worker in "${WORKERS[@]}"; do
  log "Building worker: $worker"

  # Build with pnpm
  pnpm --filter "@intexuraos/$worker" build

  # Generate production package.json
  WORKER_DIR="/workspace/workers/${worker}"

  if [[ ! -d "${WORKER_DIR}/dist" ]]; then
    log "ERROR: Build output not found: ${WORKER_DIR}/dist"
    exit 1
  fi

  # Create minimal package.json for Cloud Functions
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('${WORKER_DIR}/package.json'));
    const prod = {
      name: pkg.name.replace('@intexuraos/', '') + '-prod',
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
      dependencies: pkg.dependencies || {}
    };
    fs.writeFileSync('${WORKER_DIR}/dist/package.json', JSON.stringify(prod, null, 2));
  "

  log "Built: $worker"
done

log "All workers built successfully"
```

Make executable: `chmod +x cloudbuild/scripts/build-all-workers.sh`

### Step 2B.2: Create deploy-all-workers.sh

**File:** `cloudbuild/scripts/deploy-all-workers.sh`

```bash
#!/usr/bin/env bash
# deploy-all-workers.sh - Deploy all Cloud Function workers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

WORKERS=(vm-lifecycle log-cleanup predev-lifecycle)

log "Deploying all Cloud Function workers..."

for worker in "${WORKERS[@]}"; do
  log "Deploying worker: $worker"
  bash "${SCRIPT_DIR}/deploy-function.sh" "$worker"
done

log "All workers deployed successfully"
```

Make executable: `chmod +x cloudbuild/scripts/deploy-all-workers.sh`

### Step 2B.3: Update deploy-function.sh

**File:** `cloudbuild/scripts/deploy-function.sh`

Add predev-lifecycle case:

```bash
case "${WORKER}" in
  vm-lifecycle)
    FUNCTIONS=("intexuraos-vm-start-${ENVIRONMENT}" "intexuraos-vm-stop-${ENVIRONMENT}")
    ;;
  log-cleanup)
    FUNCTIONS=("intexuraos-log-cleanup-${ENVIRONMENT}")
    ;;
  predev-lifecycle)
    FUNCTIONS=(
      "intexuraos-predev-gateway-${ENVIRONMENT}"
      "intexuraos-predev-webhook-${ENVIRONMENT}"
      "intexuraos-predev-idle-check-${ENVIRONMENT}"
      "intexuraos-predev-report-ready-${ENVIRONMENT}"
    )
    ;;
  *)
    log "WARNING: No function mapping found for worker: ${WORKER}"
    log "Source uploaded but functions not redeployed"
    exit 0
    ;;
esac
```

### Step 2B.4: Update main cloudbuild.yaml

**File:** `cloudbuild/cloudbuild.yaml`

Replace Batch 8 (Cloud Functions) with consolidated version:

```yaml
# BATCH 8 - Cloud Functions Workers (CONSOLIDATED)
- name: 'node:22-slim'
  id: 'build-all-workers'
  waitFor: ['pnpm-install']
  entrypoint: 'bash'
  args:
    - '-c'
    - |
      corepack enable
      bash cloudbuild/scripts/build-all-workers.sh

- name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
  id: 'deploy-all-workers'
  waitFor: ['build-all-workers']
  entrypoint: 'bash'
  args: ['cloudbuild/scripts/deploy-all-workers.sh']
  env:
    - 'REGION=${_REGION}'
    - 'ENVIRONMENT=${_ENVIRONMENT}'
    - 'FUNCTIONS_SOURCE_BUCKET=${_FUNCTIONS_SOURCE_BUCKET}'
```

### Step 2B.5: Update Terraform cloud-build module

**File:** `terraform/modules/cloud-build/main.tf`

Add predev-lifecycle to workers list:

```hcl
locals {
  cloud_function_workers = [
    "vm-lifecycle",
    "log-cleanup",
    "predev-lifecycle",
  ]
}
```

---

## Phase 3: VM Configuration

This phase is mostly covered by the startup script in Phase 1.

### Step 3.1: Test startup script locally

```bash
# On a test Ubuntu VM:
sudo bash terraform/modules/predev-environment/scripts/startup.sh
```

### Step 3.2: Verify boot time

Target: < 90 seconds from VM start to report-ready callback.

---

## Phase 4: Integration

### Step 4.1: Deploy Terraform

```bash
cd terraform/environments/dev
terraform init
terraform plan
terraform apply
```

### Step 4.2: Configure GitHub Webhook

1. Go to GitHub repo Settings → Webhooks
2. Add webhook:
   - Payload URL: `<predev_webhook_url>` (from terraform output)
   - Content type: `application/json`
   - Secret: (value from `INTEXURAOS_GITHUB_WEBHOOK_SECRET` secret)
   - Events: Just the push event

### Step 4.3: Deploy Cloud Functions

```bash
# Trigger manual deploy
gcloud builds submit --config=workers/predev-lifecycle/cloudbuild.yaml
```

### Step 4.4: Test full flow

1. Access gateway URL → Should show "Starting" page
2. Wait for VM to boot → Should redirect to app
3. Wait 30+ minutes idle → VM should stop
4. Push to repo → Should trigger webhook

---

## Phase 5: Testing

### Step 5.1: Run worker tests

```bash
cd workers/predev-lifecycle
pnpm test
```

### Step 5.2: Verify coverage

```bash
pnpm run verify:workspace:tracked -- predev-lifecycle
```

### Step 5.3: E2E testing checklist

- [ ] Cold start: Gateway → "Starting" page → App loads
- [ ] Hot reload: Push to same branch → tsx watch picks up
- [ ] Branch switch: Push to different branch → Full restart
- [ ] Idle shutdown: 30 min no activity → VM stops
- [ ] Cost tracking: Verify ~$3/month estimate

---

## Phase 6: DevBar Extension

### Step 6.1: Update usePm2Logs hook

**File:** `apps/web/src/hooks/usePm2Logs.ts`

```typescript
const getLogServerUrl = (): string | null => {
  // Local development
  if (import.meta.env.DEV && window.location.hostname === 'localhost') {
    return 'http://localhost:8106';
  }

  // Pre-dev environment (Cloud Function gateway)
  if (window.location.hostname.includes('cloudfunctions.net')) {
    return `${window.location.origin}/devbar`;
  }

  // Production - no log server
  return null;
};

export function usePm2Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const baseUrl = getLogServerUrl();

  // Return early if no log server available
  if (!baseUrl) {
    return { logs: [], isConnected: false, error: 'Not available in production' };
  }

  // ... rest of hook using baseUrl + '/logs'
}
```

### Step 6.2: Update usePubSubEvents hook

**File:** `apps/web/src/hooks/usePubSubEvents.ts`

Same pattern as usePm2Logs - add environment detection:

```typescript
const getPubSubUrl = (): string | null => {
  if (import.meta.env.DEV && window.location.hostname === 'localhost') {
    return 'http://localhost:8105';
  }

  if (window.location.hostname.includes('cloudfunctions.net')) {
    return `${window.location.origin}/devbar`;
  }

  return null;
};
```

### Step 6.3: Update DevBar component

**File:** `apps/web/src/components/DevBar.tsx`

```typescript
const getEnvironmentLabel = (): 'LOCAL' | 'PRE-DEV' | null => {
  if (import.meta.env.DEV && window.location.hostname === 'localhost') {
    return 'LOCAL';
  }
  if (window.location.hostname.includes('cloudfunctions.net')) {
    return 'PRE-DEV';
  }
  return null;
};

export function DevBar() {
  const env = getEnvironmentLabel();

  // Don't render in production
  if (!env) return null;

  return (
    <div className="devbar">
      <span className="devbar-badge">{env}</span>
      {/* ... rest of DevBar UI */}
    </div>
  );
}
```

### Step 6.4: Complete DevBar UI panels

Implement the "coming soon" panels:

- Logs panel: Use `usePm2Logs` hook, render log entries with level colors
- Pub/Sub panel: Use `usePubSubEvents` hook, render event cards

---

## Verification Checklist

Before marking complete:

- [ ] `pnpm run ci:tracked` passes
- [ ] All worker tests pass with 95% coverage
- [ ] Terraform plan shows expected resources
- [ ] Gateway function responds with "Starting" page
- [ ] VM boots and reports ready < 90s
- [ ] Idle check stops VM after 30 min
- [ ] GitHub webhook triggers on push
- [ ] DevBar shows on pre-dev environment
- [ ] DevBar SSE streams work through gateway
- [ ] Cost tracking confirms ~$3/month

---

## Common Issues

### VM won't start

- Check MIG target size: `gcloud compute instance-groups managed describe predev-mig-dev --zone=...`
- Check startup script logs: `gcloud compute instances get-serial-port-output predev-...`

### Gateway returns 502

- Check VM is running and has external IP
- Check firewall rules allow traffic on ports 3000, 8105, 8106

### Webhook signature invalid

- Verify `INTEXURAOS_GITHUB_WEBHOOK_SECRET` matches GitHub webhook secret
- Check content type is `application/json`

### SSE disconnects

- Check gateway function timeout is 3600s (60 min)
- Check Cloud Run request timeout settings

---

## Files Created/Modified Summary

### New Files

```
ecosystem.config.cjs
terraform/modules/predev-environment/
  main.tf
  iam.tf
  functions.tf
  scheduler.tf
  variables.tf
  outputs.tf
  scripts/startup.sh
workers/predev-lifecycle/
  package.json
  tsconfig.json
  vitest.config.ts
  cloudbuild.yaml
  src/index.ts
  src/lib/state.ts
  src/lib/vm-control.ts
  src/lib/logger.ts
  src/functions/gateway.ts
  src/functions/webhook.ts
  src/functions/idle-check.ts
  src/functions/report-ready.ts
  src/__tests__/*.test.ts
cloudbuild/scripts/build-all-workers.sh
cloudbuild/scripts/deploy-all-workers.sh
```

### Modified Files

```
scripts/dev-setup.mjs
package.json (root - scripts)
cloudbuild/cloudbuild.yaml (Batch 8)
cloudbuild/scripts/deploy-function.sh (add predev case)
terraform/modules/cloud-build/main.tf (add predev-lifecycle)
terraform/environments/dev/main.tf (add predev module)
apps/web/src/hooks/usePm2Logs.ts
apps/web/src/hooks/usePubSubEvents.ts
apps/web/src/components/DevBar.tsx
```
