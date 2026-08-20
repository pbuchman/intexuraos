# IntexuraOS Terraform Infrastructure

Terraform owns persistent GCP and Hetzner infrastructure, including the two
Secret Manager package containers, native transcription exceptions, and
least-privilege IAM. It never owns package payloads, secret versions, or
service-account private key material.

## Environment Model

`terraform/environments/dev/` is the retained GCP control plane for local,
home-dev, production, and the retained workers. The legacy project name does
not mean production has a separate GCP project. Hetzner production host
infrastructure lives in `terraform/hetzner-prod/`.

## Structure

```text
terraform/
├── environments/dev/       # Retained shared GCP project
├── hetzner-prod/            # Hetzner VM/bootstrap/deploy integration
├── modules/
│   ├── artifact-registry/
│   ├── cloud-build/
│   ├── cloud-function/
│   ├── firestore/
│   ├── github-wif/
│   ├── iam/
│   └── secret-manager/
├── providers.tf
├── variables.tf
└── versions.tf
```

See [Terraform bootstrap](../docs/setup/02-terraform-bootstrap.md) for general
setup and [Secret Packages Operations](../docs/operations/secret-packages.md)
for the package lifecycle.

## Authentication

Use an explicitly selected administrative identity. Prefer short-lived
operator impersonation and GitHub OIDC/WIF; do not store a GCP JSON key in
GitHub. A transitional file-backed bootstrap credential remains outside the
repository and secret packages, mode `0600`, and is never the runtime SA JSON
contained in a package.

Verify principal and project, clear emulator variables, and then initialize and
plan:

```bash
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud config get-value project
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform init
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= terraform plan
```

Review the saved plan before applying. A plan containing package payload data,
`secret_data`, private key material, or ad hoc secret versions must not be
applied.

## Secret Package Ownership

Terraform owns only these application Secret Manager containers:

- `INTEXURAOS_SECRET_PACKAGE_DEV`;
- `INTEXURAOS_SECRET_PACKAGE_PROD`;
- `INTEXURAOS_INTERNAL_AUTH_TOKEN` and
  `INTEXURAOS_SPEECHMATICS_APP_API_KEY` as native Gen2 transcription
  exceptions.

The Google-managed Cloud Build GitHub connection token remains provider-owned.
All former per-application containers and broad accessor bindings are legacy
and are removed after the audit/rollback observation gates.

Legacy cleanup is deliberately split. Phase A removes readers while retaining
containers (`legacy_secret_readers_enabled=false` and
`legacy_secret_containers_enabled=true`), then disables existing versions
outside Terraform so the change remains reversible. Phase B removes containers
only after the reversible soak and recovery gates pass. Terraform rejects the
inverse state in which readers remain enabled while containers are absent.

Package payloads are complete immutable JSON documents declared by
`config/environments/secret-packages.json`. An authorized operator publishes a
validated version outside Terraform through `scripts/secret-package.mjs`; this
is the intentional data-plane exception that keeps values out of state.
Terraform still creates every container and IAM binding.

Every runtime/deployment reference must use a positive numeric version.
`latest` and aliases are forbidden, including native Cloud Function
injections. The manifest's `stableVersion` is reviewable promotion metadata;
it is not secret material.

## IAM And Identity Boundaries

- DEV operator/renderer: impersonates `ixos-home-secret-renderer-dev`, accessor
  on the DEV package only.
- DEV package publisher: `ixos-secret-publisher-dev`, version-adder on the DEV
  package and accessor on the DEV source inventory only.
- PROD package publisher: `ixos-secret-publisher-prod`, version-adder on the
  PROD package and accessor on the PROD source inventory only.
- home-dev bootstrap/renderer: the same account, output as
  `home_dev_secret_renderer_service_account_email`; its external transitional
  JSON is not Terraform-managed and grants no non-package role.
- local/home-dev PM2 runtime: `ixos-home-runtime-dev`, output as
  `home_dev_runtime_service_account_email`; it mirrors the minimum Hetzner
  data-plane union and has no Secret Manager access.
- home-dev orchestrator: `ixos-home-orchestrator-dev`, output as
  `home_dev_orchestrator_service_account_email`; it can only read images from
  the DEV Artifact Registry repository and has no Secret Manager access.
- Hetzner provisioner: accessor on the PROD package only.
- retained-GCP GitHub identity: narrow WIF-based Cloud Build trigger capability
  only, with no package access; the Hetzner job uses SSH.
- Hetzner runtime SA: minimum Firestore/GCS/Pub/Sub/Firebase Auth roles and no
  Secret Manager access.
- orchestrator and code workers: no Secret Manager access; they receive
  allowlisted host-rendered projections.
- transcription SA: access only to the two native secrets at numeric versions.

Keep publisher, accessor, runtime, and provisioner roles separate. Bind access
at the secret resource rather than the project. The provisioner credential is
never packaged, which prevents a bootstrap cycle.

GitHub WIF conditions must match immutable numeric owner/repository IDs, the
exact `pbuchman/intexuraos` repository, and `refs/heads/development`. Terraform
owns both retained pools/providers, the service account, conditions, and IAM.
Workflows must not use long-lived GCP service-account keys.

## Runtime Service-Account Key

The Hetzner runtime service-account JSON is created and rotated outside
Terraform so private material cannot enter state. It is inserted into a new
PROD package version, fetched by the distinct provisioner, and atomically
rendered to `/home/deploy/runtime-sa-key.json` as mode `0600`.

Rotation order is create replacement, publish complete candidate, canary,
disable previous key, monitor, then delete. Prefer keyless federation or
impersonation for every workload that supports it.

## Firebase Browser Key Rotation

Terraform creates the restricted replacement key alongside the existing key,
with exactly the reviewed referrers/APIs and `prevent_destroy` during cutover.
It must not output the replacement `key_string`. The existing sensitive
`firebase_api_key` output continues to represent the old/default web-app key in
the additive phase; it is not a source for package candidates.

After DEV and PROD package/build verification, a separate reviewed cleanup
change removes the old imported/resource definition and corrects or removes the
legacy output before the previous key is destroyed. Firestore Security Rules,
Firebase Auth, quotas, and API restrictions remain the authorization controls;
a browser key is public in the compiled SPA.

## Modules

| Module              | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `artifact-registry` | Container image registry                                         |
| `cloud-build`       | Retained build/deployment triggers and Google-managed connection |
| `cloud-function`    | Retained workers with exact native-secret injection              |
| `firestore`         | Firestore database and indexes/rules wiring                      |
| `github-wif`        | Short-lived GitHub Actions federation with attribute conditions  |
| `iam`               | Service accounts and least-privilege role bindings               |
| `secret-manager`    | Package/native containers only; no payload versions              |

## Operational Checks

Before apply:

1. validate both Terraform roots and review formatting;
2. confirm the plan contains only expected containers/IAM/identity changes;
3. verify no package value or key material appears in variables or state;
4. verify DEV and PROD accessors are disjoint;
5. verify runtime, orchestrator, and code-worker principals have no Secret
   Manager role;
6. verify every native injection and deployment input is a numeric version;
7. preserve a redacted saved-plan summary for approval.

Do not use Terraform to publish, rotate, inspect, render, disable, or destroy a
package version. Follow the operational runbook and its audit/rollback gates.
