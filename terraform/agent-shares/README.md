# Agent shares

`https://share.intexuraos.cloud/<slug>.html` and `.md` serve objects from
`gs://intexuraos-agent-shares-dev-pbuchman`. Each object name is flat and its
slug contains up to 128 lowercase ASCII letters, digits, and single hyphens
between segments. The Cloudflare Worker accepts `GET` and `HEAD` and sends
only the method and validated path to the Gen2 function. Requests to the
existing `https://intexuraos.cloud/share/` paths continue through the existing
routing and `intexuraos-shared-content-dev` bucket.

## Resource inventory

| Resource                                                                               | Purpose                                                                                                   |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `intexuraos-dev-pbuchman-terraform-state/terraform/state/agent-shares/default.tfstate` | Isolated state in the existing GCS backend bucket                                                         |
| `intexuraos-agent-shares-dev-pbuchman`                                                 | Private content bucket with uniform access and public access prevention                                   |
| `intexuraos-agent-shares-src-dev-pbuchman`                                             | Private staging bucket for the Terraform-built Gen2 source archive                                        |
| `intexuraos-agent-shares-origin`                                                       | Gen2 HTTPS function and dedicated runtime service account                                                 |
| `agentSharesObjectGetter`                                                              | Project-defined role containing `storage.objects.get`, bound to the runtime account at the content bucket |
| `share.intexuraos.cloud`                                                               | Worker Custom Domain in the existing Cloudflare zone                                                      |

The Gen2 backing service grants `roles/run.invoker` to `allUsers`, so its
`run.app` endpoint also serves shares anonymously. The same path, expiry,
and browser policies apply at the origin. GCS reads use the runtime identity
and are scoped to the content bucket. The runtime cannot list its objects.

Without a GCS system `customTime`, a share remains available until it is
replaced or removed. When present, `customTime` is the UTC expiry. The origin
returns `410` at or after that instant while the object exists and `404` after
deletion. An invalid system `customTime` also returns `404`. The bucket
lifecycle marks objects with `customTime` for asynchronous deletion after
zero days. The origin checks expiry on each request and again before sending
GET content. Its media request uses generation and metageneration
preconditions against the current object.
[Cloud Storage lifecycle rules](https://docs.cloud.google.com/storage/docs/lifecycle) ·
[Objects.get preconditions](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get)

Use self-contained UTF-8 documents up to 16 MiB. HTML supports inline scripts
and styles inside a CSP sandbox with an opaque origin. Use data URLs for
embedded images and fonts. Responses set `no-store`, `nosniff`, and
`no-referrer`.

## Offline checks

From the repository root, run the origin and Worker synthetic suites with Node
22 or later and check the HCL formatting with Terraform 1.5 or later. The
deployed function uses Node 24.

```bash
node --test terraform/agent-shares/origin/*.test.* terraform/agent-shares/worker/*.test.*
terraform -chdir=terraform/agent-shares fmt -check -recursive
```

The suites use synthetic GCS and Function responses and a local test double
for the Worker deployment command. Run `terraform validate` after provider
initialization in the deployment environment.

## Authorized GCP deployment

Use an already-authorized operator in `intexuraos-dev-pbuchman`. The defaults
use `europe-central2`. Set `TF_VAR_project_id` and `TF_VAR_region` explicitly
if deliberately using different values. Each deployment using this backend
prefix owns the same fixed content bucket name and state. The state bucket must
already exist, and the operator needs access to read, write, list and lock the
state there. The operator also needs permissions for the buckets and IAM,
service account and custom role, Gen2 function, and its backing service IAM,
including `iam.serviceAccounts.actAs` for the runtime account and
`serviceusage.services.use` on the target project.

Confirm the target project already has the Cloud Functions, Cloud Run, Cloud
Build, Artifact Registry, Cloud Storage, and IAM APIs available. The Cloud
Functions service agent needs its standard `roles/cloudfunctions.serviceAgent`
grant. Confirm the project allows public invocation of this one service.
[Cloud Functions service agents](https://docs.cloud.google.com/functions/docs/concepts/iam) ·
[Gen2 invoker IAM](https://docs.cloud.google.com/functions/docs/securing/authenticating)

Gen2 uses the project's configured default Cloud Build identity. Confirm
which account it uses before applying. It can be the legacy
`PROJECT_NUMBER@cloudbuild.gserviceaccount.com` or the default Compute Engine
account `PROJECT_NUMBER-compute@developer.gserviceaccount.com`. If insufficient,
the project IAM owner must review `roles/logging.logWriter` on the project,
`roles/storage.objectViewer` on the regional Google-managed staging bucket
(`gcf-v2-sources-PROJECT_NUMBER-REGION`) and any upload bucket the build uses,
and `roles/artifactregistry.writer` on the regional `gcf-artifacts` repository.
If a build error names the Terraform source bucket, also verify object read
access to that specific bucket. Keep source and image grants scoped to the
resources that the build uses.
The root does not modify the project default build identity or grant it any
permissions. [Cloud Functions build identities and grants](https://docs.cloud.google.com/functions/docs/building)

Run from the repository root. Use a fresh shell with an approved short-lived
user OAuth token provided in `GOOGLE_OAUTH_ACCESS_TOKEN` for both the backend
and the Google provider. Supply the value through the shell environment and
keep it out of Terraform variables, command arguments, configuration files,
and shell history. The required OAuth scope is `cloud-platform`. Use the
same checkout and Terraform data directory through plan and apply. Disable
shell tracing and clear any local emulator endpoint overrides.
[GCS backend authentication](https://developer.hashicorp.com/terraform/language/backend/gcs) ·
[Google provider authentication](https://registry.terraform.io/providers/hashicorp/google/5.45.0/docs/guides/provider_reference)

```bash
: "${GOOGLE_OAUTH_ACCESS_TOKEN:?Supply an approved user OAuth token in the environment}"
export GOOGLE_OAUTH_ACCESS_TOKEN
export TF_VAR_project_id=intexuraos-dev-pbuchman
export TF_VAR_region=europe-central2
unset STORAGE_EMULATOR_HOST FIRESTORE_EMULATOR_HOST PUBSUB_EMULATOR_HOST
unset GOOGLE_APPLICATION_CREDENTIALS GOOGLE_CREDENTIALS GOOGLE_BACKEND_CREDENTIALS
unset GOOGLE_CLOUD_KEYFILE_JSON GCLOUD_KEYFILE_JSON
unset GOOGLE_IMPERSONATE_SERVICE_ACCOUNT GOOGLE_BACKEND_IMPERSONATE_SERVICE_ACCOUNT

terraform -chdir=terraform/agent-shares init
terraform -chdir=terraform/agent-shares validate
terraform -chdir=terraform/agent-shares plan -out=tfplan
terraform -chdir=terraform/agent-shares show tfplan
```

Review the saved plan for only the resources and bindings above. On first
apply, expect only additions. Keep the reviewed local plan and source files
in place. If needed, refresh the user token in the environment before applying.

```bash
terraform -chdir=terraform/agent-shares apply tfplan
export FUNCTION_ORIGIN="$(terraform -chdir=terraform/agent-shares output -raw function_origin)"
unset GOOGLE_OAUTH_ACCESS_TOKEN
```

Use [`worker/README.md`](worker/README.md) to deploy the Worker with that
`FUNCTION_ORIGIN` in the authorized Cloudflare account. The deploy config
owns the share subdomain only. Existing apex records or routes do not need
changes. Cloudflare needs an active zone and an available custom hostname.
[Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## Authorized smoke test

Use a publisher already authorized to create objects in the content bucket.
For a fresh slug and a local `share-smoke.html` fixture, set `EXPIRY` to a
near-future RFC 3339 UTC timestamp. Supply the publisher's existing user OAuth
token via `CLOUDSDK_AUTH_ACCESS_TOKEN`. Use `--custom-time` for this expiring
fixture so it qualifies for lifecycle cleanup.
[Storage upload options](https://docs.cloud.google.com/sdk/gcloud/reference/storage/cp)

```bash
: "${CLOUDSDK_AUTH_ACCESS_TOKEN:?Supply an approved publisher OAuth token in the environment}"
export CLOUDSDK_AUTH_ACCESS_TOKEN
gcloud storage cp ./share-smoke.html \
  --project="${TF_VAR_project_id:-intexuraos-dev-pbuchman}" \
  "gs://intexuraos-agent-shares-dev-pbuchman/${SLUG:?Set a fresh slug}.html" \
  --custom-time="${EXPIRY:?Set the share expiry}" --if-generation-match=0 \
  --content-type='text/html; charset=utf-8' --cache-control=no-store
unset CLOUDSDK_AUTH_ACCESS_TOKEN
```

Run these checks before and after `EXPIRY`. Expect `200` before expiry, the
fixture on GET, and the browser security headers on both methods. After expiry,
expect `410` while the object exists or `404` after lifecycle removal.

```bash
for check_url in "https://share.intexuraos.cloud/${SLUG}.html" "${FUNCTION_ORIGIN%/}/${SLUG}.html"; do
  curl -q -sS -i "$check_url"
  curl -q -sSI "$check_url"
done
```

Verify anonymous GCS access fails for both the object and the listing API.
Check an existing apex `/share/` URL before and after rollout using a known
legacy object. Its status and body should match.

```bash
curl -q -sS -o /dev/null -w '%{http_code}\n' \
  "https://storage.googleapis.com/intexuraos-agent-shares-dev-pbuchman/${SLUG}.html"
curl -q -sS -o /dev/null -w '%{http_code}\n' \
  'https://storage.googleapis.com/storage/v1/b/intexuraos-agent-shares-dev-pbuchman/o'
```
