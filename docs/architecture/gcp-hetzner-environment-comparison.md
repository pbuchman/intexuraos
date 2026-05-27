# GCP and Hetzner Environment Comparison

This document compares the current GCP-backed production environment with the Hetzner migration foundation introduced by INT-1633. It is based on the current PR diff, `terraform/environments/dev/main.tf`, `terraform/hetzner-prod/**`, `apps/web/service-manifest.json`, `ecosystem.config.cjs`, `firestore-collections.json`, the INT-1632 parent plan, and the project environment rules.

## Current State

IntexuraOS currently has one GCP project, `intexuraos-dev-pbuchman`, and one GCP Terraform root, `terraform/environments/dev/`. The `dev` name is historical: this root owns infrastructure for the public production domain `intexuraos.cloud` and retained shared resources used by both production and `dev.intexuraos.cloud`.

The INT-1633 PR adds a separate Terraform root at `terraform/hetzner-prod/`. That root does not replace the GCP root. It creates the Hetzner foundation only: SSH key, primary IPv4, firewall, Ubuntu server, outputs, and a read-only retained-GCP inventory. Application runtime files, nginx config, Pub/Sub cutover resources, Scheduler cutover resources, deployment workflow, and rollback procedures are owned by follow-up child issues.

## Apply Command Comparison

| Operation | Existing GCP root | Hetzner foundation root |
| --- | --- | --- |
| Directory | `terraform/environments/dev` | `terraform/hetzner-prod` |
| State backend | GCS bucket `intexuraos-dev-pbuchman-terraform-state`, prefix `terraform/state` | Same bucket, isolated prefix `terraform/state/prod-hetzner` |
| Providers | Google providers through existing modules | `hashicorp/google ~> 5.0` for retained project lookup and `hetznercloud/hcloud ~> 1.45` for VM resources |
| Required credentials | `GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json` | Same GCP credentials plus `HCLOUD_TOKEN` for Hetzner |
| Plan command | `STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev plan` | `STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json HCLOUD_TOKEN=$HCLOUD_TOKEN terraform -chdir=terraform/hetzner-prod plan` |
| Apply command | `STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json terraform -chdir=terraform/environments/dev apply` | `STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json HCLOUD_TOKEN=$HCLOUD_TOKEN terraform -chdir=terraform/hetzner-prod apply` |
| Expected current blast radius | Manages the current GCP project resources | Adds Hetzner infrastructure and reads the GCP project only; it must not destroy retained GCP resources |

Always clear emulator environment variables before Terraform operations. The GCP root and Hetzner root must be planned independently because they have different state prefixes and ownership boundaries.

## Component Comparison

| Component | Current GCP environment | Hetzner migration state | What changes |
| --- | --- | --- | --- |
| Public compute | 22 Cloud Run app services in `terraform/environments/dev/main.tf` | Target is one Hetzner VM running Node services under PM2 behind nginx | Cloud Run app traffic moves to nginx and local PM2 processes after later runtime and cutover work |
| Static web app | GCS web bucket plus load balancer from the `web_app` module | Target is serving the SPA from the Hetzner public origin, with retained GCS buckets still available for data-backed assets | Public web serving moves; retained buckets stay until a later explicit cleanup |
| Service URL injection | `local.common_service_env_vars` points services at Cloud Run URLs | Later runtime work must point service URLs at `https://intexuraos.cloud/api/*` or localhost process URLs as appropriate | URL ownership moves from Cloud Run service URLs to nginx route fan-out |
| Service routing | Cloud Run service URLs and web proxy prefixes | nginx public routes for API prefixes and internal routes for async handlers | nginx becomes the production ingress and route registry |
| Terraform state | `terraform/environments/dev` owns GCP state | `terraform/hetzner-prod` owns Hetzner foundation state | State is provider-isolated; no `terraform/environments/prod` GCP root is created |
| Hetzner VM and IP | Not present | `hcloud_server.prod`, `hcloud_primary_ip.prod_ipv4`, `hcloud_firewall.prod`, `hcloud_ssh_key.deploy` | New server, stable IPv4, and firewall are created in Hetzner |
| Server/IP placement | Not applicable | Server and primary IPv4 both use `var.hetzner_location` | Avoids datacenter drift between the IP and server |
| Firestore | `(default)` database managed by `terraform/environments/dev` | Retained; exposed as `retained_firestore_database_id` and inventory only | Stays in GCP and remains shared |
| Firestore collection ownership | `firestore-collections.json` maps each collection to one service owner | Same registry and collections continue to apply | No collection migration is part of INT-1633 |
| Pub/Sub topics | Topics and push subscriptions live in GCP | Topics are retained in GCP; later cutover work adds or changes push endpoints for app handlers | The async data plane stays GCP, but app-handler push endpoints move to Hetzner nginx/internal routes |
| Cloud Scheduler | Scheduler jobs invoke Cloud Run or Cloud Functions with OIDC | Retained in GCP; later cutover work retargets app jobs to Hetzner internal endpoints | Scheduler remains GCP, destinations change for app-owned jobs |
| Cloud Functions | `vm_start`, `vm_stop`, and `transcription` functions are managed in GCP | Retained in GCP | Functions do not move to Hetzner in this phase |
| GCS buckets | Static assets, shared content, web app, WhatsApp media, generated images, and functions source buckets | Retained inventory lists those buckets | Buckets stay in GCP until explicit retirement work |
| Secret Manager | App, integration, Firebase, worker, and observability secrets are managed in GCP | Retained inventory lists secret IDs, including the Cloudflare DNS token name expected by later certbot work | Secrets stay in GCP; later runtime work must load them onto the VM safely |
| Artifact Registry | Docker images and `code-worker` image live in GCP Artifact Registry | Retained inventory lists repository and `code-worker` image path | Registry stays in GCP during migration |
| Cloud Build | Monolith, web, Firestore, code-worker, vm-lifecycle, and transcription triggers remain in GCP | Retained inventory lists the trigger names | Existing GCP builds stay; later deployment work adds Hetzner deploy/reload flow |
| IAM service accounts | Service, scheduler, functions, and transcription accounts live in GCP | Retained inventory lists current service account emails | Service accounts remain the access boundary for GCP resources |
| Monitoring | Existing monitoring module remains in `terraform/environments/dev` | No replacement in INT-1633 | Monitoring cleanup or replacement is out of scope for this foundation PR |
| DNS and TLS | `intexuraos.cloud` currently routes through the GCP web app/load balancer path | Hetzner root exposes `hetzner_dns_a_record_hint`; later runtime uses DNS-01 via Cloudflare token | DNS flips only after runtime, TLS, and rollback paths are ready |

## Service Management

Today, production services are managed as Cloud Run services in Terraform and deployed through Cloud Build/GitHub Actions. Each service has an app directory under `apps/`, a Dockerfile, Cloud Run Terraform module wiring, an IAM service account, Secret Manager bindings, Cloud Build deployment wiring, and web service URL injection when the frontend calls it.

After the Hetzner migration, app processes will be managed on the VM by PM2. The current `ecosystem.config.cjs` already describes the dev PM2 process shape and port map. The production equivalent is owned by INT-1634 and must include the 22 app services from Terraform. `apps/web/service-manifest.json` exposes 21 web-facing API services; `api-docs-hub` exists in Terraform and PM2 but is not part of that web manifest.

During the transition, new services must be wired into both worlds:

| Area | Current required change | Hetzner migration required change |
| --- | --- | --- |
| Application code | Create `apps/<service>` with routes, services, tests, Dockerfile, and package metadata | Same app code remains the service implementation |
| GCP infrastructure | Add Cloud Run module, IAM service account, env vars, secrets, Pub/Sub topics if needed, Cloud Build trigger/deploy wiring | Keep this until Cloud Run retirement is complete |
| Web frontend | Add `apps/web/service-manifest.json`, `apps/web/src/config.ts`, Vite proxy, and any dashboard calls | Add nginx public route for the API prefix and production service URL mapping |
| Dev runtime | Add `ecosystem.config.cjs` process and port | Production PM2 config must allocate the same or explicitly mapped port |
| Async routes | Add Pub/Sub/Scheduler Terraform in `terraform/environments/dev` | Add Hetzner-targeted push or scheduler destination in the cutover Terraform owned by follow-up work |
| Documentation and verification | Run `scripts/verify-service-scaffolding.sh <service-name>` and `pnpm run ci:tracked` | Add migration/cutover verification that the service responds through nginx and internal push routes |

## Firestore Dependency

Firestore is not being migrated by INT-1633. The current Firestore database remains the shared `(default)` database in `intexuraos-dev-pbuchman`, managed by the GCP root. The Hetzner root only records `firestore_database_id = "(default)"` in retained inventory and exposes `retained_firestore_database_id`.

That means Hetzner-hosted services will still need GCP credentials and IAM access to read and write Firestore. The collection ownership rules remain the same: each collection in `firestore-collections.json` has exactly one owning service. Moving the compute location does not change collection ownership, schemas, indexes, migrations, or the requirement that cross-service access goes through HTTP APIs instead of direct foreign collection writes.

The current accepted state is therefore:

| Firestore question | Answer |
| --- | --- |
| Does Firestore move to Hetzner now? | No |
| Which database is used? | GCP Firestore `(default)` in `intexuraos-dev-pbuchman` |
| Who owns it? | `terraform/environments/dev` through the Firestore module |
| Does Hetzner Terraform manage it? | No, it references the database ID only |
| Is data separated between dev and prod? | No, project rules state Firestore is shared |
| What must be protected during retirement? | The database, indexes, collection data, and service IAM access must stay until a separate data migration plan exists |

## Retiring The Existing Google Cloud Environment

Retirement is not a single `terraform destroy`. The GCP environment contains retained data and control-plane resources that remain required after compute moves to Hetzner.

The safe retirement sequence is:

1. Complete Hetzner runtime work: PM2 config, nginx routes, secret loading, TLS, health checks, and deployment scripts.
2. Complete async control-plane work: Pub/Sub push subscriptions and Cloud Scheduler jobs that currently call Cloud Run app handlers must call `https://intexuraos.cloud/internal/*` with the expected OIDC audience and edge verification.
3. Complete frontend and DNS cutover: web service URLs and public DNS must point to the Hetzner origin, with rollback documented.
4. Verify every public API prefix, internal route, Pub/Sub handler, Scheduler target, webhook, and SPA route through the Hetzner origin.
5. Keep retained GCP resources: Firestore, Pub/Sub topics, Secret Manager, GCS buckets, Cloud Functions, Artifact Registry/code-worker, Cloud Build triggers still needed for retained workers, Firebase/Auth0 integration data, IAM, and monitoring resources that still collect useful signals.
6. Disable or remove Cloud Run app services only after there is no production traffic, no Scheduler target, no Pub/Sub push endpoint, and no rollback dependency on those Cloud Run URLs.
7. Remove obsolete GCP resources from `terraform/environments/dev` in small reviewed changes, each with a plan proving no retained data resource is destroyed.

The key rule is that compute retirement and data retirement are separate projects. INT-1633 starts compute migration infrastructure; it does not authorize deleting the existing GCP data plane.

## Source Reconciliation

The April Hetzner plan proposed `terraform/environments/prod/`, but current project rules and INT-1632 supersede that: the active design uses `terraform/hetzner-prod/` for Hetzner and keeps `terraform/environments/dev/` as the only GCP root. The stale plan also treated `api-docs-hub` as optional; current Terraform and PM2 config include it as a service, while the web service manifest still excludes it from frontend URL injection.

The INT-1633 PR follows the current source of truth by:

- keeping GCP resources in the existing root;
- adding only the provider-isolated Hetzner foundation root;
- using the same Hetzner `location` for server and primary IPv4;
- setting destroy protection on the primary IPv4, firewall, and server;
- exposing retained-GCP inventory without managing retained GCP resources from the Hetzner root.
