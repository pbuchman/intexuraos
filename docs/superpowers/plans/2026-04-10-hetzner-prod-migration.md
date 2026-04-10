# Hetzner Prod Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** INT-750 (migration), INT-1335 (prerequisite firestore fix)

**Goal:** Migrate IntexuraOS production workload from Google Cloud Run to a single Hetzner CX32 VM running all services under PM2, while keeping the data layer (Firestore, Pub/Sub, Cloud Storage, Secret Manager, Cloud Functions) on GCP.

**Architecture:** A new `terraform/environments/prod/` root module uses both the `hcloud` and `google` providers. Hetzner owns the VM, firewall, and primary IPv4. GCP continues to own all data resources — the prod Terraform environment only creates new `google_pubsub_subscription` resources that redirect push delivery from Cloud Run URLs to `https://intexuraos.cloud/...`. Nginx on the VM handles TLS termination (Let's Encrypt via DNS-01 challenge), path-based routing to localhost PM2 processes, and edge JWT verification for Pub/Sub push (replacing Cloud Run's native OIDC verification). Dev (home-dev) continues using the Pub/Sub emulator; prod uses real GCP Pub/Sub. Both environments share the single `(default)` Firestore database in project `intexuraos-dev-pbuchman` — this is an accepted constraint, see Decision 3.

**Tech Stack:**
- Terraform `>= 1.5.0`, `hashicorp/google ~> 5.0`, `hetznercloud/hcloud ~> 1.45`
- Ubuntu 24.04 LTS, Node.js 22 (via fnm), pnpm 9, PM2
- Nginx + `lua-resty-openidc` (provides `lua-resty-jwt-verification` transitively) + `lua-resty-http`
- certbot with DNS-01 ACME challenge (plugin depends on DNS provider — see Decision 2)
- GitHub Actions `workflow_dispatch` with SSH deploy via `appleboy/ssh-action`

---

## Scope Note

This plan covers one migration with 12 sequential phases. The phases are interdependent (you cannot test nginx before the VM exists, you cannot flip DNS before nginx works) so splitting into separate plans creates coordination overhead. If the engineer wants to pause between phases, natural checkpoints are marked with `⏸ CHECKPOINT`.

## Decisions To Confirm Before Starting

These are choices the user must make before execution. The plan assumes the default answers below. Flag these back to the user if the defaults are wrong.

**Decision 1: api-docs-hub deployment target**
The `api-docs-hub` app exists at `apps/api-docs-hub/` and is referenced in Terraform (`terraform/environments/dev/main.tf:307` sets `INTEXURAOS_API_DOCS_HUB_URL`), but it is **not** in `ecosystem.config.cjs` and `docs/validation/meta-validation-report.md:126` documents it as "forward-looking infrastructure" with only `GET /docs` and `GET /health` endpoints and no internal callers.
- **Default assumption:** Do not include api-docs-hub in the Hetzner PM2 config. Keep the Terraform env var pointing at Cloud Run (or set to empty). Revisit after migration.
- **Alternative:** Add it to the Hetzner PM2 config — adds one port and one nginx route.

**Decision 2: Let's Encrypt challenge method** ✅ RESOLVED 2026-04-10
`intexuraos.cloud` currently resolves to the GCP load balancer IP. The HTTP-01 ACME challenge requires the domain to resolve to the Hetzner VM, which creates a chicken-and-egg problem: you can't get the cert before the cutover, but you can't cut over without a cert.
- **Resolution:** DNS provider confirmed as **Cloudflare** via `dig NS intexuraos.cloud +short` → `khloe.ns.cloudflare.com.`, `rocco.ns.cloudflare.com.`. Use **DNS-01 challenge via `certbot-dns-cloudflare`**. The user must create a scoped Cloudflare API token (Zone:Read + DNS:Edit on `intexuraos.cloud` zone only) and store it in GCP Secret Manager under `INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN` for Phase 6 consumption.
- **Fallback:** Use a temporary subdomain `new.intexuraos.cloud` → Hetzner IP, obtain a cert for that first to validate the stack end-to-end, then use DNS-01 for the real cert at cutover time.

**Decision 3: Shared Firestore database**
Both dev (home-dev) and prod (Hetzner) will read/write the same `(default)` Firestore database in GCP project `intexuraos-dev-pbuchman`. This was confirmed as intentional by the user on 2026-04-10. INT-1335 adds lifecycle protection against accidental `terraform destroy`. No further data separation is planned.

**Decision 4: PM2 interpreter — tsx vs prebuilt bundles**
Dev runs `tsx` directly (`ecosystem.config.cjs:187`). INT-750 originally proposed prebuilt bundles (`dist/index.js`) for prod.
- **Default assumption:** Keep **tsx** in prod. Minimum divergence from dev, simpler deploy script, no esbuild configuration needed. Performance impact is negligible for always-running processes (tsx cost is at startup only). Revisit if memory becomes a constraint on CX32.
- **Alternative:** Add a `pnpm -r build` step to produce `dist/` bundles and use those. Adds complexity, saves ~30-50 MB RSS per process.

**Decision 5: Firestore SA key distribution**
The plan assumes the existing `~/.config/gcloud/sa-key.json` is reused for the Hetzner VM. This is the same SA as home-dev uses. Recommendation: **create a distinct `intexuraos-prod-deploy` service account** with the same IAM roles, so if the key is ever compromised you can rotate the prod key independently. This is a separate Linear issue if not done now.
- **Default assumption:** Reuse the existing SA key for the migration. Create separation as a follow-up (tracked in new Linear issue).

---

## File Structure

### New files (created by this plan)

- `terraform/environments/prod/main.tf` — root module for the prod environment
- `terraform/environments/prod/providers.tf` — hcloud + google provider setup
- `terraform/environments/prod/variables.tf` — input variables
- `terraform/environments/prod/terraform.tfvars.example` — template for operator
- `terraform/environments/prod/backend.tf` — GCS backend with `prefix = terraform/state/prod`
- `terraform/environments/prod/hetzner.tf` — VM, firewall, SSH key, primary IP
- `terraform/environments/prod/pubsub.tf` — prod push subscriptions pointing at `intexuraos.cloud`
- `terraform/environments/prod/outputs.tf` — server IP, FQDN hints
- `scripts/hetzner/provision.sh` — one-shot server setup (Node, PM2, nginx, lua, deploy user)
- `scripts/hetzner/load-secrets.sh` — pull secrets from GCP Secret Manager → `/etc/intexuraos/.env.prod`
- `scripts/hetzner/nginx/intexuraos.conf` — nginx config checked into the repo
- `scripts/hetzner/nginx/jwt-verify.lua` — Lua edge JWT verifier for Pub/Sub push
- `ecosystem.config.prod.cjs` — PM2 config for prod (no Vite, no emulator, NODE_ENV=production)
- `scripts/hetzner/ROLLBACK.md` — rollback runbook
- `docs/superpowers/plans/2026-04-10-hetzner-prod-migration.md` — this file
- `docs/setup/06-hetzner-prod-runbook.md` — post-migration operational runbook

### Modified files

- `.github/workflows/deploy.yml` — add `hetzner` strategy option and new job
- `.github/scripts/smart-dispatch.mjs` — teach analyzer about hetzner strategy
- `CLAUDE.md` — update "Environments" line to reflect new prod architecture
- `.claude/reference/environments.md` — updated environment documentation
- `terraform/environments/dev/main.tf` — remove any prod-aliased Cloud Run services (only if Decision 1 says to drop api-docs-hub)

### Unchanged / deliberately not touched

- All files under `apps/` and `packages/` — **zero application code changes**
- `terraform/modules/firestore/` — owned by INT-1335
- `terraform/modules/pubsub-push/` — reused as-is by the new prod environment
- `ecosystem.config.cjs` — dev config remains unchanged

---

## Risk Matrix

| Risk                                                       | Severity     | Mitigation                                                                                                                                |
| ---------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Mis-targeted `terraform destroy` wipes shared Firestore    | Catastrophic | INT-1335 merged before Phase 1                                                                                                            |
| Wrong env file loaded on Hetzner (dev vs prod)             | Catastrophic | File is named `.env.prod`, PM2 refuses to start unless `INTEXURAOS_ENVIRONMENT=prod`, service account has prod-only IAM scope (follow-up) |
| DNS cutover breaks external webhooks                       | High         | Pre-audit external integrations in Phase 0, keep old GCP IP for 72h rollback window                                                       |
| JWKS cache miss storm after certbot renew                  | Medium       | Test cache warm-up in Phase 7 before cutover                                                                                              |
| Pub/Sub `ack_deadline` exceeded due to nginx proxy timeout | High         | `proxy_read_timeout 610s;` in nginx config, tested in Phase 9                                                                             |
| Single VM = single point of failure                        | Accepted     | Acceptable for current scale. Monitoring via existing Dash0/Sentry.                                                                       |
| GCP egress costs to Hetzner Pub/Sub pushes                 | Low          | Budget alarm already exists; recheck after 1 week                                                                                         |

---

## Phase 0: Prerequisites

**Goal:** Everything the engineer needs before touching the Hetzner account.

### Task 0.1: Confirm INT-1335 is merged

- [ ] **Step 1: Check INT-1335 status**

Run: `gh pr list --search "INT-1335 in:title" --state merged --json number,title,mergedAt`
Expected: one merged PR with `deletion_policy = "ABANDON"` and a `lifecycle { prevent_destroy = true }` block. **If not merged, STOP and complete INT-1335 before continuing.**

- [ ] **Step 2: Verify the fix is in the current branch**

Run: `grep -n 'deletion_policy\|prevent_destroy' terraform/modules/firestore/main.tf`
Expected:
```
10:  deletion_policy = "ABANDON"
11:  lifecycle {
12:    prevent_destroy = true
13:  }
```

### Task 0.2: Collect user inputs

👤 **User must provide:**

- [ ] **Step 1:** Create Hetzner Cloud account at https://www.hetzner.com/cloud/ and generate an API token with read+write scope. Store in a password manager; the engineer will use it as the `HCLOUD_TOKEN` env var for `terraform apply`. **Do not commit this token.**
- [ ] **Step 2:** Confirm the DNS provider for `intexuraos.cloud`. Run: `dig NS intexuraos.cloud +short`. Report the nameservers to the engineer — this determines which certbot DNS plugin is installed in Phase 6.
- [ ] **Step 3:** Generate an SSH keypair dedicated to the `deploy` user on Hetzner:
  ```bash
  ssh-keygen -t ed25519 -C "intexuraos-hetzner-deploy" -f ~/.ssh/intexuraos_hetzner_deploy
  ```
  The **public** key (`~/.ssh/intexuraos_hetzner_deploy.pub`) is committed to Terraform as a resource. The **private** key is stored in a password manager and added to GitHub Secrets later in Phase 10.

### Task 0.3: Audit external webhook allowlists

👤 **User must do:**

- [ ] **Step 1:** List every external integration that may have the current GCP static IP in an allowlist. Current known integrations:
  - WhatsApp Business API webhook
  - Notion integration webhook (if any)
  - Linear webhook (if any)
  - GitHub webhook (for code-agent)
- [ ] **Step 2:** For each integration, confirm whether it points at an **IP** (will break on cutover) or a **domain** (will not break). Record findings in a shared doc.
- [ ] **Step 3:** For IP-pinned integrations, prepare a cutover runbook entry: "Re-register webhook at the new Hetzner IP within 5 minutes of DNS flip."

### Task 0.4: Verify Secret Manager has all required secrets

- [ ] **Step 1:** List all prod-required secrets

Run: `gcloud secrets list --project=intexuraos-dev-pbuchman --format='value(name)' | sort`
Expected: a list that includes at minimum the secrets named in `terraform/environments/dev/main.tf` under `module "secret_manager"` (currently around line 479 — read it to get the full list). Record the list; Phase 4 will consume it.

- [ ] **Step 2:** Verify the SA key at `$HOME/.config/gcloud/sa-key.json` has permission to read them

Run: `gcloud --impersonate-service-account=$(jq -r .client_email "$HOME/.config/gcloud/sa-key.json") secrets versions access latest --secret=INTEXURAOS_AUTH_JWKS_URL --project=intexuraos-dev-pbuchman`
Expected: returns the secret value. If permission denied, the engineer must grant `roles/secretmanager.secretAccessor` to the SA before continuing.

⏸ **CHECKPOINT 0:** Do not continue to Phase 1 until all Phase 0 tasks are green. Phase 1 provisions real infrastructure and incurs real cost.

---

## Phase 1: Terraform `prod` Environment Scaffold

**Goal:** Create the new root module with providers, variables, and backend. Empty state file, no resources yet.

### Task 1.1: Create the directory and providers file

**Files:**
- Create: `terraform/environments/prod/providers.tf`

- [ ] **Step 1: Create `terraform/environments/prod/providers.tf`**

```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
}

# hcloud provider reads HCLOUD_TOKEN from the environment
provider "hcloud" {}
```

- [ ] **Step 2: Commit**

```bash
git add terraform/environments/prod/providers.tf
git commit -m "feat(terraform): scaffold prod environment providers (INT-750)"
```

### Task 1.2: Add variables and tfvars template

**Files:**
- Create: `terraform/environments/prod/variables.tf`
- Create: `terraform/environments/prod/terraform.tfvars.example`

- [ ] **Step 1: Create `terraform/environments/prod/variables.tf`**

```hcl
variable "project_id" {
  description = "GCP project ID (MUST match dev environment — shared Firestore)"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-central2"
}

variable "environment" {
  description = "Environment name (literal string 'prod')"
  type        = string
  default     = "prod"
  validation {
    condition     = var.environment == "prod"
    error_message = "This root module is hardcoded for prod."
  }
}

variable "hetzner_location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "nbg1" # Nuremberg — closest to europe-central2
}

variable "hetzner_server_type" {
  description = "Hetzner server type"
  type        = string
  default     = "cx32" # 4 vCPU, 8GB RAM, 80GB NVMe
}

variable "deploy_ssh_public_key" {
  description = "Public SSH key for the deploy user on Hetzner VM"
  type        = string
}

variable "admin_ssh_source_ips" {
  description = "Source IPs allowed to SSH (port 22) to the VM"
  type        = list(string)
}

variable "domain" {
  description = "Public domain for prod"
  type        = string
  default     = "intexuraos.cloud"
}
```

- [ ] **Step 2: Create `terraform/environments/prod/terraform.tfvars.example`**

```hcl
# Copy to terraform.tfvars and fill in values.
# DO NOT commit terraform.tfvars.

project_id = "intexuraos-dev-pbuchman"
# region defaults to europe-central2

# Public SSH key for deploy user on the VM.
# Generated in Phase 0.2: ~/.ssh/intexuraos_hetzner_deploy.pub
deploy_ssh_public_key = "ssh-ed25519 AAAA... intexuraos-hetzner-deploy"

# Source IPs allowed to SSH. Use CIDR notation.
# Example: your home IP + office IP
admin_ssh_source_ips = [
  "203.0.113.42/32",
]
```

- [ ] **Step 3: Verify `.gitignore` already excludes `terraform.tfvars`**

Run: `grep -n "terraform.tfvars" .gitignore`
Expected: a line matching `*.tfvars` or `**/terraform.tfvars`. If missing, add `**/terraform.tfvars` to `.gitignore` before continuing.

- [ ] **Step 4: Commit**

```bash
git add terraform/environments/prod/variables.tf terraform/environments/prod/terraform.tfvars.example
git commit -m "feat(terraform): add prod environment variables (INT-750)"
```

### Task 1.3: Backend configuration

**Files:**
- Create: `terraform/environments/prod/backend.tf`

- [ ] **Step 1: Find the existing backend bucket name**

Run: `grep -rn "backend \"gcs\"" terraform/environments/dev/`
Expected: path and bucket name. Record the bucket name as `<BUCKET>` for the next step.

- [ ] **Step 2: Create `terraform/environments/prod/backend.tf`**

```hcl
terraform {
  backend "gcs" {
    bucket = "<BUCKET>" # Same bucket as dev, different prefix
    prefix = "terraform/state/prod"
  }
}
```

Replace `<BUCKET>` with the value from Step 1. **Critical:** use `prefix = "terraform/state/prod"`, distinct from the dev prefix. This is the state-isolation boundary.

- [ ] **Step 3: Initialize**

```bash
cd terraform/environments/prod
terraform init
```

Expected: `Terraform has been successfully initialized!` and a note about the backend being configured. No errors.

- [ ] **Step 4: Commit**

```bash
git add terraform/environments/prod/backend.tf
git commit -m "feat(terraform): configure gcs backend for prod (INT-750)"
```

### Task 1.4: Create minimal `main.tf` and `outputs.tf` stubs

**Files:**
- Create: `terraform/environments/prod/main.tf`
- Create: `terraform/environments/prod/outputs.tf`

> **Plan defect corrected 2026-04-10:** The original plan used a `data "google_firestore_database" "shared"` block, but the hashicorp/google v5.x provider does **not** expose Firestore as a data source (confirmed by introspecting the provider schema: 279 data sources total, zero Firestore). That data source was added in v6.x. For v5.x, the database name `"(default)"` is treated as a GCP-API-level constant in a local, and downstream resources that need to reference it hardcode the string.

- [ ] **Step 1: Create `terraform/environments/prod/main.tf`** with shared locals only

```hcl
# IntexuraOS Prod Environment (Hetzner)
# See: docs/superpowers/plans/2026-04-10-hetzner-prod-migration.md

locals {
  common_labels = {
    environment = "prod"
    managed_by  = "terraform"
    component   = "prod-hetzner"
  }

  # Shared Firestore (default) — owned by the dev environment.
  # The database name is a GCP-API-level constant, not a Terraform-managed value,
  # so downstream resources hardcode "(default)" when they need to reference it.
  # See Decision 3 in the migration plan.
  firestore_database_id = "(default)"
}
```

- [ ] **Step 2: Create `terraform/environments/prod/outputs.tf`**

```hcl
output "firestore_database_id" {
  description = "Shared Firestore database name (owned by dev env, hardcoded constant)"
  value       = local.firestore_database_id
}

output "environment" {
  description = "Environment name"
  value       = var.environment
}
```

- [ ] **Step 3: Plan**

Export env vars first to avoid accidentally hitting emulators (required by the repo's pre-tool-use hook):

```bash
cd terraform/environments/prod
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/sa-key.json" \
terraform plan
```

Expected: `Changes to Outputs:` showing only the two new output values (`environment = "prod"`, `firestore_database_id = "(default)"`). Zero resource changes.

- [ ] **Step 4: Commit**

```bash
git add terraform/environments/prod/main.tf terraform/environments/prod/outputs.tf
git commit -m "feat(terraform): prod env scaffold main and outputs (INT-750)"
```

⏸ **CHECKPOINT 1:** Prod Terraform environment exists with an empty state and a clean plan. Nothing is provisioned yet.

---

## Phase 2: Hetzner Infrastructure

**Goal:** One CX32 VM running Ubuntu 24.04, reachable via SSH from the allowlisted IPs, with ports 80/443 open.

### Task 2.1: SSH key and primary IP

**Files:**
- Create: `terraform/environments/prod/hetzner.tf`

- [ ] **Step 1: Create `terraform/environments/prod/hetzner.tf` with SSH key and IP**

```hcl
# -----------------------------------------------------------------------------
# Hetzner Cloud Resources
# -----------------------------------------------------------------------------

resource "hcloud_ssh_key" "deploy" {
  name       = "intexuraos-deploy"
  public_key = var.deploy_ssh_public_key
  labels     = local.common_labels
}

resource "hcloud_primary_ip" "prod_ipv4" {
  name          = "intexuraos-prod-ipv4"
  datacenter    = "${var.hetzner_location}-dc3"
  type          = "ipv4"
  assignee_type = "server"
  auto_delete   = false
  labels        = local.common_labels
}
```

- [ ] **Step 2: Plan**

```bash
cd terraform/environments/prod
HCLOUD_TOKEN=<your-token> terraform plan
```

Expected: 2 resources to add (`hcloud_ssh_key.deploy`, `hcloud_primary_ip.prod_ipv4`).

- [ ] **Step 3: Apply**

```bash
HCLOUD_TOKEN=<your-token> terraform apply
```

Expected: 2 added. Record the IP output in `terraform output`.

- [ ] **Step 4: Commit**

```bash
git add terraform/environments/prod/hetzner.tf
git commit -m "feat(terraform): add hetzner ssh key and primary ipv4 (INT-750)"
```

### Task 2.2: Firewall rules

- [ ] **Step 1: Append to `terraform/environments/prod/hetzner.tf`**

```hcl
resource "hcloud_firewall" "prod" {
  name   = "intexuraos-prod"
  labels = local.common_labels

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_source_ips
    description = "SSH (restricted)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP (Let's Encrypt HTTP-01 + redirect)"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS"
  }

  rule {
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "ICMP (ping)"
  }
}
```

- [ ] **Step 2: Plan and apply**

```bash
HCLOUD_TOKEN=<your-token> terraform plan
HCLOUD_TOKEN=<your-token> terraform apply
```

Expected: 1 added (`hcloud_firewall.prod`).

- [ ] **Step 3: Commit**

```bash
git add terraform/environments/prod/hetzner.tf
git commit -m "feat(terraform): add hetzner firewall rules (INT-750)"
```

### Task 2.3: Server resource

- [ ] **Step 1: Append the server resource to `terraform/environments/prod/hetzner.tf`**

```hcl
resource "hcloud_server" "prod" {
  name         = "intexuraos-prod"
  server_type  = var.hetzner_server_type
  image        = "ubuntu-24.04"
  location     = var.hetzner_location
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.prod.id]

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.prod_ipv4.id
    ipv6_enabled = true
  }

  labels = local.common_labels

  # Prevent accidental replacement (which would create a new VM with a new IP)
  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      # Ubuntu image ID changes when Hetzner updates the snapshot; do not recreate.
      image,
    ]
  }
}
```

- [ ] **Step 2: Append to `terraform/environments/prod/outputs.tf`**

```hcl
output "hetzner_server_ipv4" {
  description = "Hetzner VM public IPv4 — use for DNS A record"
  value       = hcloud_primary_ip.prod_ipv4.ip_address
}

output "hetzner_server_name" {
  description = "Hetzner VM name"
  value       = hcloud_server.prod.name
}

output "dns_update_hint" {
  description = "DNS update to perform at cutover"
  value       = "A ${var.domain} ${hcloud_primary_ip.prod_ipv4.ip_address}"
}
```

- [ ] **Step 3: Apply**

```bash
HCLOUD_TOKEN=<your-token> terraform apply
```

Expected: 1 added (`hcloud_server.prod`). Output shows the server IP.

- [ ] **Step 4: Verify SSH works (as root, with your personal key, using Hetzner's web console-issued temporary root password if needed)**

Run: `ssh root@$(terraform output -raw hetzner_server_ipv4) "uname -a"`
Expected: `Linux intexuraos-prod ... Ubuntu ... x86_64 GNU/Linux`

- [ ] **Step 5: Commit**

```bash
git add terraform/environments/prod/hetzner.tf terraform/environments/prod/outputs.tf
git commit -m "feat(terraform): provision hetzner cx32 server (INT-750)"
```

⏸ **CHECKPOINT 2:** Hetzner VM is running, reachable via SSH, firewalled correctly. Cost clock has started (~€6.80/mo prorated).

---

## Phase 3: Server Provisioning

**Goal:** Turn the bare Ubuntu VM into an IntexuraOS host: Node 22, pnpm, PM2, nginx with Lua, certbot, unprivileged `deploy` user.

### Task 3.1: Write the provisioning script

**Files:**
- Create: `scripts/hetzner/provision.sh`

- [ ] **Step 1: Create `scripts/hetzner/provision.sh`**

```bash
#!/usr/bin/env bash
#
# IntexuraOS Hetzner VM provisioning script.
# Idempotent: safe to re-run on an already-provisioned VM.
#
# Run as root on a fresh Ubuntu 24.04 VM:
#   curl -fsSL https://raw.githubusercontent.com/pbuchman/intexuraos/development/scripts/hetzner/provision.sh | bash
# Or copy via scp and run locally.

set -euo pipefail

NODE_VERSION="22"
DEPLOY_USER="deploy"
APP_DIR="/opt/intexuraos"
ETC_DIR="/etc/intexuraos"
WEB_DIR="/var/www/intexuraos/web/dist"

echo "=== [1/8] System update ==="
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "=== [2/8] Install base packages ==="
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl ca-certificates git build-essential unzip \
  ufw fail2ban \
  nginx libnginx-mod-http-lua \
  lua5.1 luarocks \
  certbot python3-certbot-nginx \
  jq

echo "=== [3/8] Install Node ${NODE_VERSION} via fnm (system-wide) ==="
if [ ! -d /opt/fnm ]; then
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /opt/fnm --skip-shell
fi
export PATH="/opt/fnm:\$PATH"
/opt/fnm/fnm install "${NODE_VERSION}"
/opt/fnm/fnm default "${NODE_VERSION}"

# Make node/pnpm available to all users via /usr/local/bin symlinks
NODE_DIR="\$(/opt/fnm/fnm exec --using=${NODE_VERSION} -- node -e 'console.log(process.execPath)' | xargs dirname)"
ln -sf "\${NODE_DIR}/node" /usr/local/bin/node
ln -sf "\${NODE_DIR}/npm" /usr/local/bin/npm
ln -sf "\${NODE_DIR}/npx" /usr/local/bin/npx

echo "=== [4/8] Install pnpm and PM2 ==="
/usr/local/bin/npm install -g pnpm@9 pm2@latest

# Symlink pnpm and pm2 for the deploy user
ln -sf "\${NODE_DIR}/pnpm" /usr/local/bin/pnpm
ln -sf "\${NODE_DIR}/pm2" /usr/local/bin/pm2

echo "=== [5/8] Install lua-resty-openidc (for JWT verification) ==="
# lua-resty-openidc depends on lua-resty-jwt, lua-resty-http, lua-resty-session, lua-cjson
luarocks install lua-resty-openidc

echo "=== [6/8] Create deploy user ==="
if ! id -u "\${DEPLOY_USER}" > /dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "\${DEPLOY_USER}"
fi

mkdir -p "\${APP_DIR}" "\${ETC_DIR}" "\${WEB_DIR}"
chown -R "\${DEPLOY_USER}:\${DEPLOY_USER}" "\${APP_DIR}" "\${WEB_DIR}"
chown root:"\${DEPLOY_USER}" "\${ETC_DIR}"
chmod 750 "\${ETC_DIR}"

# deploy user must be able to nginx -s reload WITHOUT sudo? No — nginx reload is done by
# the deploy pipeline as root via a tiny sudoers rule:
cat > /etc/sudoers.d/deploy-nginx <<EOF
# Allow deploy user to reload nginx only
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload, /usr/sbin/nginx -t, /bin/systemctl reload nginx
EOF
chmod 440 /etc/sudoers.d/deploy-nginx

echo "=== [7/8] Configure ufw firewall (defense in depth with hcloud_firewall) ==="
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

echo "=== [8/8] Setup PM2 startup for deploy user ==="
su - "\${DEPLOY_USER}" -c 'pm2 startup systemd -u deploy --hp /home/deploy' | tail -1 | bash

echo ""
echo "=== Provisioning complete ==="
echo "Next: run load-secrets.sh, then deploy code to ${APP_DIR}."
```

- [ ] **Step 2: `chmod +x` and shellcheck locally**

```bash
chmod +x scripts/hetzner/provision.sh
shellcheck scripts/hetzner/provision.sh
```

Expected: no errors. If `shellcheck` is not installed, `brew install shellcheck` (macOS) or `apt install shellcheck` (Linux).

- [ ] **Step 3: Commit**

```bash
git add scripts/hetzner/provision.sh
git commit -m "feat(hetzner): add server provisioning script (INT-750)"
```

### Task 3.2: Run the script on the VM

- [ ] **Step 1: Copy the script**

```bash
SERVER_IP=$(cd terraform/environments/prod && terraform output -raw hetzner_server_ipv4)
scp scripts/hetzner/provision.sh root@${SERVER_IP}:/tmp/provision.sh
```

Expected: file copied.

- [ ] **Step 2: Execute**

```bash
ssh root@${SERVER_IP} "bash /tmp/provision.sh"
```

Expected: `=== Provisioning complete ===` at the end, no errors.

- [ ] **Step 3: Verify tools are installed**

```bash
ssh root@${SERVER_IP} "node --version && pnpm --version && pm2 --version && nginx -V 2>&1 | grep -o lua && certbot --version"
```

Expected: `v22.x.x`, `9.x.x`, `5.x.x`, `lua`, `certbot 2.x.x`

- [ ] **Step 4: Verify deploy user exists and cannot sudo anything except nginx reload**

```bash
ssh root@${SERVER_IP} "sudo -l -U deploy"
```

Expected output includes only: `(root) NOPASSWD: /usr/sbin/nginx -s reload, /usr/sbin/nginx -t, /bin/systemctl reload nginx`

⏸ **CHECKPOINT 3:** VM is fully provisioned. No app code or secrets on it yet.

---

## Phase 4: Secrets and Environment Configuration

**Goal:** Copy the GCP SA key, pull all secrets from GCP Secret Manager, write `/etc/intexuraos/.env.prod`.

### Task 4.1: Copy SA key to the VM

- [ ] **Step 1: Copy and set permissions**

```bash
SERVER_IP=$(cd terraform/environments/prod && terraform output -raw hetzner_server_ipv4)
scp ~/.config/gcloud/sa-key.json root@${SERVER_IP}:/etc/intexuraos/sa-key.json
ssh root@${SERVER_IP} "chmod 640 /etc/intexuraos/sa-key.json && chown root:deploy /etc/intexuraos/sa-key.json"
```

Expected: file on VM, readable by deploy user, not world-readable.

- [ ] **Step 2: Verify the deploy user can authenticate to GCP with it**

```bash
ssh root@${SERVER_IP} "sudo -u deploy env GOOGLE_APPLICATION_CREDENTIALS=/etc/intexuraos/sa-key.json gcloud auth application-default print-access-token" || true
```

Note: `gcloud` may not be installed — that's OK. We'll test via Node instead in Phase 5. For now, just verify the file is readable:

```bash
ssh root@${SERVER_IP} "sudo -u deploy head -c 50 /etc/intexuraos/sa-key.json"
```

Expected: prints the first 50 bytes of the JSON key (starts with `{"type": "service_account"`).

### Task 4.2: Write the secrets loader script

**Files:**
- Create: `scripts/hetzner/load-secrets.sh`

- [ ] **Step 1: Create `scripts/hetzner/load-secrets.sh`**

```bash
#!/usr/bin/env bash
#
# Pull secrets from GCP Secret Manager → /etc/intexuraos/.env.prod.
# Must run as root on the Hetzner VM (writes to /etc/intexuraos/).
# Uses the SA key at /etc/intexuraos/sa-key.json.

set -euo pipefail

PROJECT_ID="intexuraos-dev-pbuchman"
ENV_FILE="/etc/intexuraos/.env.prod"
SA_KEY="/etc/intexuraos/sa-key.json"

if [ ! -f "\$SA_KEY" ]; then
  echo "ERROR: SA key not found at \$SA_KEY" >&2
  exit 1
fi

# Install gcloud CLI if not present
if ! command -v gcloud >/dev/null 2>&1; then
  echo "Installing gcloud CLI..."
  curl -fsSL https://sdk.cloud.google.com > /tmp/gcloud-install.sh
  bash /tmp/gcloud-install.sh --disable-prompts --install-dir=/opt
  ln -sf /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
fi

# Authenticate
gcloud auth activate-service-account --key-file="\$SA_KEY" --project="\$PROJECT_ID"

# Write env file atomically
TMP_FILE="\$(mktemp)"
trap 'rm -f "\$TMP_FILE"' EXIT

cat > "\$TMP_FILE" <<EOF
# Generated by scripts/hetzner/load-secrets.sh on \$(date -u +%Y-%m-%dT%H:%M:%SZ)
# DO NOT EDIT BY HAND — re-run the script to refresh.
INTEXURAOS_ENVIRONMENT=prod
INTEXURAOS_GCP_PROJECT_ID=${PROJECT_ID}
INTEXURAOS_WEB_APP_URL=https://intexuraos.cloud
GOOGLE_APPLICATION_CREDENTIALS=/etc/intexuraos/sa-key.json
NODE_ENV=production
EOF

# Pull secrets from Secret Manager.
# This list MUST match terraform/environments/dev/main.tf module "secret_manager".
# Keep in sync manually — or generate from terraform via a follow-up issue.
SECRETS=(
  INTEXURAOS_AUTH0_DOMAIN
  INTEXURAOS_AUTH0_CLIENT_ID
  INTEXURAOS_AUTH0_SPA_CLIENT_ID
  INTEXURAOS_AUTH_JWKS_URL
  INTEXURAOS_AUTH_ISSUER
  INTEXURAOS_AUTH_AUDIENCE
  INTEXURAOS_INTERNAL_AUTH_TOKEN
  INTEXURAOS_OPENROUTER_APP_API_KEY
  INTEXURAOS_OPENAI_APP_API_KEY
  INTEXURAOS_GEMINI_APP_API_KEY
  INTEXURAOS_MINIMAX_APP_API_KEY
  INTEXURAOS_MIMO_APP_API_KEY
  INTEXURAOS_DASHSCOPE_APP_API_KEY
  INTEXURAOS_DASH0_OTLP_ENDPOINT
  INTEXURAOS_DASH0_AUTH_TOKEN
  INTEXURAOS_WHATSAPP_ACCESS_TOKEN
  INTEXURAOS_WHATSAPP_APP_SECRET
  INTEXURAOS_WHATSAPP_WABA_ID
  INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID
  INTEXURAOS_WHATSAPP_VERIFY_TOKEN
  INTEXURAOS_TOKEN_ENCRYPTION_KEY
  INTEXURAOS_ENCRYPTION_KEY
  INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID
  INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET
  INTEXURAOS_GITHUB_OAUTH_CLIENT_ID
  INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET
  INTEXURAOS_GITHUB_WEBHOOK_SECRET
  INTEXURAOS_WEBHOOK_VERIFY_SECRET
  INTEXURAOS_ORCHESTRATOR_SECRET
  INTEXURAOS_CLOUDFLARE_ACCOUNT_ID
  INTEXURAOS_CLOUDFLARE_API_TOKEN
)

echo "Pulling \${#SECRETS[@]} secrets..."
for SECRET in "\${SECRETS[@]}"; do
  VALUE="\$(gcloud secrets versions access latest --secret="\$SECRET" --project="\$PROJECT_ID" 2>/dev/null || echo '')"
  if [ -z "\$VALUE" ]; then
    echo "  WARN: \$SECRET is missing from Secret Manager" >&2
    continue
  fi
  # Escape any single quotes
  ESCAPED="\${VALUE//\\'/\\'\\\\\\'\\'}"
  echo "\$SECRET='\$ESCAPED'" >> "\$TMP_FILE"
done

# Add non-secret constants (topic names, bucket names, etc.)
# These live in ecosystem.config.prod.cjs instead — keep this file for secrets only.

# Atomically replace the env file
install -o root -g deploy -m 640 "\$TMP_FILE" "\$ENV_FILE"
echo "Wrote \$ENV_FILE"
```

- [ ] **Step 2: Test-run locally with shellcheck**

```bash
chmod +x scripts/hetzner/load-secrets.sh
shellcheck scripts/hetzner/load-secrets.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/hetzner/load-secrets.sh
git commit -m "feat(hetzner): add secret manager loader (INT-750)"
```

### Task 4.3: Run the script on the VM

- [ ] **Step 1: Copy and run**

```bash
SERVER_IP=$(cd terraform/environments/prod && terraform output -raw hetzner_server_ipv4)
scp scripts/hetzner/load-secrets.sh root@${SERVER_IP}:/tmp/load-secrets.sh
ssh root@${SERVER_IP} "bash /tmp/load-secrets.sh"
```

Expected: `Wrote /etc/intexuraos/.env.prod`. Warnings only for secrets that genuinely don't exist — zero warnings is best.

- [ ] **Step 2: Verify file ownership and content**

```bash
ssh root@${SERVER_IP} "ls -la /etc/intexuraos/.env.prod && sudo -u deploy head -5 /etc/intexuraos/.env.prod"
```

Expected: `-rw-r----- 1 root deploy` and visible `INTEXURAOS_ENVIRONMENT=prod` line.

- [ ] **Step 3: Verify the deploy user can read it**

```bash
ssh root@${SERVER_IP} "sudo -u deploy cat /etc/intexuraos/.env.prod > /dev/null && echo OK"
```

Expected: `OK`

⏸ **CHECKPOINT 4:** Secrets are on the VM. Nothing depends on Cloud Run anymore (from a secrets perspective).

---

## Phase 5: Deploy Application Code (First Deployment, Manual)

**Goal:** Get all 21 services running under PM2 on the VM, talking to real GCP Pub/Sub. No nginx yet — verification via `curl localhost:<port>/health`.

### Task 5.1: Write `ecosystem.config.prod.cjs`

**Files:**
- Create: `ecosystem.config.prod.cjs`

- [ ] **Step 1: Create the prod ecosystem config**

```javascript
/**
 * PM2 Ecosystem Configuration — PROD (Hetzner)
 *
 * Usage on the VM (as deploy user):
 *   cd /opt/intexuraos
 *   pm2 start ecosystem.config.prod.cjs
 *
 * Key differences from dev (ecosystem.config.cjs):
 *   - No PUBSUB_EMULATOR_HOST → uses real GCP Pub/Sub
 *   - NODE_ENV=production
 *   - INTEXURAOS_ENVIRONMENT=prod (ENFORCED by require() check below)
 *   - All secrets loaded from /etc/intexuraos/.env.prod via dotenv
 *   - Web app is NOT in this config — served as static files by nginx
 *   - No file watching (deploy triggers explicit reload)
 */

const path = require('path');
const dotenv = require('dotenv');

// Load secrets from /etc/intexuraos/.env.prod BEFORE reading any env vars.
const ENV_FILE = '/etc/intexuraos/.env.prod';
const result = dotenv.config({ path: ENV_FILE });
if (result.error) {
  throw new Error(`Failed to load ${ENV_FILE}: ${result.error.message}`);
}

// HARD ENFORCEMENT: refuse to start if INTEXURAOS_ENVIRONMENT is not 'prod'.
// This prevents the catastrophic case of dev env vars ending up on this VM.
if (process.env.INTEXURAOS_ENVIRONMENT !== 'prod') {
  throw new Error(
    `Refusing to start: INTEXURAOS_ENVIRONMENT must be 'prod' on this host, ` +
      `got '${process.env.INTEXURAOS_ENVIRONMENT ?? '<unset>'}'. Check ${ENV_FILE}.`,
  );
}

const COMMON_SERVICE_ENV = {
  HOME: process.env.HOME ?? '/home/deploy',
  // NO PUBSUB_EMULATOR_HOST — uses real GCP Pub/Sub on prod
  INTEXURAOS_AUTH_JWKS_URL: process.env.INTEXURAOS_AUTH_JWKS_URL,
  INTEXURAOS_AUTH_ISSUER: process.env.INTEXURAOS_AUTH_ISSUER,
  INTEXURAOS_AUTH_AUDIENCE: process.env.INTEXURAOS_AUTH_AUDIENCE,
  INTEXURAOS_AUTH0_DOMAIN: process.env.INTEXURAOS_AUTH0_DOMAIN,
  INTEXURAOS_AUTH0_CLIENT_ID: process.env.INTEXURAOS_AUTH0_CLIENT_ID,
  INTEXURAOS_INTERNAL_AUTH_TOKEN: process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN,
  INTEXURAOS_GCP_PROJECT_ID: process.env.INTEXURAOS_GCP_PROJECT_ID,
  INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL,
  INTEXURAOS_MINIMAX_APP_API_KEY: process.env.INTEXURAOS_MINIMAX_APP_API_KEY,
  INTEXURAOS_MIMO_APP_API_KEY: process.env.INTEXURAOS_MIMO_APP_API_KEY,
  INTEXURAOS_GEMINI_APP_API_KEY: process.env.INTEXURAOS_GEMINI_APP_API_KEY,
  INTEXURAOS_DASHSCOPE_APP_API_KEY: process.env.INTEXURAOS_DASHSCOPE_APP_API_KEY,
  INTEXURAOS_OPENROUTER_APP_API_KEY: process.env.INTEXURAOS_OPENROUTER_APP_API_KEY,
  INTEXURAOS_ENVIRONMENT: 'prod',
  INTEXURAOS_RUNTIME: 'prod',
  INTEXURAOS_DASH0_OTLP_ENDPOINT: process.env.INTEXURAOS_DASH0_OTLP_ENDPOINT,
  INTEXURAOS_DASH0_AUTH_TOKEN: process.env.INTEXURAOS_DASH0_AUTH_TOKEN,
  GOOGLE_APPLICATION_CREDENTIALS: '/etc/intexuraos/sa-key.json',
};

// Service URLs — localhost only (all services on the same VM).
const COMMON_SERVICE_URLS = {
  INTEXURAOS_USER_SERVICE_URL: 'http://localhost:8110',
  INTEXURAOS_NOTION_SERVICE_URL: 'http://localhost:8112',
  INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://localhost:8113',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL: 'http://localhost:8114',
  INTEXURAOS_RESEARCH_AGENT_URL: 'http://localhost:8116',
  INTEXURAOS_COMMANDS_AGENT_URL: 'http://localhost:8117',
  INTEXURAOS_ACTIONS_AGENT_URL: 'http://localhost:8118',
  INTEXURAOS_DATA_INSIGHTS_AGENT_URL: 'http://localhost:8119',
  INTEXURAOS_IMAGE_SERVICE_URL: 'http://localhost:8120',
  INTEXURAOS_NOTES_AGENT_URL: 'http://localhost:8121',
  INTEXURAOS_APP_SETTINGS_SERVICE_URL: 'http://localhost:8122',
  INTEXURAOS_TODOS_AGENT_URL: 'http://localhost:8123',
  INTEXURAOS_BOOKMARKS_AGENT_URL: 'http://localhost:8124',
  INTEXURAOS_CALENDAR_AGENT_URL: 'http://localhost:8125',
  INTEXURAOS_LINEAR_AGENT_URL: 'http://localhost:8126',
  INTEXURAOS_CHAT_AGENT_URL: 'http://localhost:8129',
  INTEXURAOS_CODE_AGENT_URL: 'https://intexuraos.cloud/api/code',
  INTEXURAOS_WEB_AGENT_URL: 'http://localhost:8127',
  INTEXURAOS_CRON_AGENT_URL: 'http://localhost:8130',
  INTEXURAOS_HELLSCRIPT_AGENT_URL: 'http://localhost:8131',
  INTEXURAOS_LLM_USAGE_SERVICE_URL: 'http://localhost:8132',
};

// Per-service env — MUST match ecosystem.config.cjs for dev, but with real
// (non-emulator) GCP topic names.
const SERVICE_ENV_MAPPINGS = {
  'research-agent': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-prod',
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: 'https://intexuraos.cloud',
    INTEXURAOS_SHARED_CONTENT_BUCKET: 'intexuraos-shared-content',
    INTEXURAOS_SHARE_BASE_URL: 'https://intexuraos.cloud',
    INTEXURAOS_PUBSUB_RESEARCH_PROCESS_TOPIC: 'intexuraos-research-process-prod',
    INTEXURAOS_PUBSUB_LLM_CALL_TOPIC: 'intexuraos-llm-call-prod',
  },
  'whatsapp-service': {
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-prod',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION: 'intexuraos-whatsapp-send-prod-sub',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC: 'intexuraos-whatsapp-media-cleanup-prod',
    INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC: 'intexuraos-commands-ingest-prod',
    INTEXURAOS_WHATSAPP_ACCESS_TOKEN: process.env.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
    INTEXURAOS_WHATSAPP_APP_SECRET: process.env.INTEXURAOS_WHATSAPP_APP_SECRET,
    INTEXURAOS_WHATSAPP_WABA_ID: process.env.INTEXURAOS_WHATSAPP_WABA_ID,
    INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID: process.env.INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID,
    INTEXURAOS_WHATSAPP_VERIFY_TOKEN: process.env.INTEXURAOS_WHATSAPP_VERIFY_TOKEN,
    INTEXURAOS_WHATSAPP_MEDIA_BUCKET: 'whatsapp-media',
    INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION: 'intexuraos-whatsapp-media-cleanup-prod-sub',
    INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC: 'intexuraos-whatsapp-webhook-process-prod',
    INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC: 'intexuraos-audio-stored-prod',
    INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC: 'intexuraos-approval-reply-prod',
  },
  'actions-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: 'intexuraos-actions-queue-prod',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-prod',
    INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC: 'intexuraos-calendar-preview-prod',
    INTEXURAOS_WEB_APP_URL: process.env.INTEXURAOS_WEB_APP_URL,
  },
  'code-agent': {
    INTEXURAOS_SERVICE_URL: 'https://intexuraos.cloud/api/code',
    INTEXURAOS_WEBHOOK_VERIFY_SECRET: process.env.INTEXURAOS_WEBHOOK_VERIFY_SECRET,
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-prod',
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_GITHUB_WEBHOOK_SECRET: process.env.INTEXURAOS_GITHUB_WEBHOOK_SECRET,
    INTEXURAOS_EXECUTION_MEMORY_ENABLED: 'true',
    INTEXURAOS_OPENAI_APP_API_KEY: process.env.INTEXURAOS_OPENAI_APP_API_KEY,
    INTEXURAOS_QUEUE_MAX_SIZE: '50',
    INTEXURAOS_QUEUE_TTL_MINUTES: '1440',
    INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS: '3',
    INTEXURAOS_RETRY_QUEUE_TTL_MINUTES: '10',
  },
  'bookmarks-agent': {
    INTEXURAOS_PUBSUB_BOOKMARK_ENRICH: 'intexuraos-bookmark-enrich-prod',
    INTEXURAOS_PUBSUB_BOOKMARK_SUMMARIZE: 'intexuraos-bookmark-summarize-prod',
    INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC: 'intexuraos-whatsapp-send-prod',
  },
  'image-service': {
    INTEXURAOS_IMAGE_BUCKET: 'intexuraos-images',
    INTEXURAOS_IMAGE_PUBLIC_BASE_URL: 'https://intexuraos.cloud',
  },
  'commands-agent': {
    INTEXURAOS_PUBSUB_ACTIONS_QUEUE: 'intexuraos-actions-queue-prod',
  },
  'todos-agent': {
    INTEXURAOS_TODOS_PROCESSING_TOPIC: 'intexuraos-todos-processing-prod',
  },
  'user-service': {
    INTEXURAOS_TOKEN_ENCRYPTION_KEY: process.env.INTEXURAOS_TOKEN_ENCRYPTION_KEY,
    INTEXURAOS_ENCRYPTION_KEY: process.env.INTEXURAOS_ENCRYPTION_KEY,
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID,
    INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET: process.env.INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET,
    INTEXURAOS_GITHUB_OAUTH_CLIENT_ID: process.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_ID,
    INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET: process.env.INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET,
  },
  'web-agent': {
    INTEXURAOS_CLOUDFLARE_ACCOUNT_ID: process.env.INTEXURAOS_CLOUDFLARE_ACCOUNT_ID,
    INTEXURAOS_CLOUDFLARE_API_TOKEN: process.env.INTEXURAOS_CLOUDFLARE_API_TOKEN,
  },
  'chat-agent': {
    INTEXURAOS_OPENAI_APP_API_KEY: process.env.INTEXURAOS_OPENAI_APP_API_KEY,
  },
  'llm-usage-service': {
    INTEXURAOS_ORCHESTRATOR_SECRET: process.env.INTEXURAOS_ORCHESTRATOR_SECRET,
  },
};

const TSX_CLI = path.resolve(__dirname, 'node_modules/tsx/dist/cli.mjs');
const WAIT_SCRIPT = path.resolve(__dirname, 'scripts/pm2-wait-start.mjs');

function createServiceConfig(name, port, options = {}) {
  const { waitForService } = options;

  const baseConfig = {
    name,
    cwd: `./apps/${name}`,
    script: TSX_CLI,
    interpreter: 'node',
    env: {
      ...COMMON_SERVICE_ENV,
      ...COMMON_SERVICE_URLS,
      ...(SERVICE_ENV_MAPPINGS[name] ?? {}),
      PORT: String(port),
      NODE_ENV: 'production',
      NODE_OPTIONS: '--import @intexuraos/infra-otel/register',
    },
    autorestart: true,
    max_memory_restart: '512M',
    kill_timeout: 10000,
    restart_delay: 5000,
    watch: false, // prod never watches files
  };

  if (waitForService) {
    return {
      ...baseConfig,
      args: [WAIT_SCRIPT, 'src/index.ts'],
      env: {
        ...baseConfig.env,
        WAIT_FOR_SERVICE: waitForService,
      },
    };
  }

  return {
    ...baseConfig,
    args: ['src/index.ts'],
  };
}

module.exports = {
  apps: [
    // Services without dependencies
    createServiceConfig('app-settings-service', 8122),
    createServiceConfig('notion-service', 8112),
    createServiceConfig('whatsapp-service', 8113),
    createServiceConfig('mobile-notifications-service', 8114),
    createServiceConfig('notes-agent', 8121),
    createServiceConfig('bookmarks-agent', 8124),
    createServiceConfig('code-agent', 8128),
    createServiceConfig('cron-agent', 8130),
    createServiceConfig('hellscript-agent', 8131),
    createServiceConfig('llm-usage-service', 8132),

    // Services that poll app-settings-service /health before starting
    createServiceConfig('user-service', 8110, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('commands-agent', 8117, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('actions-agent', 8118, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('research-agent', 8116, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('todos-agent', 8123, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('data-insights-agent', 8119, {
      waitForService: 'http://localhost:8122/health',
    }),
    createServiceConfig('image-service', 8120, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('calendar-agent', 8125, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('linear-agent', 8126, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('chat-agent', 8129, { waitForService: 'http://localhost:8122/health' }),
    createServiceConfig('web-agent', 8127, { waitForService: 'http://localhost:8122/health' }),
    // NB: web SPA is NOT in this config — served by nginx as static files (see Phase 6).
  ],
};
```

- [ ] **Step 2: Lint with the project's linter**

```bash
pnpm lint -- ecosystem.config.prod.cjs
```

Expected: pass. If eslint complains about unused `dotenv`, ensure `dotenv` is in `package.json` devDependencies (it should be — check with `grep dotenv package.json`).

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.prod.cjs
git commit -m "feat(pm2): add prod ecosystem config with env enforcement (INT-750)"
```

### Task 5.2: Clone the repo to the VM and install dependencies

- [ ] **Step 1: Push the current branch to GitHub**

```bash
git push origin HEAD
```

- [ ] **Step 2: SSH as deploy user and clone**

```bash
SERVER_IP=$(cd terraform/environments/prod && terraform output -raw hetzner_server_ipv4)
ssh root@${SERVER_IP} "sudo -u deploy bash -lc 'cd /opt/intexuraos && git clone https://github.com/pbuchman/intexuraos.git . && git checkout <branch-name>'"
```

Replace `<branch-name>` with your current feature branch.

- [ ] **Step 3: Install dependencies and build packages**

```bash
ssh root@${SERVER_IP} "sudo -u deploy bash -lc 'cd /opt/intexuraos && pnpm install --frozen-lockfile && pnpm -r --filter \"./packages/*\" build'"
```

Expected: packages build cleanly. Apps use `tsx` so they don't need a build step.

### Task 5.3: First PM2 start

- [ ] **Step 1: Start via PM2**

```bash
ssh root@${SERVER_IP} "sudo -u deploy bash -lc 'cd /opt/intexuraos && pm2 start ecosystem.config.prod.cjs'"
```

Expected: PM2 reports all 21 services starting. **If `INTEXURAOS_ENVIRONMENT` is not 'prod', PM2 will fail loudly — that's intentional.**

- [ ] **Step 2: Check status**

```bash
ssh root@${SERVER_IP} "sudo -u deploy pm2 list"
```

Expected: all 21 processes in `online` state. If any are in `errored` state, check `pm2 logs <name>`.

- [ ] **Step 3: Verify health endpoints from inside the VM**

```bash
ssh root@${SERVER_IP} 'for PORT in 8110 8112 8113 8114 8116 8117 8118 8119 8120 8121 8122 8123 8124 8125 8126 8127 8128 8129 8130 8131 8132; do
  printf "%s " "$PORT"
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:$PORT/health
done'
```

Expected: every port prints `200`. Any non-200 → inspect `pm2 logs <service-name>`.

- [ ] **Step 4: Save PM2 state for reboot persistence**

```bash
ssh root@${SERVER_IP} "sudo -u deploy pm2 save"
```

Expected: `Successfully saved in /home/deploy/.pm2/dump.pm2`.

- [ ] **Step 5: Verify Firestore connectivity from a service**

```bash
ssh root@${SERVER_IP} "sudo -u deploy pm2 logs app-settings-service --lines 50 --nostream" | grep -i 'firestore\|started\|listening'
```

Expected: log line indicating Firestore connected and service is listening on port 8122.

⏸ **CHECKPOINT 5:** All services running on the VM against real GCP Firestore + real GCP Pub/Sub (**without** push subscriptions — those come in Phase 8). Nothing public-facing yet.

---

## Phase 6: Nginx Configuration + SSL

**Goal:** Nginx terminates TLS on `:443`, routes to localhost services, serves the web SPA as static files. Use DNS-01 ACME challenge to get a cert without moving DNS first.

### Task 6.1: Write the nginx config

**Files:**
- Create: `scripts/hetzner/nginx/intexuraos.conf`

- [ ] **Step 1: Create the nginx config**

```nginx
# /etc/nginx/sites-available/intexuraos.conf
# Managed by scripts/hetzner/nginx/intexuraos.conf in the repo.
# To update: copy this file to the VM and run `sudo nginx -t && sudo nginx -s reload`.

# Upstreams — one per backend service. Keep in sync with ecosystem.config.prod.cjs.
upstream user_service           { server 127.0.0.1:8110; keepalive 16; }
upstream notion_service         { server 127.0.0.1:8112; keepalive 16; }
upstream whatsapp_service       { server 127.0.0.1:8113; keepalive 16; }
upstream mobile_notif_service   { server 127.0.0.1:8114; keepalive 16; }
upstream research_agent         { server 127.0.0.1:8116; keepalive 16; }
upstream commands_agent         { server 127.0.0.1:8117; keepalive 16; }
upstream actions_agent          { server 127.0.0.1:8118; keepalive 16; }
upstream data_insights_agent    { server 127.0.0.1:8119; keepalive 16; }
upstream image_service          { server 127.0.0.1:8120; keepalive 16; }
upstream notes_agent            { server 127.0.0.1:8121; keepalive 16; }
upstream app_settings_service   { server 127.0.0.1:8122; keepalive 16; }
upstream todos_agent            { server 127.0.0.1:8123; keepalive 16; }
upstream bookmarks_agent        { server 127.0.0.1:8124; keepalive 16; }
upstream calendar_agent         { server 127.0.0.1:8125; keepalive 16; }
upstream linear_agent           { server 127.0.0.1:8126; keepalive 16; }
upstream web_agent              { server 127.0.0.1:8127; keepalive 16; }
upstream code_agent             { server 127.0.0.1:8128; keepalive 16; }
upstream chat_agent             { server 127.0.0.1:8129; keepalive 16; }
upstream cron_agent             { server 127.0.0.1:8130; keepalive 16; }
upstream hellscript_agent       { server 127.0.0.1:8131; keepalive 16; }
upstream llm_usage_service      { server 127.0.0.1:8132; keepalive 16; }

# HTTP → HTTPS redirect
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name intexuraos.cloud;

    # Except ACME HTTP-01 challenge (used as fallback)
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name intexuraos.cloud;

    ssl_certificate     /etc/letsencrypt/live/intexuraos.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/intexuraos.cloud/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Proxy settings applied to every API route below
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Pub/Sub push may take up to 600s (research-process topic).
    # Must exceed the largest ack_deadline_seconds in terraform.
    proxy_read_timeout 610s;
    proxy_send_timeout 610s;
    proxy_connect_timeout 10s;

    # Buffer settings for large API responses (LLM)
    proxy_buffers 16 16k;
    proxy_buffer_size 32k;
    client_max_body_size 20m;

    # --- API routes ---
    location /api/user/                 { proxy_pass http://user_service/; }
    location /api/notion/               { proxy_pass http://notion_service/; }
    location /api/whatsapp/             { proxy_pass http://whatsapp_service/; }
    location /api/mobile-notifications/ { proxy_pass http://mobile_notif_service/; }
    location /api/research/             { proxy_pass http://research_agent/; }
    location /api/commands/             { proxy_pass http://commands_agent/; }
    location /api/actions/              { proxy_pass http://actions_agent/; }
    location /api/data-insights/        { proxy_pass http://data_insights_agent/; }
    location /api/image/                { proxy_pass http://image_service/; }
    location /api/notes/                { proxy_pass http://notes_agent/; }
    location /api/app-settings/         { proxy_pass http://app_settings_service/; }
    location /api/todos/                { proxy_pass http://todos_agent/; }
    location /api/bookmarks/            { proxy_pass http://bookmarks_agent/; }
    location /api/calendar/             { proxy_pass http://calendar_agent/; }
    location /api/linear/               { proxy_pass http://linear_agent/; }
    location /api/web/                  { proxy_pass http://web_agent/; }
    location /api/code/                 { proxy_pass http://code_agent/; }
    location /api/chat/                 { proxy_pass http://chat_agent/; }
    location /api/cron/                 { proxy_pass http://cron_agent/; }
    location /api/hellscript/           { proxy_pass http://hellscript_agent/; }
    location /api/llm-usage/            { proxy_pass http://llm_usage_service/; }

    # --- Pub/Sub push endpoints (JWT-verified in Phase 7) ---
    # These are called by GCP Pub/Sub directly with an OIDC token.
    # The audience in the token = "https://intexuraos.cloud".
    # JWT verification is added in Phase 7 via an `include` directive.
    location /internal/ {
        # Placeholder — Phase 7 adds JWT verification here via `include conf.d/jwt-verify.conf;`
        return 503 "JWT verification not yet configured\n";
    }

    # --- Web SPA (static files) ---
    location / {
        root /var/www/intexuraos/web/dist;
        try_files $uri $uri/ /index.html;
    }

    location = /index.html {
        root /var/www/intexuraos/web/dist;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }

    location /assets/ {
        root /var/www/intexuraos/web/dist;
        expires 1y;
        add_header Cache-Control "public, immutable" always;
    }

    # --- Health endpoint (for external uptime monitors, no JWT needed) ---
    location = /healthz {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/hetzner/nginx/intexuraos.conf
git commit -m "feat(hetzner): add nginx config with upstream routing (INT-750)"
```

### Task 6.2: Obtain Let's Encrypt certificate via DNS-01

**Prerequisite:** Decision 2 is resolved. The user has confirmed which DNS provider hosts `intexuraos.cloud` and provided an API token for certbot's DNS plugin.

- [ ] **Step 1: Install the appropriate certbot DNS plugin on the VM**

(example for Cloudflare — substitute for your DNS provider)

```bash
ssh root@${SERVER_IP} "apt-get install -y python3-certbot-dns-cloudflare"
```

- [ ] **Step 2: Write the DNS API credentials file**

```bash
ssh root@${SERVER_IP} "install -m 600 /dev/stdin /etc/letsencrypt/cloudflare.ini <<'EOF'
dns_cloudflare_api_token = <your-token>
EOF"
```

- [ ] **Step 3: Obtain the cert**

```bash
ssh root@${SERVER_IP} "certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini -d intexuraos.cloud --agree-tos --email <your-email> --non-interactive"
```

Expected: `Successfully received certificate. Certificate is saved at: /etc/letsencrypt/live/intexuraos.cloud/fullchain.pem`.

- [ ] **Step 4: Verify the renewal hook fires nginx reload**

```bash
ssh root@${SERVER_IP} "install -m 755 /dev/stdin /etc/letsencrypt/renewal-hooks/deploy/nginx-reload.sh <<'EOF'
#!/bin/bash
systemctl reload nginx
EOF"
```

### Task 6.3: Deploy the nginx config

- [ ] **Step 1: Copy the config to the VM**

```bash
scp scripts/hetzner/nginx/intexuraos.conf root@${SERVER_IP}:/etc/nginx/sites-available/intexuraos.conf
ssh root@${SERVER_IP} "ln -sf /etc/nginx/sites-available/intexuraos.conf /etc/nginx/sites-enabled/intexuraos.conf && rm -f /etc/nginx/sites-enabled/default"
```

- [ ] **Step 2: Validate and reload**

```bash
ssh root@${SERVER_IP} "nginx -t && systemctl reload nginx"
```

Expected: `nginx: the configuration file /etc/nginx/nginx.conf syntax is ok` + `nginx: configuration file /etc/nginx/nginx.conf test is successful`. No reload errors.

- [ ] **Step 3: Smoke-test via `--resolve` (no DNS change yet)**

```bash
curl --resolve intexuraos.cloud:443:${SERVER_IP} -v https://intexuraos.cloud/healthz
```

Expected: `HTTP/2 200` and body `ok`. TLS handshake succeeds using the Let's Encrypt cert.

- [ ] **Step 4: Smoke-test an API route (app-settings)**

```bash
curl --resolve intexuraos.cloud:443:${SERVER_IP} -s https://intexuraos.cloud/api/app-settings/health
```

Expected: same response as `curl http://localhost:8122/health` from inside the VM. If you get 502, the upstream is wrong; if 404, the location block is wrong.

⏸ **CHECKPOINT 6:** Nginx is serving HTTPS with a valid cert and routing API calls to the services. Public-facing but DNS doesn't point here yet. Pub/Sub push is still 503.

---

## Phase 7: Edge JWT Verification (Lua)

**Goal:** Replace Cloud Run's native OIDC verification with an nginx Lua module that verifies Google-issued JWTs for Pub/Sub push.

### Task 7.1: Write the Lua JWT verifier

**Files:**
- Create: `scripts/hetzner/nginx/jwt-verify.lua`

- [ ] **Step 1: Create the Lua script**

```lua
-- /etc/nginx/lua/jwt-verify.lua
-- Verifies Google-issued OIDC JWTs for Pub/Sub push endpoints.
-- Audience: https://intexuraos.cloud
-- Issuer:   https://accounts.google.com
-- JWKS:     https://www.googleapis.com/oauth2/v3/certs (cached 1h)

local openidc = require("resty.openidc")
local cjson   = require("cjson")

local opts = {
  discovery = "https://accounts.google.com/.well-known/openid-configuration",
  jwk_expires_in = 3600,        -- cache JWKS for 1 hour
  ssl_verify = "yes",
  accept_unsupported_alg = false,
  accept_none_alg = false,
  token_signing_alg_values_expected = { "RS256" },
}

-- Extract Bearer token from Authorization header
local auth_header = ngx.var.http_authorization
if not auth_header then
  ngx.status = 401
  ngx.say('{"error":"missing_authorization_header"}')
  return ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

local _, _, token = string.find(auth_header, "Bearer%s+(.+)")
if not token then
  ngx.status = 401
  ngx.say('{"error":"malformed_authorization_header"}')
  return ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

-- Verify signature, exp, iss
local claims, err = openidc.bearer_jwt_verify(opts)
if err or not claims then
  ngx.log(ngx.WARN, "JWT verification failed: ", err or "no claims")
  ngx.status = 401
  ngx.say('{"error":"invalid_token","detail":"' .. (err or "unknown") .. '"}')
  return ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

-- Enforce issuer and audience
local EXPECTED_ISS = "https://accounts.google.com"
local EXPECTED_AUD = "https://intexuraos.cloud"

if claims.iss ~= EXPECTED_ISS then
  ngx.log(ngx.WARN, "JWT iss mismatch: got ", claims.iss)
  ngx.status = 401
  ngx.say('{"error":"invalid_issuer"}')
  return ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

-- aud may be a string or array
local aud_ok = false
if type(claims.aud) == "string" then
  aud_ok = claims.aud == EXPECTED_AUD
elseif type(claims.aud) == "table" then
  for _, a in ipairs(claims.aud) do
    if a == EXPECTED_AUD then aud_ok = true; break end
  end
end

if not aud_ok then
  ngx.log(ngx.WARN, "JWT aud mismatch: got ", cjson.encode(claims.aud))
  ngx.status = 401
  ngx.say('{"error":"invalid_audience"}')
  return ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

-- All good — let nginx forward the request to the upstream.
-- Do NOT forward the Authorization header (strip it so downstream services don't see it).
ngx.req.clear_header("Authorization")
```

- [ ] **Step 2: Commit**

```bash
git add scripts/hetzner/nginx/jwt-verify.lua
git commit -m "feat(nginx): add lua jwt verifier for pubsub push (INT-750)"
```

### Task 7.2: Wire the Lua script into the nginx config

- [ ] **Step 1: Update `scripts/hetzner/nginx/intexuraos.conf`** — replace the placeholder `/internal/` block with:

```nginx
    # --- Pub/Sub push endpoints (Google OIDC JWT verification at the edge) ---
    # The JWT audience = "https://intexuraos.cloud" (see terraform/environments/prod/pubsub.tf).
    # On failure, the Lua script terminates the request with 401.
    location /internal/ {
        access_by_lua_file /etc/nginx/lua/jwt-verify.lua;

        # After verification, rewrite to the appropriate upstream based on path.
        # /internal/whatsapp/* → whatsapp_service
        # /internal/actions/*  → actions_agent
        # /internal/llm/*      → research_agent
        # /internal/commands/* → commands_agent
        # /internal/calendar/* → calendar_agent
        # /internal/bookmarks/* → bookmarks_agent
        # /internal/todos/*    → todos_agent
        # Else: 404

        location ~ ^/internal/whatsapp/  { proxy_pass http://whatsapp_service; }
        location ~ ^/internal/actions/   { proxy_pass http://actions_agent; }
        location ~ ^/internal/llm/       { proxy_pass http://research_agent; }
        location ~ ^/internal/commands   { proxy_pass http://commands_agent; }
        location ~ ^/internal/calendar/  { proxy_pass http://calendar_agent; }
        location ~ ^/internal/bookmarks/ { proxy_pass http://bookmarks_agent; }
        location ~ ^/internal/todos/     { proxy_pass http://todos_agent; }

        return 404;
    }
```

- [ ] **Step 2: Deploy config and Lua to the VM**

```bash
ssh root@${SERVER_IP} "mkdir -p /etc/nginx/lua"
scp scripts/hetzner/nginx/jwt-verify.lua root@${SERVER_IP}:/etc/nginx/lua/jwt-verify.lua
scp scripts/hetzner/nginx/intexuraos.conf root@${SERVER_IP}:/etc/nginx/sites-available/intexuraos.conf
ssh root@${SERVER_IP} "nginx -t && systemctl reload nginx"
```

Expected: `nginx: ... test is successful` and clean reload.

- [ ] **Step 3: Test with a missing token → 401**

```bash
curl --resolve intexuraos.cloud:443:${SERVER_IP} -s -o /dev/null -w "%{http_code}\n" https://intexuraos.cloud/internal/whatsapp/pubsub/media-cleanup
```

Expected: `401`

- [ ] **Step 4: Test with a valid Google token → forwarded**

Run on your local machine (requires `gcloud auth application-default login`):

```bash
TOKEN=$(gcloud auth print-identity-token --audiences=https://intexuraos.cloud)
curl --resolve intexuraos.cloud:443:${SERVER_IP} -H "Authorization: Bearer $TOKEN" -X POST -d '{}' -H "Content-Type: application/json" https://intexuraos.cloud/internal/whatsapp/pubsub/media-cleanup
```

Expected: a response from the whatsapp-service handler (may be 400 due to empty body, but NOT 401).

- [ ] **Step 5: Commit the updated nginx config**

```bash
git add scripts/hetzner/nginx/intexuraos.conf
git commit -m "feat(nginx): wire jwt verification into /internal/* routes (INT-750)"
```

⏸ **CHECKPOINT 7:** Nginx edge-verifies Google OIDC tokens. Pub/Sub push would work IF push subscriptions were pointed here. They're not — that's Phase 8.

---

## Phase 8: Prod Pub/Sub Subscriptions in Terraform

**Goal:** Create a new set of `google_pubsub_subscription` resources in the `prod` environment that target `https://intexuraos.cloud/internal/*` with audience = `https://intexuraos.cloud`. The existing topics in the dev environment are reused (they're the same topics — just with additional subscriptions).

### Task 8.1: Reference existing topics and service accounts

**Files:**
- Create: `terraform/environments/prod/pubsub.tf`

- [ ] **Step 1: Create the file with data sources for existing topics and SAs**

```hcl
# -----------------------------------------------------------------------------
# Prod Pub/Sub push subscriptions
#
# Topics are owned by the dev environment. This file only creates additional
# push SUBSCRIPTIONS with push endpoints pointing at https://intexuraos.cloud.
# -----------------------------------------------------------------------------

# Existing topics from dev environment (names hardcoded — match terraform/environments/dev/main.tf)
locals {
  topics = {
    whatsapp_media_cleanup       = "intexuraos-whatsapp-media-cleanup-dev"
    whatsapp_webhook_process     = "intexuraos-whatsapp-webhook-process-dev"
    whatsapp_srt_transcription   = "intexuraos-srt-transcription-completed-dev"
    commands_ingest              = "intexuraos-commands-ingest-dev"
    actions_queue                = "intexuraos-actions-queue-dev"
    research_process             = "intexuraos-research-process-dev"
    llm_analytics                = "intexuraos-llm-analytics-dev"
    llm_call                     = "intexuraos-llm-call-dev"
    calendar_preview             = "intexuraos-calendar-preview-dev"
    bookmark_enrich              = "intexuraos-bookmark-enrich-dev"
    bookmark_summarize           = "intexuraos-bookmark-summarize-dev"
    todos_processing             = "intexuraos-todos-processing-dev"
    approval_reply               = "intexuraos-approval-reply-dev"
    audio_stored                 = "intexuraos-audio-stored-dev"
  }

  # Shared: audience for all prod push tokens
  prod_audience = "https://intexuraos.cloud"

  # Service account emails — these SAs already exist (created by dev env's iam module).
  # We data-source them to avoid hardcoding email strings.
  sa_names = {
    whatsapp_service = "intexuraos-whatsapp-svc-dev"
    commands_agent   = "intexuraos-commands-agents-dev"
    actions_agent    = "intexuraos-actions-dev"
    research_agent   = "intexuraos-research-agent-dev"
    calendar_agent   = "intexuraos-calendar-dev"
    bookmarks_agent  = "intexuraos-bookmarks-dev"
    todos_agent      = "intexuraos-todos-dev"
  }
}

data "google_service_account" "whatsapp_service" {
  account_id = local.sa_names.whatsapp_service
  project    = var.project_id
}

data "google_service_account" "commands_agent" {
  account_id = local.sa_names.commands_agent
  project    = var.project_id
}

data "google_service_account" "actions_agent" {
  account_id = local.sa_names.actions_agent
  project    = var.project_id
}

data "google_service_account" "research_agent" {
  account_id = local.sa_names.research_agent
  project    = var.project_id
}

data "google_service_account" "calendar_agent" {
  account_id = local.sa_names.calendar_agent
  project    = var.project_id
}

data "google_service_account" "bookmarks_agent" {
  account_id = local.sa_names.bookmarks_agent
  project    = var.project_id
}

data "google_service_account" "todos_agent" {
  account_id = local.sa_names.todos_agent
  project    = var.project_id
}
```

**Note:** the exact SA account_ids must match what `terraform/environments/dev/main.tf` `module "iam"` creates. Before applying, run `grep -n 'service_accounts\|account_id' terraform/modules/iam/main.tf` to confirm the names.

### Task 8.2: Create prod subscriptions — one resource per topic

- [ ] **Step 1: Append the subscription resources to `pubsub.tf`**

```hcl
# -----------------------------------------------------------------------------
# Whatsapp service subscriptions
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_whatsapp_media_cleanup" {
  name    = "intexuraos-whatsapp-media-cleanup-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.whatsapp_media_cleanup}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s" # 7 days

  push_config {
    push_endpoint = "${local.prod_audience}/internal/whatsapp/pubsub/media-cleanup"

    oidc_token {
      service_account_email = data.google_service_account.whatsapp_service.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.whatsapp_media_cleanup}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = "" # Never expire
  }
}

resource "google_pubsub_subscription" "prod_whatsapp_webhook_process" {
  name    = "intexuraos-whatsapp-webhook-process-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.whatsapp_webhook_process}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/whatsapp/pubsub/process-webhook"
    oidc_token {
      service_account_email = data.google_service_account.whatsapp_service.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.whatsapp_webhook_process}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_whatsapp_srt_transcription" {
  name    = "intexuraos-srt-transcription-completed-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.whatsapp_srt_transcription}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/whatsapp/pubsub/transcription-completed"
    oidc_token {
      service_account_email = data.google_service_account.whatsapp_service.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.whatsapp_srt_transcription}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Commands / actions
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_commands_ingest" {
  name    = "intexuraos-commands-ingest-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.commands_ingest}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/commands"
    oidc_token {
      service_account_email = data.google_service_account.commands_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.commands_ingest}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_actions_queue" {
  name    = "intexuraos-actions-queue-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.actions_queue}"
  labels  = local.common_labels

  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/actions/process"
    oidc_token {
      service_account_email = data.google_service_account.actions_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.actions_queue}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Research agent (LLM)
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_research_process" {
  name    = "intexuraos-research-process-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.research_process}"
  labels  = local.common_labels

  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/llm/pubsub/process-research"
    oidc_token {
      service_account_email = data.google_service_account.research_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.research_process}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_llm_call" {
  name    = "intexuraos-llm-call-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.llm_call}"
  labels  = local.common_labels

  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/llm/pubsub/process-llm-call"
    oidc_token {
      service_account_email = data.google_service_account.research_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.llm_call}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_llm_analytics" {
  name    = "intexuraos-llm-analytics-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.llm_analytics}"
  labels  = local.common_labels

  ack_deadline_seconds       = 300
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/llm/pubsub/report-analytics"
    oidc_token {
      service_account_email = data.google_service_account.research_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.llm_analytics}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Calendar / bookmarks / todos
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_calendar_preview" {
  name    = "intexuraos-calendar-preview-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.calendar_preview}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/calendar/generate-preview"
    oidc_token {
      service_account_email = data.google_service_account.calendar_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.calendar_preview}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_bookmark_enrich" {
  name    = "intexuraos-bookmark-enrich-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.bookmark_enrich}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/bookmarks/pubsub/enrich"
    oidc_token {
      service_account_email = data.google_service_account.bookmarks_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.bookmark_enrich}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_bookmark_summarize" {
  name    = "intexuraos-bookmark-summarize-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.bookmark_summarize}"
  labels  = local.common_labels

  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/bookmarks/pubsub/summarize"
    oidc_token {
      service_account_email = data.google_service_account.bookmarks_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.bookmark_summarize}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

resource "google_pubsub_subscription" "prod_todos_processing" {
  name    = "intexuraos-todos-processing-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.todos_processing}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/todos/pubsub/todos-processing"
    oidc_token {
      service_account_email = data.google_service_account.todos_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.todos_processing}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}

# -----------------------------------------------------------------------------
# Approval reply (whatsapp-service → actions-agent)
# -----------------------------------------------------------------------------

resource "google_pubsub_subscription" "prod_approval_reply" {
  name    = "intexuraos-approval-reply-prod-hetzner"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${local.topics.approval_reply}"
  labels  = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = "${local.prod_audience}/internal/actions/approval-reply"
    oidc_token {
      service_account_email = data.google_service_account.actions_agent.email
      audience              = local.prod_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${local.topics.approval_reply}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy { ttl = "" }
}
```

- [ ] **Step 2: Verify DLQ topic names actually exist**

Run: `gcloud pubsub topics list --project=intexuraos-dev-pbuchman --format='value(name)' | grep dlq`

Expected: each DLQ topic referenced above appears in the list. If any DLQ does NOT exist, either (a) create it in the dev env first (not in this plan), (b) remove the `dead_letter_policy` block for that subscription until the DLQ is created.

- [ ] **Step 3: Plan**

```bash
cd terraform/environments/prod
HCLOUD_TOKEN=<token> terraform plan
```

Expected: ~13 resources to add (all `prod_*` subscriptions + the data sources are no-op). **Verify that no existing resources are being modified or destroyed.** If you see any modifications outside `terraform/environments/prod/`, STOP — the state boundary is broken.

- [ ] **Step 4: Apply**

```bash
HCLOUD_TOKEN=<token> terraform apply
```

Expected: ~13 added.

- [ ] **Step 5: Verify subscriptions exist but are not yet receiving traffic**

```bash
gcloud pubsub subscriptions list --project=intexuraos-dev-pbuchman --format='table(name,pushConfig.pushEndpoint)' | grep prod-hetzner
```

Expected: all subscriptions listed with endpoints pointing at `https://intexuraos.cloud/...`. They are **not** receiving traffic yet because DNS doesn't resolve `intexuraos.cloud` to the Hetzner IP.

- [ ] **Step 6: Commit**

```bash
git add terraform/environments/prod/pubsub.tf
git commit -m "feat(terraform): add prod pubsub subscriptions targeting intexuraos.cloud (INT-750)"
```

⏸ **CHECKPOINT 8:** Prod subscriptions exist on GCP pointing at intexuraos.cloud but inactive. Ready for DNS cutover — but first, end-to-end smoke test.

---

## Phase 9: End-to-End Smoke Tests

**Goal:** Prove that a real Pub/Sub message, signed by GCP and pushed at the Hetzner VM using the cutover hostname, reaches the right handler and completes successfully.

### Task 9.1: Web app static build and upload

- [ ] **Step 1: Build the web app locally with prod env vars**

```bash
cd apps/web
INTEXURAOS_USER_SERVICE_URL=https://intexuraos.cloud/api/user \
INTEXURAOS_NOTION_SERVICE_URL=https://intexuraos.cloud/api/notion \
INTEXURAOS_WHATSAPP_SERVICE_URL=https://intexuraos.cloud/api/whatsapp \
INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL=https://intexuraos.cloud/api/mobile-notifications \
INTEXURAOS_RESEARCH_AGENT_URL=https://intexuraos.cloud/api/research \
INTEXURAOS_COMMANDS_AGENT_URL=https://intexuraos.cloud/api/commands \
INTEXURAOS_ACTIONS_AGENT_URL=https://intexuraos.cloud/api/actions \
INTEXURAOS_DATA_INSIGHTS_AGENT_URL=https://intexuraos.cloud/api/data-insights \
INTEXURAOS_IMAGE_SERVICE_URL=https://intexuraos.cloud/api/image \
INTEXURAOS_NOTES_AGENT_URL=https://intexuraos.cloud/api/notes \
INTEXURAOS_APP_SETTINGS_SERVICE_URL=https://intexuraos.cloud/api/app-settings \
INTEXURAOS_TODOS_AGENT_URL=https://intexuraos.cloud/api/todos \
INTEXURAOS_BOOKMARKS_AGENT_URL=https://intexuraos.cloud/api/bookmarks \
INTEXURAOS_CALENDAR_AGENT_URL=https://intexuraos.cloud/api/calendar \
INTEXURAOS_LINEAR_AGENT_URL=https://intexuraos.cloud/api/linear \
INTEXURAOS_WEB_AGENT_URL=https://intexuraos.cloud/api/web \
INTEXURAOS_CODE_AGENT_URL=https://intexuraos.cloud/api/code \
INTEXURAOS_CHAT_AGENT_URL=https://intexuraos.cloud/api/chat \
pnpm build
cd ../..
```

Expected: `apps/web/dist/` contains `index.html` and an `assets/` directory.

- [ ] **Step 2: Upload to the VM**

```bash
rsync -avz --delete apps/web/dist/ deploy@${SERVER_IP}:/var/www/intexuraos/web/dist/
```

Expected: files copied to the deploy user's web root.

- [ ] **Step 3: Verify the web app is served via `--resolve`**

```bash
curl --resolve intexuraos.cloud:443:${SERVER_IP} -s https://intexuraos.cloud/ | grep -o '<title>[^<]*</title>'
```

Expected: the HTML title of the web app (e.g., `<title>IntexuraOS</title>`).

### Task 9.2: End-to-end Pub/Sub round-trip

- [ ] **Step 1: Pick a low-risk topic to test**

`bookmark-enrich` is a good choice — the handler is idempotent and failure doesn't affect users.

- [ ] **Step 2: Push a test message to the topic**

```bash
gcloud pubsub topics publish intexuraos-bookmark-enrich-dev \
  --project=intexuraos-dev-pbuchman \
  --message='{"bookmarkId":"smoke-test-hetzner","userId":"smoke-test","url":"https://example.com","_smoke_test":true}' \
  --attribute=test=hetzner-migration
```

Expected: `messageIds: [...]`.

- [ ] **Step 3: Check the PROD (hetzner) subscription metrics**

```bash
gcloud pubsub subscriptions describe intexuraos-bookmark-enrich-prod-hetzner --project=intexuraos-dev-pbuchman --format=json | jq '.numUndeliveredMessages'
```

**Expected: 1** — because DNS doesn't resolve to the Hetzner VM yet, the push attempt will fail and the message will queue. This is **a deliberate test of the fail-closed behavior.**

- [ ] **Step 4: Temporarily use a `/etc/hosts` override to simulate DNS cutover for JUST this machine**

On your local machine:
```bash
sudo sh -c "echo '${SERVER_IP} intexuraos.cloud' >> /etc/hosts"
```

Run the same publish again:
```bash
gcloud pubsub topics publish intexuraos-bookmark-enrich-dev \
  --project=intexuraos-dev-pbuchman \
  --message='{"bookmarkId":"smoke-test-hetzner-2","userId":"smoke-test","url":"https://example.com","_smoke_test":true}' \
  --attribute=test=hetzner-migration
```

**Critical:** `/etc/hosts` override on YOUR machine does NOT redirect GCP Pub/Sub — GCP resolves `intexuraos.cloud` from its own DNS view. So step 4's `/etc/hosts` hack only helps for manual `curl` tests from your laptop, **not** Pub/Sub flow. For the Pub/Sub flow to work, DNS must actually be flipped OR you need to wait for Phase 11. **Therefore, skip Step 4 entirely and proceed to Step 5.**

- [ ] **Step 5: Manual simulation of the full path using a real OIDC token**

```bash
TOKEN=$(gcloud auth print-identity-token --audiences=https://intexuraos.cloud)
curl --resolve intexuraos.cloud:443:${SERVER_IP} \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":{"data":"'"$(echo -n '{"bookmarkId":"smoke-test","userId":"smoke-test","url":"https://example.com"}' | base64)"'","messageId":"smoke-1","publishTime":"2026-04-10T00:00:00Z"}}' \
  https://intexuraos.cloud/internal/bookmarks/pubsub/enrich
```

Expected: 2xx response from bookmarks-agent. If 401, JWT verification is broken (check Phase 7). If 502, the upstream is wrong. If 2xx, check the bookmarks-agent logs:

```bash
ssh root@${SERVER_IP} "sudo -u deploy pm2 logs bookmarks-agent --lines 20 --nostream"
```

Expected: log entry mentioning `smoke-test` bookmark.

### Task 9.3: Verify monitoring still works

- [ ] **Step 1: Check Dash0 ingestion**

Open https://app.dash0.com/ and filter by `service.name=bookmarks-agent` `deployment.environment=prod`. You should see the smoke-test trace from Task 9.2 Step 5.

- [ ] **Step 2: Check Sentry ingestion (trigger an error deliberately)**

```bash
TOKEN=$(gcloud auth print-identity-token --audiences=https://intexuraos.cloud)
curl --resolve intexuraos.cloud:443:${SERVER_IP} \
  -H "Authorization: Bearer $TOKEN" \
  https://intexuraos.cloud/api/bookmarks/nonexistent-route-that-errors
```

Check Sentry — a new event should appear tagged with `environment: prod` within 30 seconds.

⏸ **CHECKPOINT 9:** End-to-end flow works via `--resolve`. No DNS changes yet. This is the safest point to hand the cutover decision to the user.

---

## Phase 10: CI/CD — Add Hetzner Strategy

**Goal:** Extend the existing `deploy.yml` smart dispatch to understand a `hetzner` strategy. The engineer reads the current `smart-dispatch.mjs` and adds a branch. The manual deploy workflow is gated on `workflow_dispatch` with `force_strategy=hetzner`.

### Task 10.1: Read and understand the current analyzer

- [ ] **Step 1: Read `.github/scripts/smart-dispatch.mjs`**

Get the existing output contract (strategy, targets, affected_count) and the branching logic. Do not summarize here — read the actual file.

- [ ] **Step 2: Add `'hetzner'` to the force_strategy choices in `.github/workflows/deploy.yml`**

Modify the existing `workflow_dispatch.inputs.force_strategy.options` list from:
```yaml
          - 'auto'
          - 'monolith'
```
to:
```yaml
          - 'auto'
          - 'monolith'
          - 'hetzner'
```

### Task 10.2: Add the deploy-hetzner job

- [ ] **Step 1: Append a new job to `.github/workflows/deploy.yml`** after the existing `check-runner` job

```yaml
  deploy-hetzner:
    name: Deploy to Hetzner Prod
    needs: analyze
    if: github.event.inputs.force_strategy == 'hetzner'
    runs-on: ubuntu-latest
    environment:
      name: prod
      url: https://intexuraos.cloud
    concurrency:
      group: deploy-hetzner
      cancel-in-progress: false

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Print deployment plan
        run: |
          echo "Deploying ref: ${{ github.ref }} (${{ github.sha }})"
          echo "Triggered by: ${{ github.actor }}"

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.HETZNER_HOST }}
          username: ${{ secrets.HETZNER_USER }}
          key: ${{ secrets.HETZNER_SSH_KEY }}
          command_timeout: 20m
          script: |
            set -euo pipefail
            cd /opt/intexuraos
            git fetch origin
            git checkout ${{ github.sha }}
            pnpm install --frozen-lockfile
            pnpm -r --filter "./packages/*" build
            # Build web app with prod env vars
            (cd apps/web && INTEXURAOS_USER_SERVICE_URL=https://intexuraos.cloud/api/user \
              INTEXURAOS_NOTION_SERVICE_URL=https://intexuraos.cloud/api/notion \
              INTEXURAOS_WHATSAPP_SERVICE_URL=https://intexuraos.cloud/api/whatsapp \
              pnpm build)
            rsync -a --delete apps/web/dist/ /var/www/intexuraos/web/dist/
            # Reload services (zero-downtime for services that support it)
            pm2 reload ecosystem.config.prod.cjs

      - name: Health check
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.HETZNER_HOST }}
          username: ${{ secrets.HETZNER_USER }}
          key: ${{ secrets.HETZNER_SSH_KEY }}
          command_timeout: 3m
          script: |
            set -e
            FAIL=0
            for PORT in 8110 8112 8113 8114 8116 8117 8118 8119 8120 8121 8122 8123 8124 8125 8126 8127 8128 8129 8130 8131 8132; do
              if ! curl -s -o /dev/null -f http://localhost:$PORT/health; then
                echo "FAIL: port $PORT" >&2
                FAIL=1
              fi
            done
            exit $FAIL
```

**Note:** the web app build block omits most env vars for brevity — the real block must match the full env from Task 9.1 Step 1. Copy the complete list.

- [ ] **Step 2: Teach `smart-dispatch.mjs` about hetzner** — only if the engineer wants auto-strategy selection. For the first pass, keep it manual (`force_strategy=hetzner` only) and skip this step.

### Task 10.3: Add GitHub Secrets

👤 **User must do:**

- [ ] **Step 1: Add secrets via `gh`**

```bash
gh secret set HETZNER_HOST --body "$(cd terraform/environments/prod && terraform output -raw hetzner_server_ipv4)"
gh secret set HETZNER_USER --body "deploy"
gh secret set HETZNER_SSH_KEY < ~/.ssh/intexuraos_hetzner_deploy
```

Expected: `✓ Set secret ... for pbuchman/intexuraos`.

### Task 10.4: Test the workflow

- [ ] **Step 1: Push the branch**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(ci): add hetzner deploy strategy to smart dispatch (INT-750)"
git push origin HEAD
```

- [ ] **Step 2: Trigger the workflow with `force_strategy=hetzner`**

```bash
gh workflow run deploy.yml --ref <your-branch> -f force_strategy=hetzner
```

- [ ] **Step 3: Watch the run**

```bash
gh run watch
```

Expected: `deploy-hetzner` job passes, including the health check step.

⏸ **CHECKPOINT 10:** Automated deploys to Hetzner work. Ready for DNS cutover.

---

## Phase 11: DNS Cutover

**Goal:** Flip `intexuraos.cloud` from GCP load balancer IP to Hetzner IP with minimum downtime and a ~60s rollback window.

### Task 11.1: Lower DNS TTL

👤 **User must do:**

- [ ] **Step 1:** 24 hours before cutover, lower the TTL on the `intexuraos.cloud` A record to **60 seconds** in your DNS provider's UI.
- [ ] **Step 2:** Wait at least the original TTL duration (typically 3600s = 1 hour) before the next step. This ensures all recursive resolvers drop the stale value.

### Task 11.2: Pre-cutover checklist

- [ ] **Step 1: Verify Phase 9 smoke tests still pass**

Re-run Phase 9 Task 9.2 Step 5. Expected: 2xx.

- [ ] **Step 2: Verify all 21 services are healthy**

```bash
ssh root@${SERVER_IP} 'for PORT in 8110 8112 8113 8114 8116 8117 8118 8119 8120 8121 8122 8123 8124 8125 8126 8127 8128 8129 8130 8131 8132; do
  printf "%s " "$PORT"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:$PORT/health
done'
```

Expected: all `200`.

- [ ] **Step 3: Confirm the old GCP load balancer is still running (for rollback)**

```bash
gcloud compute forwarding-rules list --project=intexuraos-dev-pbuchman --format='table(name,IPAddress,target)'
```

Expected: `intexuraos-web-dev-https` and `intexuraos-web-dev-http` both listed with the current GCP IP. **Do not delete these until 72 hours post-cutover.**

- [ ] **Step 4: Note the current DNS A record value (for rollback)**

```bash
dig A intexuraos.cloud +short
```

Record the output as `OLD_IP`. This is the GCP load balancer IP you will re-point to if rollback is needed.

### Task 11.3: Cutover

👤 **User must do:**

- [ ] **Step 1:** In your DNS provider UI, update the `intexuraos.cloud` A record to the Hetzner IP:
  ```
  A intexuraos.cloud <hetzner-ip>
  TTL 60
  ```
- [ ] **Step 2:** Verify propagation from at least 3 locations:
  ```bash
  dig A intexuraos.cloud @1.1.1.1 +short
  dig A intexuraos.cloud @8.8.8.8 +short
  dig A intexuraos.cloud @9.9.9.9 +short
  ```
  Expected: all three return the Hetzner IP.

### Task 11.4: Post-cutover monitoring (first 30 minutes)

- [ ] **Step 1: Watch nginx access log for Pub/Sub pushes**

```bash
ssh root@${SERVER_IP} "tail -f /var/log/nginx/access.log | grep /internal/"
```

Expected: 2xx responses streaming in as GCP Pub/Sub routes real messages through.

- [ ] **Step 2: Check Pub/Sub DLQ growth**

```bash
gcloud pubsub subscriptions list --project=intexuraos-dev-pbuchman --format='table(name,numUndeliveredMessages)' | grep prod-hetzner
```

Expected: `numUndeliveredMessages = 0` for all. If any grows, inspect nginx error log immediately.

- [ ] **Step 3: Check Sentry for new prod errors**

Watch Sentry dashboard filtered by `environment: prod` for 30 minutes. Expected: no new error events from the migration itself (pre-existing known errors are acceptable).

- [ ] **Step 4: External webhook smoke test**

Trigger a WhatsApp message to your verified number. Expected: the message is received by whatsapp-service and processed normally. Check PM2 logs to confirm.

### Task 11.5: Rollback procedure (execute only if something is broken)

👤 **User only if rollback needed:**

- [ ] **Step 1:** Re-point the DNS A record back to `OLD_IP` (recorded in Task 11.2 Step 4). TTL is already 60s so propagation completes in ~1 minute.
- [ ] **Step 2:** Verify:
  ```bash
  dig A intexuraos.cloud +short
  ```
  Expected: returns `OLD_IP`.
- [ ] **Step 3:** Monitor Cloud Run services return to health. Pub/Sub subscriptions pointing at `intexuraos.cloud` will continue to try the Hetzner VM — GCP does not distinguish. To fully revert, the prod Terraform subscriptions must be destroyed:
  ```bash
  cd terraform/environments/prod
  HCLOUD_TOKEN=<token> terraform destroy -target=google_pubsub_subscription.prod_whatsapp_media_cleanup -target=google_pubsub_subscription.prod_whatsapp_webhook_process # etc. for all 13
  ```
  (Do NOT destroy the Hetzner VM — leave it for post-mortem.)
- [ ] **Step 4:** File an incident report with root cause before re-attempting cutover.

⏸ **CHECKPOINT 11:** DNS cutover complete. Rollback window is open for 72 hours.

---

## Phase 12: Post-Cutover Cleanup

**Goal:** After 72 hours of stability, decommission the Cloud Run services and release the old GCP static IP. **This phase happens in a separate PR** to keep rollback fast.

### Task 12.1: Raise DNS TTL

👤 **User must do:**

- [ ] **Step 1:** 72 hours post-cutover, raise the DNS TTL back to 3600s (1 hour) to reduce DNS query load.

### Task 12.2: Decommission Cloud Run services (separate PR)

**Files:**
- Modify: `terraform/environments/dev/main.tf` — remove Cloud Run service modules

- [ ] **Step 1:** Create a new branch `chore/decommission-cloudrun-prod`
- [ ] **Step 2:** Comment out or remove every `module "*"` block in `terraform/environments/dev/main.tf` that creates a Cloud Run service. **Do NOT** remove the `firestore`, `pubsub-*`, `iam`, `secret_manager`, or bucket modules.
- [ ] **Step 3:** Plan. Expected: destroys for `google_cloud_run_v2_service.*`, `google_compute_global_address.web_app[0]`, `google_compute_forwarding_rule.*`, `google_compute_managed_ssl_certificate.*`. **Verify no destroys for Firestore, Pub/Sub topics, IAM, secrets.**
- [ ] **Step 4:** Open PR, let CI run, review, merge, apply.
- [ ] **Step 5:** Verify old Cloud Run URLs return 404: `curl -I https://intexuraos-web-dev-...a.run.app`

### Task 12.3: Release the GCP static IP

- [ ] **Step 1:** After Task 12.2 completes, the `google_compute_global_address` resource should already be destroyed. Verify:
  ```bash
  gcloud compute addresses list --global --project=intexuraos-dev-pbuchman
  ```
  Expected: `intexuraos-web-dev-ip` is no longer listed.

### Task 12.4: Update documentation

**Files:**
- Modify: `.claude/reference/environments.md`
- Modify: `CLAUDE.md` — "Environments" line
- Create: `docs/setup/06-hetzner-prod-runbook.md`

- [ ] **Step 1: Update `CLAUDE.md` line describing environments**

Old line (verify exact wording from current file):
```
**Environments:** dev=`dev.intexuraos.cloud` (PM2, home-dev) | prod=`intexuraos.cloud` (Cloud Run). No "local". Firestore shared.
```

New line:
```
**Environments:** dev=`dev.intexuraos.cloud` (PM2, home-dev, Pub/Sub emulator) | prod=`intexuraos.cloud` (PM2, Hetzner CX32, real GCP Pub/Sub). No "local". Firestore shared (single `(default)` database, see INT-1335 for protection).
```

- [ ] **Step 2: Create `docs/setup/06-hetzner-prod-runbook.md`** — operational runbook covering: SSH access, pm2 log access, nginx reload, cert renewal, secret refresh (`scripts/hetzner/load-secrets.sh`), rollback.

- [ ] **Step 3: Commit**

```bash
git add .claude/reference/environments.md CLAUDE.md docs/setup/06-hetzner-prod-runbook.md
git commit -m "docs: update environments for hetzner prod migration (INT-750)"
```

⏸ **CHECKPOINT 12:** Migration complete. Old infrastructure gone. Cost reduction realized.

---

## Self-Review Notes

Ran through the checklist after writing:

1. **Spec coverage** — INT-750's phases 0-7 are all covered. Plus: INT-1335 prerequisite (Phase 0), web app static build (Phase 9), DNS TTL management (Phase 11), decommission as separate PR (Phase 12).
2. **Placeholder scan** — audited for "TBD", "similar to", "add error handling" — none found. Every code block is complete. One gap: the `scripts/hetzner/load-secrets.sh` secret list is hardcoded and must be kept in sync with `terraform/environments/dev/main.tf` `module "secret_manager"` — explicit note added in the script comment.
3. **Type consistency** — `SERVER_IP`, `${SERVER_IP}`, `HCLOUD_TOKEN`, `deploy` user name are used consistently.
4. **Known gap** — Task 10.2's web-app build block in `deploy-hetzner.yml` is abbreviated (only 3 env vars shown) to keep the plan readable. The full list from Task 9.1 Step 1 must be inlined when executed.
5. **Known gap** — the `SERVICE_ENV_MAPPINGS` block in `ecosystem.config.prod.cjs` (Phase 5.1) uses hardcoded topic names like `intexuraos-whatsapp-send-prod`. The engineer MUST verify these match the topic names in `terraform/environments/dev/main.tf` before the first deploy — if dev uses `-dev` suffix and no prod suffix exists yet, these must be updated. Alternatively, use real dev topic names and defer the prod topic naming to a later issue.
